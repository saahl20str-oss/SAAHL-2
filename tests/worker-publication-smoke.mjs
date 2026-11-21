import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const root = 'http://127.0.0.1:8781/';
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined});
const server = spawn('python3',['-m','http.server','8781','--bind','127.0.0.1'],{stdio:'ignore'});
const officeId = '00000000-0000-4000-8000-000000000010';
const legacyId = '00000000-0000-4000-8000-000000000020';
const testSdk = `
window.supabase={createClient:(_url,_key,options)=>{
  if(location.pathname.endsWith('marketplace.html') && (options?.auth?.persistSession!==false || options.auth.detectSessionInUrl!==false))
    throw Error('public directory is sharing a session');
  const officeId='${officeId}', legacyId='${legacyId}';
  const office={id:officeId,owner_id:'owner',name:'مكتب تجربة',status:'approved'};
  const get=()=>JSON.parse(localStorage.workerFixture || JSON.stringify([{id:legacyId,office_id:officeId,
    display_name:'ملف محفوظ',nationality:'الهند',age:31,status:'available',publication_consent_at:null}]));
  const set=rows=>{localStorage.workerFixture=JSON.stringify(rows);};
  const readRequests=()=>JSON.parse(localStorage.consentFixture || '{}');
  const saveRequests=r=>{localStorage.consentFixture=JSON.stringify(r);};
  const success=data=>({data,error:null});
  return {
    auth:{getUser:async()=>success({user:{id:'owner'}})},
    storage:{from:()=>({upload:async()=>success({}),remove:async()=>success({}),
      createSignedUrl:async()=>success({signedUrl:location.origin+'/saahl-logo.png'}),
      download:async()=>success(new Blob(['test'],{type:'image/png'}))
    })},
    from(table){
      let filters={}, needsConsent=false, payload, mode='read';
      const result=()=>{
        if(table==='offices') return success([office]);
        if(table!=='workers') return success([]);
        let rows=get();
        if(mode==='insert'){
          const row={id:crypto.randomUUID(),...payload};
          set([...rows,row]);return success([row]);
        }
        if(mode==='update'){
          rows=rows.map(w=>w.id===filters.id?{...w,...payload}:w);set(rows);
        }
        if(location.pathname.endsWith('marketplace.html')&&!needsConsent) throw Error('missing public consent filter');
        return success(rows.filter(w=>(!filters.id||filters.id===w.id)&&(!filters.status||filters.status===w.status)
          &&(!needsConsent||w.publication_consent_at)).map(w=>({...w,offices:office})));
      };
      const q={select(){return q},eq(key,value){filters[key]=value;return q},in(){return q},order(){return q},limit(){return q},
        not(key,comparison,value){needsConsent=key==='publication_consent_at'&&comparison==='is'&&value===null;return q},
        insert(data){mode='insert';payload=data;return q},update(data){mode='update';payload=data;return q},
        maybeSingle:async()=>success(result().data[0]||null),
        single:async()=>success(result().data[0]),
        then(ok,bad){return Promise.resolve(result()).then(ok,bad)}
      };return q;
    },
    async rpc(name,args){
      const rows=get(), requests=readRequests();
      const worker=rows.find(w=>w.id===args.p_worker);
      if(name==='saahl2_office_publication_states'){
        return success(rows.map(w=>{const r=requests[w.id];return {worker_id:w.id,state:w.publication_consent_at?'documented':r?.state||'new',photo_allowed:r?.photo||false}}));
      }
      if(name==='saahl2_request_worker_publication'){
        const token=crypto.randomUUID().replaceAll('-','').repeat(2);
        requests[worker.id]={workerId:worker.id,token,state:'pending'};saveRequests(requests);return success({token});
      }
      if(name==='saahl2_set_worker_publication_preview'){
        requests[worker.id].url=args.p_url;saveRequests(requests);return success(null);
      }
      if(name==='saahl2_worker_publication_link'){
        const r=Object.values(requests).find(row=>row.token===args.p_token);
        if(!r)return success(null);
        if(args.p_approve!==undefined){
          r.state=args.p_approve?'approved':'declined';r.photo=args.p_photo;
          saveRequests(requests);return success({status:r.state});
        }
        const w=rows.find(row=>row.id===r.workerId);
        return success({status:r.state,office:office.name,photo_url:r.url,profile:{name:w.display_name,number:w.worker_number,nationality:w.nationality,age:w.age}});
      }
      if(name==='saahl2_publish_office_worker'){
        const r=requests[worker.id];
        if(r?.state!=='approved')throw Error('approval missing');
        worker.status='available';worker.publication_consent_at=new Date().toISOString();worker.photo_url=r.photo?r.url:null;
        set(rows);return success(null);
      }
      throw Error('Unexpected RPC: '+name);
    }
  };
}};
`;

async function noOverflow(page){
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
}

try{
  await new Promise(resolve=>setTimeout(resolve,500));
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-AE'});
  await context.route('**/*supabase-js@2*',route=>route.fulfill({contentType:'application/javascript',body:testSdk}));
  await context.route('https://fonts.googleapis.com/**',route=>route.abort());
  const office=await context.newPage();
  await office.goto(root+'office.html');
  const legacy=office.locator('.worker-card').filter({hasText:'ملف محفوظ'});
  await legacy.getByRole('button',{name:'طلب موافقة النشر'}).waitFor();
  assert.equal(await office.locator('#availableWorkers').textContent(),'0');
  await noOverflow(office);

  await office.getByRole('button',{name:'+ إضافة عاملة',exact:true}).click();
  await office.locator('#workerName').fill('ملف تجريبي');
  await office.locator('#workerNumber').fill('TEST-102');
  await office.locator('#nationality').selectOption({label:'الهند'});
  await office.locator('#age').fill('34');
  await office.locator('#workerPhotoFile').setInputFiles('saahl-logo.png');
  await office.getByRole('button',{name:'حفظ ومتابعة'}).click();
  const dialog=office.getByRole('dialog',{name:'موافقة العاملة على النشر'});
  await dialog.getByRole('button',{name:'إنشاء رابط الموافقة'}).click();
  await dialog.getByRole('button',{name:'نسخ الرابط'}).waitFor();
  await noOverflow(office);
  const link=await office.locator('#publicationLink').inputValue();
  assert.match(link,/#\w{64}$/);
  await dialog.getByRole('button',{name:'العودة للوحة المكتب'}).click();
  await office.getByText('بانتظار موافقة العاملة').waitFor();

  const market=await context.newPage();
  await market.goto(root+'marketplace.html');
  await market.getByText('مكتب تجربة',{exact:true}).waitFor();
  assert.equal(await market.locator('.office-count strong').textContent(),'0');

  const consent=await context.newPage();
  await consent.setViewportSize({width:320,height:740});
  await consent.goto(link);
  await consent.getByText('ملف تجريبي',{exact:true}).waitFor();
  await consent.locator('#photoPreview').waitFor();
  await noOverflow(consent);
  assert.ok(await consent.locator('#approve').isDisabled());
  await consent.locator('#consentLanguage').selectOption('en');
  await consent.getByText('I also agree to have this photo published (optional).').waitFor();
  await consent.locator('#profileConsent').check();
  await consent.getByRole('button',{name:'Record my consent'}).click();
  await consent.getByText(/Your consent has been recorded/).waitFor();

  const refresh=office.getByRole('button',{name:'تحديث حالة النشر'});
  if(await refresh.isVisible()) await refresh.click();
  await office.getByText('جاهزة للنشر').waitFor();
  await office.getByRole('button',{name:'انشر في البحث'}).click();
  await office.getByText('منشورة في بحث الكفيل').waitFor();
  await market.reload();
  await market.getByText('مكتب تجربة',{exact:true}).waitFor();
  assert.equal(await market.locator('.office-count strong').textContent(),'1');
  assert.equal(await office.evaluate(()=>JSON.parse(localStorage.workerFixture).find(w=>w.worker_number==='TEST-102').photo_url),null);
  assert.equal(await market.getByText('ملف محفوظ',{exact:true}).count(),0);

  await office.setViewportSize({width:1280,height:800});
  await noOverflow(office);
  console.log('Office draft, legacy entry, private photo preview, optional photo, publication and public search passed (320px, 390px and desktop).');
  await context.close();
}finally{
  await browser.close();
  server.kill();
}

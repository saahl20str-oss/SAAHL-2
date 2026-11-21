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
    display_name:'ملف محفوظ',nationality:'الهند',age:31,status:'available',photo_url:'https://example.com/approved.png',publication_consent_at:null}]));
  const set=rows=>{localStorage.workerFixture=JSON.stringify(rows);};
  const success=data=>({data,error:null});
  const testingSignup=new URLSearchParams(location.search).has('testSignup');
  return {
    auth:{
      getUser:async()=>success({user:testingSignup?null:{id:'owner'}}),
      async signUp(){
        await new Promise(resolve=>setTimeout(resolve,400));
        return {data:null,error:{status:500,message:'Error sending confirmation email'}};
      }
    },
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
      const rows=get();
      const worker=rows.find(w=>w.id===args.p_worker);
      if(name==='saahl2_publish_with_office_attestation'){
        if(!worker||args.p_data_confirmed!==true) throw Error('missing office attestation');
        const photo=worker.publication_photo_draft||worker.photo_url;
        if(args.p_include_photo&&args.p_confirmed_photo!==photo) throw Error('wrong photo');
        worker.status='available';
        worker.publication_consent_at=new Date().toISOString();
        worker.photo_url=args.p_include_photo?photo:null;
        set(rows);return success(null);
      }
      throw Error('Unexpected RPC: '+name);
    }
  };
}};
`;

async function noOverflow(page){
  const layout=await page.evaluate(()=>({
    width:innerWidth,scroll:document.documentElement.scrollWidth,
    overflowing:[...document.querySelectorAll('body *')].filter(e=>{
      const r=e.getBoundingClientRect();
      return (r.left < -1 || r.right > innerWidth+1) && r.width > 0;
    }).slice(0,8).map(e=>e.id||e.className||e.tagName)
  }));
  assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));
}

try{
  await new Promise(resolve=>setTimeout(resolve,500));
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-AE'});
  await context.route('**/*supabase-js@2*',route=>route.fulfill({contentType:'application/javascript',body:testSdk}));
  await context.route('https://fonts.googleapis.com/**',route=>route.abort());
  await context.route('https://example.com/approved.png',route=>route.fulfill({path:'saahl-logo.png',contentType:'image/png'}));
  const office=await context.newPage();
  await office.goto(root+'office.html');
  const legacy=office.locator('.worker-card').filter({hasText:'ملف محفوظ'});
  await legacy.getByRole('button',{name:'انشر في البحث'}).waitFor();
  assert.equal(await office.locator('#availableWorkers').textContent(),'0');
  await noOverflow(office);

  await office.getByRole('button',{name:'+ إضافة عاملة',exact:true}).click();
  await office.locator('#workerName').fill('ملف تجريبي');
  await office.locator('#workerNumber').fill('TEST-102');
  await office.locator('#nationality').selectOption({label:'الهند'});
  await office.locator('#age').fill('34');
  await office.locator('#workerPhotoFile').setInputFiles('saahl-logo.png');
  await office.getByRole('button',{name:'حفظ ومتابعة للنشر'}).click();
  const dialog=office.getByRole('dialog',{name:'نشر ملف العاملة'});
  await dialog.waitFor();
  assert.ok(await dialog.getByRole('button',{name:'نشر في البحث'}).isDisabled());
  assert.ok(await office.locator('#confirmPublicationPhoto').isVisible());
  assert.ok(!(await office.locator('#confirmPublicationPhoto').isChecked()));
  await noOverflow(office);

  const market=await context.newPage();
  await market.goto(root+'marketplace.html');
  await market.getByText('مكتب تجربة',{exact:true}).waitFor();
  assert.equal(await market.locator('.office-count strong').textContent(),'0');

  await office.setViewportSize({width:320,height:740});
  await noOverflow(office);
  await office.locator('#confirmPublicationData').check();
  await dialog.getByRole('button',{name:'نشر في البحث'}).click();
  await office.getByText('منشورة في بحث الكفيل').waitFor();
  await market.reload();
  await market.getByText('مكتب تجربة',{exact:true}).waitFor();
  assert.equal(await market.locator('.office-count strong').textContent(),'1');
  assert.equal(await office.evaluate(()=>JSON.parse(localStorage.workerFixture).find(w=>w.worker_number==='TEST-102').photo_url),null);

  await legacy.getByRole('button',{name:'انشر في البحث'}).click();
  await office.locator('#confirmPublicationData').check();
  await office.locator('#confirmPublicationPhoto').check();
  await dialog.getByRole('button',{name:'نشر في البحث'}).click();
  await legacy.getByText('منشورة في بحث الكفيل').waitFor();
  await market.reload();
  await market.getByText('مكتب تجربة',{exact:true}).waitFor();
  assert.equal(await market.locator('.office-count strong').textContent(),'2');
  assert.equal(await office.evaluate(()=>JSON.parse(localStorage.workerFixture).find(w=>w.display_name==='ملف محفوظ').photo_url),'https://example.com/approved.png');
  await market.getByRole('button',{name:'عرض عاملات المكتب'}).click();
  const checkboxes=market.getByRole('checkbox',{name:'مقارنة',exact:true});
  await checkboxes.first().waitFor();
  assert.equal(await checkboxes.count(),2);
  await checkboxes.first().check();
  await checkboxes.last().check();
  assert.ok(await market.locator('#compareBtn').isEnabled());
  for(const width of [320,390,760,1280]){
    await market.setViewportSize({width,height:844});
    await noOverflow(market);
    const checkbox=await checkboxes.first().boundingBox();
    const label=await market.locator('.cmp-label span').first().boundingBox();
    assert.equal(checkbox.width,16);
    assert.ok(label.height<25,'Compare text wraps on a profile card');
  }

  const signup=await context.newPage();
  await signup.goto(root+'office.html?register=1&testSignup=1');
  await signup.locator('#email').fill('office-fixture@example.com');
  await signup.locator('#password').fill('Synthetic-password-2026');
  for(const id of ['officeTerms','officePrivacyRead','officePrivacyConsent']) await signup.locator('#'+id).check();
  const signupButton=signup.locator('#signup');
  await signupButton.click();
  assert.ok(await signupButton.isDisabled());
  await signup.getByText('خدمة البريد غير متاحة حاليًا', {exact:false}).waitFor();
  assert.ok(await signupButton.isEnabled());
  await noOverflow(signup);

  const profilePhoto=legacy.getByRole('img',{name:'صورة العاملة'});
  await profilePhoto.scrollIntoViewIfNeeded();
  await profilePhoto.waitFor();
  assert.equal(await profilePhoto.evaluate(img=>getComputedStyle(img).objectFit),'contain');
  for(const width of [320,390,1280]){
    await office.setViewportSize({width,height:844});
    await noOverflow(office);
    for(const button of await legacy.getByRole('button').all()){
      assert.ok((await button.boundingBox()).height>=44,'Office card control is too short');
    }
  }
  await legacy.getByRole('button',{name:'عرض السيرة الذاتية'}).click();
  await office.locator('#cvModal').waitFor();
  await office.locator('#closeCV').click();
  await legacy.getByRole('button',{name:'تعديل البيانات'}).click();
  assert.equal(await office.locator('#workerName').inputValue(),'ملف محفوظ');
  await office.locator('#cancelWorker').click();
  await legacy.getByRole('combobox',{name:'حالة التوفر'}).selectOption('unavailable');
  await legacy.getByText('غير منشورة في البحث').waitFor();
  await legacy.getByRole('combobox',{name:'حالة التوفر'}).selectOption('available');
  await legacy.getByText('منشورة في بحث الكفيل').waitFor();

  await office.setViewportSize({width:1280,height:800});
  await noOverflow(office);
  console.log('Office attestation, required checkbox, optional photo, existing profile, public search, card comparison, office card controls and signup feedback passed (320px, 390px and desktop).');
  await context.close();
}finally{
  await browser.close();
  server.kill();
}

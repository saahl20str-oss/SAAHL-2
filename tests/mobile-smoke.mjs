import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const server=spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],{stdio:'ignore'});
let fails=0, checks=0;
const pages=['index.html','kafala.html','office.html','marketplace.html','advertise.html','admin.html'];
const widths=[320,360,390,430,768,1280];
const browser=await chromium.launch({headless:true});
await mkdir('mobile-preview',{recursive:true});
try {
 await delay(1500);
 for(const page of pages) {
  for(const width of widths) {
   const context=await browser.newContext({viewport:{width,height:780},deviceScaleFactor:1,locale:'ar-AE',isMobile:width<500,hasTouch:width<500});
   const tab=await context.newPage();
   const errors=[];
   tab.on('pageerror',e=>errors.push(String(e.message).slice(0,180)));
   let status='error',overflow=0,meta=false;
   try{
    const res=await tab.goto('http://127.0.0.1:8765/'+page,{waitUntil:'domcontentloaded',timeout:20000});
    status=res?.status()??0;
    await tab.waitForTimeout(600);
    const obj=await tab.evaluate(()=>({overflow:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth??0)-innerWidth,meta:!!document.querySelector('link[rel="manifest"]'),css:!!document.querySelector('link[href*="mobile-first.css"]')}));
    overflow=obj.overflow;meta=obj.meta&&obj.css;
    if(page==='index.html'){
      const layout=await tab.evaluate(()=>{
        const rules=document.getElementById('saahl-home-mobile-layout').sheet;
        const sections=['#how','#types','.cta-section','footer'];
        const heights=()=>sections.map(selector=>document.querySelector(selector).offsetHeight);
        const after=heights();
        const routes=[...document.querySelectorAll('#types a.type-card')].map(card=>[
          card.getAttribute('href'),card.querySelectorAll('.type-feat').length,card.querySelector('.type-btn').offsetHeight
        ]);
        rules.disabled=true;
        const before=heights();
        rules.disabled=false;
        return {before,after,routes,footerLinks:document.querySelectorAll('footer a').length};
      });
      const small=width<=700;
      const routes=layout.routes.map(([route])=>route).join(',')==='marketplace.html,office.html?register=1,kafala.html';
      const complete=routes&&layout.routes.every(([,features,tapHeight])=>features===4&&(!small||tapHeight>=44))&&layout.footerLinks===14;
      const sectionsFit=small
        ? layout.after.every((height,index)=>height<layout.before[index])
        : layout.after.every((height,index)=>height===layout.before[index]);
      const landingPass=complete&&sectionsFit;
      if(!landingPass)fails++;
      checks++;
      console.log(JSON.stringify({width,landingLayout:layout,pass:landingPass}));
    }
    if(width===390 || width===1280) await tab.screenshot({path:'mobile-preview/'+page.replace('.html','')+'-'+width+'.png',fullPage:true});
    if(status!==200 || overflow>2 || !meta)fails++;
    checks++;
    console.log(JSON.stringify({page,width,http:status,overflow,assetsLinked:meta,pageErrors:errors.slice(0,3),pass:status===200&&overflow<=2&&meta}));
   }catch(e){fails++;checks++;console.log(JSON.stringify({page,width,error:String(e).slice(0,220),pass:false}));}
   await context.close();
  }
 }
 // Check secondary entry points and mobile-only styles, including signed-out pages.
 const secondary=['legal.html','reset-password.html','worker-consent.html','worker-publication.html','worker.html','admin-offices.html','login.html','office-dashboard.html','search.html','office-login.html','contracts.html','register-office.html','register-sponsor.html','sponsor-dashboard.html','search-choice.html','ai-search.html'];
 const compactPages=['marketplace.html','office.html','kafala.html','advertise.html','admin.html'];
 const origin='http://127.0.0.1:8765';
 const toolchain=['.site-header','.office-navbar','.list-hero','.hero','.ct'];
 for(const width of [320,390,1280]){
   const ctx=await browser.newContext({viewport:{width,height:740},hasTouch:width<500});
   try{
     await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
     const page=await ctx.newPage();
     for(const name of [...compactPages,...secondary]){
       const response=await page.goto(origin+'/'+name,{waitUntil:'domcontentloaded'});
       const state=await page.evaluate(({selector,checkFilter})=>{
         const style=document.getElementById('saahl-phone-layout')?.sheet;
         const target=selector?document.querySelector(selector):null;
         const snapshot=()=> target?[
           target.offsetHeight,getComputedStyle(target).padding,
           getComputedStyle(target).display,getComputedStyle(target).gap
         ].join('|'):null;
         const current=snapshot();
         if(style)style.disabled=true;
         const original=snapshot();
         if(style)style.disabled=false;
         let filterFits=true;
         if(checkFilter){
           const dialog=document.getElementById('filterSheet');
           dialog.showModal();
           const box=dialog.getBoundingClientRect();
           filterFits=box.width<=innerWidth+1&&box.height<=innerHeight+1&&dialog.scrollWidth<=dialog.clientWidth+2;
           dialog.close();
         }
         return {overflow:document.documentElement.scrollWidth-innerWidth,
           desktopStable:!style||current===original,
           styleApplied:!!style&&matchMedia('(max-width:600px)').matches,filterFits};
       },{selector:toolchain[compactPages.indexOf(name)]??null,checkFilter:name==='marketplace.html'});
       const pass=response?.ok()&&state.overflow<=2&&state.filterFits&&
         (width>600?state.desktopStable:!compactPages.includes(name)||state.styleApplied);
       if(!pass)fails++;
       checks++;
       console.log(JSON.stringify({page:name,width,phoneScope:state,pass}));
     }
   }finally{await ctx.close();}
 }
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const tab=await context.newPage();
 await tab.goto('http://127.0.0.1:8765/index.html');
 const manifest=await tab.evaluate(async()=>{const x=await fetch('./manifest.webmanifest');const j=await x.json();return {status:x.status,name:j.name,display:j.display,icons:j.icons?.length}});
 checks++;if(manifest.status!==200||manifest.display!=='standalone'||!manifest.icons)fails++;
 console.log(JSON.stringify({pwaManifest:manifest}));
 await context.close();
 const iphone=await browser.newContext({
   viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ar-AE',
   userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
 });
 // A Chromium user-agent override does not disable Chromium-only install capabilities.
 await iphone.addInitScript(() => {
   Object.defineProperty(navigator,'install',{value:undefined,configurable:true});
   window.addEventListener('beforeinstallprompt',event=>{
     event.preventDefault();
     event.stopImmediatePropagation();
   },{capture:true});
 });
 const iosPage=await iphone.newPage();
 await iosPage.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
 const install=iosPage.locator('#mainNav .nav-login + .nav-install .saahl-install-btn');
 await install.waitFor({state:'visible'});
 await install.click();
 const iosPanel=await iosPage.locator('#saahl-ios-install-info').isVisible();
 checks++; if(!iosPanel)fails++;
 console.log(JSON.stringify({test:'iOS Safari home-screen guidance',pass:iosPanel}));
 await iphone.close();
 for(const width of [320,390,1280]){
   const ctx=await browser.newContext({viewport:{width,height:844}});
   await ctx.route('**/*supabase-js@2*',route=>route.fulfill({
     contentType:'application/javascript',
     body:`window.adminOfficeRows=[
       {id:'office-1',name:'مكتب معتمد',license_number:'QA-11',status:'approved'},
       {id:'office-2',name:'مكتب جديد',license_number:'QA-22',status:'pending'}
     ];
     window.adminAdRows=[
       {id:'archived-ad',ad_topic:'إعلان سابق',status:'approved',advertiser_name:'مكتب معتمد',ad_details:'تفاصيل سابقة'},
       {id:'pending-ad',ad_topic:'عاملة متاحة: طلب جديد',status:'pending',advertiser_name:'مكتب جديد',ad_details:'خبرة: 3 سنوات',worker_photo_url:'https://hkfxikmpfgixrbrboxeb.supabase.co/storage/v1/object/public/mock/worker.png'}
     ];
     window.supabase={createClient:()=>({
       auth:{getSession:async()=>({data:{session:null}})},
       rpc:async name=>({data:name==='saahl2_office_license_review'
         ? {has_attachment:true,contact_email:'office@example.com',attachment_path:'office-2/revision-qa',submitted_at:'2026-11-22'}:[],error:null}),
       storage:{from:()=>({download:async path=>({data:path==='office-2/revision-qa'?new Blob(['%PDF-1.4'],{type:'application/pdf'}):null,error:null})})},
       from(table){
         let head=false, status;
         const query={
           select(_fields,options){head=options?.head;return query;},
           eq(key,value){if(key==='status')status=value;return query;},
           gte(){return query;}, order(){return query;}, limit(){return query;},
           then(resolve,reject){
             const rows=table==='offices'?window.adminOfficeRows.filter(o=>!status||o.status===status):
               table==='strip_ads'?window.adminAdRows:[];
             return Promise.resolve({data:head?null:rows,count:rows.length,error:null}).then(resolve,reject);
           }
         };
         return query;
       }
     })};`
   }));
   await ctx.route('**/storage/v1/object/public/mock/worker.png',route=>route.fulfill({path:'saahl-logo.png'}));
   const page=await ctx.newPage();
   await page.goto('http://127.0.0.1:8765/admin.html',{waitUntil:'domcontentloaded'});
   await page.evaluate(()=>showApp());
   const queue=page.getByRole('button',{name:'مراجعة طلبات المكاتب'});
   await queue.waitFor();
   const firstBadge=await page.locator('#office-pending-badge').textContent();
   await queue.click();
   const newOffice=page.locator('.office-card').filter({hasText:'مكتب جديد'});
   await newOffice.waitFor();
   const compact=await newOffice.getByRole('button',{name:'توثيق الرخصة'}).count()===0&&
     await newOffice.getByText('QA-22',{exact:true}).isVisible();
   await newOffice.getByRole('button',{name:'التفاصيل'}).click();
   const officeDialog=page.getByRole('dialog',{name:'تفاصيل طلب المكتب'});
   await officeDialog.waitFor();
   const mailOffice=officeDialog.getByRole('link',{name:'مراسلة المكتب بالبريد'});
   await mailOffice.waitFor();
   const emailReady=(await mailOffice.getAttribute('href')).startsWith('mailto:office@example.com?');
   await officeDialog.getByRole('button',{name:'عرض الرخصة'}).click();
   await officeDialog.getByRole('link',{name:'فتح الرخصة في تبويب جديد'}).waitFor();
   const pdfPreview=await officeDialog.locator('iframe[title="معاينة نسخة الرخصة PDF"]').isVisible();
   const officeControls=(await officeDialog.getByRole('button',{name:'توثيق الرخصة'}).isVisible())&&
     (await officeDialog.getByRole('button',{name:'تنزيل نسخة الرخصة'}).isVisible())&&
     (await officeDialog.getByRole('button',{name:'اعتماد المكتب'}).isVisible())&&
     (await officeDialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2));
   await officeDialog.getByRole('button',{name:'إغلاق',exact:true}).click();
   await officeDialog.waitFor({state:'hidden'});
   const focusRestored=await newOffice.getByRole('button',{name:'التفاصيل'}).evaluate(el=>document.activeElement===el);
   const onlyPending=await page.locator('.office-card').count()===1;
   await page.evaluate(async()=>{
     window.adminOfficeRows[1].status='approved';
     await refreshOfficeQueue();
   });
   await page.locator('#office-pending-badge').waitFor({state:'hidden'});
   await page.getByText('لا توجد مكاتب تطابق البحث أو الحالة المختارة.').waitFor();
   await page.getByLabel('حالة المكتب').selectOption('');
   const tones=await page.locator('.office-card').evaluateAll(cards=>cards.map(card=>getComputedStyle(card).backgroundColor));
   const distinctTones=tones.length===2&&new Set(tones).size===2;
   await page.getByRole('searchbox',{name:'البحث عن مكتب'}).fill('QA-22');
   await newOffice.getByText('معتمد',{exact:true}).waitFor();
   const officeFits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2);
   const officePass=firstBadge==='1'&&onlyPending&&compact&&officeControls&&emailReady&&pdfPreview&&focusRestored&&distinctTones&&officeFits&&await page.locator('.office-card').count()===1;
   checks++;
   if(!officePass)fails++;
   console.log(JSON.stringify({width,officeApprovalCards:officePass}));
   await page.evaluate(async()=>{
      const result={office_id:'12345678-4321-4321-4321-123456789abc',name:'مكتب نموذجي',emirate:'دبي',display_name:'عاملة تجريبية',nationality:'كينيا',worker_number:'W-77',age:29,experience_years:3};
      const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:result})};
      await window.SaahlWorkerCard.open({
        ad_topic:'إعلان تجريبي',advertiser_name:'معلن تجريبي',status:'pending',phone:'0500000000',
        worker_id:'87654321-4321-4321-4321-123456789abc',office_id:result.office_id,
        worker_photo_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAoCAIAAABrb60CAAAALElEQVR4nGPcOj2JgRqAiSqmjBo0atCoQaMGjRo0atCoQaMGjRo0atCwMAgA+nsB/oHiI1YAAAAASUVORK5CYII='
      },{parts:['تفاصيل محفوظة'],photo:''},{from:()=>chain},location.origin);
   });
   const dialog=page.getByRole('dialog',{name:'إعلان تجريبي'});
   const good=await dialog.evaluate(element=>({
     fits:element.scrollWidth===element.clientWidth&&element.getBoundingClientRect().width<=innerWidth,
     photo:getComputedStyle(element.querySelector('img')).objectFit==='contain',
     text:element.textContent.includes('مكتب نموذجي')&&element.textContent.includes('W-77')&&element.textContent.includes('تفاصيل محفوظة')
   }));
   await dialog.getByRole('button',{name:'إغلاق'}).click();
   const closed=await dialog.isHidden();
   checks++;
   if(!Object.values(good).every(Boolean)||!closed)fails++;
   console.log(JSON.stringify({width,workerPreview:{...good,closed}}));
   await page.evaluate(()=>navTo('overview'));
   const review=page.getByRole('button',{name:/مراجعة إعلانات الشريط/});
   await review.getByText('1',{exact:true}).waitFor();
   await review.click();
   const pending=page.locator('#ads-wrap .ad-awaiting-review');
   await pending.waitFor();
   const previous=page.locator('#ads-history');
   const old=previous.getByText('إعلان سابق',{exact:true});
   const initiallyCollapsed=await old.isHidden();
   const pendingColor=await pending.evaluate(el=>getComputedStyle(el).backgroundColor);
   const imageReady=await pending.locator('img').evaluate(img=>img.decode().then(
     ()=>getComputedStyle(img).objectFit==='contain'&&img.offsetHeight>=76,()=>false));
   const approvalVisible=await pending.getByRole('button',{name:'موافقة ونشر'}).isVisible();
   await pending.getByRole('button',{name:'عرض العاملة'}).click();
   const adPreview=page.getByRole('dialog',{name:'عاملة متاحة: طلب جديد'});
   await adPreview.getByRole('button',{name:'إغلاق'}).click();
   await previous.locator('summary').click();
   await old.waitFor();
   const archiveColor=await old.evaluate(el=>getComputedStyle(el.closest('article')).backgroundColor);
   await page.evaluate(()=>{window.adminAdRows[1].status='approved'});
   await page.getByRole('button',{name:'تحديث القائمة',exact:true}).click();
   await page.getByText('لا توجد طلبات إعلانات بانتظار المراجعة.').waitFor();
   const restored=await previous.getByText('عاملة متاحة: طلب جديد',{exact:true}).isVisible();
   const adsFit=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2);
   const adsPass=initiallyCollapsed&&pendingColor!==archiveColor&&imageReady&&approvalVisible&&restored&&adsFit;
   checks++;if(!adsPass)fails++;
   console.log(JSON.stringify({width,adminAdsReview:{initiallyCollapsed,imageReady,approvalVisible,restored,adsFit,pass:adsPass}}));
   await ctx.close();
 }
 // Published ads share one marquee; every button opens its own details.
 const stripOrigin='http://127.0.0.1:8765';
 const workerId='87654321-4321-4321-4321-123456789abc';
 const officeId='12345678-4321-4321-4321-123456789abc';
 const profileUrl=stripOrigin+'/marketplace.html#worker='+workerId;
 const office={id:officeId,name:'مكتب تجريبي',status:'approved',emirate:'دبي'};
 const worker={id:workerId,office_id:officeId,offices:office,display_name:'عاملة تجريبية',nationality:'كينيا'};
 const ad={id:workerId,placement:'strip',ad_topic:'عاملة متاحة: W-77',advertiser_name:'مكتب تجريبي',
   ad_details:'الجنسية: كينيا | رابط العاملة: '+profileUrl};
 const otherAd={id:officeId,placement:'strip',ad_topic:'خدمات مكتب ثانٍ',
   advertiser_name:'مكتب ثانٍ',ad_details:'تفاصيل الإعلان الثاني',whatsapp:'0501234567'};
 const stripSdk=`window.supabase={createClient:()=>({from:table=>({
   select(){return this},in(){return this},eq(){return this},not(){return this},order(){return this},
   limit:async()=>({data:({strip_ads:${JSON.stringify([ad,otherAd])},offices:[${JSON.stringify(office)}],workers:[${JSON.stringify(worker)}]})[table]||[]})
 })})};`;
 for(const width of [320,1280]){
   const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'no-preference'});
   try{
     await ctx.route('**/*',route=>new URL(route.request().url()).origin===stripOrigin?route.continue():route.abort());
     await ctx.route(/supabase-js@2/,route=>route.fulfill({contentType:'application/javascript',body:stripSdk}));
     const page=await ctx.newPage();
     await page.goto(stripOrigin+'/index.html');
     const first=page.getByRole('button',{name:'عرض التفاصيل — مكتب تجريبي',exact:true});
     await first.waitFor();
     const motion=await page.locator('.saahl-ad-rail').evaluate(async rail=>{
       const animation=rail.getAnimations().find(item=>item.animationName==='saahl-ad-marquee');
       if(!animation)return false;
       animation.pause();
       await animation.ready;
       const duration=animation.effect.getComputedTiming().duration;
       const [original,repeat]=rail.children;
       const x=time=>{animation.currentTime=time;return rail.getBoundingClientRect().x;};
       const start=x(0);
       const quarter=x(duration/4);
       const middle=x(duration/2);
       const final=x(duration-10);
       return quarter>start+5 && middle>quarter+5 && final>middle+5 &&
         Math.abs((quarter-start)/(duration/4000)-40)<2 &&
         original.children.length===4 && repeat.children.length===4;
     });
     const dividers=page.locator('.saahl-ad-group:not([aria-hidden]) .saahl-ad-divider');
     const logoDivider=await dividers.count()===2 &&
       await dividers.first().evaluate(node=>getComputedStyle(node).backgroundImage.includes('/saahl-logo.png'));
     const noArrows=await page.locator('#saahl-ad-prev,#saahl-ad-next').count()===0;
     await page.emulateMedia({reducedMotion:'reduce'});
     await page.getByRole('button',{name:'عرض التفاصيل — خدمات مكتب ثانٍ'}).click();
     const dialog=page.locator('#adDetailOverlay');
     const secondCorrect=(await dialog.textContent()).includes('تفاصيل الإعلان الثاني') &&
       (await dialog.getByRole('link',{name:'تواصل عبر واتساب'}).getAttribute('href')).includes('971501234567');
     await page.getByRole('button',{name:'إغلاق',exact:true}).click();
     await first.click();
     const firstCorrect=(await dialog.textContent()).includes('الجنسية: كينيا') &&
       !(await dialog.textContent()).includes('تفاصيل الإعلان الثاني');
     const link=page.getByRole('link',{name:'عرض ملف العاملة'});
     const sameTarget=await link.getAttribute('target')==='_self';
     if(sameTarget)await Promise.all([page.waitForURL(profileUrl),link.click()]);
     const profileOpened=sameTarget && await page.locator('#cvModal').waitFor({state:'visible',timeout:5000}).then(()=>true,()=>false);
     const onePage=ctx.pages().length===1;
     if(profileOpened){
       await page.goBack();
       await page.locator('#adDetailOverlay').waitFor({state:'hidden',timeout:5000});
     }
     checks++;
     const pass=motion&&logoDivider&&noArrows&&firstCorrect&&secondCorrect&&profileOpened&&onePage;
     if(!pass)fails++;
     console.log(JSON.stringify({width,adStrip:{motion,logoDivider,noArrows,firstCorrect,secondCorrect,profileOpened,onePage,pass}}));
   }finally{await ctx.close();}
 }
 for(const asset of ['saahl-pwa-192.png','saahl-pwa-512.png','apple-touch-icon.png']){
   const ctx=await browser.newContext();
   const tab=await ctx.newPage();
   const response=await tab.request.get('http://127.0.0.1:8765/'+asset);
   const bytes=await response.body();
   const png=response.status()===200 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   checks++;if(!png)fails++;
   console.log(JSON.stringify({asset,status:response.status(),pass:png}));
   await ctx.close();
 }
} finally {await browser.close();server.kill();}
console.log(JSON.stringify({checks,failed:fails}));
if(fails)process.exitCode=1;

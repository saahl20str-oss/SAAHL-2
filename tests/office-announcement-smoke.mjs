import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const html=await readFile('admin.html','utf8');
if(html.includes('view.href=parsed.worker')) throw Error('Unsafe external worker navigation remains');
if(!html.includes('showSaahl2WorkerPreview(a,parsed)')) throw Error('Local preview not wired');
for(const p of ['index.html','office.html','marketplace.html','kafala.html','advertise.html']){
 if((await readFile(p,'utf8')).includes('<script defer src="./notifications-inbox.js')) throw Error('Top bell loader remains on '+p);
}
const sdk=`window.supabase={createClient:()=>({
 auth:{getUser:async()=>({data:{user:{id:'office-test-user'}},error:null}),
       signOut:async()=>({error:null}),signInWithPassword:async()=>({data:{user:{id:'office-test-user'}},error:null})},
 from:(table)=>{
   const q={
     select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},
     maybeSingle:async()=>({data:table==='offices'?{id:'office-1',owner_id:'office-test-user',name:'مكتب تجربة',phone:'0500000000',status:'approved'}:null,error:null}),
     then(ok,bad){return Promise.resolve({data:table==='notifications'&&!window.noticeStopped?
       [{id:'notice-test-1',title:'إشعار اختبار المكتب',body:'مضمون الإشعار',sent_at:'2026-11-19T10:00:00Z'}]:[],error:null}).then(ok,bad)}
   };return q;
 }
})};`;
const server=spawn('python3',['-m','http.server','8767','--bind','127.0.0.1'],{stdio:'ignore'});
const browser=await chromium.launch({headless:true});
try{
 await delay(1200);
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-AE'});
 await context.addInitScript(()=>{
  const original=window.setInterval.bind(window);
  window.setInterval=(fn,ms,...args)=>original(fn,ms===30000?150:ms,...args);
 });
 await context.route('**/*supabase-js@2*',route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk}));
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:8767/office.html',{waitUntil:'load'});
 const dlg=page.getByRole('dialog',{name:'إشعار من إدارة ساهل 2'});
 await dlg.waitFor({state:'visible',timeout:12000});
 if(!(await dlg.getByText('إشعار اختبار المكتب').isVisible()))throw Error('Notice content missing');
 if(await page.locator('#saahl-inbox-trigger').count())throw Error('Top bell is still visible');
 await dlg.getByRole('button',{name:'إغلاق'}).click();
 await dlg.waitFor({state:'detached'});
 await page.reload({waitUntil:'load'});
 await page.waitForTimeout(1200);
 if(await page.locator('.saahl2-office-notice-overlay').count())throw Error('Dismissed notice unexpectedly reopened');
 await page.evaluate(()=>localStorage.removeItem('saahl2-office-read-notices:office-test-user'));
 await page.reload({waitUntil:'load'});
 await dlg.waitFor({state:'visible',timeout:12000});
 await page.evaluate(()=>{window.noticeStopped=true});
 await dlg.waitFor({state:'detached',timeout:3000});
 console.log(JSON.stringify({officeModalShown:true,closeWorked:true,dismissalPersisted:true,stoppedNoticeRemoved:true,externalLinksRemoved:true}));
 await context.close();
}finally{await browser.close();server.kill();}

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const server=spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],{stdio:'ignore'});
let fails=0, checks=0;
const pages=['index.html','kafala.html','office.html','marketplace.html','advertise.html','admin.html'];
const widths=[320,360,390,430,768,1280];
const browser=await chromium.launch({headless:true});
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
    if(status!==200 || overflow>2 || !meta)fails++;
    checks++;
    console.log(JSON.stringify({page,width,http:status,overflow,assetsLinked:meta,pageErrors:errors.slice(0,3),pass:status===200&&overflow<=2&&meta}));
   }catch(e){fails++;checks++;console.log(JSON.stringify({page,width,error:String(e).slice(0,220),pass:false}));}
   await context.close();
  }
 }
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const tab=await context.newPage();
 await tab.goto('http://127.0.0.1:8765/index.html');
 const manifest=await tab.evaluate(async()=>{const x=await fetch('./manifest.webmanifest');const j=await x.json();return {status:x.status,name:j.name,display:j.display,icons:j.icons?.length}});
 checks++;if(manifest.status!==200||manifest.display!=='standalone'||!manifest.icons)fails++;
 console.log(JSON.stringify({pwaManifest:manifest}));
 await context.close();
} finally {await browser.close();server.kill();}
console.log(JSON.stringify({checks,failed:fails}));
if(fails)process.exitCode=1;

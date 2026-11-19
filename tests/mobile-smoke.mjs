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
    if(width===390 || width===1280) await tab.screenshot({path:'mobile-preview/'+page.replace('.html','')+'-'+width+'.png',fullPage:true});
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
 const iphone=await browser.newContext({
   viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ar-AE',
   userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
 });
 const iosPage=await iphone.newPage();
 await iosPage.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
 const install=iosPage.locator('.saahl-install-btn');
 await install.waitFor({state:'visible'});
 await install.click();
 const iosPanel=await iosPage.locator('#saahl-ios-install-info').isVisible();
 checks++; if(!iosPanel)fails++;
 console.log(JSON.stringify({test:'iOS Safari home-screen guidance',pass:iosPanel}));
 await iphone.close();
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

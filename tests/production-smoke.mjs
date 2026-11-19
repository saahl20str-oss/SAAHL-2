import { chromium } from 'playwright';
import { setTimeout as wait } from 'node:timers/promises';

const origin='https://saahl20str-oss.github.io/SAAHL-2/';
const pages=['index.html','kafala.html','office.html','marketplace.html','advertise.html','admin.html'];
const browser=await chromium.launch({headless:true});
let errors=0;
try {
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-AE'});
  const page=await context.newPage();
  // GitHub Pages deployment may lag behind the push creating this workflow.
  let deployed=false;
  for(let attempt=1;attempt<=12;attempt++) {
    try {
      const r=await context.request.get(origin+'manifest.webmanifest?release=20261119',{timeout:20000});
      const value=await r.text();
      if(r.status()===200 && value.includes('ساهل 2')){deployed=true;break;}
    } catch(e){ console.log('Deployment pending',String(e).slice(0,120)); }
    await wait(10000);
  }
  if(!deployed)throw Error('Updated GitHub Pages manifest did not become accessible');
  for(const name of pages){
    const r=await page.goto(origin+name+'?release=20261119',{waitUntil:'domcontentloaded',timeout:25000});
    const state=await page.evaluate(()=>({
      css:!!document.querySelector('link[href*="mobile-first.css"]'),
      manifest:!!document.querySelector('link[rel="manifest"]'),
      overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth
    }));
    const okay=r?.status()===200 && state.css && state.manifest && state.overflow<=2;
    console.log(JSON.stringify({name,http:r?.status(),...state,pass:okay}));
    if(!okay)errors++;
  }
  await context.close();
} finally {await browser.close();}
if(errors)throw Error(errors+' published page tests failed');
console.log('Production smoke verified: six live pages');

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const ORIGIN='https://saahl20str-oss.github.io/SAAHL-2/';
const paths=['index.html','kafala.html','office.html','marketplace.html','advertise.html','admin.html'];
const widths=[320,360,390,430,768,1280];
const browser=await chromium.launch({headless:true});
let total=0,fail=0;
await mkdir('production-previews',{recursive:true});
try {
  for(const path of paths) {
    for(const width of widths) {
      total++;
      const ctx=await browser.newContext({viewport:{width,height:800},isMobile:width<=430,hasTouch:width<=430,locale:'ar-AE'});
      const p=await ctx.newPage();
      try {
        const response=await p.goto(ORIGIN+path,{waitUntil:'domcontentloaded',timeout:30000});
        await p.waitForTimeout(650);
        const m=await p.evaluate(()=>({
          overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
          dir:document.documentElement.dir,
          mobileCss:!!document.querySelector('link[href*="mobile-first.css"]'),
          manifest:!!document.querySelector('link[rel="manifest"]'),
          installJs:!!document.querySelector('script[src*="pwa-install.js"]'),
          appleIcon:!!document.querySelector('link[rel="apple-touch-icon"]'),
          title:document.title
        }));
        const ok=response?.status()===200 && m.overflow<=2 && m.dir==='rtl' && m.mobileCss && m.manifest && m.installJs && m.appleIcon;
        if(!ok)fail++;
        console.log(JSON.stringify({path,width,http:response?.status(),...m,ok}));
        if(width===390||width===1280)await p.screenshot({path:`production-previews/${path.replace('.html','')}-${width}.png`,fullPage:true});
      }catch(e){fail++;console.log(JSON.stringify({path,width,ok:false,error:String(e).slice(0,200)}));}
      finally{await ctx.close();}
    }
  }
  for(const asset of ['manifest.webmanifest','sw.js','mobile-first.css','pwa-install.js','saahl-pwa-icon.svg','saahl-pwa-192.png','saahl-pwa-512.png','apple-touch-icon.png']) {
    total++;
    try {
      const response=await fetch(ORIGIN+asset,{redirect:'follow'});
      let valid=response.ok;
      if(asset==='manifest.webmanifest'){
        const manifest=await response.json();
        valid=valid&&manifest.display==='standalone'&&manifest.start_url==='./index.html'&&manifest.icons.some(i=>i.src.includes('192.png')) && manifest.icons.some(i=>i.src.includes('512.png'));
      }
      if(!valid)fail++;
      console.log(JSON.stringify({asset,http:response.status,ok:valid}));
    }catch(e){fail++;console.log(JSON.stringify({asset,ok:false,error:String(e).slice(0,200)}));}
  }
} finally{await browser.close();}
console.log(JSON.stringify({total,failed:fail}));
if(fail)process.exitCode=1;

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const site = 'http://127.0.0.1:8787/';
const server = spawn('python3',['-m','http.server','8787','--bind','127.0.0.1'],{stdio:'ignore'});
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined});
const firstId = '11223344-0000-4000-8000-000000000001';
const secondId = '11223345-0000-4000-8000-000000000002';
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=';
const base = {profession:'عامل بناء',emirate:'أبوظبي',age:35,experience_years:6,monthly_salary:1200,
  ends_at:new Date(Date.now()+86400000).toISOString()};
const rows = [
  {...base,id:firstId,nationality:'الهند',skills:['أعمال السباكة'],worker_photo_url:photo},
  {...base,id:secondId}
];

try {
  for (const width of [360,1280]) {
    const page = await browser.newPage({viewport:{width,height:760}});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*supabase-js@2*',route=>route.fulfill({contentType:'application/javascript',body:`
      window.requests = [];
      window.supabase = {createClient:()=>({async rpc(name,args) {
        if (name==='saahl2_public_transfer_profiles') return {data:${JSON.stringify(rows)}};
        if (name==='saahl2_transfer_whatsapp') {
          window.requests.push(args);
          return {data: args.p_ad === '${firstId}' ? '971500000001' : null};
        }
        throw Error('Unexpected RPC '+name);
      }})};
    `}));
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.addInitScript(() => Object.defineProperty(navigator,'clipboard',{value:undefined}));
    await page.route('https://wa.me/**',route=>route.fulfill({contentType:'text/plain',body:'WhatsApp test stub'}));
    await page.goto(site+'kafala.html', {waitUntil:'domcontentloaded'});
    const cards = page.locator('.transfer-poster');
    await cards.nth(1).waitFor();
    assert.equal(await cards.first().locator('img').getAttribute('src'),photo);
    await cards.first().locator('img').evaluate(img=>img.decode());
    assert.equal(await cards.nth(1).locator('img').count(),0);
    assert.equal(await cards.nth(1).locator('.poster-top').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
    const open = async card => {
      await card.getByRole('button',{name:'عرض التفاصيل'}).click();
      await card.getByRole('button',{name:'بطاقة الاستفسار والتواصل'}).click();
    };
    const modal = page.locator('#detailOv');
    await open(cards.first());
    assert.equal(await modal.locator('#dm-avatar img').getAttribute('src'),photo);
    assert.match(await modal.innerText(),/الهند/);
    assert.match(await modal.innerText(),/أعمال السباكة/);
    assert.doesNotMatch(await modal.innerText(),/الإبلاغ عن الإعلان/);
    assert.equal(await modal.locator('.dm-contact button').count(),1);
    await modal.locator('.dm-close').click();
    await open(cards.nth(1));
    assert.equal(await modal.locator('#dm-avatar img').count(),0);
    assert.doesNotMatch(await modal.innerText(),/الهند|أعمال السباكة/);
    const whatsappButton = modal.getByRole('button',{name:'تواصل مع المعلن عبر واتساب'});
    await whatsappButton.click();
    await modal.getByText('واتساب غير مفعّل لهذا الإعلان.').waitFor();
    assert.equal(page.url(),site+'kafala.html');
    await page.goto(site+'kafala.html#ad='+firstId);
    await modal.getByText('إعلان 11223344',{exact:true}).waitFor();
    const destination = page.waitForRequest(url => url.url().startsWith('https://wa.me/'));
    const download = page.waitForEvent('download');
    await whatsappButton.click();
    const attachment = await download;
    assert.match(attachment.suggestedFilename(),/11223344[.]png$/);
    const png = await readFile(await attachment.path());
    assert.equal(png.readUInt32BE(16),800);
    assert.equal(png.readUInt32BE(20),1006);
    const url = new URL((await destination).url());
    assert.equal(url.pathname,'/971500000001');
    assert.match(url.searchParams.get('text'),/أرغب|أود الاستفسار/);
    assert.match(url.searchParams.get('text'),/11223344/);
    assert.match(url.searchParams.get('text'),new RegExp(firstId));
    assert.match(url.searchParams.get('text'),/أعمال السباكة/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Transfer profiles, inquiry cards, and direct WhatsApp links passed at mobile and desktop widths.');
} finally {
  await browser.close();
  server.kill();
}

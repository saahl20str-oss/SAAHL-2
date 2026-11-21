import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

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
        if (name==='saahl2_send_request') {
          window.requests.push(args);
          return args.p_email.startsWith('retry@')
            ? {error:{code:'P4290'}} : {data:'receipt-123'};
        }
        throw Error('Unexpected RPC '+name);
      }})};
    `}));
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.goto(site+'kafala.html', {waitUntil:'domcontentloaded'});
    const cards = page.locator('.transfer-poster');
    await cards.nth(1).waitFor();
    assert.equal(await cards.first().locator('img').getAttribute('src'),photo);
    await cards.first().locator('img').evaluate(img=>img.decode());
    assert.equal(await cards.nth(1).locator('img').count(),0);
    assert.equal(await cards.nth(1).locator('.poster-top').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
    const open = async card => {
      await card.getByRole('button',{name:'عرض التفاصيل'}).click();
      await card.getByRole('button',{name:'التواصل بشأن الإعلان'}).click();
    };
    const modal = page.locator('#detailOv');
    await open(cards.first());
    assert.equal(await modal.locator('#dm-avatar img').getAttribute('src'),photo);
    assert.match(await modal.innerText(),/الهند/);
    assert.match(await modal.innerText(),/أعمال السباكة/);
    assert.doesNotMatch(await modal.innerText(),/الإبلاغ عن الإعلان/);
    await modal.getByRole('button',{name:'إرسال طلب تواصل'}).click();
    await modal.getByLabel('بريدك الإلكتروني').fill('retry@example.com');
    await modal.getByLabel('رسالتك').fill('أرغب بالتواصل حول الإعلان.');
    await modal.getByRole('button',{name:'إرسال الطلب'}).click();
    await modal.getByText('انتظر قليلًا قبل إرسال طلب جديد.').waitFor();
    await modal.getByLabel('بريدك الإلكتروني').fill('visitor@example.com');
    await modal.getByRole('button',{name:'إرسال الطلب'}).click();
    await modal.getByText(/receipt-123/).waitFor();
    assert.equal(page.url(),site+'kafala.html');
    const requests = await page.evaluate(()=>window.requests);
    assert.equal(requests.length,2);
    assert.ok(requests.every(request=>request.p_ad===firstId && request.p_kind==='transfer_contact'));
    await modal.locator('.dm-close').click();
    await open(cards.nth(1));
    assert.equal(await modal.locator('#dm-avatar img').count(),0);
    assert.doesNotMatch(await modal.innerText(),/الهند|أعمال السباكة|receipt-123/);
    assert.ok(await modal.getByRole('button',{name:'إرسال طلب تواصل'}).isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Transfer profile and contact tests passed at mobile and desktop widths.');
} finally {
  await browser.close();
  server.kill();
}

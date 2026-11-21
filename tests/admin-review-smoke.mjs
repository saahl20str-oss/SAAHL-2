import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('admin.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
const responses = new Map();
const queries = [];
const filters = [];
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    textContent: '', innerHTML: '', value: '', style: {}, addEventListener() {},
    replaceChildren() {}, classList: { add() {}, remove() {} },
  });
  return elements.get(id);
};
const db = {
  from(table) {
    queries.push(table);
    const query = {
      select() { return query; },
      order() { return query; },
      update() { return query; },
      eq(...args) { filters.push(args); return query; },
      then(resolve, reject) {
        return Promise.resolve(responses.get(table) ?? { data: [], error: null }).then(resolve, reject);
      },
    };
    return query;
  },
  async rpc(name) { return responses.get(name) ?? { data: [], error: null }; },
};
const context = vm.createContext({
  supabase: { createClient: () => db },
  document: { getElementById: element },
  localStorage: { getItem() { return null; } },
  window: { addEventListener() {} },
  confirm: () => true,
  setTimeout() {},
});
vm.runInContext(script, context);
const run = code => vm.runInContext(code, context);

assert.doesNotMatch(html, /data-p="(?:bookings|payments)"|id="ads-rev"|تم حفظ الأسعار/);
for (const [, handler] of html.matchAll(/onclick="(navTo\('kafala'\))"/g)) new vm.Script(handler);
responses.set('offices', { data: null, count: null, error: { message: 'offline' } });
responses.set('sponsor_profiles', { data: null, error: { message: 'offline' } });
responses.set('strip_ads', { data: [], error: null });
await run('loadAll()');
assert.doesNotMatch(queries.join(' '), /bookings|payments/);
assert.equal(element('s-off').textContent, '—');
assert.match(element('off-wrap').textContent, /تعذر تحميل/);
run('filterOffices();filterSponsors()');
assert.match(element('spo-wrap').textContent, /تعذّر تحميل/);
assert.match(element('ads-wrap').textContent, /لا توجد طلبات/);
responses.set('strip_ads', { data: null, error: { message: 'offline' } });
await run('loadAds()');
assert.match(element('ads-cnt').textContent, /تعذّر التحميل/);
assert.match(element('ads-wrap').textContent, /تعذّر تحميل/);

responses.set('kafala_pending_edits', { data: null, error: { message: 'offline' } });
await run('loadKf()');
assert.match(element('kf-wrap').innerHTML, /تعذّر تحميل التعديلات/);
assert.doesNotMatch(element('kf-wrap').innerHTML, /لا توجد طلبات/);
assert.equal(element('s-kf-pending').textContent, '—');

const tryAdApproval = async savedRows => {
  run("aAds=[{id:'ad-1',status:'pending',days:1}]; loadAds=async()=>{}");
  responses.set('strip_ads', { data: savedRows, error: null });
  await run("appAd('ad-1')");
  return element('toast').textContent;
};
assert.match(await tryAdApproval([]), /لم يُحفظ الاعتماد/);
assert.match(await tryAdApproval([{ id: 'ad-1', status: 'approved' }]), /تم اعتماد الإعلان/);
assert.ok(filters.some(([column, value]) => column === 'status' && value === 'pending'));

run("aKf=[{id:'transfer-1'}];loadKf=async()=>[{id:'transfer-1',review_status:'approved',is_active:false}]");
await run("reviewKf('transfer-1','resume')");
assert.match(element('toast').textContent, /تعذّر تأكيد القرار/);
run("loadKf=async()=>[{id:'transfer-1',review_status:'approved',is_active:true}]");
await run("reviewKf('transfer-1','resume')");
assert.match(element('toast').textContent, /تم حفظ القرار/);
console.log('Admin review smoke passed.');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('admin.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
const responses = new Map();
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
    const query = {
      select() { return query; },
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

const tryAdApproval = async (savedRows, error = null) => {
  run("aAds=[{id:'ad-1',status:'pending',days:1}]; loadAds=async()=>{}");
  responses.set('strip_ads', { data: savedRows, error });
  await run("appAd('ad-1')");
  return element('toast').textContent;
};
assert.match(await tryAdApproval(null, { message: 'offline' }), /تعذر اعتماد الإعلان/);
assert.match(await tryAdApproval([]), /لم يُحفظ الاعتماد/);
assert.match(await tryAdApproval([{ id: 'ad-1', status: 'approved' }]), /تم اعتماد الإعلان/);
assert.ok(filters.some(([column, value]) => column === 'status' && value === 'pending'));

console.log('Announcement approval smoke passed.');

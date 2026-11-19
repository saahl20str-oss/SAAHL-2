(() => {
  const labels = new Map(Object.entries({
    'العاملة':'worker', 'اسم العاملة':'worker', 'الجنسية':'nationality', 'العمر':'age',
    'الخبرة':'experience', 'إجمالي الخبرة':'experience', 'سنوات الخبرة':'experience',
    'الإمارة':'emirate', 'الامارة':'emirate', 'المكتب':'office', 'اسم المكتب':'office',
    'الرقم':'number', 'رقم العاملة':'number', 'رقم التواصل':'phone', 'الهاتف':'phone',
    'واتساب':'whatsapp', 'المعلن':'advertiser', 'اسم المعلن':'advertiser', 'الديانة':'religion',
    'الراتب':'salary', 'المهنة':'profession', 'الوضع الحالي':'workerStatus'
  }));
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const value = (...options) => options.find(item => item !== undefined && item !== null &&
    String(item).trim() && !/^(?:—|غير محدد(?:ة)?|غير متوفر(?:ة)?)$/.test(String(item).trim()));

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function parseDetails(parts) {
    const fields = new Map();
    const notes = [];
    for (const part of parts) {
      const match = /^([^:：]+)[:：]\s*(.*)$/.exec(part);
      const key = labels.get(match?.[1].trim());
      if (!key) {
        if (!/^(?:صورة العاملة|رابط العاملة)\s*[:：]/.test(part)) notes.push(part);
      } else if (value(match[2])) {
        if (fields.has(key)) notes.push(part);
        else fields.set(key, match[2].trim());
      }
    }
    return {fields, notes};
  }

  function photoURL(raw, origin) {
    if (typeof raw !== 'string') return '';
    if (raw.length <= 700000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      if (url.origin === origin && url.pathname.startsWith('/storage/v1/object/public/')) return url.href;
    } catch { /* Missing or malformed photo. */ }
    return '';
  }

  function detailList(rows, className) {
    const list = node('dl', className);
    for (const [label, text, direction] of rows) {
      if (text === undefined) continue;
      const term = node('dt', '', label);
      const detail = node('dd', '', text);
      detail.dir = direction || 'auto';
      const group = node('div');
      group.append(term, detail);
      list.append(group);
    }
    return list;
  }

  async function open(ad, parsed, client, origin) {
    const previous = document.getElementById('saahl2-worker-preview');
    if (previous) previous.close();
    const opener = document.activeElement;
    const dialog = node('dialog', 'saahl-worker-dialog');
    dialog.id = 'saahl2-worker-preview';
    dialog.dir = 'rtl';
    dialog.setAttribute('aria-labelledby', 'saahl-worker-title');
    const title = node('h2', '', value(ad.ad_topic, 'تفاصيل الإعلان'));
    title.id = 'saahl-worker-title';
    const close = node('button', 'saahl-worker-close', 'إغلاق');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    const header = node('header', 'saahl-worker-header');
    header.append(title, close);
    const body = node('div', 'saahl-worker-body');
    dialog.append(header, body);
    const {fields, notes} = parseDetails(parsed.parts);
    const field = key => fields.get(key);

    function render(worker, office) {
      const hero = node('div', 'saahl-worker-hero');
      const media = node('div', 'saahl-worker-media');
      const unavailable = node('span', '', 'الصورة غير متوفرة');
      const photos = [...new Set([ad.worker_photo_url, parsed.photo, worker?.photo_url].map(raw => photoURL(raw, origin)).filter(Boolean))];
      if (photos.length) {
        const img = node('img');
        img.alt = 'صورة العاملة';
        img.referrerPolicy = 'no-referrer';
        let next = 0;
        img.addEventListener('error', () => {
          next += 1;
          if (next < photos.length) img.src = photos[next];
          else media.replaceChildren(unavailable);
        });
        img.src = photos[0];
        media.append(img);
      } else media.append(unavailable);

      const overview = node('div', 'saahl-worker-overview');
      const workerName = value(field('worker'), worker?.display_name);
      if (workerName) overview.append(node('h3', '', workerName));
      const status = {pending:'بانتظار المراجعة', approved:'معتمد', active:'نشط', rejected:'مرفوض', expired:'منتهي'};
      if (ad.status) overview.append(node('span', 'saahl-worker-status', status[ad.status] || ad.status));
      const facts = detailList([
        ['الجنسية', value(field('nationality'), worker?.nationality)],
        ['العمر', value(field('age'), worker?.age == null ? null : worker.age + ' سنة')],
        ['الخبرة', value(field('experience'), worker?.experience_years == null ? null : worker.experience_years + ' سنة')],
        ['الإمارة', value(field('emirate'), office?.emirate)]
      ], 'saahl-worker-facts');
      if (facts.childElementCount) overview.append(facts);
      hero.append(media, overview);

      const contact = detailList([
        ['المكتب', value(field('office'), office?.name)],
        ['المعلن', value(ad.advertiser_name, field('advertiser'))],
        ['رقم العاملة', value(field('number'), worker?.worker_number)],
        ['رقم التواصل', value(ad.phone, field('phone'), office?.phone), 'ltr'],
        ['واتساب', value(ad.whatsapp, field('whatsapp'), office?.whatsapp), 'ltr']
      ], 'saahl-worker-contacts');
      const extra = detailList([
        ['المهنة', field('profession')],
        ['الوضع الحالي', field('workerStatus')],
        ['الديانة', value(field('religion'), worker?.religion)],
        ['الراتب', value(field('salary'), worker?.salary_aed == null ? null : worker.salary_aed + ' درهم')],
        ['مدة الإعلان', ad.days == null ? undefined : ad.days + ' يوم'],
        ['القيمة المسجلة', ad.amount == null ? undefined : ad.amount + ' درهم'],
        ['انتهاء الإعلان', ad.expires_at && Number.isFinite(Date.parse(ad.expires_at))
          ? new Intl.DateTimeFormat('ar-AE-u-nu-latn', {dateStyle:'medium',timeZone:'Asia/Dubai'}).format(new Date(ad.expires_at)) : undefined]
      ], 'saahl-worker-contacts');
      const sections = [hero];
      if (contact.childElementCount) sections.push(node('h3', 'saahl-worker-section', 'المكتب والتواصل'), contact);
      if (extra.childElementCount || notes.length) sections.push(node('h3', 'saahl-worker-section', 'تفاصيل الإعلان'));
      if (extra.childElementCount) sections.push(extra);
      for (const note of notes) sections.push(node('p', 'saahl-worker-note', note));
      body.replaceChildren(...sections);
    }

    render();
    dialog.addEventListener('close', () => {
      dialog.remove();
      opener?.focus();
    }, {once:true});
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
    close.focus();

    let workerId = ad.worker_id;
    if (!uuid(workerId) && parsed.worker) {
      const link = new URL(parsed.worker);
      workerId = link.searchParams.get('worker') || link.searchParams.get('maidId');
    }
    if (!uuid(workerId) && !uuid(ad.office_id)) return;
    try {
      let workerQuery = uuid(workerId) ? client.from('workers').select(
        'office_id,display_name,worker_number,nationality,age,experience_years,photo_url,religion,salary_aed'
      ).eq('id', workerId) : null;
      if (workerQuery && uuid(ad.office_id)) workerQuery = workerQuery.eq('office_id', ad.office_id);
      const officeQuery = id => client.from('offices').select('name,emirate,phone,whatsapp').eq('id', id).maybeSingle();
      const [workerResult, officeResult] = await Promise.all([
        workerQuery?.maybeSingle(), uuid(ad.office_id) ? officeQuery(ad.office_id) : null
      ]);
      if (!dialog.open) return;
      const worker = workerResult?.data;
      const office = officeResult?.data || (!uuid(ad.office_id) && uuid(worker?.office_id)
        ? (await officeQuery(worker.office_id)).data : null);
      if (dialog.open && (worker || office)) render(worker, office);
    } catch { /* Preserve the saved advertisement if related data is unavailable. */ }
  }

  window.SaahlWorkerCard = {open};
})();

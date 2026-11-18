(() => {
  const el = id => document.getElementById(id);
  const fields = {
    worker_name: 'wName', nationality: 'wNat', age: 'wAge', profession: 'wProf',
    experience_years: 'wExp', monthly_salary: 'wSalary', religion: 'wReligion',
    current_status: 'wStatus', emirate: 'wEmirate', reason: 'wReason',
    contact_phone: 'wContact', sponsor_display_name: 'sponsorDisplayName'
  };
  const labels = {
    nationality: 'الجنسية', age: 'العمر', experience_years: 'الخبرة', monthly_salary: 'الراتب الشهري',
    religion: 'الديانة', current_status: 'الوضع الحالي', contact_phone: 'رقم التواصل',
    sponsor_display_name: 'اسم الكفيل', skills: 'المهارات', reason: 'سبب النقل'
  };
  const customFields = new Set(['wNat', 'wProf', 'wStatus']);
  const validPin = value => /^[0-9]{6}$/.test(value);
  const numberFrom = value => toEnglishDigits(value).trim().replace(/[\s-]/g, '').toUpperCase();
  const validNumber = value => /^(?:[0-9]{8}|[0-9A-F]{16})$/.test(value);
  const recentKey = 'saahl2-kafala-request-numbers';
  let requestKey;
  let reservation;
  let requestNumber;
  let submittedNumber;
  let owner;
  let loginTimer;
  let viewVersion = 0;

  function message(id, value) {
    el(id).textContent = value;
  }

  function statusText(active, status, endsAt) {
    if (status === 'approved' && endsAt && Date.parse(endsAt) <= Date.now()) return 'منتهي';
    if (active) return 'منشور';
    if (status === 'approved') return 'موقوف';
    if (status === 'rejected') return 'مرفوض';
    return 'بانتظار مراجعة الإدارة';
  }

  function savedNumbers() {
    try {
      const numbers = JSON.parse(localStorage.getItem(recentKey) || '[]');
      return Array.isArray(numbers) ? numbers.filter(value => typeof value === 'string' && validNumber(value)) : [];
    } catch { return []; }
  }

  function renderSavedNumbers() {
    const numbers = savedNumbers();
    el('ownerRecent').hidden = !numbers.length;
    el('ownerRecentNumbers').replaceChildren(new Option('اختر رقم طلب', ''), ...numbers.map(number => new Option(number, number)));
    return numbers;
  }

  function updateSavedNumbers(number, removedNumber) {
    const numbers = savedNumbers().filter(value => value !== number && value !== removedNumber);
    if (number) numbers.unshift(number);
    try { localStorage.setItem(recentKey, JSON.stringify(numbers.slice(0, 12))); } catch { /* Optional browser storage */ }
    renderSavedNumbers();
  }

  async function copyNumber(inputId, messageId) {
    const input = el(inputId);
    try {
      await navigator.clipboard.writeText(input.value);
      message(messageId, 'تم نسخ رقم الطلب.');
    } catch {
      input.focus();
      input.select();
      message(messageId, 'تم تحديد الرقم. انسخه يدويًا.');
    }
  }

  async function reserveNumber() {
    if (requestNumber) return requestNumber;
    if (reservation) return reservation;
    requestKey ||= crypto.randomUUID();
    el('retryReservedNumber').hidden = true;
    message('reserveNumberStatus', '');
    reservation = (async () => {
      const {data,error} = await _db.rpc('kafala_reserve_number', {p_request:requestKey});
      if (error || !validNumber(data)) {
        message('reserveNumberStatus', 'تعذّر تجهيز رقم الطلب.');
        el('retryReservedNumber').hidden = false;
        return null;
      }
      requestNumber = data;
      el('reservedNumber').value = data;
      el('copyReservedNumber').disabled = false;
      return data;
    })();
    try { return await reservation; }
    finally { reservation = null; }
  }

  el('retryReservedNumber').onclick = reserveNumber;
  el('ownerCopyNumber').onclick = () => copyNumber('ownerNumberInfo','ownerCopyStatus');
  el('ownerPhoto').onerror = () => { el('ownerPhotoFrame').hidden = true; };
  el('copyReservedNumber').onclick = () => copyNumber('reservedNumber','reserveNumberStatus');
  el('createOwnerPin').addEventListener('focus', reserveNumber);
  el('ownerRecentNumbers').onchange = event => {
    if (!event.target.value) return;
    el('ownerNumber').value = event.target.value;
    el('ownerPin').focus();
  };

  function setOwnerForm(editing) {
    editingKafala = editing;
    for (const id of ['kafalaPricing', 'kafalaTerms', 'kafalaAgree', 'kafalaPinFields']) el(id).hidden = editing;
    el('kafalaCancelEdit').hidden = !editing;
    el('formContent').style.display = '';
    el('formSuccess').classList.remove('show');
    message('kafalaFormTitle', editing ? 'تعديل الإعلان' : 'أضف عاملك للقائمة');
    message('kafalaFormSubtitle', editing ? 'تراجع الإدارة التعديلات قبل نشرها.' : 'أدخل بيانات العامل واختر مدة العرض. يُنشر الإعلان بعد موافقة الإدارة.');
    message('kafala-pay-btn', editing ? 'إرسال التعديل للمراجعة' : 'إرسال الإعلان دون دفع');
    message('kafala-pay-msg', '');
  }

  function fillFields(values = {}) {
    for (const [key, id] of Object.entries(fields)) {
      const input = el(id);
      const value = String(values[key] ?? '');
      const custom = value && customFields.has(id) && !Array.from(input.options).some(option => option.value === value);
      input.value = custom ? '__other__' : value;
      if (customFields.has(id)) {
        const other = el(id + 'Other');
        other.value = custom ? value : '';
        other.required = Boolean(custom);
        other.style.display = custom ? 'block' : 'none';
      }
      setErr(id, false);
    }
    const extras = new Set(values.skills || []);
    for (const chip of el('skillsWrap').querySelectorAll('.skill-chip')) {
      const selected = extras.delete(chip.textContent.trim());
      chip.classList.toggle('on', selected);
      chip.setAttribute('aria-pressed', String(selected));
    }
    el('wExtraSkills').value = Array.from(extras).join(', ');
    message('skillsSelected', values.skills?.length ? 'المهارات المختارة (' + values.skills.length + ')' : 'اضغط على أي مهارة لاختيارها.');
    selectedPhotoFile = null;
    el('page-form').querySelector('input[type=file]').value = '';
    showKafalaPhoto(safeKafalaImageUrl(values.worker_photo_url));
  }

  async function readPhoto() {
    const image = await createImageBitmap(selectedPhotoFile);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d', {alpha: false});
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL('image/jpeg', 0.82);
      if (!safeKafalaImageUrl(photo)) throw new Error();
      return photo;
    } catch {
      throw new Error('تعذّرت معالجة الصورة. اختر صورة أخرى.');
    } finally {
      image.close();
    }
  }

  async function collectFields() {
    const values = {};
    for (const [key, id] of Object.entries(fields)) {
      const raw = customFields.has(id) ? kafalaFieldValue(id) : el(id).value.trim();
      values[key] = ['age', 'experience_years', 'monthly_salary'].includes(key) ? (raw === '' ? null : Number(raw)) : raw || null;
    }
    values.skills = collectSkills();
    if (selectedPhotoFile) values.worker_photo_url = await readPhoto();
    return values;
  }

  function showOwner(data, note = '') {
    owner.data = data;
    el('ownerLogin').hidden = true;
    el('ownerPanel').hidden = false;
    el('ownerChangeForm').hidden = true;
    el('ownerChange').setAttribute('aria-expanded', 'false');
    const ad = data.fields;
    message('ownerName', ad.worker_name);
    const summary = [ad.profession, ad.emirate].filter(Boolean).join(' · ');
    message('ownerSummary', summary);
    el('ownerSummary').hidden = !summary;
    message('ownerStatus', statusText(data.active, data.status, data.ends_at));
    el('ownerStatus').dataset.state = data.expired ? 'expired' : data.active ? 'active' : 'review';
    el('ownerExpiry').hidden = !data.ends_at;
    message('ownerExpiryDate', data.ends_at ? formatArabicDate(data.ends_at) : '');
    const draft = {pending:'التعديل بانتظار المراجعة', rejected:'التعديل مرفوض'}[data.draft_status] || '';
    message('ownerDraftNotice', draft);
    el('ownerDraftNotice').hidden = !draft;
    el('ownerNumberInfo').value = data.request_number;
    message('ownerCopyStatus', '');
    el('ownerDelete').hidden = !data.expired;
    el('ownerExpiredNotice').hidden = !data.expired;
    el('ownerEdit').hidden = Boolean(data.expired);
    const photo = safeKafalaImageUrl(ad.worker_photo_url);
    el('ownerPhotoFrame').hidden = !photo;
    if (photo) el('ownerPhoto').src = photo;
    else el('ownerPhoto').removeAttribute('src');
    const detail = el('ownerDetails');
    detail.replaceChildren();
    for (const [key, label] of Object.entries(labels)) {
      const value = ad[key];
      if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
      const item = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = Array.isArray(value) ? value.join('، ') : value;
      if (key === 'contact_phone') dd.dir = 'ltr';
      if (key === 'monthly_salary') dd.textContent = Number(value).toLocaleString('en-AE') + ' درهم';
      if (key === 'reason' || key === 'skills') item.classList.add('owner-detail-wide');
      item.append(dt, dd);
      detail.append(item);
    }
    el('ownerDetailsSection').hidden = !detail.childElementCount;
    message('ownerMessage', note);
    showPage('manage');
  }

  function closeOwner(note = '') {
    viewVersion++;
    clearTimeout(loginTimer);
    owner = null;
    el('ownerPin').value = '';
    el('ownerPanel').hidden = true;
    el('ownerChangeForm').reset();
    el('ownerChangeForm').hidden = true;
    el('ownerPhoto').removeAttribute('src');
    el('ownerDetails').replaceChildren();
    el('ownerNumberInfo').value = '';
    message('ownerCopyStatus', '');
    message('ownerName', '');
    message('ownerStatus', '');
    el('ownerLogin').hidden = false;
    if (editingKafala) {
      setOwnerForm(false);
      fillFields();
    }
    message('ownerMessage', note);
  }

  const feedback = {
    invalid: 'تحقق من رقم الطلب والرمز السري.',
    locked: 'تم إيقاف المحاولات مؤقتًا. حاول مرة أخرى بعد 15 دقيقة.',
    changed: 'تم تحديث الإعلان منذ فتحه. أغلق الطلب وافتحه مجددًا قبل التعديل.',
    not_expired: 'الحذف متاح بعد انتهاء فترة الإعلان.',
    invalid_pin: 'أدخل رمزًا سريًا من 6 أرقام.'
  };

  async function manage(number, pin, action, options = {}) {
    const {data, error} = await _db.rpc('kafala_manage_request', {p_number:number, p_pin:pin, p_action:action, ...options});
    if (error) throw new Error(action === 'edit'
      ? 'تعذّر حفظ التعديل. تحقق من البيانات وحاول مرة أخرى.'
      : 'تعذّر الاتصال. حاول مرة أخرى.');
    if (data.error) throw new Error(feedback[data.error]);
    return data;
  }

  el('ownerLogin').addEventListener('submit', async event => {
    event.preventDefault();
    const number = numberFrom(el('ownerNumber').value);
    const pin = el('ownerPin').value;
    if (!validNumber(number) || !validPin(pin)) return message('ownerMessage', feedback.invalid);
    const button = event.submitter;
    const version = viewVersion;
    button.disabled = true;
    message('ownerMessage', 'جارٍ فتح الطلب…');
    try {
      const data = await manage(number, pin, 'open');
      if (version !== viewVersion) return;
      el('ownerPin').value = '';
      owner = {number:data.request_number, pin, data};
      el('ownerNumber').value = data.request_number;
      updateSavedNumbers(data.request_number, number);
      clearTimeout(loginTimer);
      loginTimer = setTimeout(() => {
        const showingOwner = el('page-manage').classList.contains('on') || editingKafala;
        closeOwner('انتهت جلسة إدارة الإعلان. أدخل الرمز مجددًا.');
        if (showingOwner) showPage('manage');
      }, 15 * 60 * 1000);
      showOwner(data);
    } catch (error) {
      if (version === viewVersion) message('ownerMessage', error.message);
    } finally { button.disabled = false; }
  });

  el('ownerLogout').onclick = () => closeOwner();
  el('ownerDelete').onclick = async () => {
    const session = owner;
    if (!session || !confirm('انتهت فترة الإعلان. هل تريد حذف الإعلان نهائيًا؟')) return;
    const button = el('ownerDelete');
    button.disabled = true;
    try {
      await manage(session.number,session.pin,'delete');
      updateSavedNumbers(null,session.number);
      if (session !== owner) return;
      closeOwner('تم حذف الإعلان المنتهي.');
      el('ownerNumber').value = '';
      history.replaceState(null,'','#manage');
    } catch (error) {
      if (session === owner) message('ownerMessage',error.message);
    } finally { button.disabled = false; }
  };
  el('ownerEdit').onclick = () => {
    setOwnerForm(true);
    fillFields(owner.data.fields);
    showPage('form');
  };
  el('kafalaCancelEdit').onclick = () => {
    setOwnerForm(false);
    showOwner(owner.data);
  };
  el('ownerChange').onclick = () => {
    const form = el('ownerChangeForm');
    form.hidden = !form.hidden;
    el('ownerChange').setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) el('newOwnerPin').focus();
  };
  el('ownerChangeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const pin = el('newOwnerPin').value;
    if (!validPin(pin) || pin !== el('newOwnerPinAgain').value) {
      return message('ownerMessage', 'أدخل 6 أرقام متطابقة في خانتي الرمز.');
    }
    const session = owner;
    const button = event.submitter;
    button.disabled = true;
    try {
      const data = await manage(session.number, session.pin, 'change_pin', {p_new_pin:pin});
      if (session !== owner) return;
      owner.pin = pin;
      event.target.reset();
      showOwner(data, 'تم تغيير الرمز السري.');
    } catch (error) {
      if (session === owner) message('ownerMessage', error.message);
    } finally { button.disabled = false; }
  });

  window.newKafalaAd = () => {
    if (el('kafala-pay-btn').disabled) return;
    closeOwner();
    setOwnerForm(false);
    if (submittedNumber) {
      submittedNumber = null;
      requestKey = null;
      requestNumber = null;
      el('reservedNumber').value = '';
      el('copyReservedNumber').disabled = true;
      fillFields();
      el('agreeTerms').checked = false;
    }
    showPage('form');
    reserveNumber();
  };

  window.processPayment = async () => {
    const msg = 'kafala-pay-msg';
    if (!validateForm()) return message(msg, 'أكمل الحقول المطلوبة.');
    const session = editingKafala ? owner : null;
    const age = Number(el('wAge').value);
    const days = Number(el('adDays').value);
    if (!Number.isInteger(age) || age < 18 || age > 60) return message(msg, 'أدخل عمرًا بين 18 و60 سنة.');
    const pin = el('createOwnerPin').value;
    if (!session) {
      if (!Number.isInteger(days) || days < 1 || days > 90) return message(msg, 'اختر مدة بين يوم واحد و90 يومًا.');
      if (!el('agreeTerms').checked) return message(msg, 'وافق على الشروط والأحكام لإرسال الطلب.');
      if (!validPin(pin) || pin !== el('createOwnerPinAgain').value) return message(msg, 'أدخل 6 أرقام متطابقة في خانتي الرمز.');
    }
    const button = el('kafala-pay-btn');
    button.disabled = true;
    message(msg, 'جارٍ الحفظ…');
    try {
      const payload = await collectFields();
      if (session) {
        if (session !== owner) return;
        const data = await manage(session.number, session.pin, 'edit', {p_fields:payload, p_revision:session.data.revision});
        if (session !== owner) return;
        setOwnerForm(false);
        showOwner(data, 'تم إرسال التعديل إلى الإدارة للمراجعة.');
      } else {
        const number = await reserveNumber();
        if (!number) throw new Error('أعد محاولة تجهيز رقم الطلب قبل الإرسال.');
        const {data,error} = await _db.rpc('kafala_submit_numbered', {p_request:requestKey,p_number:number,p_pin:pin,p_days:days,p_fields:payload});
        if (error?.code === 'P4100') {
          requestNumber = null;
          el('reservedNumber').value = '';
          el('copyReservedNumber').disabled = true;
          await reserveNumber();
          throw new Error('انتهت صلاحية الرقم السابق. احفظ الرقم الظاهر ثم أرسل الطلب مرة أخرى.');
        }
        if (error) throw new Error('تعذّر إرسال الطلب. تحقق من البيانات وحاول مرة أخرى.');
        submittedNumber = data;
        el('createOwnerPin').value = '';
        el('createOwnerPinAgain').value = '';
        el('formContent').style.display = 'none';
        el('formSuccess').classList.add('show');
        el('adNum').value = data;
        updateSavedNumbers(data);
        message('copySuccessNumber','');
        const link = new URL('kafala.html', location.href);
        link.hash = 'manage=' + data;
        el('trackingLink').value = link.href;
        el('trackingActions').style.display = 'block';
        message('trackingCopyStatus', '');
        window.scrollTo({top: 0, behavior: 'smooth'});
      }
    } catch (error) { message(msg, error.message); }
    finally { button.disabled = false; }
  };

  window.copyKafalaTracking = async (numberOnly = false) => {
    if (numberOnly) return copyNumber('adNum','copySuccessNumber');
    try {
      await navigator.clipboard.writeText(el('trackingLink').value);
      message('trackingCopyStatus', 'تم نسخ الرابط.');
    } catch {
      const input = el('trackingLink');
      input.focus();
      input.select();
      message('trackingCopyStatus', 'يمكنك تحديد النص ونسخه يدويًا.');
    }
  };

  window.openKafalaTracking = () => { location.assign(el('trackingLink').value); };

  async function openFromLocation() {
    const hash = location.hash.slice(1);
    if (hash === 'manage' || hash.startsWith('manage=')) {
      const number = numberFrom(hash.slice(7));
      if (!owner || (number && number !== owner.number)) closeOwner();
      const saved = renderSavedNumbers();
      const current = validNumber(number) ? number : saved[0];
      if (current) el('ownerNumber').value = current;
      showPage('manage');
      if (!owner) (current ? el('ownerPin') : el('ownerNumber')).focus();
      return;
    }
    const token = new URLSearchParams(location.search).get('track');
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return;
    showPage('manage');
    el('ownerLogin').hidden = true;
    message('ownerMessage', 'جارٍ جلب حالة الطلب السابق…');
    const {data,error} = await _db.rpc('kafala_track', {p_token:token});
    const ad = data?.[0];
    message('ownerMessage', error ? 'تعذّر تحميل حالة الطلب.' : ad
      ? 'حالة الطلب السابق: ' + statusText(ad.is_active, ad.review_status, ad.ends_at)
      : 'تعذّر العثور على الطلب السابق.');
  }

  window.addEventListener('hashchange', openFromLocation);
  document.querySelector('a[href="kafala.html#manage"]').addEventListener('click', event => {
    if (location.hash !== '#manage') return;
    event.preventDefault();
    openFromLocation();
  });
  openFromLocation();
})();

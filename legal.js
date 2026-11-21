(() => {
  const form = document.getElementById('supportForm');
  const byId = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const ad = params.get('ad');
  const kind = params.get('kind');
  if (ad && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(ad)) {
    for (const option of byId('kind').options) option.hidden = false;
    if (kind === 'transfer_report' || kind === 'transfer_contact') byId('kind').value = kind;
    byId('reference').textContent = 'مرجع الإعلان: ' + ad.slice(0, 8).toUpperCase();
    byId('reference').hidden = false;
  }
  const button = form.querySelector('button');
  const status = byId('supportStatus');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || button.disabled) return;
    button.disabled = true;
    status.textContent = 'جارٍ الإرسال…';
    try {
      const db = window.supabase.createClient(
        'https://hkfxikmpfgixrbrboxeb.supabase.co',
        'sb_publishable_OcWY5nY_-b2odLqQxsu2Kw_iQ4YswBz',
        {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
      );
      const {data,error} = await db.rpc('saahl2_send_request', {
        p_kind:byId('kind').value,p_email:byId('email').value,p_message:byId('message').value,
        p_ad: ad && !byId('reference').hidden ? ad : null
      });
      if (error) throw error;
      status.textContent = 'تم استلام الطلب. احتفظ برقمه: ' + data;
      form.reset();
    } catch (error) {
      status.textContent = error.code === 'P4290' ? 'انتظر قليلًا قبل إرسال طلب جديد.' : 'تعذّر إرسال الطلب. تحقق من الاتصال أو من حالة الإعلان ثم حاول مرة أخرى.';
    } finally {
      button.disabled = false;
      status.focus();
    }
  });
})();

(() => {
  const el = id => document.getElementById(id);
  const request = el('request');
  const change = el('change');
  const feedback = message => { el('feedback').textContent = message; };
  if (!window.supabase) {
    request.querySelector('button').disabled = true;
    feedback('تعذّر تحميل خدمة الاستعادة. حدّث الصفحة وحاول مرة أخرى.');
    return;
  }

  const locationHash = new URLSearchParams(location.hash.slice(1));
  const recovery = locationHash.get('type') === 'recovery' && Boolean(locationHash.get('access_token'));
  const query = new URLSearchParams(location.search);
  const failedLink = locationHash.has('error') || query.has('error') || query.get('error_code') === 'otp_expired';
  const client = window.supabase.createClient(
    'https://hkfxikmpfgixrbrboxeb.supabase.co',
    'sb_publishable_OcWY5nY_-b2odLqQxsu2Kw_iQ4YswBz',
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:recovery,flowType:'implicit'}}
  );
  const invalid = () => {
    history.replaceState(null, '', location.pathname);
    request.hidden = false;
    feedback('الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.');
  };

  request.addEventListener('submit', async event => {
    event.preventDefault();
    const button = request.querySelector('button');
    button.disabled = true;
    feedback('جارٍ إرسال الطلب…');
    try {
      const {error} = await client.auth.resetPasswordForEmail(el('email').value.trim(), {
        redirectTo:new URL('./reset-password.html',location.href).href
      });
      if (error && error.status !== 404) throw error;
      feedback('إذا كان البريد مسجلًا لدينا، افتح أحدث رسالة لاستعادة كلمة المرور. إذا جمع Gmail الرسائل في محادثة واحدة، اضغط «…» أسفل الرسالة الأحدث لإظهار رابطها.');
    } catch (error) {
      feedback(error?.status === 429 ? 'أُرسلت طلبات كثيرة. انتظر قليلًا قبل المحاولة.' : 'تعذّر إرسال رابط الاستعادة الآن. حاول لاحقًا.');
    } finally { button.disabled = false; }
  });

  if (failedLink) return invalid();
  if (!recovery) return;
  request.hidden = true;
  feedback('جارٍ التحقق من رابط الاستعادة…');
  let authorized = false;
  const timer = setTimeout(() => { if (!authorized) invalid(); }, 12000);
  client.auth.onAuthStateChange(event => {
    if (event !== 'PASSWORD_RECOVERY') return;
    authorized = true;
    clearTimeout(timer);
    history.replaceState(null, '', location.pathname);
    request.hidden = true;
    change.hidden = false;
    el('title').textContent = 'تعيين كلمة مرور جديدة';
    feedback('');
  });
  change.addEventListener('submit', async event => {
    event.preventDefault();
    if (!authorized) return;
    const password = el('password').value;
    if (password !== el('confirm').value) {
      feedback('كلمتا المرور غير متطابقتين.');
      return;
    }
    const button = change.querySelector('button');
    button.disabled = true;
    try {
      const {error} = await client.auth.updateUser({password});
      if (error) throw error;
      change.reset();
      change.hidden = true;
      authorized = false;
      feedback('تم حفظ كلمة المرور. ارجع إلى تسجيل الدخول واستخدم كلمة المرور الجديدة.');
      await client.auth.signOut({scope:'local'});
    } catch (error) {
      if (!authorized) return;
      feedback(error?.code === 'weak_password'
        ? 'اختر كلمة مرور أقوى.'
        : 'تعذّر حفظ كلمة المرور. تحقق من صلاحية الرابط وحاول مرة أخرى.');
    } finally { button.disabled = false; }
  });
})();

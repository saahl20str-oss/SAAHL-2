(() => {
  const $ = id => document.getElementById(id);
  const token = location.hash.slice(1);
  const text = {
    ar: {
      heading:'موافقة نشر الملف', loading:'جارٍ تحميل الطلب…',
      invalid:'هذا الرابط غير صالح أو انتهت مدته. اطلب رابطًا جديدًا من المكتب.',
      error:'تعذر الاتصال. حدّث الصفحة وحاول مرة أخرى.',
      saveError:'تعذر تسجيل ردك. حاول مرة أخرى.',
      intro:'راجعي البيانات التي قد يراها زوار ساهل‑2. القرار لكِ. يمكنكِ طلب إيقاف العرض بمراسلة saahl2030@gmail.com وذكر رقم الملف.',
      profileLabel:'أوافق على نشر البيانات المعروضة في ساهل‑2 وإتاحتها لزواره عبر الإنترنت إلى أن أطلب إيقافها أو يُزال الملف.',
      photoLabel:'أوافق أيضًا على نشر هذه الصورة (اختياري).', approve:'تسجيل الموافقة', decline:'لا أوافق',
      approved:'تم تسجيل موافقتكِ. يستطيع المكتب الآن نشر البيانات التي وافقتِ عليها.',
      declined:'تم تسجيل رفضكِ. لن يتمكن المكتب من النشر بهذا الطلب.',
      policy:'تفاصيل الخصوصية والموافقة',
      fields:['الاسم أو الرمز','رقم الملف','الجنسية','العمر','الديانة','الراتب الشهري (درهم)','سنوات الخبرة','المهارات','اللغات','ملاحظات','الخبرة حسب الدولة']
    },
    en: {
      heading:'Permission to publish your profile', loading:'Loading the request…',
      invalid:'This link is invalid or expired. Ask the office for a new link.',
      error:'Could not connect. Reload this page and try again.',
      saveError:'Your response could not be saved. Please try again.',
      intro:'Review the information SAAHL‑2 visitors could see. The decision is yours. To stop publication, email saahl2030@gmail.com and include your profile number.',
      profileLabel:'I agree to have the details shown above published online on SAAHL‑2 until I withdraw permission or the profile is removed.',
      photoLabel:'I also agree to have this photo published (optional).', approve:'Record my consent', decline:'I do not agree',
      approved:'Your consent has been recorded. The office can now publish the details you agreed to share.',
      declined:'Your decision has been recorded. The office cannot publish using this request.',
      policy:'Privacy and consent details',
      fields:['Name or reference','Profile number','Nationality','Age','Religion','Monthly salary (AED)','Years of experience','Skills','Languages','Notes','Experience by country']
    }
  };
  const fields = ['name','number','nationality','age','religion','salary','experience','skills','languages','description','countries'];
  let request = null;
  let feedback = 'loading';
  let saving = false;
  const copy = () => text[$('consentLanguage').value];
  function render(){
    const lang = $('consentLanguage').value, t = copy();
    document.documentElement.lang = lang;
    document.documentElement.dir = lang==='ar' ? 'rtl' : 'ltr';
    for(const id of ['heading','intro','profileLabel','photoLabel','approve','decline','policy']) $(id).textContent = t[id];
    $('status').textContent = t[feedback] || '';
    const pending = request?.status==='pending';
    $('review').hidden = !pending;
    if(!pending) return;
    $('officeName').textContent = request.office || '';
    const entries = $('profilePreview');
    entries.replaceChildren();
    for(const [index,key] of fields.entries()){
      let value = request.profile[key];
      if(Array.isArray(value)) value = key==='countries'
        ? value.map(entry=>[entry.country || entry.country_name || entry.name,entry.years ?? entry.experience_years].join(' · ')).join('\n')
        : value.join(', ');
      if(value==null || value==='') continue;
      const row = document.createElement('div'), label = document.createElement('dt'), detail = document.createElement('dd');
      label.textContent = t.fields[index]; detail.textContent = value;
      row.append(label,detail); entries.append(row);
    }
    const image = $('photoPreview');
    if(request.photo_url && !image.getAttribute('src')){
      image.onload = () => {
        image.hidden = $('photoConsent').hidden = false;
        $('allowPhoto').disabled = saving;
      };
      image.src = request.photo_url;
    }
    setButtons();
  }
  function setButtons(){
    $('approve').disabled = saving || !$('profileConsent').checked;
    $('decline').disabled = saving;
    $('profileConsent').disabled = saving;
    $('allowPhoto').disabled = saving || $('photoConsent').hidden;
  }
  $('consentLanguage').onchange = render;
  $('profileConsent').onchange = setButtons;
  render();
  if(!/^[a-f0-9]{64}$/.test(token)){feedback='invalid';render();return;}
  if(!window.supabase){feedback='error';render();return;}
  const client = supabase.createClient('https://hkfxikmpfgixrbrboxeb.supabase.co',
    'sb_publishable_OcWY5nY_-b2odLqQxsu2Kw_iQ4YswBz',
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'saahl2-worker-publication'}});
  async function load(){
    const {data,error} = await client.rpc('saahl2_worker_publication_link',{p_token:token});
    request = data;
    feedback = error ? 'error' : data?.status || 'invalid';
    render();
  }
  async function record(approve){
    if(saving || request?.status!=='pending' || (approve && !$('profileConsent').checked)) return;
    const photo = approve && !$('allowPhoto').disabled && $('allowPhoto').checked;
    saving = true;
    setButtons();
    try{
      const {data,error} = await client.rpc('saahl2_worker_publication_link',
        {p_token:token,p_approve:approve,p_photo:photo});
      if(error) throw error;
      request = data;
      feedback = data?.status || 'invalid';
      if(data?.status) history.replaceState(null,'',location.pathname+location.search);
    }catch{
      feedback = 'saveError';
    }finally{
      saving = false;
      render();
    }
  }
  $('consentForm').onsubmit = event => {event.preventDefault();record(true);};
  $('decline').onclick = () => record(false);
  load().catch(()=>{feedback='error';render();});
})();

/* SAAHL-2 registered-user in-app notification inbox. No push or background tracking. */
(() => {
 const rootUrl='https://hkfxikmpfgixrbrboxeb.supabase.co';
 const publicKey='sb_publishable_OcWY5nY_-b2odLqQxsu2Kw_iQ4YswBz';
 if(!window.supabase?.createClient)return;
 const db=window.supabase.createClient(rootUrl,publicKey,{auth:{storageKey:'supabase-auth-token'}});
 let panel,trigger,items=[];
 const formatDate=v=>{try{return new Date(v).toLocaleString('ar-AE',{dateStyle:'medium',timeStyle:'short'});}catch{return '';}};
 async function refresh(){
  if(!panel)return;
  const list=panel.querySelector('.saahl-inbox-items');
  const {data,error}=await db.from('notifications').select('id,title,body,target,sent_at').order('sent_at',{ascending:false}).limit(40);
  if(error){list.textContent='تعذر تحميل الإشعارات. تحقق من الاتصال وحاول مجددًا.';return;}
  items=data||[];
  list.replaceChildren();
  if(!items.length){list.textContent='لا توجد إشعارات جديدة حاليًا.';return;}
  for(const item of items){
   const article=document.createElement('article');article.className='saahl-inbox-entry';
   const title=document.createElement('strong');title.textContent=item.title;
   const text=document.createElement('p');text.textContent=item.body;
   const date=document.createElement('small');date.textContent=formatDate(item.sent_at);
   article.append(title,text,date);list.append(article);
  }
 }
 function mount(){
  if(document.getElementById('saahl-inbox-trigger'))return;
  const host=document.querySelector('.nav-actions,.office-navbar nav,.site-header nav,.nav-r,header nav,header');
  if(!host)return;
  trigger=document.createElement('button');
  trigger.id='saahl-inbox-trigger';trigger.className='saahl-inbox-trigger';
  trigger.type='button';trigger.textContent='🔔 الإشعارات';
  trigger.setAttribute('aria-expanded','false');
  panel=document.createElement('section');panel.className='saahl-inbox-panel';panel.hidden=true;
  panel.setAttribute('aria-label','إشعارات ساهل 2');
  const heading=document.createElement('strong');heading.textContent='الإشعارات الواردة';
  const reload=document.createElement('button');reload.type='button';reload.textContent='تحديث';reload.onclick=refresh;
  const close=document.createElement('button');close.type='button';close.textContent='إغلاق';close.onclick=()=>{panel.hidden=true;trigger.setAttribute('aria-expanded','false');};
  const controls=document.createElement('div');controls.className='saahl-inbox-controls';controls.append(heading,reload,close);
  const list=document.createElement('div');list.className='saahl-inbox-items';
  panel.append(controls,list);
  trigger.onclick=()=>{panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)refresh();};
  host.append(trigger);
  document.body.append(panel);
 }
 async function start(){
  try{
   const {data,error}=await db.auth.getUser();
   if(error||!data?.user)return;
   mount();
  }catch{/* Do not expose private notifications to guests. */}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 window.addEventListener('pageshow',start);
})();

/* SAAHL-2: install only on eligible devices. iOS Safari shows manual instructions. */
(() => {
  let pendingPrompt = null;
  let button = null;
  const ua = navigator.userAgent || '';
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  function hide() { if (button) button.hidden = true; }
  function showInstructions() {
    const old = document.getElementById('saahl-ios-install-info');
    if (old) { old.remove(); return; }
    const panel = document.createElement('aside');
    panel.id = 'saahl-ios-install-info';
    panel.className = 'saahl-ios-install-info';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'طريقة تثبيت تطبيق ساهل 2');
    const heading = document.createElement('strong');
    heading.textContent = 'تثبيت ساهل 2 على iPhone';
    const text = document.createElement('p');
    text.textContent = 'في Safari اضغط زر المشاركة، ثم اختر «إضافة إلى الشاشة الرئيسية» واضغط «إضافة».';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'إغلاق';
    close.addEventListener('click', () => { panel.remove(); button?.focus(); });
    panel.append(heading, text, close);
    document.body.append(panel);
    close.focus();
  }
  function show() {
    if (standalone()) return;
    if (!pendingPrompt && !(isIOS && isSafari)) return;
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'saahl-install-btn';
      button.setAttribute('aria-label', 'تثبيت تطبيق ساهل 2 على الجهاز');
      button.addEventListener('click', async () => {
        if (!pendingPrompt) { showInstructions(); return; }
        const prompt = pendingPrompt;
        pendingPrompt = null;
        hide();
        try { await prompt.prompt(); await prompt.userChoice; }
        catch { /* Only the browser can confirm installation. */ }
      });
      document.body.append(button);
    }
    button.textContent = pendingPrompt ? 'تثبيت ساهل 2' : 'إضافة ساهل 2 للشاشة';
    button.hidden = false;
  }
  window.addEventListener('beforeinstallprompt', event => {
    if (standalone()) return;
    event.preventDefault();
    pendingPrompt = event;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',show,{once:true});
    else show();
  });
  window.addEventListener('appinstalled', () => { pendingPrompt=null; hide(); });
  if (isIOS && isSafari && !standalone()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',show,{once:true});
    else show();
  }
})();

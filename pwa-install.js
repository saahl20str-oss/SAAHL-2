/* SAAHL-2 install prompt: never show unless browser offers installation. */
(() => {
  let pendingPrompt = null;
  let button = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function hide() { if (button) button.hidden = true; }
  function show() {
    if (!pendingPrompt || standalone()) return;
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'saahl-install-btn';
      button.textContent = 'تثبيت ساهل 2';
      button.setAttribute('aria-label','تثبيت تطبيق ساهل 2 على الجهاز');
      button.addEventListener('click', async () => {
        const prompt = pendingPrompt;
        if (!prompt) return;
        pendingPrompt = null;
        hide();
        try { await prompt.prompt(); await prompt.userChoice; }
        catch { /* Browser declined; do not display a false success. */ }
      });
      document.body.append(button);
    }
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
})();

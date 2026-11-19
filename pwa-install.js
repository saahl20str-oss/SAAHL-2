(() => {
  const directory = new URL('./', document.currentScript.src);
  const mode = matchMedia('(display-mode: standalone)');
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const edge = /Edg(?:A|iOS)?\//.test(ua);
  const chrome = /(?:Chrome|CriOS)\//.test(ua) && !edge;
  const safari = /Version\/[\d.]+.*Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const buttons = [];
  let pendingPrompt;
  let installed = false;
  let busy = false;
  let guide;
  let guideAction;

  const isInstalled = () => installed || mode.matches || navigator.standalone === true;

  function instructions() {
    if (ios) return safari
      ? 'في Safari افتح «المشاركة»، ثم اختر «إضافة إلى الشاشة الرئيسية». فعّل «فتح كتطبيق ويب» إذا ظهر، ثم اضغط «إضافة».'
      : 'افتح هذه الصفحة في Safari. من «المشاركة» اختر «إضافة إلى الشاشة الرئيسية»، ثم اضغط «إضافة».';
    if (edge && !android) return 'إذا ظهر رمز تثبيت التطبيق في شريط العنوان فاضغطه. أو افتح ⋯ ثم «المزيد من الأدوات» ← «التطبيقات» ← «تثبيت هذا الموقع كتطبيق». إذا غاب الخيار، جرّب نافذة Edge عادية خارج InPrivate.';
    if (android) return 'افتح قائمة ⋮ في المتصفح، واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» بحسب الخيار المتاح.';
    if (chrome) return 'في Chrome اضغط رمز التثبيت في شريط العنوان، أو افتح قائمة ⋮ ثم «البث والحفظ والمشاركة» واختر «تثبيت الصفحة كتطبيق» إذا ظهر.';
    if (safari) return 'في Safari على Mac، افتح «المشاركة» أو قائمة «ملف»، ثم اختر «إضافة إلى Dock». إذا لم يظهر الخيار، جرّب Chrome أو Edge.';
    return 'ابحث في قائمة المتصفح عن «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». إذا لم يظهر الخيار، افتح الرابط في Chrome أو Edge، أو في Safari على iPhone وiPad.';
  }

  function refresh() {
    const complete = isInstalled();
    for (const button of buttons) {
      button.disabled = complete || busy;
      button.textContent = complete ? 'ساهل-2 مثبت' : busy ? 'جارٍ التثبيت…' : 'تثبيت ساهل-2';
    }
    if (guideAction) {
      guideAction.hidden = complete || (!pendingPrompt && !busy);
      guideAction.disabled = busy;
      guideAction.textContent = busy ? 'جارٍ التثبيت…' : 'فتح نافذة التثبيت';
    }
  }

  function showGuide(opener) {
    if (guide?.open) return;
    guide = document.createElement('dialog');
    guide.id = 'saahl-ios-install-info';
    guide.className = 'saahl-install-guide';
    guide.dir = 'rtl';
    guide.setAttribute('aria-labelledby', 'saahl-install-guide-title');
    const title = document.createElement('h2');
    title.id = 'saahl-install-guide-title';
    title.textContent = 'تثبيت ساهل-2';
    const steps = document.createElement('p');
    steps.textContent = instructions();
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'إغلاق';
    close.addEventListener('click', () => guide.close());
    guideAction = document.createElement('button');
    guideAction.type = 'button';
    guideAction.addEventListener('click', requestInstall);
    guide.addEventListener('close', event => {
      event.currentTarget.remove();
      if (guide === event.currentTarget) {
        guide = null;
        guideAction = null;
      }
      if (opener.isConnected) opener.focus();
    }, {once:true});
    const actions = document.createElement('div');
    actions.className = 'saahl-install-guide-actions';
    actions.append(guideAction, close);
    guide.append(title, steps, actions);
    document.body.append(guide);
    refresh();
    guide.showModal();
    close.focus();
  }

  async function requestInstall(event) {
    if (isInstalled() || busy) return;
    const opener = event.currentTarget;
    if (!pendingPrompt) return showGuide(opener);
    const prompt = pendingPrompt;
    pendingPrompt = null;
    busy = true;
    refresh();
    try {
      const result = await prompt.prompt();
      const choice = result?.outcome ? result : await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        installed = true;
        if (guide?.open) guide.close();
      }
    } catch {
      if (!isInstalled()) showGuide(opener);
    } finally {
      busy = false;
      refresh();
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    if (isInstalled()) return;
    event.preventDefault();
    pendingPrompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    pendingPrompt = null;
    if (guide?.open) guide.close();
    refresh();
  });
  mode.addEventListener?.('change', refresh);

  function init() {
    const hosts = [...document.querySelectorAll('[data-saahl-install]')];
    if (!hosts.length) {
      const host = document.querySelector('#pg-settings .cd');
      if (host) hosts.push(host);
      else {
        const section = document.createElement('div');
        section.className = 'saahl-install-section';
        (document.querySelector('footer') || document.body).append(section);
        hosts.push(section);
      }
    }
    for (const host of hosts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'saahl-install-btn';
      button.addEventListener('click', requestInstall);
      host.append(button);
      buttons.push(button);
    }
    refresh();

    if ('serviceWorker' in navigator && window.isSecureContext) {
      const worker = new URL('./sw.js', directory);
      if (worker.origin === location.origin) {
        navigator.serviceWorker.register(worker.href, {scope:directory.pathname, updateViaCache:'none'})
          .catch(error => console.warn('تعذّر تسجيل خدمة تثبيت ساهل-2', error.message));
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();

/* Only the public launcher gets an offline fallback. All responses stay uncached. */
const scope = new URL(self.registration.scope);
const launcher = new URL('index.html', scope);
const offlinePage = `<!doctype html>
<html lang="ar" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ساهل-2 — الاتصال بالإنترنت</title>
<style>
body{box-sizing:border-box;max-width:36rem;margin:12vh auto;padding:20px;background:#fbf7ec;color:#19283b;font:16px/1.8 system-ui,sans-serif}
h1{font-size:1.7rem}a{display:inline-block;background:#19283b;color:#fff;border-radius:8px;padding:8px 14px}
</style>
<h1>ساهل-2</h1>
<p>تعذّر الاتصال بالإنترنت. اتصل بالشبكة ثم حاول مرة أخرى.</p>
<a href="${launcher.href}">إعادة المحاولة</a>
</html>`;

self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || url.search || (url.pathname !== scope.pathname && url.pathname !== launcher.pathname)) return;
  event.respondWith(fetch(request).catch(() => new Response(offlinePage, {
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
  })));
});

/* SAAHL-2 safe PWA lifecycle: no interception or caching of requests.
   Sensitive authentication, request data, HTML and API responses are never cached here. */
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

const CACHE_NAME = 'nexus-shell-v36';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/changelog.js',
  '/js/auth.js',
  '/js/pwa.js',
  '/manifest.webmanifest',
  '/icons/nexus-icon.svg',
  '/icons/nexus-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }
  if (url.pathname === '/js/changelog.js') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/uploads/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_error) {
    data = { body: event.data?.text() || '' };
  }

  const actions = Array.isArray(data.actions) ? data.actions.slice(0, 2) : [{ action: 'open', title: 'Открыть' }];

  event.waitUntil(
    self.registration.showNotification(data.title || 'Nexus', {
      body: data.body || '',
      icon: '/icons/nexus-icon.svg',
      badge: '/icons/nexus-maskable.svg',
      tag: data.tag || 'nexus-message',
      renotify: true,
      requireInteraction: true,
      silent: false,
      timestamp: Date.now(),
      vibrate: [120, 60, 120],
      actions,
      data: { url: data.url || '/', chat: data.chat || null, call: data.call || null, type: data.type || 'message' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (data.type === 'call' && event.action === 'reject-call' && data.call?.callId) {
    event.waitUntil(
      fetch(`/api/webrtc/calls/${encodeURIComponent(data.call.callId)}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }).catch(() => {})
    );
    return;
  }
  let targetUrl = data.url || '/';
  if (data.type === 'call' && data.call?.callId && data.call?.from) {
    const action = event.action === 'answer-call' ? 'answer' : event.action === 'reject-call' ? 'reject' : 'open';
    targetUrl = `/?chat=private-${data.call.from}&callAction=${action}&callId=${encodeURIComponent(data.call.callId)}`;
  }
  const absoluteTargetUrl = new URL(targetUrl, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(absoluteTargetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(absoluteTargetUrl);
    })
  );
});

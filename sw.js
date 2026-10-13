/* Service Worker - نظام زيارات المندوبين APC
   غيّر رقم VERSION مع كل إصدار جديد من index.html عشان يظهر للمستخدمين شريط "تحديث جديد". */
const VERSION = '2.44';
const SHELL_CACHE = 'apc-shell-' + VERSION;
const CDN_CACHE = 'apc-cdn-v1';
const SHELL = ['./', './index.html', './portal.html', './manifest.webmanifest', './portal.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const CDN_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  // مفيش skipWaiting تلقائي: التحديث بيتفعّل لما المستخدم يضغط "تحديث" عشان منقطعش عليه زيارة بيسجلها
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== CDN_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, err => { clearTimeout(t); reject(err); });
  });
}

// الصفحات (النظام الداخلي والبوابة): الشبكة أولاً (عشان أي تحديث يوصل) وبعدين النسخة المخزنة لو النت ضعيف أو مقطوع
// كل صفحة بتتخزن باسمها (من غير الـ query) عشان البوابة متتخلطش بالنظام الداخلي
async function pageNetworkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const u = new URL(req.url);
  const key = u.origin + u.pathname;
  try {
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), 6000);
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(key)) || (await cache.match(new URL('./index.html', self.location).href)) || Response.error();
  }
}

// مكتبات CDN (نسخها مثبّتة برقم الإصدار): من الكاش أولاً
async function cdnCacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

// باقي ملفات الموقع (أيقونات، manifest): من الكاش مع تحديثها في الخلفية
async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { e.respondWith(pageNetworkFirst(req)); return; }
    if (url.pathname.endsWith('/sw.js')) return;
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  // مكتبات Firebase/Chart.js/xlsx فقط. طلبات Firestore والمصادقة (googleapis.com) مبنلمسهاش خالص.
  if (CDN_HOSTS.includes(url.hostname) && (url.pathname.startsWith('/firebasejs/') || url.pathname.startsWith('/npm/'))) {
    e.respondWith(cdnCacheFirst(req));
  }
});

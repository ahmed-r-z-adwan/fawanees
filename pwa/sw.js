// Service worker for the installable copy. The whole game is one HTML file, so "offline" means
// keeping that file, the manifest and the icons; the fonts are picked up the first time they load.
// VERSION is rewritten by build.py from a hash of the page, so a new build replaces the old cache.
const VERSION = '2efe68cf924c';
const SHELL = `fawanees-${VERSION}`;
const FONTS = 'fawanees-fonts';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest',
                     './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== FONTS) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts: use the copy we have, and fetch it once in the background if we do not.
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Opening the app offline has to give back the page, whatever path was asked for.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch (err) { return (await caches.match('./index.html')) || Response.error(); }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) (await caches.open(SHELL)).put(req, res.clone());
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});

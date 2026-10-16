/*
 * The service worker: what lets the field page open with no network.
 *
 * It keeps the APPLICATION, never the data. Data offline is the field pack
 * and the operation queue in IndexedDB, written and read by the page itself
 * where the rules about what is a snapshot and what is queued live.
 * Nothing under /api/ is cached here: a cached API answer would be a stale
 * status shown as a live one.
 *
 *   /_next/static/*   cache first — the file names carry their content hash
 *   pages             network first; the copy kept is served when offline,
 *                     and /field stands in for a page never visited
 *   /api/*            network only
 *
 * VERSION changes with every release that changes this file; the old
 * caches are dropped on activation.
 */
const VERSION = "epc-field-v3";
const SHELL = "/field";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // The field page, and every script and stylesheet it names, so that it
    // works offline even if it was never opened with this worker running.
    const res = await fetch(SHELL, { credentials: "same-origin" });
    if (res.ok) {
      const html = await res.clone().text();
      await cache.put(SHELL, res);
      const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
      await Promise.all([...new Set(assets)].map((a) => cache.add(a).catch(() => {})));
    }
    await Promise.all(["/manifest.webmanifest", "/icons/icon-192.png"].map((a) => cache.add(a).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        // Kept by path, not by query: /field?p=…&k=…&n=… from a label is the
        // same page as /field.
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(url.pathname, copy)); }
        return res;
      } catch {
        const cache = await caches.open(VERSION);
        return (await cache.match(url.pathname)) || (await cache.match(SHELL))
          || new Response("آفلاین — این صفحه روی گوشی ذخیره نشده است.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // Icons, the manifest, fonts: whatever is kept, and refreshed behind it.
  event.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

// 家計元帳 Service Worker
// 更新するときは VERSION を変える（古いキャッシュは自動で消える）
const VERSION = "v3";
const APP = "ledger-app-" + VERSION;
const FONTS = "ledger-fonts";
const CORE = ["./", "index.html", "papaparse.min.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-32.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(CORE)));   // 待機状態で止め、画面の「更新」タップで有効化する
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("ledger-app-") && k !== APP).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // フォント：初回に保存し、以後はキャッシュ優先（失敗しても表示は崩れない）
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }
      catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  // 自分のサイト内のファイルだけ扱う。GitHub APIなど外部への通信には触れない（古いデータが出ないように）
  if (url.origin !== location.origin) return;
  e.respondWith(caches.open(APP).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }          // キャッシュ優先＋裏で更新
    return (await net) || (req.mode === "navigate" ? c.match("index.html") : Response.error());
  }));
});

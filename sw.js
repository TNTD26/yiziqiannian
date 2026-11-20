/* ============================================================
 * 一字千年 · Service Worker
 * ------------------------------------------------------------
 * 预缓存全部静态资源，安装后完全离线可用（比赛现场断网也能演示）。
 * 策略：同源静态资源走 cache-first，网络请求失败时回落缓存。
 * 字体已随包本地化，无 CDN 依赖；桌面版由本地服务直接提供全部资源。
 * ============================================================ */

const VERSION = "yiziqian-desktop-v3";
const ASSETS = [
  "./",
  "./START.html",
  "./assets/css/style.css",
    "./assets/js/three.min.js",
    "./assets/js/glyphs-real.js",
    "./assets/js/glyphs.js",
    "./assets/js/vision.js",
    "./assets/js/obicnn.js",
    "./assets/js/ai.js",
    "./assets/js/art.js",
    "./assets/js/life3d.js",
    "./assets/js/script.js",
    "./assets/img/icon.svg",
    "./assets/img/icon-192.png",
    "./assets/img/icon-512.png",
    "./assets/fonts/outfit-latin-400-normal.woff2",
    "./assets/fonts/outfit-latin-600-normal.woff2",
    "./assets/fonts/noto-serif-sc-400.woff2",
    "./assets/fonts/noto-serif-sc-600.woff2",
    "./manifest.webmanifest"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ASSETS))
      .catch(() => null)            // 个别资源失败不应阻断安装
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 跨域资源（字体、云端 API）不拦截
  if (url.origin !== self.location.origin) return;
  // 桌面启动器的内部端点（心跳 / 退出通知）必须直达本地服务，不进缓存
  if (url.pathname.indexOf("/__") === 0) return;

  // 脚本与样式同样走 network-first：避免"改了代码刷新却还是旧版本"
  // 断网时 network 请求失败 → 自动回落缓存，现场离线演示不受影响
  if (/\.(js|css)$/.test(url.pathname) || req.mode === "navigate") {
    const fallback = url.pathname.endsWith(".css") ? "./assets/css/style.css"
      : req.mode === "navigate" ? "./START.html" : req.url;
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy)).catch(() => { });
          }
          return res;
        })
        .catch(() => caches.match(req)
          .then(r => r || caches.match(fallback))
          .then(r => r || caches.match("./START.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // 后台静默更新
        fetch(req).then(res => {
          if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
        }).catch(() => { });
        return cached;
      }
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => { });
        }
        return res;
      }).catch(() => caches.match("./START.html"));
    })
  );
});

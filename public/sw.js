const STATIC_CACHE = "recipe-box-static-v10";
const DATA_CACHE = "recipe-box-data-v10";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/vendor/html5-qrcode-2.3.8.min.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/images/recipe-placeholder.svg",
  "/images/dishes/garlic-butter-filet.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, DATA_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === "GET") cache.put(request, response.clone());
    return response;
  } catch {
    return await cache.match(request) || new Response(JSON.stringify({ error: "Offline and not yet cached." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") && event.request.method === "GET") {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && /\.(?:webp|png|svg)$/.test(url.pathname)) {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
      }
      return response;
    })),
  );
});

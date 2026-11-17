const STATIC_CACHE = "recipe-box-static-v12";
const DATA_CACHE = "recipe-box-data-v12";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/amounts.js",
  "/api.js",
  "/account.js",
  "/new-this-month.js",
  "/passphrase.js",
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

function offlineResponse() {
  return new Response(JSON.stringify({ error: "Offline and not yet cached." }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

// The shared recipe list is cached for offline use. Everything else under /api/ belongs to
// one person, so it is never cached here: the page keeps its own copy per person and clears
// it on sign-out.
async function networkFirstShared(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return await cache.match(request) || offlineResponse();
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
    if (event.request.method !== "GET") return;
    if (url.pathname === "/api/recipes") event.respondWith(networkFirstShared(event.request));
    else event.respondWith(fetch(event.request).catch(offlineResponse));
    return;
  }
  if (event.request.method !== "GET") return;
  // Pages are fetched fresh when online so a new version shows up on the next load.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }
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

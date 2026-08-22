/* Keeps the app usable on a coach with no signal.

   Strategy, deliberately chosen:
     - app code and data: network first, cache as the fallback. A supporter
       always gets the current version, and still gets a working app offline.
     - versioned libraries and images: cache first, since the URL changes
       whenever the content does.

   Cache-first on app code would mean everyone runs yesterday's build until
   they happen to load twice, which is not worth the few milliseconds saved. */

const CACHE = "ktfcsa-v168";

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/css/app.css",
  "assets/js/app.js",
  "assets/js/data.js",
  "assets/js/store.js",
  "assets/js/config.js",
  "assets/img/logo-128.png",
  "assets/img/logo-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const save = (request, response) => {
  /* A 200 with nothing in it happens while a deploy is mid-flight. Caching one
     would serve an empty file until the entry is evicted, so let it through
     without keeping it. */
  const empty = response && response.headers.get("content-length") === "0";
  if (response && response.ok && !empty) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return response;
};

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /* Nothing third party is loaded any more: the Supabase SDK and Leaflet are
     both served from assets/vendor, so they follow the ordinary rules below.
     The Content-Security-Policy no longer permits scripts from anywhere else. */

  /* Anything else off-site, including Supabase, is left alone. */
  if (url.origin !== location.origin) return;


  /* Our own code and data: always ask the network first. */
  e.respondWith(
    fetch(request)
      .then((res) => save(request, res))
      .catch(() => caches.match(request).then((hit) => hit || caches.match("index.html")))
  );
});

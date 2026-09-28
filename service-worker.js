// Service worker: cachea el "shell" de la app para que funcione sin
// conexión, pero prioriza la red cuando hay internet para que las
// actualizaciones (nuevas categorías, arreglos, etc.) lleguen sin
// tener que borrar caché a mano. Los registros pendientes sin
// internet se guardan en localStorage y se envían a Supabase en
// cuanto vuelve la conexión (ver app.js -> flushQueue).

const CACHE_NAME = 'habit-tracker-v6';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './app.js',
  './chart.umd.js',
  './supabase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cachea cada archivo por separado: si uno falla (ej. un icono
      // que todavía no existe), no tira abajo la instalación entera.
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('No se pudo precachear', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear llamadas a Supabase: siempre red (o fallo controlado por la app)
  if (url.hostname.endsWith('supabase.co')) return;
  if (event.request.method !== 'GET') return;

  // Red primero (para recibir actualizaciones), caché como respaldo offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

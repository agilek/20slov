// Service worker: push notifikace + offline.
//
// Strategie záměrně dvojí:
//  - navigace (HTML) jde nejdřív na síť, ať se nová verze projeví hned;
//    offline spadne na uloženou stránku,
//  - ostatní statika je stale-while-revalidate: odpoví se hned z cache
//    (takže offline a rychlý start), ale na pozadí se stáhne čerstvá verze
//    pro příští načtení. Nová verze souboru má v index.html jiné ?v=
//    (otisk obsahu), takže se stáhne hned.
//  - /api/*, /u/* a /prihlaseni se necachují vůbec.
//
// CACHE a SHELL skládá `node tools/stamp.mjs` z index.html — ručně je neupravuj.

const CACHE = '20slov-7b712498';
const SHELL = [
    '/',
    '/icons/icon.svg',
    '/icons/favicon-32.png',
    '/icons/apple-touch-icon.png',
    '/manifest.webmanifest',
    '/fonts/Nunito-latin.woff2',
    '/fonts/Nunito-latin-ext.woff2',
    '/fonts/SlovkaOne-Regular.woff2',
    '/fonts/SlovkaOne-Light.woff2',
    '/style.css?v=d64df120',
    '/designs/kostky/profil.svg',
    '/designs/kostky/cinka.svg',
    '/designs/kostky/zpet.svg',
    '/squircle.js?v=49d800f2',
    '/words.js?v=726cd556',
    '/avatar.js?v=5bda5401',
    '/achievements.js?v=04a11446',
    '/analytics.js?v=c9f59735',
    '/game.js?v=a48e7101',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            // addAll je vše-nebo-nic; jeden chybějící soubor by shodil celou
            // instalaci, proto se ukládá po jednom a výpadky se ignorují.
            .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

const nikdyNecachovat = (url) =>
    url.pathname.startsWith('/api/') || url.pathname.startsWith('/u/') || url.pathname === '/prihlaseni'
    || url.pathname.startsWith('/ingest/');

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin === location.origin && nikdyNecachovat(url)) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then(res => {
                    // jen hra sama; /soukromi a dev stránky by jinak přepsaly offline verzi hry
                    if (url.pathname === '/' && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE).then(c => c.put('/', copy)).catch(() => {});
                    }
                    return res;
                })
                .catch(() => caches.match('/').then(r => r || Response.error()))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(hit => {
            // Uloží se jen povedené odpovědi z vlastní domény.
            const cerstve = fetch(req).then(res => {
                if (res.ok && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            }).catch(() => hit);
            return hit || cerstve;
        })
    );
});

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) {}
    const title = data.title || '20 slov';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || 'Dnešní slovo na tebe čeká!',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        data: { url: data.url || './' },
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || './';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const client of list) {
                if ('focus' in client) return client.focus();
            }
            return clients.openWindow(url);
        })
    );
});

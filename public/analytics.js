// Anonymní statistiky: PostHog (EU cloud) přes vlastní doménu /ingest, takže
// žádné třetí strany v prohlížeči a blokátory to nevidí jako cizí tracker.
// Kvótu (free = 1 M událostí/měsíc) šetří málo událostí s bohatými vlastnostmi;
// autocapture i záznam obrazovky jsou vypnuté.
//
// Všude tichý no-op: mimo ostrou doménu (lokál, workers.dev, dev stránky), po
// vypnutí v profilu, s Do Not Track, a když se skript nenačte (offline,
// blokátor). Hra z něj nesmí nikdy dostat chybu ani zpomalení, proto se
// PostHog tahá až po `load` a události před jeho načtením čekají ve frontě.
const Analytics = (() => {
    const KEY = 'phc_xftWDses5yfq86Kq7DF9mZqDTrCiGMdBM7Ny2j4bJ25U';          // veřejný projektový klíč, ne tajemství
    const HOSTS = ['20slov.cz'];
    const QUEUE_MAX = 30;                  // ponytail: fronta před načtením PostHogu; po zahození skriptu se nic nehromadí

    let want = false;      // statistiky povolené (hostitel sedí a hráč je nevypnul)
    let ph = null;         // posthog po načtení
    let loading = false;
    let clientId = '';
    const props = {};
    const queue = [];

    function load() {
        if (ph || loading) return;
        loading = true;
        const s = document.createElement('script');
        s.async = true;
        s.src = '/ingest/static/array.js';
        s.onerror = () => { loading = false; queue.length = 0; };
        s.onload = () => {
            const p = window.posthog;
            if (!p || !p.init) { loading = false; return; }
            p.init(KEY, {
                api_host: '/ingest',
                ui_host: 'https://eu.posthog.com',
                autocapture: false,
                disable_session_recording: true,
                disable_surveys: true,
                capture_pageview: true,
                capture_pageleave: false,
                capture_exceptions: true,
                advanced_disable_flags: true,
                advanced_disable_feature_flags: true,
                respect_dnt: true,
                persistence: 'localStorage',           // žádné cookies, viz /soukromi
                person_profiles: 'identified_only',
                bootstrap: { distinctID: clientId },
                loaded: (inst) => {
                    ph = inst;
                    inst.register(props);
                    if (!want) inst.opt_out_capturing();
                    else if (inst.has_opted_out_capturing()) inst.opt_in_capturing();
                    for (const [name, p2] of queue.splice(0)) inst.capture(name, p2);
                },
            });
        };
        document.head.appendChild(s);
    }

    return {
        // off = hráč statistiky vypnul. Skript se tahá až po načtení stránky.
        init({ id, off, traits }) {
            clientId = id;
            Object.assign(props, traits);
            want = HOSTS.includes(location.hostname) && !off;
            if (!want) return;
            if (document.readyState === 'complete') load();
            else window.addEventListener('load', load, { once: true });
        },
        track(name, p) {
            if (!want) return;
            if (ph) ph.capture(name, p);
            else if (queue.length < QUEUE_MAX) queue.push([name, p]);
        },
        // Vlastnosti na všech dalších událostech (platforma, série, účet…).
        set(traits) {
            Object.assign(props, traits);
            if (ph) ph.register(traits);
        },
        // Přepínač v profilu: platí hned, bez znovunačtení hry.
        setOff(off) {
            if (!HOSTS.includes(location.hostname)) return;
            want = !off;
            if (!want) { queue.length = 0; if (ph) ph.opt_out_capturing(); return; }
            if (ph) ph.opt_in_capturing(); else load();
        },
    };
})();

if (typeof module === 'object') module.exports = Analytics;   // test.mjs

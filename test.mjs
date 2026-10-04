// Jediná spustitelná kontrola projektu:  node test.mjs
// Bez frameworku, jen assert. Hlídá místa, kde tichá chyba nejvíc bolí:
// vývojové přihlášení, validaci významů, neporušitelné vlastnosti slovníku
// a úplnost přesmyček.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clean, defTextError, validClient, DEF_MIN, DEF_MAX } from './worker/src/validate.js';
import { authEnabled, devLogin, meDelete } from './worker/src/auth.js';
import { points, profilePage } from './worker/src/profile.js';
import { DatabaseSync } from 'node:sqlite';
import Avatar from './public/avatar.js';
import Achievements from './public/achievements.js';
import { stamp } from './tools/stamp.mjs';
import worker from './worker/src/index.js';

// words.js se spouští ve vm, takže pole z něj mají prototyp z jiného realmu
// a deepStrictEqual by je odmítl. Proto se porovnává jen obsah.
const prazdne = (pole, popis) =>
    assert.equal(pole.length, 0, `${popis}: ${[...pole].slice(0, 5).join(', ')}`);

let passed = 0;
const test = (name, fn) => {
    try { fn(); passed++; }
    catch (e) { console.error(`✘ ${name}\n  ${e.message}`); process.exitCode = 1; }
};

/* ---------------- vývojové přihlášení (worker) ---------------- */

// /api/dev/login obchází e-mail — nesmí existovat mimo DEV=1 ani z veřejné
// adresy. Stráž je před prvním dotazem do DB; prázdná DB pak ukáže, že prošla.
const emptyDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };
const devError = async (env, host) => (await (await devLogin(null, { DB: emptyDb, ...env },
    new URL(`http://${host}/api/dev/login`))).json()).error;
const [prodLocal, devPublic, devLan] = await Promise.all([
    devError({}, 'localhost:8787'), devError({ DEV: '1' }, '20slov.cz'), devError({ DEV: '1' }, '192.168.1.5:8787')]);

test('dev přihlášení v produkci neexistuje', () => assert.equal(prodLocal, 'not found'));
test('dev přihlášení z veřejné adresy neexistuje', () => assert.equal(devPublic, 'not found'));
test('dev přihlášení z lokální sítě projde stráží', () => assert.match(devLan, /seed-dev/));
test('účty běží jen s poštou nebo ve vývoji', () => {
    assert.equal(authEnabled({}), false);
    assert.equal(authEnabled({ DEV: '1' }), true);
    assert.equal(authEnabled({ RESEND_KEY: 'k', MAIL_FROM: 'a@b.cz' }), true);
});

/* ---------------- validace významů (worker) ---------------- */

test('krátký text neprojde', () =>
    assert.match(defTextError('krátké'), /aspoň/));

test('text na hranici délky projde', () =>
    assert.equal(defTextError('a'.repeat(DEF_MIN)), null));

test('dlouhý text neprojde', () =>
    assert.match(defTextError('a'.repeat(DEF_MAX + 1)), /Nejvýš/));

test('text přesně na horní hranici projde', () =>
    assert.equal(defTextError('a'.repeat(DEF_MAX)), null));

test('běžný význam projde', () =>
    assert.equal(defTextError('Dopravní prostředek na dvou kolech.'), null));

test('sprosté slovo neprojde', () =>
    assert.match(defTextError('tohle je nejaka kurva dlouha veta'), /sprost/));

test('odkaz neprojde', () =>
    assert.match(defTextError('Podívej se na https://example.com a uvidíš'), /Odkazy/));

test('bílé znaky se slučují a ořezávají', () =>
    assert.equal(clean('  a\t\tb\n\nc  '), 'a b c'));

test('řídicí znaky se nepočítají jako délka', () =>
    assert.match(defTextError('ab\u0000\u0001cd'), /aspoň/));

test('clientId musí mít rozumnou délku', () => {
    assert.equal(validClient('x'.repeat(8)), true);
    assert.equal(validClient('x'.repeat(64)), true);
    assert.equal(validClient('x'.repeat(7)), false);
    assert.equal(validClient('x'.repeat(65)), false);
    assert.equal(validClient(null), false);
});

/* ---------------- body za aktivitu (worker) ---------------- */

// Body počítá jeden SQL dotaz, proto proti skutečnému SQLite ze schema.sql.
// Hlídá denní stropy, skryté významy a to, že se nepočítá cizí aktivita.
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('./worker/schema.sql', import.meta.url), 'utf8'));
const run = (q, ...a) => sql.prepare(q).run(...a);
const DEN = 86400000;
for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) run('INSERT INTO profile_days VALUES (?, ?, 0, 0, 0)', 'ja', d);
run('INSERT INTO profile_days VALUES (?, ?, 0, 20, 0)', 'cizi', '2026-09-01');
run("INSERT INTO training_days VALUES ('ja', '2026-09-01', 25), ('ja', '2026-09-02', 4), ('cizi', '2026-09-01', 9)");
run("INSERT INTO definitions (id, word, text, user_id, votes, hidden, created_at) VALUES ('v1', 'a', 't', 'ja', 3, 0, 0), ('v2', 'b', 't', 'ja', 5, 1, 0)");
for (let i = 0; i < 14; i++) run('INSERT INTO votes VALUES (?, ?, ?)', `x${i}`, 'ja', i < 12 ? i : 2 * DEN);
run("INSERT INTO votes VALUES ('v1', 'cizi', 0)");
const d1 = {
    prepare: (q) => ({ bind: (...a) => ({
        all: async () => ({ results: sql.prepare(q).all(...a) }),
        first: async () => sql.prepare(q).get(...a) ?? null,
        run: async () => sql.prepare(q).run(...a),
    }) }),
    batch: async (stmts) => Promise.all(stmts.map(st => st.run())),
};
const [mojeBody, nikdo] = await Promise.all([points({ DB: d1 }, 'ja'), points({ DB: d1 }, 'nikdo')]);

test('body: denní stropy a skryté významy', () => assert.deepEqual({ ...mojeBody },
    { total: 3 * 10 + 14 + 5 + 3 * 2 + 12, dny: 3, slovTreninku: 14, vyznamu: 1, ziskanychHlasu: 3, maxHlasu: 3, nejlepsi: 0, danychHlasu: 12 }));
test('body: hráč bez aktivity má nulu', () => assert.equal(nikdo.total, 0));

/* ---------------- percentil dne (worker) ---------------- */

// Celou cestou přes fetch workeru: validace, zápis a jeden SQL dotaz na pořadí.
// Den 366 je stejný den cyklu jako den 1, ale jiný rok — nesmí se míchat.
const poslat = (day, score, clientId) => worker.fetch(new Request('https://x/api/result', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, score, clientId }),
}), { DB: d1 }).then(r => r.json());
for (let i = 0; i < 20; i++) await poslat(1, i, `hrac-${String(i).padStart(4, '0')}`);
await poslat(366, 20, 'hrac-pristi-rok');
const muj = await poslat(1, 15, 'hrac-ja-00001');
const malo = await poslat(2, 20, 'hrac-ja-00001');
const spatne = await poslat(1, 21, 'hrac-ja-00001');
test('percentil: kolik hráčů dne má aspoň tolik slov', () =>
    assert.deepEqual(muj, { real: true, total: 21, topPct: 29 }));   // 15–19 a já = 6 z 21
test('percentil: pod 15 hráči jen odhad', () => assert.deepEqual(malo, { real: false, total: 1 }));
test('percentil: nesmyslné skóre neprojde', () => assert.equal(spatne.error, 'bad params'));

/* ---------------- úspěchy ---------------- */

// Nejlepší výklad = význam nahoře u slova, a jen když porazil jiný.
run("INSERT INTO definitions (id, word, text, user_id, votes, hidden, created_at) VALUES ('w1', 'slon', 't', 'autor', 4, 0, 0), ('w2', 'slon', 't', 'cizi', 2, 0, 0), ('w3', 'sam', 't', 'autor', 9, 0, 0)");
const autor = await points({ DB: d1 }, 'autor');
test('úspěchy: nejlepší výklad a nejvíc hlasů na jednom významu', () =>
    assert.deepEqual([autor.nejlepsi, autor.maxHlasu], [1, 9]));

/* ---------------- smazání účtu ---------------- */

// Zásady soukromí slibují, že po smazání zůstanou jen významy bez autora.
const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ab12')))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
run("INSERT INTO users (id, email_hash, handle, handle_lc, created_at) VALUES ('smaz', 'h', 'Smaz', 'smaz', 0)");
run("INSERT INTO sessions VALUES (?, 'smaz', 0, ?)", tokenHash, Date.now() + DEN);
run("INSERT INTO profile_days VALUES ('smaz', '2026-09-01', 0, 20, 0)");
run("INSERT INTO definitions (id, word, text, user_id, author, votes, created_at) VALUES ('s1', 'kolo', 't', 'smaz', 'Smaz', 0, 0)");
run("INSERT INTO votes VALUES ('w2', 'smaz', 0)");
run("UPDATE definitions SET votes = votes + 1 WHERE id = 'w2'");
const hlasyPred = sql.prepare("SELECT votes FROM definitions WHERE id = 'w2'").get().votes;
await meDelete(new Request('https://x/api/me/delete', { method: 'POST', headers: { Cookie: 'sid=ab12' } }),
    { DB: d1, RESEND_KEY: 'x', MAIL_FROM: 'x' });
const zbylo = (t, col) => sql.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = 'smaz'`).get().n;
test('smazání účtu: data pryč, významy bez autora, hlasy odečtené', () => assert.deepEqual({
    users: zbylo('users', 'id'), sessions: zbylo('sessions', 'user_id'), dny: zbylo('profile_days', 'user_id'),
    hlasy: zbylo('votes', 'client_id'), hlasuW2: sql.prepare("SELECT votes FROM definitions WHERE id = 'w2'").get().votes,
    vyznam: { ...sql.prepare("SELECT user_id, author FROM definitions WHERE id = 's1'").get() },
}, { users: 0, sessions: 0, dny: 0, hlasy: 0, hlasuW2: hlasyPred - 1, vyznam: { user_id: null, author: null } }));
test('úspěchy: prahy a veřejný stav', () => {
    const st = Achievements.publicState({ dny: 7, nejdelsi: 7, perfektnich: 0 }, autor, true);
    const got = Achievements.LIST.filter(a => Achievements.done(a, st)).map(a => a.id);
    assert.deepEqual(got, ['prvni-kolo', 'nova-tvar', 'rozjezd', 'tyden', 'sto-slov', 'pisalek', 'palec', 'nejlepsi']);
});
// Veřejný profil: odznaky, které zná jen klient (tajné, sdílení), přijdou
// z user_achievements; ostatní server dopočítá sám (autor má význam = Pisálek).
// Hlavní profil ukáže jen náhled (nejvýš 4) s odkazem na všechny; celý
// seznam je na ?ach=1, po skupinách jako v aplikaci.
run("INSERT INTO users (id, email_hash, handle, handle_lc, created_at) VALUES ('autor', 'h', 'Autor', 'autor', 0)");
run("INSERT INTO user_achievements VALUES ('autor', 'nocni-sova', 0), ('autor', 'chlouba', 0)");
const [verejny, vsechny] = await Promise.all([
    profilePage(null, { DB: d1 }, new URL('https://x/u/Autor?cast=1')).then(r => r.text()),
    profilePage(null, { DB: d1 }, new URL('https://x/u/Autor?cast=1&ach=1')).then(r => r.text()),
]);
test('úspěchy: hlavní profil má jen náhled (≤4) a odkaz na všechny', () => {
    assert.equal((verejny.match(/class="ach-tile/g) || []).length, 4);
    assert.match(verejny, /ach-grid.*>[\s\S]{0,400}Všechny úspěchy/);
    assert.ok(!verejny.includes('ach-name">Bleskovka<'));
});
test('úspěchy: ?ach=1 ukáže úplně všechny, i ty z klienta', () => {
    for (const jmeno of ['Noční sova', 'Chlouba', 'Pisálek']) assert.ok(vsechny.includes(`ach-name">${jmeno}<`), jmeno);
    assert.ok(!vsechny.includes('ach-name">Bleskovka<'));
    assert.match(vsechny, /Zpět na profil/);
});
test('úspěchy: unikátní id a každá ikona existuje', () => {
    assert.equal(new Set(Achievements.LIST.map(a => a.id)).size, Achievements.LIST.length);
    for (const a of Achievements.LIST) if (a.icon !== 'avatar') readFileSync(`public/designs/kostky/${a.icon}.svg`);
});

/* ---------------- správa (/admin) ---------------- */

// Správce = účet, jehož e-mail (hash s pepřem) je v ADMIN_EMAILS. Ostatním
// /api/admin/* neexistuje. Vrácení významu musí smazat i nahlášení a blokace
// odhlásit, skrýt významy a veřejný profil.
globalThis.caches ??= { default: { delete: async () => true } };
const hash = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
run("INSERT INTO users (id, email_hash, handle, handle_lc, created_at) VALUES ('sef', ?, 'Sef', 'sef', 0), ('hrac', 'x', 'Hrac', 'hrac', 0), ('zly', 'y', 'Zly', 'zly', 0)",
    await hash('boss@20slov.cz' + 'pepr'));
run('INSERT INTO sessions VALUES (?, ?, 0, ?), (?, ?, 0, ?), (?, ?, 0, ?)',
    await hash('aa01'), 'sef', Date.now() + DEN, await hash('aa02'), 'hrac', Date.now() + DEN, await hash('aa03'), 'zly', Date.now() + DEN);
run("INSERT INTO definitions (id, word, text, user_id, author, votes, reports, hidden, created_at) VALUES ('n1', 'pes', 'nahlášený', 'hrac', 'Hrac', 0, 3, 1, 0), ('z1', 'kocka', 'zlý', 'zly', 'Zly', 0, 0, 0, 0)");
run("INSERT INTO reports VALUES ('n1', 'a', 0), ('n1', 'b', 0), ('n1', 'c', 0)");
const envAdmin = { DB: d1, RESEND_KEY: 'x', MAIL_FROM: 'x', HASH_PEPPER: 'pepr', ADMIN_EMAILS: 'nekdo@jiny.cz, Boss@20slov.cz ' };
const spravce = (path, sid, body, env = envAdmin) => worker.fetch(new Request('https://x/api/admin/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'sid=' + sid }, body: JSON.stringify(body),
} : { headers: { Cookie: 'sid=' + sid } }), env);
const [bezSeznamu, cizi, prehled] = await Promise.all([
    spravce('overview', 'aa01', null, { ...envAdmin, ADMIN_EMAILS: '' }), spravce('overview', 'aa02'), spravce('overview', 'aa01')]);
test('správa: bez ADMIN_EMAILS a pro ostatní neexistuje', () => assert.deepEqual([bezSeznamu.status, cizi.status], [404, 404]));
test('správa: správce vidí přehled', () => assert.equal(prehled.status, 200));
const kKontrole = await (await spravce('defs?filter=review', 'aa01')).json();
test('správa: ke kontrole jsou nahlášené a skryté, ne čisté', () => {
    const ids = kKontrole.defs.map(d => d.id);
    assert.ok(ids.includes('n1') && !ids.includes('z1'), ids.join());
});
await spravce('def', 'aa01', { id: 'n1', action: 'show' });
test('správa: vrácení smaže i nahlášení', () => assert.deepEqual(
    { ...sql.prepare("SELECT hidden, reports, (SELECT COUNT(*) FROM reports WHERE definition_id = 'n1') AS zbylo FROM definitions WHERE id = 'n1'").get() },
    { hidden: 0, reports: 0, zbylo: 0 }));
const sebe = await spravce('user', 'aa01', { id: 'sef', action: 'ban' });
await spravce('user', 'aa01', { id: 'zly', action: 'ban' });
const profilZleho = await profilePage(null, { DB: d1 }, new URL('https://x/u/Zly'));
test('správa: blokace odhlásí, skryje významy i profil, sebe ne', () => assert.deepEqual({
    sebe: sebe.status, banned: sql.prepare("SELECT banned FROM users WHERE id = 'zly'").get().banned,
    sessions: sql.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'zly'").get().n,
    hidden: sql.prepare("SELECT hidden FROM definitions WHERE id = 'z1'").get().hidden, profil: profilZleho.status,
}, { sebe: 400, banned: 1, sessions: 0, hidden: 1, profil: 404 }));
const [prejmenovat, obsazeno] = [await spravce('user', 'aa01', { id: 'hrac', action: 'rename', handle: 'Slušný' }),
    await spravce('user', 'aa01', { id: 'zly', action: 'rename', handle: 'sef' })];
test('správa: přejmenování přepíše autora, obsazené neprojde', () => assert.deepEqual(
    [prejmenovat.status, sql.prepare("SELECT author FROM definitions WHERE id = 'n1'").get().author, obsazeno.status],
    [200, 'Slušný', 409]));

/* ---------------- avatar (hra i worker) ---------------- */

// Kód jde z localStorage i z POST /api/me/avatar rovnou do innerHTML —
// projít smí jen čtyři indexy v rozsahu polí.
test('avatar: každý tvar, barva, oči i pusa se vykreslí', () => {
    const [ns, nc, ne, nm] = Avatar.counts;
    assert.ok(ns >= 30 && ne >= 15 && nm >= 15, `málo variant: ${Avatar.counts}`);
    for (let i = 0; i < Math.max(ns, nc, ne, nm); i++) {
        const svg = Avatar.svg(`${i % ns}-${i % nc}-${i % ne}-${i % nm}`);
        assert.match(svg, /^<svg[^>]*>.*<\/svg>$/s);
        assert.doesNotMatch(svg, /undefined|NaN/);
    }
});
test('avatar: náhodný kód je vždy platný', () => {
    for (let i = 0; i < 500; i++) assert.ok(Avatar.valid(Avatar.random()));
});
test('avatar: cizí kód neprojde', () => {
    const [ns] = Avatar.counts;
    for (const bad of [`${ns}-0-0-0`, '0-0-0', '0-0-0-0-0', '0-0-0-0"><script>', '', null, '-1-0-0-0'])
        assert.equal(Avatar.svg(bad), '', String(bad));
});

/* ---------------- slovník ---------------- */

// vm je vlastní realm — web globály (atob, TextDecoder) v něm nejsou, dekodér
// slov je ale potřebuje. Prototypy polí odtud jsou cizí, proto se níž porovnává
// jen obsah.
const ctx = { o: null, atob, TextEncoder, TextDecoder };
vm.createContext(ctx);
vm.runInContext(
    readFileSync(new URL('./public/words.js', import.meta.url), 'utf8') +
    '\n;o = { PACKED, unpackDay, PRACTICE_WORDS, ALTS };', ctx);
const { PACKED, unpackDay, PRACTICE_WORDS, ALTS } = ctx.o;
// Rozbalené denní pořadí. Zároveň nejpřísnější kontrola šifry: kontroly níž
// (podmnožina poolu, jedno slovo z každého pásma) spadnou při jediném rozjetém
// bitu mezi pack_day v Pythonu a unpackDay v JS.
const WORDS = Array.from({ length: PACKED.length }, (_, i) => unpackDay(i)).flat();

const PER_DAY = 20;
const DAYS = 365;

test('denní výzva má přesně rok slov', () =>
    assert.equal(WORDS.length, DAYS * PER_DAY));

test('denní slova nejsou ve zdrojáku čitelná', () => {
    const src = readFileSync(new URL('./public/words.js', import.meta.url), 'utf8');
    const den = unpackDay(0);
    assert.equal(src.includes('const WORDS'), false);
    // slovo z dne 1 se v souboru smí objevit leda v tréninkovém poolu,
    // ne na místě, kde by šlo přečíst, ke kterému dni patří.
    assert.equal(src.includes(den.join('","')), false);
});

test('tréninkový pool má 15 000 slov', () =>
    assert.equal(PRACTICE_WORDS.length, 15000));

test('žádné slovo se neopakuje', () => {
    assert.equal(new Set(WORDS).size, WORDS.length);
    assert.equal(new Set(PRACTICE_WORDS).size, PRACTICE_WORDS.length);
});

test('denní slova jsou podmnožinou poolu', () => {
    const pool = new Set(PRACTICE_WORDS);
    prazdne(WORDS.filter(w => !pool.has(w)), 'mimo pool');
});

test('denní výzva je přesně prvních 7300 slov poolu', () => {
    // Na tom stojí popisek obtížnosti tréninku „Střední = stejně jako v denní výzvě".
    const top = new Set(PRACTICE_WORDS.slice(0, WORDS.length));
    prazdne(WORDS.filter(w => !top.has(w)), 'mimo prvních 7300');
});

test('každý den má právě jedno slovo z každého frekvenčního pásma', () => {
    // Pásma se počítají z pořadí v poolu; pool je seřazený podle frekvence.
    const rank = new Map(PRACTICE_WORDS.map((w, i) => [w, i]));
    const daily = [...WORDS].sort((a, b) => rank.get(a) - rank.get(b));
    const band = new Map(daily.map((w, i) => [w, Math.floor(i / DAYS)]));
    for (let d = 0; d < DAYS; d++) {
        const den = WORDS.slice(d * PER_DAY, (d + 1) * PER_DAY);
        assert.equal(new Set(den.map(w => band.get(w))).size, PER_DAY,
            `den ${d + 1} nemá slovo z každého pásma`);
    }
});

/* ---------------- přesmyčky ---------------- */

const klic = w => [...w].sort().join('');
const skupiny = new Map();
for (const w of PRACTICE_WORDS) {
    const k = klic(w);
    if (!skupiny.has(k)) skupiny.set(k, []);
    skupiny.get(k).push(w);
}

test('každá přesmyčka uvnitř poolu je v ALTS', () => {
    const chybi = [];
    for (const ws of skupiny.values()) {
        if (ws.length < 2) continue;
        for (const w of ws) {
            const ma = new Set(ALTS[w] || []);
            for (const jine of ws) if (jine !== w && !ma.has(jine)) chybi.push(`${w}→${jine}`);
        }
    }
    prazdne(chybi, 'chybějící vazby');
});

test('ruční kurace zůstala zachovaná', () => {
    assert.ok((ALTS['otec'] || []).includes('ocet'));
    assert.ok((ALTS['otec'] || []).includes('otce'));   // i tvar mimo pool
    assert.ok((ALTS['rok'] || []).includes('okr'));
});

test('alternativa je vždy ze stejných písmen', () => {
    for (const [slovo, alts] of Object.entries(ALTS)) {
        for (const a of alts) {
            assert.equal(klic(a), klic(slovo), `${slovo} ↔ ${a} nejsou přesmyčky`);
        }
    }
});

/* ---------------- anonymní statistiky ---------------- */

// analytics.js ve vm s falešným prohlížečem: skript PostHogu se netahá nikdy
// mimo ostrou doménu ani po vypnutí, události před načtením čekají a po
// vypnutí se zahazují.
const prohlizec = (hostname) => {
    const skripty = [], volani = [];
    const ph = {
        init: (key, cfg) => { volani.push(['init', key, cfg]); cfg.loaded(ph); },
        register: (p) => volani.push(['register', p]),
        capture: (n, p) => volani.push(['capture', n, p]),
        opt_out_capturing: () => volani.push(['opt_out']),
        opt_in_capturing: () => volani.push(['opt_in']),
        has_opted_out_capturing: () => false,
    };
    const win = { posthog: ph, addEventListener: () => {} };
    const ctx = { window: win, location: { hostname }, module: undefined,
        document: { readyState: 'complete', head: { appendChild: (el) => skripty.push(el) }, createElement: () => ({}) } };
    vm.createContext(ctx);
    vm.runInContext(readFileSync('public/analytics.js', 'utf8') + '\nthis.Analytics = Analytics;', ctx);
    return { A: ctx.Analytics, skripty, volani };
};
test('statistiky: mimo 20slov.cz nic', () => {
    const { A, skripty } = prohlizec('localhost');
    A.init({ id: 'x', off: false, traits: {} });
    A.track('day_started');
    assert.equal(skripty.length, 0);
});
test('statistiky: vypnuté v profilu se ani nenačtou', () => {
    const { A, skripty } = prohlizec('20slov.cz');
    A.init({ id: 'x', off: true, traits: {} });
    assert.equal(skripty.length, 0);
});
test('statistiky: fronta, init přes /ingest, vypnutí za běhu', () => {
    const { A, skripty, volani } = prohlizec('20slov.cz');
    A.init({ id: 'zarizeni-1', off: false, traits: { platform: 'ios' } });
    A.track('day_started', { day_idx: 3 });                       // PostHog ještě není načtený
    assert.equal(skripty[0].src, '/ingest/static/array.js');
    skripty[0].onload();
    const init = volani.find(v => v[0] === 'init');
    assert.equal(init[2].api_host, '/ingest');
    assert.equal(init[2].persistence, 'localStorage');            // žádné cookies
    assert.equal(init[2].autocapture, false);
    assert.equal(init[2].disable_session_recording, true);
    assert.equal(init[2].bootstrap.distinctID, 'zarizeni-1');
    assert.deepEqual(volani.find(v => v[0] === 'capture').slice(1), ['day_started', { day_idx: 3 }]);
    A.setOff(true);
    A.track('day_finished', {});
    assert.equal(volani.filter(v => v[0] === 'capture').length, 1, 'po vypnutí se nic neposílá');
    assert.ok(volani.some(v => v[0] === 'opt_out'));
});
await (async () => {   // top-level await: `test` výše je synchronní
  try {
    const volane = [];
    const puvodni = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        volane.push([url, init]);
        return new Response('ok', { status: 200, headers: { 'Set-Cookie': 'ph=1', 'Content-Length': '2' } });
    };
    try {
        const hlavicky = { Cookie: 'sid=tajne', 'CF-Connecting-IP': '1.2.3.4' };
        const sk = await worker.fetch(new Request('https://x/ingest/static/array.js', { headers: hlavicky }), {});
        const ev = await worker.fetch(new Request('https://x/ingest/e/?v=1', { method: 'POST', body: '{}', headers: hlavicky }), {});
        assert.equal(volane[0][0], 'https://eu-assets.i.posthog.com/static/array.js');
        assert.equal(volane[1][0], 'https://eu.i.posthog.com/e/?v=1');
        assert.equal(volane[1][1].headers.get('cookie'), null);
        assert.equal(volane[1][1].headers.get('x-forwarded-for'), '1.2.3.4');
        assert.equal(sk.headers.get('set-cookie'), null);
        assert.equal(ev.status, 200);
        const del = await worker.fetch(new Request('https://x/ingest/e/', { method: 'DELETE' }), {});
        assert.equal(del.status, 404);
    } finally { globalThis.fetch = puvodni; }
    passed++;
  } catch (e) { console.error(`✘ statistiky: proxy /ingest\n  ${e.message}`); process.exitCode = 1; }
})();

/* ---------------- verze statiky ---------------- */

// ?v= v index.html a CACHE/SHELL v sw.js jsou otisky obsahu. Kdo změní CSS
// nebo JS a zapomene na `node tools/stamp.mjs`, vracející se hráč dostane
// ze service workeru starou verzi.
test('statika je orazítkovaná (node tools/stamp.mjs)', () => {
    const { html, sw } = stamp();
    assert.ok(html === readFileSync('public/index.html', 'utf8'), 'index.html má staré ?v=');
    assert.ok(sw === readFileSync('public/sw.js', 'utf8'), 'sw.js má starý SHELL nebo CACHE');
});

console.log(`${passed} kontrol prošlo${process.exitCode ? ' (a něco spadlo)' : ''}`);

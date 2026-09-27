// Backend hry 20 000 slov: skutečné percentily + denní připomínka přes Web Push.
// Běží na Cloudflare Workers + D1 (SQLite na edge). Zdarma v rámci free tier
// (100k čtení / 100k zápisů denně v D1). Web Push jede přes @pushforge/builder,
// jediná knihovna z tohohle výběru, co používá Web Crypto místo Node `crypto`/`https`
// a funguje tak přímo ve Workers.

import { buildPushHTTPRequest } from '@pushforge/builder';
import { clean, defTextError, validClient } from './validate.js';
import { json, readJson, badJson } from './http.js';
import {
    authStart, authPoll, authVerify, authApprove, authLandingPage,
    authLogout, meGet, meSetHandle, meSetAvatar, meDelete, currentUser, purgeAuth, devMode, devLogin,
} from './auth.js';
import { apiProfile, profilePage, validPlayedOn, points, myResults } from './profile.js';
import { defCacheKey, dropDefCache } from './defcache.js';
import { ADMIN_ROUTES } from './admin.js';
import Achievements from '../../public/achievements.js';

const MIN_SAMPLE = 15; // pod tento počet hráčů dne se vrátí { real: false } a hra použije statický odhad
const MAX_DAY = 5000;
const DAYS = 365;
const ADMIN_CONTACT = 'https://github.com/agilek/20slov'; // VAPID "sub" kontakt, viz RFC 8292
// Kam vede klepnutí na push notifikaci. V cronu není request, ze kterého by
// šlo origin odvodit, takže je natvrdo — po navázání vlastní domény přepsat.
const SITE_URL = 'https://20slov.cz/';

// Cesty. Statiku servírují [assets] ve wrangler.toml, sem doteče jen to, co
// sedí na run_worker_first — proto tu nejsou žádné soubory.
const ROUTES = {
    'POST /api/result': handleSubmit,
    'GET /api/percentile': handlePercentile,
    'POST /api/subscribe': handleSubscribe,
    'GET /api/defs': handleDefsBatch,
    'GET /api/defs/word': handleDefsForWord,
    'GET /api/defs/mine': handleMyDefs,
    'POST /api/defs': handleDefCreate,
    'POST /api/defs/vote': handleDefVote,
    'POST /api/defs/report': handleDefReport,
    'POST /api/defs/edit': handleDefEdit,
    // Účty. Bez RESEND_KEY/MAIL_FROM zůstane /api/auth/start na 503 a klient
    // přihlášení vůbec nenabídne — viz `auth` v odpovědi /api/me.
    'POST /api/auth/start': authStart,
    'GET /api/auth/poll': authPoll,
    'POST /api/auth/verify': authVerify,
    'POST /api/auth/approve': authApprove,
    'POST /api/auth/logout': authLogout,
    'GET /prihlaseni': authLandingPage,
    'GET /api/me': meGet,
    'POST /api/me/handle': meSetHandle,
    'POST /api/me/avatar': meSetAvatar,
    'POST /api/me/delete': meDelete,
    'GET /api/profile': apiProfile,
    'POST /api/profile/backfill': handleBackfill,
    'GET /api/me/points': handleMyPoints,
    'GET /api/me/results': handleMyResults,
    'POST /api/training': handleTraining,
    'POST /api/achievements': handleAchievements,
    'GET /api/achievements/stats': handleAchievementStats,
    'GET /api/dev/login': devLogin,   // jen DEV=1, viz auth.js
    // Správa (/admin): jen pro účty z ADMIN_EMAILS, ostatním 404, viz admin.js.
    ...ADMIN_ROUTES,
};

// Limity na významy. Drží se v D1 dotazech, žádné nové úložiště.
const DEF_PER_DAY = 20;
const BATCH_MAX = 20;
const REPORTS_TO_HIDE = 3;

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // Profil má v cestě přezdívku, takže se do tabulky cest nevejde.
        if (request.method === 'GET' && url.pathname.startsWith('/u/')) {
            return profilePage(request, env, url);
        }
        const handler = ROUTES[`${request.method} ${url.pathname}`];
        if (!handler) {
            // Sem dojde i každá adresa, pro kterou [assets] nenašly soubor: s workerem
            // se not_found_handling sám neuplatní. Mimo API ji proto vrátí statika,
            // ta už podle wrangler.toml pošle public/404.html se stavem 404.
            const page = (request.method === 'GET' || request.method === 'HEAD') && !url.pathname.startsWith('/api/');
            return page && env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'not found' }, 404);
        }
        // CSRF: cizí stránka neumí poslat náš Content-Type bez preflightu (a ten
        // bez CORS hlaviček neprojde), Origin navíc musí sedět na vlastní doménu.
        if (request.method !== 'GET' && !sameOrigin(request, url)) {
            return json({ error: 'bad origin' }, 403);
        }
        try {
            return await handler(request, env, url, ctx);
        } catch (err) {
            return json({ error: 'internal error' }, 500);
        }
    },

    // Cron trigger (viz wrangler.toml) — jednou denně pošle připomínku všem odběratelům.
    async scheduled(event, env, ctx) {
        ctx.waitUntil(sendDailyReminders(env));
        ctx.waitUntil(purgeAuth(env));   // prošlé žádosti a session, ať IP hashe neleží
    },
};

// Hra i API jedou na jedné doméně, takže CORS není potřeba vůbec.
function sameOrigin(request, url) {
    const origin = request.headers.get('Origin');
    return !origin || origin === url.origin;
}

const validScore = (n) => Number.isInteger(n) && n >= 0 && n <= 20;

// Historie z doby před přihlášením — klient si ji tvrdí sám, stejně jako
// /api/result. Proto profil ano, žebříček ne.
async function handleBackfill(request, env) {
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'not logged in' }, 401);
    const body = await readJson(request);
    if (!body) return badJson();
    const days = Array.isArray(body.days) ? body.days.slice(0, 400) : [];
    const rows = days.filter(d =>
        validPlayedOn(d && d.d) && validScore(d.score)
        && Number.isInteger(d.dayIdx) && d.dayIdx >= 0 && d.dayIdx < 365);
    if (!rows.length) return json({ ok: true, added: 0 }, 200);
    await env.DB.batch(rows.map(d => env.DB.prepare(
        `INSERT INTO profile_days (user_id, played_on, day_idx, score, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, played_on) DO NOTHING`
    ).bind(user.id, d.d, d.dayIdx, d.score, Date.now())));
    return json({ ok: true, added: rows.length }, 200);
}

// Získané úspěchy zařízení (i bez účtu) pro „Má ho X % hráčů“. U přihlášeného
// se zapíšou i k účtu, ať je veřejný profil ukáže i ty, které zná jen klient
// (sdílení, Bleskovka, tajné). Klient si je tvrdí sám jako /api/result.
// Proto jen tahle čísla a odznaky na profilu, nic, co by šlo zneužít.
const ACH_IDS = new Set(Achievements.LIST.map(a => a.id));
async function handleAchievements(request, env) {
    const body = await readJson(request);
    if (!body) return badJson();
    if (!validClient(body.clientId) || !Array.isArray(body.ids)) return json({ error: 'bad params' }, 400);
    const ids = [...new Set(body.ids)].filter(id => ACH_IDS.has(id));
    if (!ids.length) return json({ ok: true }, 200);
    const user = await currentUser(request, env);
    const now = Date.now();
    await env.DB.batch(ids.flatMap(id => [
        env.DB.prepare('INSERT INTO achievements (client_id, ach, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING')
            .bind(body.clientId, id, now),
        ...(user ? [env.DB.prepare('INSERT INTO user_achievements (user_id, ach, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING')
            .bind(user.id, id, now)] : []),
    ]));
    return json({ ok: true }, 200);
}

// { total, pct: { id: % } }. Pod MIN_SAMPLE zařízeními bez procent, jako
// percentil dne. Mění se pomalu, proto hodinová cache na edge.
async function handleAchievementStats(request, env, url, ctx) {
    const cache = devMode(env) ? null : caches.default;
    const key = new Request(url.origin + '/api/achievements/stats');
    const hit = cache && await cache.match(key);
    if (hit) return hit;
    const [{ results: tot }, { results: rows }] = await Promise.all([
        env.DB.prepare('SELECT COUNT(DISTINCT client_id) AS n FROM achievements').all(),
        env.DB.prepare('SELECT ach, COUNT(*) AS n FROM achievements GROUP BY ach').all(),
    ]);
    const total = tot[0].n;
    const pct = {};
    if (total >= MIN_SAMPLE) for (const r of rows) pct[r.ach] = Math.round(r.n / total * 1000) / 10;
    const res = json({ total, pct }, 200, { 'Cache-Control': 'public, max-age=3600' });
    if (cache) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
}

// Body pro vlastní profil. Veřejný je má v markupu z profile.js.
async function handleMyPoints(request, env) {
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'not logged in' }, 401);
    return json(await points(env, user.id), 200);
}

// Odehrané dny účtu pro obnovu persist.results na novém zařízení (viz
// restoreResults v game.js) — po přihlášení, ať profil neukazuje nulu i
// s odehranou historií. Jde přes session, ne veřejný profil (ten by
// se skrytým profilem vrátil 404 i vlastníkovi).
async function handleMyResults(request, env) {
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'not logged in' }, 401);
    return json({ days: await myResults(env, user.id) }, 200);
}

// Jedno uhodnuté slovo tréninku. Klient si ho tvrdí sám jako /api/result,
// proto body za trénink mají denní strop (profile.js ZA_DEN).
async function handleTraining(request, env) {
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'not logged in' }, 401);
    const body = await readJson(request);
    if (!body) return badJson();
    if (!validPlayedOn(body.playedOn)) return json({ error: 'bad params' }, 400);
    await env.DB.prepare(
        `INSERT INTO training_days (user_id, played_on, words) VALUES (?1, ?2, 1)
         ON CONFLICT(user_id, played_on) DO UPDATE SET words = words + 1`
    ).bind(user.id, body.playedOn).run();
    return json({ ok: true }, 200);
}

// `day` je pořadí dne od začátku hry (1 = 21. 9. 2026), ne den v ročním
// cyklu: denní slova se po 365 dnech opakují, ale výsledky různých let se
// míchat nesmí. V prvním roce jsou obě čísla stejná.
async function handleSubmit(request, env) {
    const body = await readJson(request);
    if (!body) return badJson();
    const { day, score, clientId } = body;
    if (!Number.isInteger(day) || day < 1 || day > MAX_DAY || !validScore(score) || !validClient(clientId)) {
        return json({ error: 'bad params' }, 400);
    }

    // upsert: pokud hráč (stejné clientId) pro tento den už výsledek poslal, přepíše se
    const writes = [env.DB.prepare(
        `INSERT INTO results (day, score, client_id, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(day, client_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`
    ).bind(day, score, clientId, Date.now())];

    // Přihlášenému se den zapíše i do profilu — klíčováno skutečným datem,
    // protože index dne se po roce opakuje. Nepřihlášení hrají beze změny.
    const user = await currentUser(request, env);
    if (user && validPlayedOn(body.playedOn)) {
        writes.push(env.DB.prepare(
            `INSERT INTO profile_days (user_id, played_on, day_idx, score, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(user_id, played_on) DO UPDATE SET score = excluded.score`
        ).bind(user.id, body.playedOn, (day - 1) % DAYS, score, Date.now()));
    }
    await env.DB.batch(writes);
    return json(await computePercentile(env, day, score), 200);
}

async function handlePercentile(request, env, url) {
    const day = Number(url.searchParams.get('day'));
    const score = Number(url.searchParams.get('score'));
    if (!Number.isInteger(day) || !validScore(score)) return json({ error: 'bad params' }, 400);
    return json(await computePercentile(env, day, score), 200);
}

// Jeden průchod indexem idx_results_day: kolik hráčů dne a kolik z nich má aspoň tolik.
async function computePercentile(env, day, score) {
    const row = await env.DB.prepare(
        'SELECT COUNT(*) AS total, COALESCE(SUM(score >= ?2), 0) AS better FROM results WHERE day = ?1'
    ).bind(day, score).first();
    const total = row?.total || 0;
    if (total < MIN_SAMPLE) return { real: false, total };
    return { real: true, total, topPct: Math.max(1, Math.round(row.better / total * 100)) };
}

async function handleSubscribe(request, env) {
    const body = await readJson(request);
    if (!body) return badJson();
    const { clientId, endpoint, keys } = body;
    if (!validClient(clientId) || typeof endpoint !== 'string' || !endpoint.startsWith('https://')
        || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
        return json({ error: 'bad params' }, 400);
    }

    // upsert: nová registrace stejného zařízení (nový endpoint po re-subscribe) přepíše starou
    await env.DB.prepare(
        `INSERT INTO subscriptions (client_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(client_id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`
    ).bind(clientId, endpoint, keys.p256dh, keys.auth, Date.now()).run();

    return json({ ok: true }, 200);
}

/* ---------------- komunitní významy slov ---------------- */

const now = () => Date.now();

function defRow(r, userId, voted) {
    return {
        id: r.id,
        word: r.word,
        text: r.text,
        author: r.author,          // vždy přezdívka z účtu — anonymní autoři neexistují
        avatar: r.avatar || null,  // kód z public/avatar.js, null = iniciála
        votes: r.votes,
        mine: !!userId && r.user_id === userId,
        voted: !!voted && voted.has(r.id),
        hidden: !!r.hidden,        // veřejné seznamy skryté vynechávají; vidí je jen autor
    };
}

// Pro přihlášeného: pro které z těchto významů už hlasoval (votes.client_id =
// id účtu). Bez toho by tlačítko po načtení ukazovalo „nehlasováno" a další
// klepnutí by hlas nečekaně odebralo.
async function votedSet(env, me, ids) {
    if (!me || !ids.length) return new Set();
    const { results } = await env.DB.prepare(
        `SELECT definition_id FROM votes WHERE client_id = ? AND definition_id IN (${ids.map(() => '?').join(',')})`
    ).bind(me.id, ...ids).all();
    return new Set(results.map(r => r.definition_id));
}

// Nejlépe hodnocený význam pro až BATCH_MAX slov naráz — hra si je natahuje
// dopředu, aby přechodová obrazovka nikdy nečekala na síť.
// Cachuje se po jednotlivých slovech, ne po dávce: fronty jsou u každého hráče
// jiné, takže klíč podle složení dávky by se skoro netrefil.
async function handleDefsBatch(request, env, url, ctx) {
    const raw = (url.searchParams.get('w') || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    const words = [...new Set(raw)].slice(0, BATCH_MAX);
    if (!words.length) return json({ defs: {} }, 200);
    const me = await currentUser(request, env);

    // Ve vývoji bez cache: seed zapisuje rovnou do D1 a uložené „bez významu"
    // by ho 5 minut zakrývalo.
    const cache = devMode(env) ? null : caches.default;
    const rows = {};                                    // slovo -> řádek | null
    const misses = [];
    // dotazy do cache naráz, ne po jednom (dávka má až BATCH_MAX slov)
    const hits = await Promise.all(words.map(w => cache && cache.match(defCacheKey(w))));
    for (const [i, w] of words.entries()) {
        if (hits[i]) rows[w] = await hits[i].json();
        else misses.push(w);
    }

    if (misses.length) {
        const marks = misses.map(() => '?').join(',');
        const { results } = await env.DB.prepare(
            `SELECT * FROM (
               SELECT d.*, u.avatar, ROW_NUMBER() OVER (PARTITION BY d.word ORDER BY d.votes DESC, d.created_at ASC) AS rn
               FROM definitions d LEFT JOIN users u ON u.id = d.user_id
               WHERE d.hidden = 0 AND d.word IN (${marks})
             ) WHERE rn = 1`
        ).bind(...misses).all();
        for (const w of misses) rows[w] = null;          // i prázdno je odpověď
        for (const r of results) rows[r.word] = r;
        // Ukládá se i to prázdno — slov bez významu je zdaleka nejvíc a právě
        // ta nemá smysl pouštět na D1 pořád dokola.
        for (const w of cache ? misses : []) {
            const body = new Response(JSON.stringify(rows[w]), {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
            });
            ctx ? ctx.waitUntil(cache.put(defCacheKey(w), body)) : await cache.put(defCacheKey(w), body);
        }
    }

    // `mine` a `voted` jsou na hráče, takže se dopočítají až po cache.
    const voted = await votedSet(env, me, words.map(w => rows[w] && rows[w].id).filter(Boolean));
    const defs = {};
    for (const w of words) defs[w] = rows[w] ? defRow(rows[w], me && me.id, voted) : null;
    return json({ defs }, 200);
}

async function handleDefsForWord(request, env, url) {
    const word = (url.searchParams.get('w') || '').trim().toLowerCase();
    if (!word) return json({ error: 'bad params' }, 400);
    const me = await currentUser(request, env);
    const { results } = await env.DB.prepare(
        `SELECT d.*, u.avatar FROM definitions d LEFT JOIN users u ON u.id = d.user_id
         WHERE d.word = ?1 AND d.hidden = 0 ORDER BY d.votes DESC, d.created_at ASC LIMIT 50`
    ).bind(word).all();
    const voted = await votedSet(env, me, results.map(r => r.id));
    return json({ word, defs: results.map(r => defRow(r, me && me.id, voted)) }, 200);
}

// Vlastní významy po stránkách: ?limit=&offset= (nejnovější první), ?sort=votes
// pro oblak štítků na profilu. total = kolik jich autor má celkem.
async function handleMyDefs(request, env, url) {
    const me = await currentUser(request, env);
    if (!me) return json({ defs: [], total: 0 }, 200);
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 20));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
    const order = url.searchParams.get('sort') === 'votes' ? 'votes DESC, created_at DESC' : 'created_at DESC';
    const [{ results }, { results: cnt }] = await Promise.all([
        env.DB.prepare(`SELECT * FROM definitions WHERE user_id = ?1 ORDER BY ${order} LIMIT ?2 OFFSET ?3`)
            .bind(me.id, limit, offset).all(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM definitions WHERE user_id = ?1').bind(me.id).all(),
    ]);
    return json({ defs: results.map(r => defRow(r, me.id)), total: cnt[0].n }, 200);
}

async function handleDefCreate(request, env, url, ctx) {
    // Psát smí jen přihlášený — jinak by u významu stálo jméno, za kterým
    // nikdo nestojí a které si může vzít kdokoli.
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'Významy může přidávat jen přihlášený hráč.' }, 401);
    if (!user.handle) return json({ error: 'Nejdřív si zvol přezdívku.' }, 400);

    const body = await readJson(request);
    if (!body) return badJson();
    const { clientId, word, text } = body;
    if (typeof word !== 'string' || !word.trim()) return json({ error: 'bad params' }, 400);
    const err = defTextError(text);
    if (err) return json({ error: err }, 400);
    const name = user.handle;

    const dayAgo = now() - 86400000;
    const { results: cnt } = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM definitions WHERE user_id = ?1 AND created_at > ?2'
    ).bind(user.id, dayAgo).all();
    if (cnt[0].n >= DEF_PER_DAY) {
        return json({ error: `Denní limit je ${DEF_PER_DAY} významů. Zkus to zítra.` }, 429);
    }

    const id = crypto.randomUUID();
    try {
        await env.DB.prepare(
            `INSERT INTO definitions (id, word, text, client_id, user_id, author, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(id, word.trim().toLowerCase(), clean(text),
               validClient(clientId) ? clientId : null, user.id, name, now()).run();
    } catch (e) {
        // jediný unikátní index je (user_id, word)
        return json({ error: 'K tomuhle slovu už svůj význam máš.' }, 409);
    }
    await dropDefCache(word.trim().toLowerCase(), ctx);
    return json({ ok: true, id }, 200);
}

// Úprava vlastního významu. Když text měl hlasy, úprava je smaže — jinak by
// šlo vyhlasovat neškodnou větu a pak ji přepsat na něco jiného.
async function handleDefEdit(request, env, url, ctx) {
    const me = await currentUser(request, env);
    if (!me) return json({ error: 'Upravovat může jen přihlášený hráč.' }, 401);
    const body = await readJson(request);
    if (!body) return badJson();
    const { id, text } = body;
    if (typeof id !== 'string' || !id) return json({ error: 'bad params' }, 400);
    const err = defTextError(text);
    if (err) return json({ error: err }, 400);

    const { results } = await env.DB.prepare(
        'SELECT user_id, word, text, votes FROM definitions WHERE id = ?1'
    ).bind(id).all();
    if (!results.length) return json({ error: 'not found' }, 404);
    const row = results[0];
    if (row.user_id !== me.id) return json({ error: 'Upravit jde jen vlastní význam.' }, 403);

    const novy = clean(text);
    if (novy === row.text) return json({ ok: true, votes: row.votes, resetVotes: false }, 200);

    const resetVotes = row.votes > 0;
    const statements = [
        env.DB.prepare('UPDATE definitions SET text = ?1 WHERE id = ?2').bind(novy, id),
    ];
    if (resetVotes) {
        statements.push(env.DB.prepare('DELETE FROM votes WHERE definition_id = ?1').bind(id));
        statements.push(env.DB.prepare('UPDATE definitions SET votes = 0 WHERE id = ?1').bind(id));
    }
    await env.DB.batch(statements);
    await dropDefCache(row.word, ctx);
    return json({ ok: true, votes: resetVotes ? 0 : row.votes, resetVotes }, 200);
}

async function handleDefVote(request, env, url, ctx) {
    const me = await currentUser(request, env);
    if (!me) return json({ error: 'Hlasovat může jen přihlášený hráč.' }, 401);
    const body = await readJson(request);
    if (!body) return badJson();
    const { id } = body;
    if (typeof id !== 'string' || !id) return json({ error: 'bad params' }, 400);
    const clientId = me.id;

    const { results: own } = await env.DB.prepare('SELECT user_id, word FROM definitions WHERE id = ?1').bind(id).all();
    if (!own.length) return json({ error: 'not found' }, 404);
    if (own[0].user_id === me.id) return json({ error: 'Svůj vlastní význam hodnotit nejde.' }, 400);

    const { results: had } = await env.DB.prepare(
        'SELECT 1 AS x FROM votes WHERE definition_id = ?1 AND client_id = ?2'
    ).bind(id, clientId).all();
    if (had.length) {
        await env.DB.batch([
            env.DB.prepare('DELETE FROM votes WHERE definition_id = ?1 AND client_id = ?2').bind(id, clientId),
            env.DB.prepare('UPDATE definitions SET votes = (SELECT COUNT(*) FROM votes WHERE definition_id = ?1) WHERE id = ?1').bind(id),
        ]);
    } else {
        await env.DB.batch([
            env.DB.prepare('INSERT OR IGNORE INTO votes (definition_id, client_id, created_at) VALUES (?1, ?2, ?3)').bind(id, clientId, now()),
            env.DB.prepare('UPDATE definitions SET votes = (SELECT COUNT(*) FROM votes WHERE definition_id = ?1) WHERE id = ?1').bind(id),
        ]);
    }
    const { results } = await env.DB.prepare('SELECT votes FROM definitions WHERE id = ?1').bind(id).all();
    await dropDefCache(own[0].word, ctx);
    return json({ ok: true, votes: results[0].votes, voted: !had.length }, 200);
}

async function handleDefReport(request, env, url, ctx) {
    const me = await currentUser(request, env);
    if (!me) return json({ error: 'Nahlásit může jen přihlášený hráč.' }, 401);
    const body = await readJson(request);
    if (!body) return badJson();
    const { id } = body;
    if (typeof id !== 'string' || !id) return json({ error: 'bad params' }, 400);
    const clientId = me.id;
    await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO reports (definition_id, client_id, created_at) VALUES (?1, ?2, ?3)').bind(id, clientId, now()),
        env.DB.prepare(
            `UPDATE definitions SET reports = (SELECT COUNT(*) FROM reports WHERE definition_id = ?1),
             hidden = CASE WHEN (SELECT COUNT(*) FROM reports WHERE definition_id = ?1) >= ${REPORTS_TO_HIDE} THEN 1 ELSE hidden END
             WHERE id = ?1`
        ).bind(id),
    ]);
    const { results: w } = await env.DB.prepare('SELECT word FROM definitions WHERE id = ?1').bind(id).all();
    if (w.length) await dropDefCache(w[0].word, ctx);
    return json({ ok: true }, 200);
}

async function sendDailyReminders(env) {
    if (!env.VAPID_PRIVATE_JWK) return; // secret nenastaven (lokální dev, nebo zapomenuté nasazení) — cron tiše nic neudělá
    const privateJWK = JSON.parse(env.VAPID_PRIVATE_JWK);
    const { results } = await env.DB.prepare(
        'SELECT client_id, endpoint, p256dh, auth FROM subscriptions'
    ).all();

    for (const sub of results) {
        try {
            const { endpoint, headers, body } = await buildPushHTTPRequest({
                privateJWK,
                subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                message: {
                    payload: {
                        title: '20 slov',
                        body: 'Dnešní slovo na tebe čeká! 🔤',
                        url: SITE_URL,
                    },
                    adminContact: ADMIN_CONTACT,
                },
            });
            const res = await fetch(endpoint, { method: 'POST', headers, body });
            // 404/410 = odběr na straně prohlížeče zanikl (odinstalace, zrušení oprávnění) — smazat.
            if (res.status === 404 || res.status === 410) {
                await env.DB.prepare('DELETE FROM subscriptions WHERE client_id = ?1').bind(sub.client_id).run();
            }
        } catch (err) {
            // jeden nepovedený push nesmí shodit zbytek dávky
        }
    }
}

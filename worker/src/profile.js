// Veřejný profil hráče: statistiky, rok denních výzev a jeho významy slov.
// Renderuje se na serveru kvůli náhledu při sdílení (og:*) — SPA route by
// poslala prázdný index.html. Markup používá třídy a styly samotné hry
// (style.css), takže vypadá stejně jako aplikace. Hra si
// ?cast=1 bere jen obsah a ukáže ho jako svou obrazovku — jeden vzhled, dvě cesty.

import Avatar from '../../public/avatar.js';
import { json } from './http.js';
import Achievements from '../../public/achievements.js';

const PER_DAY = 20;
const DAYS = 365;

const esc = (t) => String(t).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const iso = (d) => d.toISOString().slice(0, 10);
const dayBefore = (isoDate, n) => {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return iso(d);
};

export const validPlayedOn = (s) =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

// Statistiky se počítají při čtení — je jich nejvýš 365 řádků.
function stats(rows) {
    const byDate = new Map(rows.map(r => [r.played_on, r.score]));
    const dny = rows.length;
    const slova = rows.reduce((a, r) => a + r.score, 0);
    const perfektnich = rows.filter(r => r.score === PER_DAY).length;
    const dnes = iso(new Date());

    // Aktuální série smí začínat dneškem nebo včerejškem (dnešek ještě nemusel hrát).
    let serie = 0;
    for (let i = byDate.has(dnes) ? 0 : 1; ; i++) {
        if (!byDate.has(dayBefore(dnes, i))) break;
        serie++;
        if (i > DAYS) break;
    }
    let nejdelsi = 0, bezi = 0;
    const serazene = [...byDate.keys()].sort();
    let predchozi = null;
    for (const d of serazene) {
        bezi = (predchozi && dayBefore(d, 1) === predchozi) ? bezi + 1 : 1;
        if (bezi > nejdelsi) nejdelsi = bezi;
        predchozi = d;
    }
    return {
        dny, slova, perfektnich, serie, nejdelsi,
        uspesnost: dny ? Math.round(slova / (dny * PER_DAY) * 100) : 0,
    };
}

// Body za aktivitu (jako karma na Redditu). Nemají vlastní tabulku, počítají
// se při čtení z řádků, které už existují. Nejdou tak napočítat dvakrát,
// odebraný hlas nebo skrytý význam je hned odečte a změna vah platí zpětně
// pro všechny. Za den se některé věci počítají jen do stropu, ať se nevyplatí
// farmit: odklikat hlasy všem je pro pořadí významů horší než nehlasovat.
export const BODY = { den: 10, slovoTreninku: 1, vyznam: 5, ziskanyHlas: 2, danyHlas: 1 };
export const ZA_DEN = { slovTreninku: 10, danychHlasu: 10 };

// Počty zvlášť, ne jen součet: stejná čísla ponesou i úspěchy.
export async function points(env, userId) {
    const { results } = await env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM profile_days WHERE user_id = ?1) AS dny,
        (SELECT COALESCE(SUM(MIN(words, ?2)), 0) FROM training_days WHERE user_id = ?1) AS slovTreninku,
        (SELECT COUNT(*) FROM definitions WHERE user_id = ?1 AND hidden = 0) AS vyznamu,
        (SELECT COALESCE(SUM(votes), 0) FROM definitions WHERE user_id = ?1 AND hidden = 0) AS ziskanychHlasu,
        (SELECT COALESCE(MAX(votes), 0) FROM definitions WHERE user_id = ?1 AND hidden = 0) AS maxHlasu,
        (SELECT COUNT(*) FROM definitions d WHERE d.user_id = ?1 AND d.hidden = 0 AND EXISTS (
            SELECT 1 FROM definitions o WHERE o.word = d.word AND o.hidden = 0 AND o.id != d.id) AND NOT EXISTS (
            SELECT 1 FROM definitions o WHERE o.word = d.word AND o.hidden = 0 AND o.id != d.id
            AND (o.votes > d.votes OR (o.votes = d.votes AND o.created_at < d.created_at)))) AS nejlepsi,
        (SELECT COALESCE(SUM(MIN(n, ?3)), 0) FROM (SELECT COUNT(*) AS n FROM votes
            WHERE client_id = ?1 GROUP BY created_at / 86400000)) AS danychHlasu`
    ).bind(userId, ZA_DEN.slovTreninku, ZA_DEN.danychHlasu).all();
    const c = results[0];
    const total = c.dny * BODY.den + c.slovTreninku * BODY.slovoTreninku + c.vyznamu * BODY.vyznam
        + c.ziskanychHlasu * BODY.ziskanyHlas + c.danychHlasu * BODY.danyHlas;
    return { total, ...c };
}

const DEFS_SHOWN = 10;

async function loadProfile(env, handle) {
    const { results: users } = await env.DB.prepare(
        'SELECT id, handle, hide_profile, banned, avatar FROM users WHERE handle_lc = ?1'
    ).bind(String(handle || '').toLowerCase()).all();
    const user = users[0];
    if (!user || user.hide_profile || user.banned) return null;   // zablokovaný nemá veřejný profil
    const [{ results: rows }, { results: defs }, { results: cnt }, body, { results: ach }] = await Promise.all([
        env.DB.prepare(
            'SELECT played_on, day_idx, score FROM profile_days WHERE user_id = ?1 AND played_on >= ?2 ORDER BY played_on'
        ).bind(user.id, dayBefore(iso(new Date()), DAYS)).all(),
        // „best" = význam, který hra u slova ukazuje nahoře (nejvíc hlasů, při
        // shodě starší) — a jen když porazil jiné; jediný význam slova není výhra.
        env.DB.prepare(`SELECT d.word, d.text, d.votes, EXISTS (
                SELECT 1 FROM definitions o WHERE o.word = d.word AND o.hidden = 0 AND o.id != d.id) AND NOT EXISTS (
                SELECT 1 FROM definitions o WHERE o.word = d.word AND o.hidden = 0 AND o.id != d.id
                AND (o.votes > d.votes OR (o.votes = d.votes AND o.created_at < d.created_at))) AS best
            FROM definitions d WHERE d.user_id = ?1 AND d.hidden = 0
            ORDER BY d.votes DESC, d.created_at DESC LIMIT ?2`).bind(user.id, DEFS_SHOWN).all(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM definitions WHERE user_id = ?1 AND hidden = 0').bind(user.id).all(),
        points(env, user.id),
        env.DB.prepare('SELECT ach, created_at FROM user_achievements WHERE user_id = ?1').bind(user.id).all(),
    ]);
    return {
        user, rows, stats: stats(rows), defs, defsTotal: cnt[0].n, points: body,
        ach: new Set(ach.map(r => r.ach)),
        // Čas nahlášení — hra ho posílá při každé synchronizaci (syncAchievements),
        // i za odznaky, které server spočítá sám ze statistik. Nepřesné (přihlášení
        // k jinému účtu je nahlásí znovu), ale na řazení „poslední" na profilu stačí.
        achDates: new Map(ach.map(r => [r.ach, r.created_at])),
    };
}

// Vlastní odehrané dny přihlášeného účtu — obnoví lokální persist.results
// na novém zařízení (viz restoreResults v game.js). Na rozdíl od apiProfile
// jde po user_id ze session, ne po přezdívce: funguje i se skrytým profilem.
export async function myResults(env, userId) {
    const { results } = await env.DB.prepare(
        'SELECT day_idx AS dayIdx, score FROM profile_days WHERE user_id = ?1'
    ).bind(userId).all();
    return results;
}

export async function apiProfile(request, env, url) {
    const data = await loadProfile(env, url.searchParams.get('handle'));
    if (!data) return json({ error: 'not found' }, 404);
    return json({
        handle: data.user.handle,
        stats: data.stats,
        points: data.points.total,
        days: data.rows.map(r => ({ d: r.played_on, score: r.score })),
    }, 200);
}

const num = (n) => n.toLocaleString('cs-CZ');

// Úspěchy na veřejném profilu: co server spočítá sám, plus co hra nahlásila
// k účtu (user_achievements: sdílení, Bleskovka, tajné, …). Neklikací, bez JS.
function achievementsState(data) {
    const st = Achievements.publicState(data.stats, data.points, Avatar.valid(data.user.avatar));
    // nahlášený odznak zvedne svůj klíč na práh, ať se vykreslí jako získaný
    for (const a of Achievements.LIST) if (data.ach.has(a.id)) st[a.v] = Math.max(st[a.v] || 0, a.goal);
    const got = Achievements.LIST.filter(a => Achievements.done(a, st));
    const byRecency = got.slice().sort((a, b) => (data.achDates.get(b.id) || 0) - (data.achDates.get(a.id) || 0));
    return { st, got, byRecency };
}

const ACH_PREVIEW = 4;

// Náhled: poslední čtyři (podle nahlášení, viz achievementsState), s odkazem
// na všechny, když jich hráč má víc — stejné jméno tlačítka jako v aplikaci.
function achievementsSection(data) {
    const { st, got, byRecency } = achievementsState(data);
    if (!got.length) return '';
    const avatar = Avatar.svg(data.user.avatar);
    const more = got.length > ACH_PREVIEW
        ? `<a class="btn btn-secondary" href="/u/${encodeURIComponent(data.user.handle)}?ach=1">Všechny úspěchy</a>`
        : '';
    return `<div class="profile-section">
        <h3 class="profile-section-title">Úspěchy <small>${got.length}</small></h3>
        <div class="ach-grid">${byRecency.slice(0, ACH_PREVIEW).map(a => Achievements.tile(a, st, { avatar, tag: 'span' })).join('')}</div>
        ${more}
      </div>`;
}

// Celý seznam získaných úspěchů, po skupinách jako v aplikaci (renderAchievements
// v game.js) — jen skupiny, kde hráč aspoň jeden má; zamčené se veřejně neukazují.
function achievementsPageBody(data) {
    const { st, got } = achievementsState(data);
    const avatar = Avatar.svg(data.user.avatar);
    const groups = Achievements.GROUPS.map(([g, title]) => {
        const list = got.filter(a => a.g === g);
        if (!list.length) return '';
        return `<div class="profile-section"><h3 class="profile-section-title">${title} <small>${list.length}</small></h3>
            <div class="ach-grid">${list.map(a => Achievements.tile(a, st, { avatar, tag: 'span' })).join('')}</div></div>`;
    }).join('');
    return `<div class="profile-head">
        <a class="icon-btn-circle icon-btn-circle--bare" href="/u/${encodeURIComponent(data.user.handle)}" aria-label="Zpět na profil"><img src="/designs/kostky/zpet.svg" alt=""></a>
        <div class="profile-avatar" aria-hidden="true">${avatar || esc(data.user.handle.charAt(0).toUpperCase())}</div>
        <div class="profile-name">${esc(data.user.handle)}</div>
        <div class="profile-sub">Úspěchy · ${got.length} z ${Achievements.LIST.length}</div>
      </div>
      ${groups || '<div class="empty-card">Zatím žádný úspěch.</div>'}`;
}
const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;
const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MESICE_KRATCE = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
const DNY = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const kratce = (d) => `${+d.slice(8, 10)}. ${+d.slice(5, 7)}.`;
const dlouze = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Stupeň kostky: 0 nehráno, 1–3 odstíny zelené, 4 zlatá za všech 20.
const stupen = (score) =>
    score === undefined ? 0 : score === PER_DAY ? 4 : score >= 15 ? 3 : score >= 10 ? 2 : 1;

// Rok svisle jako kalendář: týden = řádek Po–Ne, nahoře nejstarší. Začíná
// týdnem prvního odehraného dne (nejdál před rokem), ať nový hráč nemá
// stránku prázdných řádků. Měsíc je otočený popisek přes všechny své řádky;
// týden patří měsíci, do kterého padne jeho čtvrtek (většina dnů, jako ISO týden).
function calendar(rows) {
    const byDate = new Map(rows.map(r => [r.played_on, r.score]));
    const dnes = iso(new Date());
    const od = rows.length ? rows[0].played_on : dnes;
    const tydny = [];
    for (let t = dayBefore(od, (new Date(od + 'T00:00:00Z').getUTCDay() + 6) % 7); t <= dnes; t = dayBefore(t, -7)) tydny.push(t);
    const ctvrtek = (t) => dayBefore(t, -3);
    const mesic = (t) => ctvrtek(t).slice(0, 7);
    const out = ['<span></span>', ...DNY.map(d => `<span class="yc-head">${d}</span>`)];
    tydny.forEach((t, i) => {
        if (i === 0 || mesic(tydny[i - 1]) !== mesic(t)) {
            let n = 1;
            while (i + n < tydny.length && mesic(tydny[i + n]) === mesic(t)) n++;
            const m = +ctvrtek(t).slice(5, 7) - 1;
            // jeden řádek plný název neunese — tam zkratka
            const nazev = n > 1 ? MESICE[m] + (m === 0 && i > 0 ? ` ${ctvrtek(t).slice(0, 4)}` : '') : MESICE_KRATCE[m];
            out.push(`<span class="yc-month" style="grid-row: span ${n}">${nazev}</span>`);
        }
        for (let k = 0; k < 7; k++) {
            const d = dayBefore(t, -k);
            if (d > dnes) { out.push('<i class="yc-day yc-future"></i>'); continue; }
            const score = byDate.get(d);
            out.push(`<i class="yc-day s${stupen(score)}${d === dnes ? ' yc-today' : ''}" `
                + `title="${kratce(d)} — ${score === undefined ? 'nehráno' : `${score}/20`}"></i>`);
        }
    });
    return out.join('');
}

const statTile = (value, label, extra = '') =>
    `<div class="stat-tile${extra}"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;

const defItem = (d) => `<li class="def-item${d.best ? ' def-item--best' : ''}">`
    + (d.best ? '<div class="def-best-label">Nejlepší význam</div>' : '')
    + `<div class="def-word">${esc(d.word)}</div><p class="wd-text">${esc(d.text)}</p>`
    + `<div class="wd-meta"><span><span class="emoji" data-emoji="palec">👍</span> ${num(d.votes)}</span></div></li>`;

// Obsah profilu — stejný pro samostatnou stránku i obrazovku ve hře.
function profileBody(data) {
    const s = data.stats;
    const jmeno = esc(data.user.handle);
    const zbyva = data.defsTotal - data.defs.length;
    return `
      <div class="profile-head">
        <div class="profile-avatar" aria-hidden="true">${Avatar.svg(data.user.avatar) || esc(data.user.handle.charAt(0).toUpperCase())}</div>
        <div class="profile-name">${jmeno}</div>
        <div class="profile-sub">${data.rows.length ? `Hraje od ${esc(dlouze(data.rows[0].played_on))}` : 'Zatím bez odehraného dne'}</div>
        <div class="points-pill"><span class="emoji" data-emoji="hvezda">⭐</span> ${num(data.points.total)} ${plural(data.points.total, 'bod', 'body', 'bodů')}</div>
      </div>
      <div class="profile-section">
        <h3 class="profile-section-title">Statistiky</h3>
        <div class="stat-grid">
          ${statTile(num(s.serie), 'dní v řadě', s.serie ? '' : ' stat-tile--off')}
          ${statTile(num(s.dny), 'odehraných dní')}
          ${statTile(`${s.uspesnost} %`, s.dny ? `úspěšnost z ${num(s.dny * PER_DAY)} slov v denní výzvě` : 'úspěšnost')}
        </div>
      </div>
      ${achievementsSection(data)}
      <!-- Záložky bez JS (rádio + :checked): fungují na sdílené stránce
           i ve hře, kam se obsah vkládá přes innerHTML. Rok může být dlouhý,
           významy by jinak odjely úplně dolů. -->
      <div class="profile-section profile-tabs">
        <input type="radio" name="ptab" id="ptabRok" class="ptab-input" checked>
        <input type="radio" name="ptab" id="ptabVyznamy" class="ptab-input">
        <div class="ptab-bar">
          <label for="ptabRok">Denní výzvy</label>
          <label for="ptabVyznamy">Významy <span class="ptab-count">${num(data.defsTotal)}</span></label>
        </div>
        <div class="ptab-panel ptab-panel--rok">
          <div class="year-cal" role="img" aria-label="Rok denních výzev: ${num(s.dny)} odehraných dní, ${num(s.perfektnich)}× všech 20 slov">${calendar(data.rows)}</div>
          <p class="yc-legend" aria-hidden="true"><span>méně</span>${[0, 1, 2, 3].map(n => `<i class="yc-day s${n}"></i>`).join('')}<span>více</span><i class="yc-day s4"></i><span>všech 20</span></p>
        </div>
        <div class="ptab-panel ptab-panel--vyznamy">
          ${data.defs.length
            ? `<ul class="defs-list">${data.defs.map(defItem).join('')}</ul>`
              + (zbyva > 0 ? `<p class="profile-note">…a ${plural(zbyva, 'další', 'další', 'dalších')} ${num(zbyva)} ${plural(zbyva, 'význam', 'významy', 'významů')}.</p>` : '')
            : '<div class="empty-card">Zatím žádný význam.</div>'}
        </div>
      </div>`;
}

export async function profilePage(request, env, url) {
    const handle = decodeURIComponent(url.pathname.replace(/^\/u\//, '')).trim();
    const data = await loadProfile(env, handle);
    const site = url.origin;
    const cast = url.searchParams.has('cast');
    const html = (body, status, cache) => new Response(body, {
        status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache },
    });
    if (!data) {
        const body = `<div class="profile-head"><div class="profile-name">Profil nenalezen</div>
            <div class="profile-sub">Tenhle hráč tu není, nebo má profil skrytý.</div></div>`;
        return html(cast ? body : page('Profil nenalezen', body, ''), 404, 'no-store');
    }
    const jmeno = esc(data.user.handle);

    // Všechny úspěchy na vlastní podstránce (?ach=1), ať náhled na hlavním
    // profilu neroste s každým dalším odznakem — link na ni dává achievementsSection.
    if (url.searchParams.has('ach')) {
        const body = achievementsPageBody(data);
        if (cast) return html(body, 200, 'no-store');
        return html(page(`Úspěchy — ${jmeno} — 20 slov`, body, ''), 200, 'public, max-age=300');
    }

    // Hra chce vidět čerstvé číslo hned po dohrání dne, sdílený odkaz snese 5 minut.
    if (cast) return html(profileBody(data), 200, 'no-store');

    const s = data.stats;
    const popis = `${s.dny} odehraných dní · série ${s.serie} · ${s.perfektnich}× všech 20 slov`;
    const meta = `
      <meta property="og:title" content="${jmeno} — 20 slov">
      <meta property="og:description" content="${esc(popis)}">
      <meta property="og:type" content="profile">
      <meta property="og:url" content="${site}/u/${encodeURIComponent(data.user.handle)}">
      <meta property="og:image" content="${site}/og.png">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta name="twitter:card" content="summary_large_image">`;
    return html(page(`${jmeno} — 20 slov`, profileBody(data), meta), 200, 'public, max-age=300');
}

// Samostatná stránka pro sdílený odkaz: styly a písma hry, obsah jako
// obrazovka hry, dole pozvánka do hry.
function page(title, body, meta) {
    return `<!doctype html><html lang="cs"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>${meta}
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131f24" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link rel="preload" href="/fonts/SlovkaOne-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
</head><body><div class="screen active public-page" id="publicProfile">${body}
<div class="page-cta"><a class="btn btn-play" href="/">Zahrát si taky</a></div></div>
<script src="/squircle.js"></script><script src="/page.js"></script></body></html>`;
}

// Přihlášení magic linkem, které přežije instalovanou PWA.
//
// Proč to není "klikni na odkaz a jsi přihlášený": odkaz z Mailu otevře
// Safari/Chrome, NE nainstalovanou PWA, a ta má na iOS 17.4+ vlastní úložiště
// cookies oddělené od Safari. Cookie nastavená klikem v mailu se do aplikace
// nedostane nikdy. Proto odkaz session jen SCHVÁLÍ a vyzvedne si ji ta
// instance, která o přihlášení požádala (poll). Kdo se vrátí do aplikace dřív,
// než doklikal, opíše šestimístný kód.
//
// Schválení je POST za tlačítkem, ne prostý GET: poštovní klienti a firemní
// skenery odkazy předběžně stahují a skenerový GET by tiše přihlásil cizího
// člověka.

import Avatar from '../../public/avatar.js';
import { json, readJson, badJson } from './http.js';

const SESSION_DAYS = 365;
const REQUEST_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_PER_EMAIL_HOUR = 5;
const MAX_PER_IP_HOUR = 20;
export const HANDLE_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

const now = () => Date.now();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);

async function sha256(text) {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export const peppered = (env, value) => sha256(String(value) + (env.HASH_PEPPER || 'no-pepper'));

// Lokální vývoj: DEV=1 v .dev.vars (ten se nikdy nenasazuje). Přihlášení pak
// jede i bez Resendu — kód a odkaz se místo e-mailu vypíšou do terminálu
// wrangleru — a cookie nemá Secure, ať jde přihlásit i z telefonu přes http.
export const devMode = (env) => env.DEV === '1';

// Přihlášení je zapnuté, jen když je čím poslat e-mail (nebo ve vývoji).
export const authEnabled = (env) => devMode(env) || !!(env.RESEND_KEY && env.MAIL_FROM);

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(e);

/* ---------------- session ---------------- */

function cookie(env, name, value, maxAgeSec) {
    const secure = devMode(env) ? '' : ' Secure;';
    return `${name}=${value}; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export async function currentUser(request, env) {
    // Když je přihlášení vypnuté, nesmí zbylá cookie nikoho identifikovat —
    // jinak by hráč zůstal "přihlášený" bez jakéhokoli ovládání účtu.
    if (!authEnabled(env)) return null;
    const raw = request.headers.get('Cookie') || '';
    const m = raw.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
    if (!m) return null;
    const { results } = await env.DB.prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?1 AND s.expires_at > ?2`
    ).bind(await sha256(m[1]), now()).all();
    const u = results[0];
    return u && !u.banned ? u : null;
}

async function startSession(env, userId) {
    const token = rand(24);
    await env.DB.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(await sha256(token), userId, now(), now() + SESSION_DAYS * 86400000).run();
    return cookie(env, 'sid', token, SESSION_DAYS * 86400);
}

const publicUser = (u) => ({ id: u.id, handle: u.handle, needsHandle: !u.handle, avatar: u.avatar || null });

/* ---------------- e-mail ---------------- */

async function sendLoginMail(env, email, link, code) {
    if (devMode(env) && !env.RESEND_KEY) {
        console.log(`\n✉️  Přihlášení pro ${email}\n    kód:   ${code}\n    odkaz: ${link}\n`);
        return;
    }
    // RESEND_URL je jen pro lokální vývoj (mock místo skutečného odesílání);
    // v produkci se nenastavuje a míří se na Resend.
    const res = await fetch(env.RESEND_URL || 'https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.RESEND_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: env.MAIL_FROM,
            to: [email],
            subject: 'Přihlášení do hry 20 slov',
            text: `Přihlaš se klepnutím na odkaz:\n${link}\n\n`
                + `Nebo v aplikaci opiš kód: ${code}\n\n`
                + `Odkaz i kód platí 15 minut. Když jsi o přihlášení nežádal, nic nedělej.`,
        }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
}

/* ---------------- endpointy ---------------- */

export async function authStart(request, env, url) {
    if (!authEnabled(env)) return json({ error: 'Přihlášení zatím není spuštěné.' }, 503);
    const body = await readJson(request);
    if (!body) return badJson();

    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return json({ error: 'Zadej platný e-mail.' }, 400);

    const emailHash = await peppered(env, email);
    const ipHash = await peppered(env, request.headers.get('CF-Connecting-IP') || 'local');
    const hourAgo = now() - 3600000;

    const { results: rate } = await env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM login_requests WHERE email_hash = ?1 AND created_at > ?3) AS byEmail,
           (SELECT COUNT(*) FROM login_requests WHERE ip_hash = ?2 AND created_at > ?3) AS byIp`
    ).bind(emailHash, ipHash, hourAgo).all();
    if (rate[0].byEmail >= MAX_PER_EMAIL_HOUR || rate[0].byIp >= MAX_PER_IP_HOUR) {
        return json({ error: 'Moc pokusů. Zkus to za hodinu.' }, 429);
    }

    const id = rand(16);
    const approveToken = rand(16);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    await env.DB.prepare(
        `INSERT INTO login_requests
         (id, email_hash, approve_hash, code_hash, ip_hash, client_id, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(id, emailHash, await sha256(approveToken), await sha256(code), ipHash,
           body.clientId || null, now(), now() + REQUEST_TTL_MS).run();

    const link = `${url.origin}/prihlaseni?t=${approveToken}`;
    try {
        await sendLoginMail(env, email, link, code);
    } catch (e) {
        return json({ error: 'E-mail se nepodařilo odeslat. Zkus to prosím znovu.' }, 502);
    }
    return json({ loginId: id, expiresAt: now() + REQUEST_TTL_MS }, 200);
}

// Vyzvednutí session. Cookie se nastavuje JEN tady — v prohlížeči z e-mailu
// žádná session nevzniká.
export async function authPoll(request, env, url) {
    const id = url.searchParams.get('id') || '';
    if (!id) return json({ error: 'bad params' }, 400);
    const { results } = await env.DB.prepare('SELECT * FROM login_requests WHERE id = ?1').bind(id).all();
    const req = results[0];
    if (!req || req.expires_at < now() || req.consumed_at) return json({ status: 'expired' }, 200);
    if (!req.approved_at) return json({ status: 'pending' }, 200);
    return finishLogin(env, req);
}

// Návrat do aplikace dřív, než hráč doklikal odkaz.
export async function authVerify(request, env, url) {
    const body = await readJson(request);
    if (!body) return badJson();
    const { loginId, code } = body;
    const { results } = await env.DB.prepare('SELECT * FROM login_requests WHERE id = ?1').bind(loginId || '').all();
    const req = results[0];
    if (!req || req.expires_at < now() || req.consumed_at) return json({ status: 'expired' }, 200);
    if (req.attempts >= MAX_CODE_ATTEMPTS) return json({ status: 'expired' }, 200);
    if (await sha256(String(code || '')) !== req.code_hash) {
        await env.DB.prepare('UPDATE login_requests SET attempts = attempts + 1 WHERE id = ?1').bind(req.id).run();
        return json({ status: 'badcode', left: MAX_CODE_ATTEMPTS - req.attempts - 1 }, 200);
    }
    return finishLogin(env, req);
}

async function finishLogin(env, req) {
    let { results: found } = await env.DB.prepare('SELECT * FROM users WHERE email_hash = ?1').bind(req.email_hash).all();
    let user = found[0];
    const created = !user;
    if (!user) {
        const id = rand(16);
        await env.DB.prepare(
            'INSERT INTO users (id, email_hash, client_id, created_at) VALUES (?1, ?2, ?3, ?4)'
        ).bind(id, req.email_hash, req.client_id, now()).run();
        user = { id, handle: null, banned: 0 };
    }
    // Významy přidané anonymně z tohohle zařízení se navážou na účet.
    if (req.client_id) {
        await env.DB.prepare('UPDATE definitions SET user_id = ?1 WHERE client_id = ?2 AND user_id IS NULL')
            .bind(user.id, req.client_id).run();
    }
    await env.DB.prepare('UPDATE login_requests SET consumed_at = ?1 WHERE id = ?2').bind(now(), req.id).run();
    const setCookie = await startSession(env, user.id);
    return json({ status: 'ok', user: publicUser(user), created }, 200, { 'Set-Cookie': setCookie });
}

// Cíl magic linku. Nic nemění — schválení odešle až tlačítko (POST).
export function authLandingPage(request, env, url) {
    const token = url.searchParams.get('t') || '';
    const safe = token.replace(/[^a-f0-9]/g, '');
    return new Response(`<!doctype html><html lang="cs"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Přihlášení — 20 slov</title><style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100dvh;margin:0;
align-items:center;justify-content:center;padding:24px;text-align:center;background:#fff;color:#1c1c1e}
@media(prefers-color-scheme:dark){body{background:#171614;color:#f3f1ec}}
.box{max-width:360px}h1{font-size:22px;margin:0 0 10px}p{color:#777;line-height:1.5;margin:0 0 22px}
button{font:inherit;font-weight:700;border:none;border-radius:999px;padding:15px 34px;
background:#4169f1;color:#fff;cursor:pointer}button[disabled]{opacity:.5}
</style></head><body><div class="box">
<h1>Přihlásit se do hry</h1>
<p>Potvrď, že ses chtěl přihlásit. Pak se vrať do aplikace — sama se odemkne.</p>
<button id="b">Potvrdit přihlášení</button>
<p id="s" style="margin-top:18px"></p></div>
<script>
const b=document.getElementById('b'),s=document.getElementById('s');
b.onclick=async()=>{b.disabled=true;s.textContent='Potvrzuji…';
try{const r=await fetch('/api/auth/approve',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({t:${JSON.stringify(safe)}})});
s.textContent=r.ok?'Hotovo! Vrať se do aplikace.':'Odkaz už neplatí. Nech si poslat nový.';}
catch(e){s.textContent='Něco se pokazilo. Zkus to znovu.';}};
</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function authApprove(request, env, url) {
    const body = await readJson(request);
    if (!body) return badJson();
    const hash = await sha256(String(body.t || ''));
    const { results } = await env.DB.prepare(
        'SELECT id FROM login_requests WHERE approve_hash = ?1 AND expires_at > ?2 AND consumed_at IS NULL'
    ).bind(hash, now()).all();
    if (!results.length) return json({ error: 'expired' }, 404);
    await env.DB.prepare('UPDATE login_requests SET approved_at = ?1 WHERE id = ?2').bind(now(), results[0].id).run();
    return json({ ok: true }, 200);
}

export async function authLogout(request, env, url) {
    const raw = request.headers.get('Cookie') || '';
    const m = raw.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
    if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(m[1])).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(env, 'sid', '', 0) });
}

export async function meGet(request, env, url) {
    const u = await currentUser(request, env);
    return json({ auth: authEnabled(env), user: u ? publicUser(u) : null }, 200);
}

export async function meSetHandle(request, env, url) {
    const u = await currentUser(request, env);
    if (!u) return json({ error: 'not logged in' }, 401);
    const body = await readJson(request);
    if (!body) return badJson();
    const handle = String(body.handle || '').trim();
    if (!HANDLE_RE.test(handle)) return json({ error: '3–20 znaků, bez mezer.' }, 400);
    try {
        await env.DB.prepare('UPDATE users SET handle = ?1, handle_lc = ?2 WHERE id = ?3')
            .bind(handle, handle.toLowerCase(), u.id).run();
    } catch (e) {
        return json({ error: 'Tuhle přezdívku už někdo má.' }, 409);
    }
    await env.DB.prepare('UPDATE definitions SET author = ?1 WHERE user_id = ?2').bind(handle, u.id).run();
    return json({ ok: true, user: publicUser({ ...u, handle }) }, 200);
}

export async function meSetAvatar(request, env, url) {
    const u = await currentUser(request, env);
    if (!u) return json({ error: 'not logged in' }, 401);
    const body = await readJson(request);
    if (!body) return badJson();
    const avatar = String(body.avatar || '');
    if (!Avatar.valid(avatar)) return json({ error: 'bad avatar' }, 400);
    await env.DB.prepare('UPDATE users SET avatar = ?1 WHERE id = ?2').bind(avatar, u.id).run();
    return json({ ok: true, user: publicUser({ ...u, avatar }) }, 200);
}

export async function meDelete(request, env, url) {
    const u = await currentUser(request, env);
    if (!u) return json({ error: 'not logged in' }, 401);
    await env.DB.batch([
        // významy zůstanou komunitě, jen se z nich sundá autorství
        env.DB.prepare("UPDATE definitions SET user_id = NULL, author = NULL, client_id = 'deleted' WHERE user_id = ?1").bind(u.id),
        // hlasy smazaného hráče nesmí dál viset v počtu hlasů (a v bodech autorů)
        env.DB.prepare('UPDATE definitions SET votes = votes - 1 WHERE id IN (SELECT definition_id FROM votes WHERE client_id = ?1)').bind(u.id),
        env.DB.prepare('DELETE FROM votes WHERE client_id = ?1').bind(u.id),
        env.DB.prepare('DELETE FROM profile_days WHERE user_id = ?1').bind(u.id),
        env.DB.prepare('DELETE FROM training_days WHERE user_id = ?1').bind(u.id),
        env.DB.prepare('DELETE FROM user_achievements WHERE user_id = ?1').bind(u.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(u.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(u.id),
    ]);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(env, 'sid', '', 0) });
}

// Jen pro lokální vývoj: rovnou přihlásí účet ze seedu (worker/seed-dev.mjs),
// bez e-mailu — /api/dev/login?kdo=Tester. Mimo DEV=1, mimo lokální adresu
// a pro jiné než seedované účty (id dev-…) neexistuje.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
export async function devLogin(request, env, url) {
    if (!devMode(env) || !LOCAL_HOST.test(url.hostname)) return json({ error: 'not found' }, 404);
    const handle = (url.searchParams.get('kdo') || 'Tester').toLowerCase();
    const { results } = await env.DB.prepare(
        "SELECT id FROM users WHERE handle_lc = ?1 AND id LIKE 'dev-%'"
    ).bind(handle).all();
    if (!results.length) return json({ error: 'Účet nenalezen. Spusť nejdřív: node worker/seed-dev.mjs' }, 404);
    const setCookie = await startSession(env, results[0].id);
    return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': setCookie } });
}

// Úklid v cronu — prošlé žádosti a session, ať IP hashe nezůstávají ležet.
export async function purgeAuth(env) {
    await env.DB.batch([
        env.DB.prepare('DELETE FROM login_requests WHERE expires_at < ?1').bind(now() - 86400000),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now()),
    ]);
}

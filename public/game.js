/* 20 slov — česká denní slovní hra po vzoru 18words.com
 * Denní výzva: která slova se hrají, určuje DATUM, ne postup hráče — všichni
 * tak mají v daný den stejných 20 slov a výsledky jsou porovnatelné.
 * Slovník: jen podstatná jména (Wikislovník). Každý den má jedno slovo
 * z každého z 20 frekvenčních pásem, takže dny mají srovnatelnou obtížnost.
 * Slož slovo ze všech písmen do 30 s. Jeden pokus denně; zítra přijde další
 * den bez ohledu na dnešní výsledek. Série = odehrané dny v kuse, přetrhne ji jen vynechaný den.
 * Trénink čerpá z širšího poolu PRACTICE_WORDS (15 000 slov), denní výzva
 * má 7300 slov / 365 dní a v words.js je zamíchaná — rozbaluje ji unpackDay. */
'use strict';

const START_TIME = 30;
// s — za jak dlouho po slově v tréninku naběhne další samo; po chybě déle,
// je co si přečíst. Klepnutím kamkoli jde hned.
const PRACTICE_GAP = { solved: 3, missed: 6 };
const WORDS_PER_DAY = 20;
const TOTAL_WORDS = PACKED.length * WORDS_PER_DAY; // 7300
const TOTAL_LEVELS = TOTAL_WORDS / WORDS_PER_DAY; // 365
// Den 1 denní výzvy. Číslo dne se počítá od tohoto data, takže každý hráč
// dostane v daný kalendářní den stejných 20 slov. Po 365 dnech se rok opakuje.
const EPOCH = Date.UTC(2026, 8, 21);

const LETTER_RE = /[a-záčďéěíňóřšťúůýž]/;
// hratelná písmena hesla (bez mezer, teček, pomlček — ty jsou ve slotech pevně)
const lettersOf = w => [...w].filter(c => LETTER_RE.test(c)).join('');
const fmtNum = n => n.toLocaleString('cs-CZ');
const STORAGE_KEY = '20slov';
// Použije se jen při otevření z file:// nebo localhostu; po navázání
// vlastní domény sem patří ona.
const FALLBACK_URL = 'https://20slov.cz/';

// Backend běží na stejné doméně jako hra (jeden Worker servíruje statiku
// i /api/*, viz wrangler.toml), takže stačí relativní cesty — žádné CORS.
const API_TIMEOUT_MS = 1500;

// VAPID veřejný klíč pro Web Push denní připomínku (worker/README.md → sekce
// "Denní připomínka"). Prázdný = nabídka notifikací se nezobrazí.
const VAPID_PUBLIC_KEY = 'BIfOSyPsUDTwcGscDllPUF7bWF7iAMqJnMgwxlrDmUu0l3nQ_AySykBXvM_qzWk5v6HDzfvC57PYM0PHk7jRqbU';

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const IS_DESKTOP = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
// iPadOS se v Safari hlásí jako Mac; prozradí ho dotykový displej.
const IS_IOS = (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !window.MSStream;
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/* ---------------- trvalý stav ---------------- */

function defaultPersist() {
    return {
        results: {},         // { [index dne]: počet získaných slov } — odehrané dny
        streak: 0,
        bestStreak: 0,
        lastPlayDate: null, // den poslední dohrané denní výzvy; série = odehrané dny v kuse
        attempts: 0,
        wins: 0,
        kbHintShown: false,
        practiceWords: 0,   // uhodnutá slova v tréninku, opakovaná se počítají znovu
        practiceSeen: '',   // která různá slova už v tréninku padla (bitmapa, viz markPracticeSeen)
        practiceLevel: 'stredni', // obtížnost tréninku, klíč z PRACTICE_LEVELS
        practiceBestRun: 0, // nejdelší „N v řadě" v tréninku (úspěch V ráži)
        practiceHard: 0,    // uhodnutá slova na Těžkou (úspěch Těžká váha)
        ach: {},            // příznaky úspěchů, které nejdou dopočítat: { sdileno, blesk, chlup, sova, presmycka, cisty }
        achGot: {},         // { [id úspěchu]: datum získání } — získaný úspěch už nezmizí
        achUnseen: [],      // získané, ale ještě neotevřené (červená tečka)
        achQueue: [],       // čekají na oznámení, až hráč dohraje (announceAchievements)
        achSent: [],        // už nahlášené serveru („Má ho X % hráčů", u účtu i veřejný profil)
        achSentFor: '',     // komu se hlásilo: id účtu, '' = anonymně; po přihlášení se pošle všechno znovu
        nick: '',           // přezdívka u přidaných významů
        avatar: '',         // kód avatara „tvar-barva-oči-pusa", viz avatar.js
        pendingLogin: null, // { id, expiresAt } — rozjetá žádost o přihlášení
        nudgedAt: 0,        // série, u které jsme naposled připomněli účet
        day: null,           // { date, dayIdx, wordIdx, marks, time, done, perfect, realTopPct, wrong, ach }
        clientId: genClientId(), // náhodné ID zařízení pro percentily a úspěchy; po přihlášení se uloží k účtu
        a2hsPromptDismissed: false, // "přidej na plochu" nabídka na iOS se ukáže jen do prvního zavření
    };
}

function genClientId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let persist = loadPersist();

function loadPersist() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const saved = JSON.parse(raw);
            const p = Object.assign(defaultPersist(), saved);
            if (!('lastPlayDate' in saved)) migrateStreak(p);
            // uložený den ze staré, postupové verze nemá index dne — zahodit
            if (p.day && typeof p.day.dayIdx !== 'number') p.day = null;
            return p;
        }
    } catch (e) {}
    return defaultPersist();
}

function savePersist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persist)); } catch (e) {}
}

// Série dřív počítala jen perfektní dny (20/20). Teď jsou to odehrané dny
// v kuse, stejně jako na serveru a u úspěchů. Jednou se přepočítá z results.
function migrateStreak(p) {
    const today = dayIndex();
    const end = p.results[today] !== undefined ? today : p.results[today - 1] !== undefined ? today - 1 : null;
    let run = 0;
    if (end !== null) for (let i = end; i >= 0 && p.results[i] !== undefined; i--) run++;
    p.streak = run;
    p.lastPlayDate = end === null ? null : end === today ? todayStr() : daysAgoStr(1);
    p.bestStreak = Math.max(p.bestStreak, longestRun(p.results));
    delete p.lastWinDate;
}

// Nejdelší řada po sobě jdoucích dní v results (klíče = indexy dní),
// volitelně jen dní se skóre, které projde `ok`.
function longestRun(results, ok = () => true) {
    const idx = Object.keys(results).map(Number).filter(i => ok(results[i])).sort((a, b) => a - b);
    let best = 0, run = 0;
    idx.forEach((d, i) => { run = i > 0 && d === idx[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); });
    return best;
}

// Série, jak ji hráč vidí: po vynechaném dni už neplatí, i když se ještě nepřepsala.
function liveStreak() {
    return persist.lastPlayDate === todayStr() || persist.lastPlayDate === daysAgoStr(1) ? persist.streak : 0;
}

function daysAgoStr(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return todayStr(d);
}

function todayStr(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Počet dní od EPOCH. Počítá se z data v místní půlnoci, takže se den láme
// tam, kde hráč skutečně žije.
function daysSinceEpoch(dateStr) {
    const [y, m, d] = (dateStr || todayStr()).split('-').map(Number);
    return Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
}

// Index dne v ročním cyklu slov: po 365 dnech se slova opakují.
function dayIndex(dateStr) {
    const days = daysSinceEpoch(dateStr);
    return ((days % TOTAL_LEVELS) + TOTAL_LEVELS) % TOTAL_LEVELS;
}

function playedDays() { return Object.keys(persist.results).length; }


// Slova se rozbalují až na vyžádání — celý rok v jednom poli by stačilo
// vypsat v konzoli a zamíchání v words.js by bylo k ničemu.
function dayWords(idx) { return unpackDay(idx); }

function siteUrl() {
    if (location.protocol.startsWith('http') && !location.hostname.includes('localhost')) {
        return location.origin + location.pathname;
    }
    return FALLBACK_URL;
}

// Odkaz ve sdílené zprávě nese zdroj, ať statistiky poznají, kolik nových
// hráčů sdílení přivedlo (zprávy v messengerech často nemají referrer).
const shareUrl = (medium) => `${siteUrl()}?utm_source=share&utm_medium=${medium}`;

/* ---------------- herní stav (runtime) ---------------- */

let state = {
    mode: 'daily', words: [], wordIdx: 0, marks: [], solved: 0,
    time: START_TIME, letters: [], selected: [], timer: null,
    processing: false, incorrectTimeout: null, shuffledThisWord: false,
    practiceCount: 0,
    // každé nové kolo dostane číslo; naplánované callbacky ze starého kola
    // (odhalení slova, odpočet) se podle něj poznají a zahodí
    gen: 0,
};
let countdownInterval = null;

/* ---------------- haptika ---------------- */

// Vibrační vzory (ms): číslo = jedna vibrace, pole = vibrace/pauza/vibrace…
// Na zařízeních bez podpory (iOS, desktop) se tiše nic nestane.
const HAPTIC_PATTERNS = {
    tap: 10,                          // výběr/odebrání písmene, zamíchání
    button: 15,                       // klik na tlačítko
    success: [15, 50, 30],            // správně složené slovo
    error: [45, 40, 45],              // špatné slovo
    miss: [60, 50, 60, 50, 100],      // nestihnuté slovo
    win: [20, 40, 20, 40, 20, 40, 80],// perfektní den (konfety)
    tick: 8,                          // poslední vteřiny časovače
};

const COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

// iOS Vibration API nemá, ale přepnutí <input type="checkbox" switch>
// (Safari 17.4+) vydá nativní haptické ťuknutí. Programově ale funguje jen
// klik na obalující <label> — přímý klik na input haptiku nespustí.
// Apple to v iOS 26.5 zalepil, proto níže ještě překryvné přepínače.
function iosTap() {
    if (!COARSE_POINTER) return;
    try {
        const label = document.createElement('label');
        label.ariaHidden = 'true';
        label.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        label.appendChild(input);
        document.head.appendChild(label);
        label.click();
        document.head.removeChild(label);
    } catch (e) {}
}

function haptic(kind) {
    const pattern = HAPTIC_PATTERNS[kind] || HAPTIC_PATTERNS.tap;
    if ('vibrate' in navigator) {
        try { navigator.vibrate(pattern); } catch (e) {}
        return;
    }
    // iOS: ťuknutí neumí délku ani sílu — vzor převedeme na jedno ťuknutí
    // za každý vibrační úsek, s rozestupem aspoň 120 ms, ať jdou rozeznat.
    const segs = Array.isArray(pattern) ? pattern : [pattern];
    let t = 0;
    for (let i = 0; i < segs.length; i += 2) {
        if (t === 0) iosTap();
        else setTimeout(iosTap, t);
        t += Math.max(segs[i] + (segs[i + 1] || 0), 120);
    }
}

// Skutečný, neviditelný přepínač přes celé tlačítko: dotyk ho přepne a iOS
// vydá haptiku nativně — funguje i na iOS 26.5+, kde programový trik nejde.
// Klik dál probublá na tlačítko, takže onclick funguje beze změny.
// Tah prstem není klepnutí. Kdo začne scrollovat na tlačítku, nesmí ho
// spustit: iOS přepínač v tlačítku (haptika níž) se dá i posunout, a to
// click pošle. Capture a jako první, ať click nedostane ani tap zvuk.
let touchFrom = null;
document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchFrom = { x: t.clientX, y: t.clientY, sy: scrollY, moved: false };
}, { capture: true, passive: true });
document.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (touchFrom && Math.hypot(t.clientX - touchFrom.x, t.clientY - touchFrom.y) > 10) touchFrom.moved = true;
}, { capture: true, passive: true });
document.addEventListener('touchend', () => {
    const t = touchFrom;
    setTimeout(() => { if (touchFrom === t) touchFrom = null; }, 500);   // klávesnici pak nic neblokuje
}, { capture: true, passive: true });
document.addEventListener('click', e => {
    if (!touchFrom || !(touchFrom.moved || Math.abs(scrollY - touchFrom.sy) > 2)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
}, true);

// .screen-bar (profil, veřejný profil, …) je fixní přes celý scroll; pozadí
// a linka dole (viz style.css) se zapnou, až se opravdu scrolluje.
document.addEventListener('scroll', () => {
    document.documentElement.classList.toggle('scrolled', scrollY > 0);
}, { passive: true });

const NEEDS_SWITCH = !('vibrate' in navigator) && COARSE_POINTER;
function hapticSwitch(el, css = '') {
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.setAttribute('switch', '');
    sw.setAttribute('aria-hidden', 'true');
    sw.tabIndex = -1;
    sw.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent;' + css;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(sw);
    return sw;
}

function addHapticOverlays() {
    if (NEEDS_SWITCH) $$('button:not([type="submit"])').forEach(el => hapticSwitch(el));
}

// Lehké ťuknutí při kliku na tlačítko. Na iOS mají skutečná tlačítka
// překryvný přepínač (nativní haptika), programově ťukáme jen na prvky
// s role="button", které překrýt nejdou.
document.addEventListener('pointerdown', e => {
    const btn = e.target.closest('button, [role="button"]');
    if (!btn) return;
    if ('vibrate' in navigator || !btn.matches('button')) haptic('button');
});

/* ---------------- zvuky ---------------- */

// Tóny generované přes Web Audio API (žádné soubory ke stažení). AudioContext
// se vytváří líně a probouzí při prvním doteku, aby to prošlo přes autoplay
// omezení prohlížečů. Všechny zvuky jdou přes jednu sběrnici: lowpass 6 kHz
// pro kulatost a krátký „pokoj“ (konvoluce se šumem, který dozní za 0,4 s).
let audioCtx = null, audioOut = null, audioRoom = null;
function getAudioCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
        audioCtx = new Ctx();
        audioOut = audioCtx.createBiquadFilter();         // výchozí typ je lowpass
        audioOut.frequency.value = 6000;
        audioOut.connect(audioCtx.destination);
        const len = Math.floor(audioCtx.sampleRate * 0.4);
        const ir = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
        }
        const room = audioCtx.createConvolver();
        room.buffer = ir;
        room.connect(audioOut);
        audioRoom = audioCtx.createGain();
        audioRoom.gain.value = 0.2;                       // kolik z každého zvuku jde do pokoje
        audioRoom.connect(room);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// Úder paličkou jako na marimbu: parciály 1×, 4× a 10× [násobek, hlasitost,
// délka doznění vůči dur], vyšší doznívají rychleji. bright 0–1 je hlasitost
// vyšších parciálů: 0 tupé „bonk“, 1 jiskra. bend > 1 začne výš a za 40 ms
// sklouzne na tón („pop“), bend < 1 vyjede zdola („bloop“). dry = bez pokoje.
const PARTIALS = [[1, 1, 1], [4, 0.4, 0.25], [10, 0.15, 0.1]];
let soundAt = 0;   // kdy naposled něco zaznělo, viz tap níž
function playTone(freq, { dur = 0.3, peak = 0.1, delay = 0, bend = 1, bright = 0, wave = 'sine', dry = false } = {}) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    soundAt = performance.now();
    const t0 = ctx.currentTime + delay;
    PARTIALS.forEach(([mult, vol, decay], i) => {
        if (i && !bright) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const f = freq * mult;
        const end = t0 + Math.max(dur * decay, 0.012);   // doznění nesmí začít před náběhem
        osc.type = i ? 'sine' : wave;
        osc.frequency.setValueAtTime(f * bend, t0);
        osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.04);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(peak * vol * (i ? bright : 1), t0 + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain).connect(audioOut);
        if (!dry) gain.connect(audioRoom);
        osc.start(t0);
        osc.stop(end + 0.02);
    });
}

// Tap na tlačítko: suché krátké „pop“, nejtišší ze všech zvuků.
function playTapSound() { playTone(660, { dur: 0.05, peak: 0.05, bend: 1.6, bright: 0.3, dry: true }); }
// Stoupající tón s každým dalším vybraným písmenem (á la Duolingo). Krátký
// schválně: s 0,35 s se při rychlém klepání (80 ms) tóny slily a nový úder
// byl jen 3,6× hlasitější než doznívání předchozích, s 0,16 s je to 17×.
const LETTER_NOTES = [523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50, 1174.66, 1318.51];
const letterNote = (count) => LETTER_NOTES[Math.min(count - 1, LETTER_NOTES.length - 1)];
function playLetterSound(count) {
    playTone(letterNote(count), { dur: 0.16, peak: 0.13, bend: 1.03, bright: 0.8 });
}
// Poslední sekundy: tlukot srdce, který zrychluje ze 72 na 160 tepů za
// minutu. Podle fonokardiogramu: S1 („lub“) ~150 ms s energií 50–130 Hz,
// S2 („dub“) ~120 ms, o něco výš (75–200 Hz) a tišší. Proto jen sinusovky
// a tlumený šum pod lowpassem 220 Hz („přes hrudník“) s měkkým náběhem.
// Trojúhelník s vyššími parciály zněl z telefonu plechově: basy telefon
// nezahraje a zbyly jen ty parciály.
// Údery mezi sekundami se plánují dopředu, proto před zahráním ověří, že
// odpočet pořád běží. Zastavuje ho moc míst (uhodnutí, pauza, konec…).
const URGENT_FROM = 5;
let beatAt = 0, noiseBuf = null;
const counting = () => !state.processing && state.time > 0 && $('game').classList.contains('active')
    && !$('pauseOverlay').classList.contains('active') && !document.querySelector('.modal.active');
// Jedna ozva: základ, tišší oktáva (tu telefon ještě zahraje) a krátké žuchnutí šumu.
function heartSound(f, dur, peak, delay) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    soundAt = performance.now();
    const t0 = ctx.currentTime + delay;
    const lp = ctx.createBiquadFilter();                  // výchozí typ je lowpass
    lp.frequency.value = 220;
    lp.connect(audioOut);
    const env = (node, vol, len, attack) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak * vol, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
        node.connect(g).connect(lp);
        node.start(t0);
        node.stop(t0 + len + 0.02);
    };
    for (const [mult, vol, decay] of [[1, 1, 1], [2, 0.5, 0.6]]) {
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(f * mult * 1.1, t0);  // jen lehký pokles, žádné „píu“
        osc.frequency.exponentialRampToValueAtTime(f * mult, t0 + dur);
        env(osc, vol, dur * decay, 0.015);                // 15 ms náběh = bez klapnutí
    }
    if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
        noiseBuf.getChannelData(0).forEach((_, i, d) => { d[i] = Math.random() * 2 - 1; });
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    env(noise, 0.4, 0.05, 0.005);
}
// S2 přijde po třetině tepu, ať rytmus zůstane „lub-dub … lub-dub“ i zrychlený.
function playHeartbeat(k, gap) {
    const peak = 0.063 + k * 0.007;                      // pod písmenky, i v posledních sekundách
    heartSound(55, 0.15, peak, 0);
    heartSound(70, 0.12, peak * 0.7, gap * 0.33 / 1000);
}
function playUrgentSound(left) {
    const now = performance.now();
    const k = URGENT_FROM - left;                         // 0 … 4
    const gap = 60000 / (72 + k * 22);
    if (left === URGENT_FROM || beatAt < now) beatAt = now;
    for (; beatAt < now + 1000; beatAt += gap) {
        setTimeout(() => { if (counting()) playHeartbeat(k, gap); }, beatAt - now);
    }
}
function playRemoveSound() { playTone(392.00, { dur: 0.2, peak: 0.1, bend: 1.3, bright: 0.3 }); }
// Durový rozklad E–G–C, nad posledním tónem tichá tercie jako jiskra.
function playSuccessSound() {
    [659.25, 783.99, 1046.50].forEach((f, i) => playTone(f, { dur: i < 2 ? 0.3 : 0.7, peak: 0.15, delay: i * 0.08, bright: 1 }));
    playTone(1318.51, { dur: 0.6, peak: 0.05, delay: 0.16, bright: 0.5 });
}
// Chyba: měkké „bonk“ z trojúhelníku, který na začátku spadne o kvintu.
function playErrorSound() { playTone(233.08, { dur: 0.25, peak: 0.18, bend: 1.5, bright: 0.25, wave: 'triangle' }); }
// Vypršený čas: dvě klesající „bonk“.
function playMissSound() {
    playTone(261.63, { dur: 0.22, peak: 0.16, bend: 1.4, bright: 0.25, wave: 'triangle' });
    playTone(196.00, { dur: 0.45, peak: 0.16, delay: 0.16, bend: 1.4, bright: 0.25, wave: 'triangle' });
}
// Rozklad C–E–G–C a na konci tichý akord E–G nahoře.
function playWinSound() {
    [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => playTone(f, { dur: i < 3 ? 0.3 : 0.9, peak: 0.15, delay: i * 0.1, bright: 1 }));
    [1318.51, 1567.98].forEach(f => playTone(f, { dur: 0.8, peak: 0.05, delay: 0.3, bright: 0.5 }));
}
// Hlas palcem: dvě stoupající „plink“ (G–D), odebrání hlasu jedno nižší „pop“.
function playVoteSound(on) {
    if (!on) return playTone(587.33, { dur: 0.18, peak: 0.09, bend: 1.3, bright: 0.4 });
    playTone(783.99, { dur: 0.2, peak: 0.11, bright: 1 });
    playTone(1174.66, { dur: 0.35, peak: 0.11, delay: 0.07, bright: 1 });
}
// Sheet: bublina nahoru při otevření, dolů při zavření.
function playSheetSound(open) { playTone(open ? 523.25 : 440, { dur: 0.14, peak: 0.07, bend: open ? 0.7 : 1.4 }); }
// Převíjení času zpátky na 30 s: za každou přičtenou sekundu drobný tik, výš
// a výš, naplánovaný přesně v rytmu animateTimerUp. Poslední tik dosedne silněji.
function playRewindSound(from, to, stepMs) {
    for (let v = from + 1; v <= to; v++) {
        playTone(587.33 * 2 ** (v / to), { dur: 0.05, peak: v === to ? 0.07 : 0.035, delay: (v - from) * stepMs / 1000, bend: 1.25, bright: 0.4, dry: true });
    }
}

// Tap na tlačítko (i na záložku profilu). Zazní až po obsluze kliku, a jen
// když tlačítko nezahrálo vlastní zvuk (hlas, sheet, převíjení…), takže nic
// nezní dvakrát. Capture, protože některé obsluhy volají stopPropagation.
// Disabled tlačítko click nedostane, z iOS přepínače uvnitř ho najde closest.
// Na click, ne pointerdown: začátek scrollu přes tlačítko neťukne.
document.addEventListener('click', e => {
    const btn = e.target.closest('button, [role="button"], .ptab-bar label');
    if (!btn || btn.matches(':disabled')) return;
    const t = performance.now();
    getAudioCtx();                                        // probudit ještě v gestu
    setTimeout(() => { if (soundAt < t) playTapSound(); });
}, true);

/* ---------------- UI helpery ---------------- */

let toastTimeout = null;
function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 2600);
}

// Navigace jako v mobilních appkách. Zásobník obrazovek: jít hlouběji =
// nová přijede zprava přes starou (ta ustoupí doleva), zpět = odjede doprava
// a předchozí se vrátí i se scrollem. Hra je vrstva přes aplikaci: otevře se
// zvětšením z mírně menší, při konci se rozplyne. Domov je úvod i výsledek.
const NAV_MS = 380, NAV_EASE = 'cubic-bezier(.32, .72, 0, 1)';
const navKey = (id) => id === 'result' ? 'welcome' : id;
let navStack = [];
const navScroll = {};
// Historie prohlížeče kopíruje zásobník: hlouběji = pushState, zpět v appce
// = history.go(-n). Díky tomu funguje gesto i tlačítko zpět a reload vrátí
// hráče na stejnou obrazovku (adresa za #, server ani SW nic neřeší).
let navFromPop = false;      // obrazovku přepíná popstate: historie už se pohnula
let navIgnorePops = 0;       // popstate, které vyvolalo naše history.go
let navInstant = false;      // start aplikace: bez animace
const NAV_HASH = { profile: '#profil', achievements: '#uspechy', myDefs: '#moje-vyznamy', profileEdit: '#upravit-profil', game: '#hra' };
// záznam v historii nese celý zásobník, ať reload nic nepřidává
const navState = (id) => ({ s: id, h: state.profileHandle, stack: navStack.slice() });
const navUrl = (id) => id === 'publicProfile' ? '#hrac/' + encodeURIComponent(state.profileHandle || '')
    : NAV_HASH[id] || location.pathname + location.search;

function showScreen(id) {
    const from = document.querySelector('.screen.active');
    const to = $(id);
    // Profil a trénink v rozích patří domovu — a ten je po dohrání dne výsledek.
    if (id === 'welcome' || id === 'result') to.prepend($('topBar'));
    if (!navStack.length) navStack = [navKey(id)];
    if (from === to) {
        if (id === 'publicProfile' && !navFromPop) history.replaceState(navState(id), '', navUrl(id));
        return;
    }
    const fromId = from && from.id, key = navKey(id);
    if (id !== 'game') track('screen_viewed', { screen: id });   // hru měří day_started/practice_started
    let kind;
    if (!from) kind = 'none';
    else if (id === 'game') kind = navStack.includes('game') ? 'pop' : 'present';
    else if (fromId === 'game' && id !== 'publicProfile') kind = 'dismiss';
    else if (navStack.slice(0, -1).includes(key)) kind = 'pop';
    else if (key === 'welcome') kind = 'fade';
    else kind = 'push';

    if (from) navScroll[navKey(fromId)] = scrollY;
    const depth = navStack.length;
    if (kind === 'pop') navStack = navStack.slice(0, navStack.indexOf(key) + 1);
    else if (kind === 'dismiss' || key === 'welcome') navStack = key === 'welcome' ? ['welcome'] : navStack.filter(k => k !== 'game').concat(key);
    else if (kind !== 'pop') navStack.push(key);
    if (!navFromPop) {
        if (navStack.length > depth) history.pushState(navState(id), '', navUrl(id));
        else if (navStack.length < depth) { navIgnorePops++; history.go(navStack.length - depth); }
    }
    if (navInstant) kind = 'none';

    // odcházející obrazovka zůstane na chvíli vidět tam, kde byla
    if (from && kind !== 'none' && !REDUCED_MOTION.matches) {
        from.classList.add('screen-leaving');
        from.style.top = -scrollY + 'px';
    }
    $$('.screen').forEach(s => s.classList.toggle('active', s === to));
    if (kind === 'pop' || kind === 'dismiss') scrollTo(0, navScroll[key] || 0);
    if (from) navAnimate(from, to, kind);
    if (id === 'welcome' || id === 'profile' || id === 'achievements') whenCalm();   // výsledek čeká na konec odhalení
}

// Zpět z prohlížeče (gesto, tlačítko): obrazovka podle záznamu v historii.
// Ve hře zpět = jako křížek: trénink skončí, denní výzva se zeptá.
window.addEventListener('popstate', e => {
    if (navIgnorePops) { navIgnorePops--; return; }
    const cur = document.querySelector('.screen.active');
    if (cur && cur.id === 'game') {
        if (state.mode === 'practice') return navPop(exitPractice);
        // Zůstat ve hře, pokud potvrzení zruší. Záznam až po dokončení návratu:
        // Safari po gestu zpět drží snímek předchozí obrazovky, dokud návrat
        // nedoběhne, a nový záznam přímo v popstate mu ho může nechat viset.
        setTimeout(() => history.pushState(navState('game'), '', navUrl('game')));
        return openQuit();
    }
    closeModal();
    const s = e.state || parseHash();                     // ručně přepsaná adresa za # nemá stav
    navPop(() => openRoute(s.s || 'welcome', s.h));
});

// iOS: tah od levého okraje je gesto Zpět a v denní výzvě se při rychlém
// ťukání spustí snadno omylem. Safari pak místo hry ukáže snímek předchozí
// obrazovky (bez snímku jen tmavé pozadí), hra pod ním se zastaví na
// potvrzení konce a nic nereaguje. Ve hře proto gesto nezačne: preventDefault
// na touchstart u okraje ho zruší (iOS 13.4+). Ven vede křížek. Vpravo nic
// nehrozí, ze hry nevede žádný záznam vpřed. Tlačítka a písmena (na úzkém
// displeji sahají až k okraji) klepnutí nesmí ztratit.
const EDGE_SWIPE_PX = 24;
document.addEventListener('touchstart', e => {
    if (state.mode !== 'daily' || !$('game').classList.contains('active')) return;
    if (e.changedTouches[0].clientX >= EDGE_SWIPE_PX || e.target.closest('button, .letter')) return;
    e.preventDefault();
}, { passive: false });

function parseHash() {
    const m = location.hash.match(/^#([\w-]+)(?:\/(.*))?$/);
    const s = m && (Object.keys(NAV_HASH).find(k => NAV_HASH[k] === '#' + m[1]) || (m[1] === 'hrac' && m[2] && 'publicProfile'));
    return { s: s || null, h: m && m[2] ? decodeURIComponent(m[2]) : null };
}

function navPop(fn) {
    navFromPop = true;
    try { fn(); } finally { navFromPop = false; }
}

function openRoute(id, handle) {
    if (id === 'profile') return showProfile();
    if (id === 'achievements') return showAchievements();
    if (id === 'myDefs') return showMyDefs(0);
    if (id === 'profileEdit') return showProfileEdit();
    if (id === 'publicProfile' && handle) return showPublicProfile(handle, state.profileHandle === handle ? state.profileBack : null);
    if (id === 'game' && state.profileBack) return leavePublicProfile();   // z profilu autora zpátky do tréninku
    showWelcome();
}

// Reload: z adresy obrazovka, kde hráč byl. Pod ní domov, ať zpět vede domů
// a ne pryč z hry. Hru obnovit nejde, reload v ní skončí doma.
function restoreRoute() {
    const saved = history.state;
    const { s: id, h } = saved && saved.s ? saved : parseHash();
    if (!id || id === 'game') {
        if (location.hash) history.replaceState(null, '', navUrl('welcome'));
        return;
    }
    navInstant = true;
    try {
        if (saved && saved.stack) {
            // reload: zásobník je uložený v záznamu, historie už ho obsahuje
            navStack = saved.stack.slice(0, -1);
            navPop(() => openRoute(id, h));
        } else {
            // odkaz s # z venku: pod obrazovku domov (a u Úspěchů atd. Profil)
            history.replaceState(null, '', navUrl('welcome'));
            if (id !== 'profile' && id !== 'publicProfile') showProfile();
            openRoute(id, h);
        }
    } finally { navInstant = false; }
}

function navAnimate(from, to, kind) {
    const done = () => { from.classList.remove('screen-leaving', 'screen-over'); from.style.top = ''; to.classList.remove('screen-over'); };
    if (REDUCED_MOTION.matches || kind === 'none') return done();
    const opt = { duration: NAV_MS, easing: NAV_EASE };
    const vw = window.innerWidth + 'px';
    const pair = {
        push:    [[{ translate: `${vw} 0` }, { translate: '0 0' }], [{ translate: '0 0', opacity: 1 }, { translate: '-30% 0', opacity: .6 }]],
        pop:     [[{ translate: '-30% 0', opacity: .6 }, { translate: '0 0', opacity: 1 }], [{ translate: '0 0' }, { translate: `${vw} 0` }]],
        present: [[{ scale: .94, opacity: 0 }, { scale: 1, opacity: 1 }], [{ opacity: 1 }, { opacity: 0 }]],
        dismiss: [[{ opacity: 0 }, { opacity: 1 }], [{ scale: 1, opacity: 1 }, { scale: .94, opacity: 0 }]],
        fade:    [[{ opacity: 0, translate: '0 12px' }, { opacity: 1, translate: '0 0' }], [{ opacity: 1 }, { opacity: 0 }]],
    }[kind];
    // nahoře je vždy ta, která se hýbe přes druhou: přijíždějící, nebo odjíždějící zpět
    (kind === 'pop' || kind === 'dismiss' ? from : to).classList.add('screen-over');
    to.animate(pair[0], opt);
    from.animate(pair[1], opt).finished.then(done, done);
}

/* ---------------- welcome ---------------- */

const dayCells = () => Array.from({ length: WORDS_PER_DAY }, () => el('div', 'pg-cell'));

const todayDone = () => !!(persist.day && persist.day.done && persist.day.date === todayStr());

function showWelcome() {
    stopConfetti();
    // Dohraný den: domovem je rovnou výsledek (kostky, skóre, odpočet).
    if (todayDone()) {
        restoreFinishedDay();
        showResult(true);
        return;
    }
    placeGameGrid('game');
    $('welcomeGrid').replaceChildren(...dayCells());
    $('welcomeRules').innerHTML = persist.attempts > 0
        ? 'Dohraj dnešek a série poběží dál. Dnešních 20 slov hraje dnes každý stejných.'
        : `Dnešních 20 slov z ${fmtNum(TOTAL_WORDS)} nejčastějších českých hraje dnes každý stejných. Zvládneš všechna?`;
    showScreen('welcome');
}

/* ---------------- významy slov ---------------- */

const defCache = new Map();      // slovo -> definice | null (null = víme, že žádná není)
const defInflight = new Map();

async function apiGet(path) {
    try {
        const res = await fetch(path, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
        return res.ok ? await res.json() : null;
    } catch (e) {
        return null; // offline nebo timeout — hra jede dál, jen bez významu
    }
}

// timeoutMs jen tam, kde hráč na odpověď nečeká (percentil); zápisy čekají.
async function apiPost(path, body, timeoutMs) {
    try {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ clientId: persist.clientId }, body)),
            signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
        });
        return { ok: res.ok, data: await res.json().catch(() => null) };
    } catch (e) {
        return { ok: false, data: null };
    }
}

// Chybová hláška pod formulářem; bez textu ji schová.
function formError(node, msg) {
    node.textContent = msg || '';
    node.style.display = msg ? 'block' : 'none';
}

const defsUrl = (words) => `/api/defs?w=${encodeURIComponent(words)}`;

// Fronta tréninku se bere od konce, takže dalších pár slov známe dopředu
// a mezihra pak nikdy nečeká na síť.
function prefetchDefs() {
    if (state.mode !== 'practice') return;
    const todo = (state.practiceQueue || []).slice(-10)
        .filter(w => !defCache.has(w) && !defInflight.has(w));
    if (!todo.length) return;
    todo.forEach(w => defInflight.set(w, true));
    apiGet(defsUrl(todo.join(','))).then(data => {
        if (data && data.defs) {
            for (const w of Object.keys(data.defs)) defCache.set(w, data.defs[w]);
        }
    }).finally(() => todo.forEach(w => defInflight.delete(w)));
}

/* ---------------- mezihra po slově (jen trénink) ---------------- */

// Panel zdola jako Duolingo po odpovědi: zelený po uhodnutí, červený po
// vypršení času, hra nad ním zůstává vidět. Další slovo naběhne samo (tlačítko
// se mezitím vyplňuje), klepnutím kamkoli mimo kartu hned. Sáhnutí na kartu
// s významem, otevření významů nebo odchod z aplikace odpočet zruší — kdo čte,
// tomu obrazovka neuteče.
// Hlášky po uhodnutí; krátké (≤ 12 znaků), vedle bývá štítek série.
const PRAISE = {
    fast:  ['Bleskovka!', 'Jako blesk!', 'Turbo!', 'Fofr!', 'Raketa!', 'Rychlík!'],   // do 5 s
    close: ['Tak tak!', 'O fous!', 'Na chlup!', 'Těsně!', 'Uf, těsně!', 'Na knap!'],   // zbývalo ≤ 10 s
    ok:    ['Paráda!', 'Výborně!', 'Super!', 'Skvělé!', 'Bomba!', 'Pecka!', 'Trefa!', 'Přesně tak!'],
};
// Náhodná hláška, ale nikdy stejná dvakrát po sobě.
function praise(kind) {
    const pool = PRAISE[kind].filter(p => p !== state.lastPraise);
    return (state.lastPraise = pool[Math.floor(Math.random() * pool.length)]);
}
const STREAK_MILESTONES = [5, 10, 20, 30, 50, 100];

function showWordDone(word, gen, solved) {
    if (state.gen !== gen) return;
    clearInterval(state.timer);
    clearTimeout(state.nextTimer);
    const ov = $('wordDoneOverlay');
    const elapsed = START_TIME - state.time;
    state.wdWord = word;
    ov.classList.remove('closing', 'solved', 'missed');
    ov.classList.add(solved ? 'solved' : 'missed');
    ov.querySelector('.wd-panel').style.cssText = '';
    $('wdTitle').textContent = !solved ? 'Čas vypršel'
        : praise(elapsed <= 5 ? 'fast' : state.time <= 10 ? 'close' : 'ok');
    // Čas do dalšího slova ukazuje tlačítko, podtitulek jen u chyby.
    $('wdSub').textContent = solved ? ''
        : state.lostStreak >= 2 ? 'Série skončila' : 'Hledané slovo';
    renderWdStreak(solved);
    renderWdTiles(word, solved);
    renderWdCard(word);
    const gap = PRACTICE_GAP[solved ? 'solved' : 'missed'];
    const next = $('wdNextBtn');
    next.style.setProperty('--gap', gap + 's');
    next.classList.remove('paused');
    next.classList.add('counting');
    ov.classList.add('active');
    state.wdPaused = false;
    state.wdDeadline = Date.now() + gap * 1000;
    state.nextTimer = setTimeout(nextWord, gap * 1000);
    if (!defCache.has(word)) {
        apiGet(defsUrl(word)).then(d => {
            if (!d || !d.defs) return;
            defCache.set(word, d.defs[word] || null);
            if (state.gen === gen && state.wdWord === word) renderWdCard(word);
        });
    }
    prefetchDefs();
}

// Série uhodnutých slov v tréninku; na milníku plamen vzplane (CSS) a zazní
// fanfára. Po chybě zhaslý plamen s přeškrtnutým číslem, jak to dělá Duolingo.
function renderWdStreak(solved) {
    const chip = $('wdStreak');
    const n = solved ? state.practiceCount : state.lostStreak;
    chip.className = 'wd-streak' + (solved ? '' : ' wd-streak--lost');
    chip.hidden = n < 2;
    if (n < 2) return;
    setEmojiText(chip, solved ? `🔥 ${n} v řadě` : `🔥 ${n}`);
    chip.setAttribute('aria-label', solved ? `${n} v řadě` : `Série ${n} skončila`);
    if (solved && STREAK_MILESTONES.includes(n)) {
        chip.classList.add('wd-streak--milestone');
        setTimeout(() => { playWinSound(); haptic('win'); }, 350);
    }
}

// Slovo jako kostky. Nestihnuté naskočí v rozsypaném pořadí, jak bylo ve hře,
// a přeskládá se do správného (posun --from, oblouček --hop řeší CSS).
function renderWdTiles(word, solved) {
    const box = $('wdTiles');
    const chars = [...word];
    const gap = 6;
    const avail = Math.min(window.innerWidth, 440) - 44;
    const size = Math.max(20, Math.min(44, Math.floor((avail - (chars.length - 1) * gap) / chars.length)));
    box.style.setProperty('--tile', size + 'px');
    box.setAttribute('aria-label', word);
    box.classList.remove('wd-unscramble');
    const tiles = chars.map((ch, i) => {
        const t = el('span', LETTER_RE.test(ch) ? 'wd-tile' : 'wd-tile wd-tile--gap', ch.trim());
        t.style.setProperty('--i', i);
        return t;
    });
    box.replaceChildren(...tiles);
    if (solved) return;
    const bank = [...$$('#letterRow .letter')].map(l => state.letters[+l.dataset.index]);
    const slots = chars.map((_, i) => i).filter(i => LETTER_RE.test(chars[i]));
    const used = new Set();
    slots.forEach(slot => {
        const k = bank.findIndex((c, j) => !used.has(j) && c === chars[slot]);
        if (k < 0) return;
        used.add(k);
        const dx = (slots[k] - slot) * (size + gap);
        tiles[slot].style.setProperty('--from', dx + 'px');
        tiles[slot].style.setProperty('--hop', dx ? '-16px' : '0px');
    });
    box.classList.add('wd-unscramble');
}

// Význam slova, nebo místo něj výzva, ať ho hráč doplní.
function renderWdCard(word) {
    const def = defCache.get(word);
    const card = $('wdCard');
    card.hidden = !def;
    card.replaceChildren();
    if (def) {
        const meta = el('div', 'wd-meta');
        meta.append(authorEl(def), voteBtn(def));
        card.append(el('p', 'wd-text', def.text), meta);   // cizí text vždy přes textContent
    }
    $('wdAddBtn').hidden = !!def;
    $('wdAddTitle').textContent = `Víš, co znamená „${word}“?`;
    $('wdMoreBtn').hidden = !def;
    $('wdMoreBtn').textContent = auth.enabled ? 'Významy a přidat vlastní' : 'Všechny významy';
}

function nextWord() {
    const ov = $('wordDoneOverlay');
    if (!ov.classList.contains('active') || ov.classList.contains('closing')) return;
    clearTimeout(state.nextTimer);
    state.nextTimer = null;
    hideWordDone(true);
    $('wordDisplay').style.cssText = '';
    loadWord();
}

// Odpočet se zruší, ne pozastaví: kdo klepl na význam, klepne na Další sám.
function holdWordDone() {
    if (!$('wordDoneOverlay').classList.contains('active')) return;
    clearTimeout(state.nextTimer);
    state.nextTimer = null;
    state.wdPaused = false;
    $('wdNextBtn').classList.remove('counting', 'paused');
}

// Podržení prstu: odpočet stojí, puštěním běží dál. Vzhled (pauza na tlačítku,
// zastavené vyplňování) přidá až opravdové podržení — viz obsluha níž.
function pauseCountdown() {
    if (!state.nextTimer) return false;
    clearTimeout(state.nextTimer);
    state.nextTimer = null;
    state.wdLeftMs = Math.max(0, state.wdDeadline - Date.now());
    state.wdPaused = true;
    return true;
}

function resumeCountdown() {
    if (!state.wdPaused) return;
    state.wdPaused = false;
    $('wdNextBtn').classList.remove('paused');
    state.wdDeadline = Date.now() + state.wdLeftMs;
    state.nextTimer = setTimeout(nextWord, state.wdLeftMs);
}

function hideWordDone(animated) {
    const ov = $('wordDoneOverlay');
    if (!ov.classList.contains('active')) return;
    const panel = ov.querySelector('.wd-panel');
    const finish = () => {
        ov.classList.remove('active', 'closing');
        panel.style.cssText = '';
        state.wdPaused = false;
        $('wdNextBtn').classList.remove('counting', 'paused');
    };
    if (!animated || REDUCED_MOTION.matches) return finish();
    ov.classList.add('closing');
    slideDown(panel, 260);
    setTimeout(() => { if (ov.classList.contains('closing')) finish(); }, 260);
}

// Autor s účtem je odkaz na svůj veřejný profil. Smazaný účet (author null) ne.
function authorEl(def) {
    const wrap = document.createElement(def.author ? 'button' : 'span');
    wrap.className = 'wd-author';
    if (def.author) {
        wrap.type = 'button';
        wrap.setAttribute('aria-label', `Profil hráče ${def.author}`);
        wrap.onclick = (e) => { e.stopPropagation(); openAuthorProfile(def.author); };
    }
    const av = document.createElement('span');
    av.className = 'wd-avatar';
    const label = (def.author || 'Anonym').trim();
    const svg = Avatar.svg(def.avatar);                 // jen z indexů kódu, viz renderProfile
    if (svg) { av.classList.add('wd-avatar--img'); av.innerHTML = svg; }
    else av.textContent = label.charAt(0).toUpperCase() || '?';
    const n = document.createElement('span');
    n.className = 'wd-name';
    n.textContent = label;
    wrap.append(av, n);
    return wrap;
}

function voteBtn(def) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wd-vote' + (def.voted ? ' voted' : '');
    setEmojiText(b, `👍 ${def.votes}`);
    if (def.mine) {
        b.disabled = true;
        b.title = 'Svůj vlastní význam hodnotit nejde';
    } else if (!auth.user) {
        b.disabled = true;
        b.title = 'Hlasovat může jen přihlášený hráč';
    } else {
        b.onclick = (e) => { e.stopPropagation(); voteDef(def, b); };
    }
    return b;
}

async function voteDef(def, btn) {
    playVoteSound(!def.voted);                            // hned, ne až po odpovědi serveru
    const r = await apiPost('/api/defs/vote', { id: def.id });
    if (!r.ok) return showToast((r.data && r.data.error) || 'Hlas se nepodařilo uložit.');
    def.votes = r.data.votes;
    def.voted = r.data.voted;
    if (def.voted) track('def_voted');
    setEmojiText(btn, `👍 ${def.votes}`);
    btn.classList.toggle('voted', !!def.voted);
    // Hlas může změnit, kdo je nejlepší — v detailu slova přeřadit.
    if ($('defsModal').classList.contains('active') && state.wdWord) loadDefsList(state.wdWord);
    // Hlas ze sheetu významů promítnout i do karty v mezihře pod ním.
    const top = defCache.get(state.wdWord);
    if (top && top !== def && top.id === def.id) {
        top.votes = def.votes;
        top.voted = def.voted;
        renderWdCard(state.wdWord);
    }
}

/* ---------------- modal se všemi významy ---------------- */

function openDefs(e) {
    if (e) e.stopPropagation();
    track('defs_opened', { mode: state.mode });
    holdWordDone();                                       // kdo čte významy, pokračuje sám
    const word = state.wdWord;
    $('defsTitle').textContent = word || 'Významy';
    formError($('defsError'));
    $('defsText').value = '';
    $('defsList').innerHTML = '';
    openModal('defsModal');
    renderDefsForm();
    loadDefsList(word);
    refreshAuth().then(renderDefsForm);
}

// Psát smí jen přihlášený — jméno u významu musí za někým stát.
function renderDefsForm() {
    const form = $('defsForm');
    const gate = $('defsGate');
    const canWrite = !!(auth.user && auth.user.handle);
    form.style.display = canWrite ? 'flex' : 'none';
    gate.style.display = canWrite ? 'none' : 'block';
    gate.innerHTML = '';
    if (canWrite) return;
    gate.appendChild(el('p', 'profile-note', auth.enabled
        ? 'Významy může přidávat jen přihlášený hráč — ať je jasné, kdo za nimi stojí.'
        : 'Přidávání významů spustíme, jakmile budou hotové účty.'));
    if (!auth.enabled) return;
    const b = el('button', 'btn btn-primary', auth.user ? 'Zvolit přezdívku' : 'Přihlásit se');
    b.type = 'button';
    b.onclick = () => { track('login_prompt_clicked', { where: 'defs_gate' }); closeDefs(); exitPractice(); showProfile(); };
    gate.appendChild(b);
    if (!auth.user) trackPromptShown('defs_gate');
}

function closeDefs() {
    closeSheet($('defsModal'));
}

// Detail slova: štítky s informacemi, nahoře nejlépe hodnocený význam (zlatý,
// s korunou), pod ním ostatní jako kandidáti, pro které jde hlasovat.
async function loadDefsList(word) {
    const list = $('defsList');
    renderWordInfo(word);
    const data = await apiGet(`/api/defs/word?w=${encodeURIComponent(word)}`);
    if (state.wdWord !== word) return;
    const defs = (data && data.defs) || [];
    if (!defs.length) {
        list.replaceChildren(el('li', 'def-empty', data
            ? 'Zatím tu není žádný význam. Buď první!'
            : 'Významy se teď nepodařilo načíst.'));
        return;
    }
    const [best, ...rest] = defs;                          // API řadí podle hlasů
    const items = [defItem(best)];
    if (best.votes > 0) {
        items[0].classList.add('def-item--best');
        items[0].prepend(el('div', 'def-best-label', 'Nejlepší význam'));
    }
    if (rest.length) {
        items.push(el('li', 'def-group', `${best.votes > 0 ? 'Další kandidáti' : 'Další významy'} (${rest.length})`));
        rest.forEach(d => items.push(defItem(d)));
    }
    list.replaceChildren(...items);
}

// Co o slově víme i bez sítě: pořadí podle častosti, obtížnost, délka, přesmyčky.
function renderWordInfo(word) {
    const rank = practiceRank(word);
    const n = lettersOf(word).length;
    const chips = [];
    if (rank !== undefined) {
        chips.push(el('span', 'info-chip', `${fmtNum(rank + 1)}. nejčastější`));
        const lv = rank < 3000 && n <= 5 ? 'lehka' : rank < TOTAL_WORDS ? 'stredni' : 'tezka';
        chips.push(el('span', `info-chip info-chip--level info-chip--${lv}`, PRACTICE_LEVELS[lv].label));
    }
    chips.push(el('span', 'info-chip', `${n} ${plural(n, 'písmeno', 'písmena', 'písmen')}`));
    const box = $('defsInfo');
    box.replaceChildren(...chips);
    const alts = (typeof ALTS !== 'undefined' && ALTS[word]) || [];
    if (alts.length) box.appendChild(el('p', 'defs-alts', `Ze stejných písmen: ${alts.join(', ')}`));
}

function defItem(d) {
    const li = el('li', 'def-item' + (d.mine ? ' mine' : ''));
    const p = el('p', 'wd-text', d.text);                  // cizí text vždy přes textContent
    const actions = el('span', 'def-actions');
    actions.append(voteBtn(d));
    if (d.mine) actions.append(editBtn(d, li, p, () => { loadDefsList(state.wdWord); renderWdCard(state.wdWord); }));
    else if (auth.user) actions.append(reportBtn(d, li));
    const meta = el('div', 'wd-meta');
    meta.append(authorEl(d), actions);
    li.append(p, meta);
    return li;
}

// Ikona tužky místo textu „Upravit".
function editBtn(d, li, textEl, onSaved) {
    const b = el('button', 'def-icon-btn def-edit');
    b.type = 'button';
    b.title = 'Upravit';
    b.setAttribute('aria-label', 'Upravit význam');
    b.onclick = () => editDef(d, li, textEl, onSaved);
    return b;
}

// Vlaječka; první klepnutí se zeptá („Nahlásit?"), druhé nahlásí — omylem
// ťuknutá ikona nikoho neudá. Po 3 s se vrátí zpátky.
function reportBtn(d, li) {
    const b = el('button', 'def-icon-btn def-flag');
    b.type = 'button';
    b.title = 'Nahlásit nevhodný význam';
    b.setAttribute('aria-label', 'Nahlásit nevhodný význam');
    b.onclick = () => {
        clearTimeout(b.revert);
        if (b.classList.contains('confirm')) return reportDef(d, li);
        b.classList.add('confirm');
        b.textContent = 'Nahlásit?';
        b.revert = setTimeout(() => { b.classList.remove('confirm'); b.textContent = ''; }, 3000);
    };
    return b;
}

// Autor smí svůj význam upravit. Když už má hlasy, úprava je smaže — jinak by
// šlo vyhlasovat neškodnou větu a pak ji přepsat.
function editDef(d, li, textEl, onSaved) {
    if (li.querySelector('form')) return;
    const form = el('form', 'feedback-form');
    const ta = document.createElement('textarea');
    ta.maxLength = 200;
    ta.required = true;
    ta.value = d.text;
    const err = el('p', 'feedback-error');
    formError(err);
    const save = el('button', 'btn btn-primary', 'Uložit změnu');
    save.type = 'submit';
    const cancel = el('button', 'btn-tertiary', 'Zrušit');
    cancel.type = 'button';
    cancel.onclick = () => form.remove();
    if (d.votes > 0) form.appendChild(el('p', 'profile-note', 'Úpravou se smažou dosavadní hlasy.'));
    form.append(ta, err, save, cancel);
    form.onsubmit = async (e) => {
        e.preventDefault();
        save.disabled = true;
        const r = await apiPost('/api/defs/edit', { id: d.id, text: ta.value });
        save.disabled = false;
        if (!r.ok) return formError(err, (r.data && r.data.error) || 'Nepodařilo se uložit.');
        d.text = ta.value.trim();
        d.votes = r.data.votes;
        textEl.textContent = d.text;
        form.remove();
        defCache.delete(d.word);
        if (onSaved) onSaved();
        showToast(r.data.resetVotes ? 'Upraveno, hlasy vynulovány.' : 'Upraveno.');
    };
    li.appendChild(form);
}

async function reportDef(d, li) {
    const r = await apiPost('/api/defs/report', { id: d.id });
    if (!r.ok) return showToast('Nahlášení se nepodařilo.');
    li.remove();
    showToast('Díky, nahlášeno.');
}

async function submitDef(e) {
    e.preventDefault();
    const word = state.wdWord;
    const btn = $('defsSubmit');
    const err = $('defsError');
    formError(err);
    btn.disabled = true;
    const r = await apiPost('/api/defs', { word, text: $('defsText').value });
    btn.disabled = false;
    if (!r.ok) return formError(err, (r.data && r.data.error) || 'Význam se nepodařilo uložit.');
    $('defsText').value = '';
    defCache.delete(word);
    await loadDefsList(word);
    const fresh = await apiGet(defsUrl(word));
    if (fresh && fresh.defs) defCache.set(word, fresh.defs[word] || null);
    renderWdCard(word);
    track('def_submitted');
    showToast('Díky! Význam je uložený.');
}

/* ---------------- účet (magic link) ---------------- */

// Dokud nejsou nastavené secrety pro odesílání pošty, vrací /api/me auth:false
// a sekce účtu se vůbec neukáže — hra jede dál anonymně.
const auth = { enabled: false, user: null, polling: null };

// Anonymní statistiky (analytics.js). Společné vlastnosti se posílají s každou
// událostí; hra z toho nikdy nesmí dostat chybu, proto try.
function statTraits() {
    return {
        platform: IS_IOS ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop',
        standalone: IS_STANDALONE,
        has_account: !!auth.user,
        played_days: playedDays(),
        streak: liveStreak(),
        notif_on: 'Notification' in window && Notification.permission === 'granted',
    };
}
function track(name, props) {
    try { Analytics.set(statTraits()); Analytics.track(name, props); } catch (e) {}
}
const marksStr = (marks) => marks.map(m => m ? 1 : 0).join('');
// Nabídka účtu se překresluje často; do statistik jde jednou za načtení a místo.
const promptsSeen = new Set();
function trackPromptShown(where) {
    if (promptsSeen.has(where)) return;
    promptsSeen.add(where);
    track('login_prompt_shown', { where });
}

// Přepínač v profilu: vypnuté statistiky se neposílají ani nenačítají.
function renderStatsToggle() {
    $('statsToggle').textContent = persist.noStats ? 'vypnuto' : 'zapnuto';
}
function toggleStats() {
    persist.noStats = !persist.noStats;
    savePersist();
    Analytics.setOff(persist.noStats);
    renderStatsToggle();
}

// Avatar účtu, jinak ten vybraný v zařízení.
const myAvatar = () => (auth.user && auth.user.avatar) || persist.avatar;

async function refreshAuth() {
    const d = await apiGet('/api/me');
    auth.enabled = !!(d && d.auth);
    const wasUser = !!auth.user;
    auth.user = d ? d.user : null;
    // Účet (a jeho avatar) poprvé zjištěný v týhle relaci nemá "oslavovat"
    // úspěch starý měsíce — viz markAchieved.
    if (auth.user && !wasUser) { markAchieved(achState()); savePersist(); }
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

// Emoji v textu UI obalí do <span class="emoji" data-emoji="…">, ať ho design
// může vyměnit za vlastní ikonu (designs/kostky/); bez CSS zůstane emoji.
// \n se převede na <br>. Staví DOM, ne HTML — text může přijít i z backendu.
const EMOJI_NAMES = { '👍': 'palec', '🏆': 'trofej', '👑': 'koruna', '🏅': 'medaile', '💔': 'srdce', '🔓': 'odemceno', '🔒': 'zamceno', '🔥': 'plamen', '⭐': 'hvezda' };
const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI_NAMES).join('|')}|\n)`, 'u');
function setEmojiText(node, text) {
    node.replaceChildren(...String(text).split(EMOJI_RE).filter(Boolean).map(part => {
        if (part === '\n') return document.createElement('br');
        if (!EMOJI_NAMES[part]) return part;
        const s = el('span', 'emoji', part);
        s.dataset.emoji = EMOJI_NAMES[part];
        return s;
    }));
    return node;
}

function renderAccount() {
    const section = $('accountSection');
    const box = $('accountBox');
    box.innerHTML = '';
    $('accountEnd').replaceChildren();
    $('accountEnd').hidden = true;
    if (!auth.enabled) { section.style.display = 'none'; return; }
    section.style.display = 'flex';

    if (auth.user && auth.user.needsHandle) return renderHandlePicker(box);
    if (auth.user) return renderSignedIn(box);
    if (persist.pendingLogin) return renderAwaitingCode(box);
    renderSignedOut(box);
}

function renderSignedOut(box) {
    trackPromptShown('profile');
    const form = el('form', 'feedback-form');
    const input = el('input');
    input.type = 'email';
    input.placeholder = 'tvuj@email.cz';
    input.autocomplete = 'email';
    input.required = true;
    const btn = el('button', 'btn btn-primary', 'Poslat přihlašovací odkaz');
    btn.type = 'submit';
    const err = el('p', 'feedback-error');
    formError(err);
    form.append(input, err, btn);
    form.onsubmit = async (e) => {
        e.preventDefault();
        btn.disabled = true;
        const r = await apiPost('/api/auth/start', { email: input.value });
        btn.disabled = false;
        if (!r.ok) return formError(err, (r.data && r.data.error) || 'Nepodařilo se odeslat.');
        track('login_started');
        persist.pendingLogin = { id: r.data.loginId, expiresAt: r.data.expiresAt };
        savePersist();
        renderAccount();
        startLoginPolling();
    };
    const note = el('p', 'profile-note profile-note--login', 'Pošleme ti odkaz a kód. Účet propojí tvoje významy napříč zařízeními. ');
    note.append(privacyLink());
    box.append(form, note);
}

function privacyLink() {
    const a = el('a', null, 'Zásady soukromí');
    a.href = '/soukromi';
    return a;
}

function renderAwaitingCode(box) {
    box.append(el('p', 'profile-note',
        'Poslali jsme ti e-mail. Klepni na odkaz a vrať se sem — nebo rovnou opiš kód.'));
    const form = el('form', 'feedback-form');
    const input = el('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'one-time-code';
    input.maxLength = 6;
    input.placeholder = '6místný kód';
    const btn = el('button', 'btn btn-primary', 'Potvrdit kód');
    btn.type = 'submit';
    const err = el('p', 'feedback-error');
    formError(err);
    form.append(input, err, btn);
    form.onsubmit = async (e) => {
        e.preventDefault();
        btn.disabled = true;
        const r = await apiPost('/api/auth/verify',
            { loginId: persist.pendingLogin.id, code: input.value.trim() });
        btn.disabled = false;
        const st = r.data && r.data.status;
        if (st === 'ok') return onLoggedIn(r.data.user, r.data.created);
        formError(err, st === 'badcode'
            ? `Kód nesedí. Zbývá ${r.data.left} pokusů.`
            : 'Platnost vypršela, nech si poslat nový odkaz.');
        if (st !== 'badcode') { persist.pendingLogin = null; savePersist(); renderAccount(); }
    };
    const cancel = el('button', 'btn-tertiary', 'Začít znovu');
    cancel.onclick = () => { stopLoginPolling(); persist.pendingLogin = null; savePersist(); renderAccount(); };
    box.append(form, cancel);
}

function renderHandlePicker(box) {
    box.append(el('p', 'profile-note', 'Vyber si přezdívku — uvidí ji ostatní u tvých významů.'));
    const form = el('form', 'feedback-form');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = 'Přezdívka';
    input.value = persist.nick || '';
    const btn = el('button', 'btn btn-primary', 'Uložit přezdívku');
    btn.type = 'submit';
    const err = el('p', 'feedback-error');
    formError(err);
    form.append(input, err, btn);
    form.onsubmit = async (e) => {
        e.preventDefault();
        btn.disabled = true;
        const r = await apiPost('/api/me/handle', { handle: input.value.trim() });
        btn.disabled = false;
        if (!r.ok) return formError(err, (r.data && r.data.error) || 'Nepodařilo se uložit.');
        auth.user = r.data.user;
        persist.nick = r.data.user.handle;
        savePersist();
        track('handle_set');
        renderProfile();
    };
    box.append(form);
}

function renderSignedIn(box) {
    box.append(el('p', 'profile-note', `Přihlášen jako ${auth.user.handle}. Významy se ukládají k účtu.`));
    const show = el('button', 'btn btn-secondary', 'Můj veřejný profil');
    show.type = 'button';
    show.onclick = () => showPublicProfile(auth.user.handle);
    box.append(show);
    const out = el('button', 'btn btn-secondary', 'Odhlásit se');
    out.onclick = async () => {
        await apiPost('/api/auth/logout', {});
        auth.user = null;
        renderProfile();
        showToast('Odhlášeno.');
    };
    // Smazání účtu je nevratné a hráč po něm nepátrá — proto ne další velké
    // tlačítko vedle Odhlásit se, ale prostý odkaz pod čarou, spolu se
    // Zásadami soukromí. Zůstává to <button> (spouští potvrzení a mazání,
    // nikam nevede), jen bez chlopně a pozadí, jako .feedback-link výš —
    // zásady dál mluví o „tlačítku Smazat účet" a to platí beze změny.
    const del = el('button', 'account-danger-link', 'Smazat účet');
    del.type = 'button';
    del.onclick = async () => {
        if (!confirm('Opravdu smazat účet? Tvoje významy zůstanou ostatním, jen se z nich sundá tvoje jméno.')) return;
        await apiPost('/api/me/delete', {});
        track('account_deleted');
        auth.user = null;
        persist.nick = '';
        savePersist();
        renderProfile();
        showToast('Účet smazán.');
    };
    const fine = el('p', 'account-fine');
    fine.append(del, ' · ', privacyLink());
    $('accountEnd').replaceChildren(out, fine);
    $('accountEnd').hidden = false;
}

function onLoggedIn(user, created) {
    stopLoginPolling();
    auth.user = user;
    track('login_completed', { is_new: !!created });
    persist.pendingLogin = null;
    savePersist();
    backfillProfile();
    restoreResults();
    renderProfile();
    showToast('Přihlášeno!');
}

// Historie odehraná před přihlášením. Index dne jde v prvním roce jednoznačně
// převést na datum, takže profil nezačíná prázdný.
function backfillProfile() {
    const days = Object.entries(persist.results).map(([idx, score]) => {
        const d = new Date(EPOCH + Number(idx) * 86400000);
        return { d: d.toISOString().slice(0, 10), score, dayIdx: Number(idx) };
    });
    if (days.length) apiPost('/api/profile/backfill', { days });
}

// Opak backfillProfile: nové zařízení má prázdný persist.results, i když
// účet už má odehrané dny na serveru. Doplní jen chybějící indexy dní —
// nikdy nepřepíše, co je lokálně už teď (i kdyby to bylo jiné, třeba
// z rozehraného dne, co se ještě nestihl uložit) — a přepočítá sérii.
async function restoreResults() {
    const d = await apiGet('/api/me/results');
    if (!d || !Array.isArray(d.days)) return;
    let changed = false;
    for (const { dayIdx, score } of d.days) {
        if (persist.results[dayIdx] === undefined) { persist.results[dayIdx] = score; changed = true; }
    }
    if (!changed) return;
    migrateStreak(persist);
    // Doplněná historie nemá "oslavovat" úspěchy, na které se dosáhlo dávno,
    // jen na jiném zařízení — viz markAchieved.
    markAchieved(achState());
    savePersist();
    renderProfile();
}

// Odkaz z mailu se otevře v jiném prohlížeči (a na iOS má instalovaná PWA
// vlastní cookies), takže session si vyzvedne až tenhle poll.
function startLoginPolling() {
    stopLoginPolling();
    if (!persist.pendingLogin) return;
    const id = persist.pendingLogin.id;
    let left = 150;                                   // ~5 minut po 2 s
    auth.polling = setInterval(async () => {
        if (--left < 0 || !persist.pendingLogin) return stopLoginPolling();
        const d = await apiGet(`/api/auth/poll?id=${encodeURIComponent(id)}`);
        if (!d) return;
        if (d.status === 'ok') return onLoggedIn(d.user, d.created);
        if (d.status === 'expired') {
            stopLoginPolling();
            persist.pendingLogin = null;
            savePersist();
            renderAccount();
        }
    }, 2000);
}

function stopLoginPolling() {
    clearInterval(auth.polling);
    auth.polling = null;
}

/* ---------------- profil ---------------- */

function showProfile() {
    renderProfile();
    showScreen('profile');
    refreshAuth().then(() => {
        renderProfile();
        if (persist.pendingLogin && !auth.user) startLoginPolling();
    });
}

function renderProfile() {
    const played = playedDays();
    const days = played;
    const words = Object.values(persist.results).reduce((a, b) => a + b, 0);
    const pct = days ? Math.round(words / (days * WORDS_PER_DAY) * 100) : 0;
    $('collectionChip').textContent = 'Uhodnutá slova';

    // Účty zatím neběží, takže je profil lokální — statistiky jsou skutečné,
    // jen se počítají z localStorage tohohle zařízení.
    const nick = ((auth.user && auth.user.handle) || persist.nick || '').trim();
    // Avatar vybraný před přihlášením si účet vezme, pokud žádný nemá
    // (i když se první pokus po přihlášení nepovedl — zkusí se při dalším otevření).
    if (auth.user && !auth.user.avatar && Avatar.valid(persist.avatar)) {
        auth.user.avatar = persist.avatar;
        apiPost('/api/me/avatar', { avatar: persist.avatar });
    }
    // SVG skládá avatar.js jen z indexů kódu, žádný text hráče se do něj nedostane.
    const avatar = myAvatarSvg();
    if (avatar) $('profileAvatar').innerHTML = avatar;
    else $('profileAvatar').textContent = (nick || 'Host').charAt(0).toUpperCase();
    $('profileName').textContent = nick || 'Host';
    $('profileSub').textContent = persist.bestStreak > 0
        ? `Nejdelší série: ${fmtNum(persist.bestStreak)}`
        : 'Zatím bez série';

    // Kolik toho bylo uhodnuto, řekne procento samo — z kolika slov je počítané
    // (roste s odehranými dny), sem jen jako rozsah, ne jako druhé číslo.
    const total = days * WORDS_PER_DAY;
    const successLabel = total ? `úspěšnost z ${fmtNum(total)} slov v denní výzvě` : 'úspěšnost';
    const tiles = [
        [fmtNum(liveStreak()), 'dní v řadě', liveStreak() ? '' : 'stat-tile--off'],
        [fmtNum(days), 'odehraných dní'],
        [pct + ' %', successLabel],
        [fmtNum(practiceSeenCount()), `uhodnutých slov v tréninku, to je ${practiceSeenPct()} % slovníku`],
    ];
    $('profileStats').replaceChildren(...tiles.map(([value, label, extra]) => {
        const tile = el('div', extra ? 'stat-tile ' + extra : 'stat-tile');
        tile.append(el('div', 'stat-value', value), el('div', 'stat-label', label));
        return tile;
    }));

    renderAccount();
    renderAchievements();
    loadAchStats();
    loadMyDefs();
    loadMyPoints();
}

/* ---------------- úspěchy (seznam a markup v achievements.js) ---------------- */

// Plochý stav počtů pro Achievements. Série = nejdelší řada odehraných dní
// (klíče results jsou po sobě jdoucí indexy dní), Hattrick = řada dní 20/20.
// Počty z významů zná jen server (účet).
function achState() {
    const r = persist.results;
    const fenix = Object.keys(r).some(i => r[i] <= 8 && r[+i + 1] >= 17) ? 1 : 0;
    const p = (auth.user && state.points) || {};
    const st = {
        dny: playedDays(), serie: Math.max(persist.bestStreak, longestRun(r)), fenix,
        perfekt: Object.values(r).filter(n => n === WORDS_PER_DAY).length,
        perfektSerie: longestRun(r, n => n === WORDS_PER_DAY),
        avatar: Avatar.valid(myAvatar()) ? 1 : 0,
        trenink: Math.max(persist.practiceWords, p.slovTreninku || 0),
        treninkRada: persist.practiceBestRun, tezka: persist.practiceHard,
        vyznamu: p.vyznamu, ziskanych: p.ziskanychHlasu, maxHlasu: p.maxHlasu, nejlepsi: p.nejlepsi, danych: p.danychHlasu,
        ...persist.ach,
    };
    // Získaný zůstane, i když počet pak klesne (odebraný hlas, jiné zařízení).
    for (const a of Achievements.LIST) if (persist.achGot[a.id]) st[a.v] = Math.max(st[a.v] || 0, a.goal);
    return st;
}

// Nově splněné (dosud ne v achGot) označí za získané (datum + tečka
// achUnseen) a vrátí jejich id — volající rozhodne, jestli je i zařadit do
// fronty na oznámení. syncAchievements to dělá vždycky po prvním spuštění;
// data, co dorazí později (restoreResults, refreshAuth, loadMyPoints), jen
// potichu označí — jinak by appka "oslavovala" úspěch starý měsíce, jen
// poprvé zjištěný na tomhle zařízení.
function markAchieved(st) {
    const got = [];
    for (const a of Achievements.LIST) {
        if (persist.achGot[a.id] || !Achievements.done(a, st)) continue;
        persist.achGot[a.id] = todayStr();
        persist.achUnseen.push(a.id);
        got.push(a.id);
    }
    return got;
}

// Zapíše nově splněné (datum + nové) a rozsvítí tečku na Profilu.
function syncAchievements() {
    const st = achState();
    const got = markAchieved(st);
    // Úspěchy z historie (první spuštění s úspěchy) se neoznamují, jen svítí tečkou.
    if (persist.achInit) {
        persist.achQueue.push(...got);
        got.forEach(id => track('achievement_unlocked', { id }));
    }
    persist.achInit = true;
    if (got.length) savePersist();
    reportAchievements();
    $('topBar').querySelector('.icon-btn').classList.toggle('icon-btn--dot', persist.achUnseen.length > 0);
    return st;
}

// Serveru jen id získaných: „Má ho X % hráčů" a u účtu odznaky na veřejném
// profilu. Neodeslané se zkusí příště, po přihlášení se pošle všechno znovu.
function reportAchievements() {
    const who = (auth.user && auth.user.id) || '';
    if (persist.achSentFor !== who && auth.user) { persist.achSent = []; persist.achSentFor = who; }
    const ids = Object.keys(persist.achGot).filter(id => !persist.achSent.includes(id));
    if (!ids.length || state.achPosting) return;
    state.achPosting = true;
    apiPost('/api/achievements', { ids }).then(r => {
        state.achPosting = false;
        if (!r.ok) return;
        persist.achSent.push(...ids);
        savePersist();
    });
}

// Oznámení nového úspěchu nikdy nepřeruší hru ani jiný sheet. Čeká ve frontě
// na klidnou chvíli: konec odhalení výsledku, návrat z tréninku, zavřený sheet.
// Oslava je sheet nad obrazovkou, kam hráč stejně šel, po zavření tam zůstane.
function announceAchievements() {
    if (!persist.achQueue.length || $('game').classList.contains('active')) return;
    if (document.querySelector('.modal.active') || revealTimeouts.length) return;
    openAchievement(persist.achQueue[0]);
}

function whenCalm(ms = 450) { setTimeout(announceAchievements, ms); }

// „Má ho X % hráčů", hodinová cache na serveru; stačí jednou za načtení.
function loadAchStats() {
    if (state.achStats !== undefined) return Promise.resolve(state.achStats);
    state.achStats = null;
    return apiGet('/api/achievements/stats').then(d => (state.achStats = d && d.pct ? d : null));
}

function achHasText(id) {
    const s = state.achStats;
    if (!s || !Object.keys(s.pct).length) return '';
    const v = s.pct[id];
    // sám ho má, i když ho server ještě nezapočítal (statistiky mají hodinovou cache)
    if (!v) return persist.achGot[id] ? 'Patříš mezi první, kdo ho má' : 'Zatím ho nemá nikdo';
    return v < 1 ? 'Má ho méně než 1 % hráčů' : `Má ho ${fmtNum(Math.round(v))} % hráčů`;
}

const myAvatarSvg = () => Avatar.svg(myAvatar());
const achTile = (a, st) => Achievements.tile(a, st, { avatar: myAvatarSvg(), isNew: persist.achUnseen.includes(a.id) });

function renderAchievements() {
    const st = syncAchievements();
    const L = Achievements.LIST, done = a => Achievements.done(a, st);
    const got = L.filter(done);
    const count = `${got.length} z ${L.length}`;
    $('achCount').textContent = count;
    $('achCountBar').style.width = got.length / L.length * 100 + '%';
    // V profilu: nové, pak nejčerstvější, pak nejbližší zamčené — ať je co dohánět.
    const byDate = got.slice().sort((a, b) => (persist.achGot[b.id] || '').localeCompare(persist.achGot[a.id] || ''));
    const near = achNear(st);
    const pick = [...got.filter(a => persist.achUnseen.includes(a.id)), ...byDate, ...near, ...L.filter(a => !done(a))];
    $('achProfileGrid').innerHTML = [...new Set(pick)].slice(0, 8).map(a => achTile(a, st)).join('');

    $('achSumCount').textContent = `${got.length}/${L.length}`;
    $('achNearSection').hidden = !near.length;
    $('achNear').innerHTML = near.slice(0, 3).map(a => {
        const left = a.goal - Achievements.val(a, st);
        return `<button class="ach-near-item" data-ach="${a.id}">${Achievements.badge(a, st)}<span class="ach-near-body">
            <span class="ach-near-name">${a.name}</span><span class="ach-bar"><i style="width:${Achievements.pct(a, st) * 100}%"></i></span>
            <span class="ach-near-left">Ještě ${fmtNum(left)} ${Achievements.unitOf(a, left)}</span></span></button>`;
    }).join('');
    $('achGroups').innerHTML = Achievements.GROUPS.map(([g, title]) => {
        const list = L.filter(a => a.g === g);
        return `<div class="profile-section"><h3 class="profile-section-title">${title} <small>${list.filter(done).length} z ${list.length}</small></h3>
            <div class="ach-grid">${list.map(a => achTile(a, st)).join('')}</div></div>`;
    }).join('');
}

// Zamčené s rozjetým postupem, nejbližší napřed (tajné se neprozrazují).
function achNear(st) {
    return Achievements.LIST.filter(a => !a.secret && !Achievements.done(a, st) && Achievements.val(a, st) > 0)
        .sort((a, b) => Achievements.pct(b, st) - Achievements.pct(a, st));
}

function showAchievements() {
    renderAchievements();
    showScreen('achievements');
    window.scrollTo(0, 0);
}

// Detail v sheetu. Poprvé otevřený nový úspěch = oslava „Nový úspěch!".
function openAchievement(id) {
    const A = Achievements, a = A.LIST.find(x => x.id === id);
    if (!a) return;
    const st = achState();
    const locked = !A.done(a, st), secret = A.hidden(a, st);
    const celebrate = persist.achUnseen.includes(id);
    persist.achQueue = persist.achQueue.filter(x => x !== id);
    if (celebrate) {
        persist.achUnseen = persist.achUnseen.filter(x => x !== id);
        savePersist();
        renderAchievements();
    }
    $('achTitle').textContent = secret ? 'Tajný úspěch' : a.name;
    const v = A.val(a, st), rarity = locked ? 'locked' : a.r;
    let info;
    if (!locked) {
        const d = persist.achGot[id];
        info = `<p class="ach-meta">${celebrate ? 'Získáno právě teď' : d ? 'Získáno ' + d.split('-').reverse().map(Number).join('. ') : ''}</p>`;
    } else if (a.goal > 1) {
        info = `<div class="ach-progress"><div class="ach-progress-label"><span>${fmtNum(v)} / ${fmtNum(a.goal)} ${A.unitOf(a, a.goal)}</span>
            <b>${v ? `Ještě ${fmtNum(a.goal - v)}!` : ''}</b></div><div class="ach-bar"><i style="width:${A.pct(a, st) * 100}%"></i></div></div>`;
    } else {
        info = `<p class="ach-meta">${secret ? 'Na tenhle se přichází samo, nebo náhodou.' : 'Zatím zamčeno'}</p>`;
    }
    $('achBody').innerHTML = `${celebrate ? '<p class="ach-kicker">Nový úspěch!</p>' : ''}
        <div class="ach-stage ach--${rarity}${locked ? ' is-locked' : ''} pop">${A.badge(a, st, myAvatarSvg())}</div>
        <span class="ach-rarity ach--${rarity}">${A.RARITY[a.r]}</span>
        <p class="ach-desc">${secret ? 'Nápověda: ' + a.secret : a.desc}</p>
        ${info}
        <p class="ach-meta" id="achHas">${achHasText(id)}</p>
        ${celebrate ? '<button class="btn btn-play ach-ok" onclick="closeModal()">Paráda!</button>' : ''}`;
    openModal('achModal');
    loadAchStats().then(() => { if ($('achTitle').dataset.id === id) $('achHas').textContent = achHasText(id); });
    $('achTitle').dataset.id = id;
    if (celebrate) { playWinSound(); haptic('win'); }
}

document.addEventListener('click', e => {
    const t = e.target.closest('[data-ach]');
    if (t) openAchievement(t.dataset.ach);
});

// Body (viz worker/src/profile.js) má jen účet. Ve hře nikde jinde nejsou.
async function loadMyPoints() {
    const pill = $('profilePoints');
    const d = auth.user && await apiGet('/api/me/points');
    if (d && Number.isInteger(d.total)) {
        const wasPoints = !!state.points;
        state.points = d;
        // Body účtu poprvé zjištěné v týhle relaci nemají "oslavovat" úspěch
        // starý měsíce (významy, hlasy, trénink) — viz markAchieved.
        if (!wasPoints) { markAchieved(achState()); savePersist(); }
        renderAchievements();
        whenCalm();
    }
    pill.hidden = !(d && Number.isInteger(d.total));
    if (!pill.hidden) setEmojiText(pill, `⭐ ${fmtNum(d.total)} ${plural(d.total, 'bod', 'body', 'bodů')}`);
}

// Profil: oblak štítků (slovo + palce) s nejlépe hodnocenými významy a odkaz
// na obrazovku se všemi. Celé karty s úpravou jsou až tam.
const PROFILE_TAGS = 12;
async function loadMyDefs() {
    const box = $('profileDefs');
    box.className = 'empty-card';
    box.textContent = 'Načítám…';
    const data = await apiGet(`/api/defs/mine?sort=votes&limit=${PROFILE_TAGS}`);
    if (!data || !data.defs) {
        box.textContent = 'Významy se teď nepodařilo načíst.';
        return;
    }
    const total = data.total ?? data.defs.length;
    if (!total) {
        box.textContent = 'Zatím žádný. V tréninku se ti po každém slově nabídne, ať nějaký přidáš.';
        return;
    }
    box.className = 'def-cloud';
    box.replaceChildren(...data.defs.map(d => {
        const tag = el('span', 'def-tag' + (d.hidden ? ' def-tag--hidden' : ''));
        tag.append(el('span', 'def-tag-word', d.word), setEmojiText(el('span', 'def-tag-votes'), `👍 ${d.votes}`));
        return tag;
    }));
    const all = el('button', 'btn-tertiary def-cloud-all', `Všechny moje významy (${fmtNum(total)})`);
    all.type = 'button';
    all.onclick = () => showMyDefs(0);
    box.appendChild(all);
}

// Obrazovka Moje významy: po MY_DEFS_PAGE, nejnovější nahoře, s úpravou.
const MY_DEFS_PAGE = 10;
async function showMyDefs(page) {
    state.myDefsPage = page;
    showScreen('myDefs');
    window.scrollTo(0, 0);
    const list = $('myDefsList');
    list.replaceChildren(el('li', 'def-empty', 'Načítám…'));
    const data = await apiGet(`/api/defs/mine?limit=${MY_DEFS_PAGE}&offset=${page * MY_DEFS_PAGE}`);
    if (state.myDefsPage !== page) return;                // mezitím se přeplo jinam
    const pager = $('myDefsPager');
    if (!data || !data.defs) {
        list.replaceChildren(el('li', 'def-empty', 'Významy se teď nepodařilo načíst.'));
        pager.hidden = true;
        return;
    }
    const pages = Math.max(1, Math.ceil(data.total / MY_DEFS_PAGE));
    if (page > 0 && page >= pages) return showMyDefs(pages - 1);
    $('myDefsSummary').textContent = data.total
        ? `${fmtNum(data.total)} ${plural(data.total, 'význam', 'významy', 'významů')}, nejnovější nahoře.`
        : 'Zatím žádný. V tréninku se ti po každém slově nabídne, ať nějaký přidáš.';
    list.replaceChildren(...data.defs.map(myDefItem));
    pager.hidden = pages < 2;
    $('myDefsPrev').disabled = page === 0;
    $('myDefsNext').disabled = page >= pages - 1;
    $('myDefsInfo').textContent = `${page + 1} / ${pages}`;
}

function myDefItem(d) {
    const li = el('li', 'def-item mine');
    const head = el('div', 'def-word', d.word);
    if (d.hidden) head.appendChild(el('span', 'def-hidden', 'skrytý po nahlášení'));
    const p = el('p', 'wd-text', d.text);                  // cizí text vždy přes textContent
    const meta = el('div', 'wd-meta');
    const votes = setEmojiText(el('span'), `👍 ${d.votes}`);
    // po uložení se počet hlasů může vynulovat — překreslit jen tuhle kartu
    meta.append(votes, editBtn(d, li, p, () => setEmojiText(votes, `👍 ${d.votes}`)));
    li.append(head, p, meta);
    return li;
}

// Veřejný profil jako obrazovka hry, ne nová karta. Obsah renderuje server —
// stejný markup jako sdílená stránka /u/<přezdívka>; texty hráčů v něm
// escapuje worker/src/profile.js. Zpět vede tam, odkud se přišlo: bez `back`
// do vlastního profilu, od autora významu zpátky do tréninku.
// Sdílení profilu: ikona vpravo nahoře na obrazovce veřejného profilu.
async function sharePublicProfile() {
    const handle = state.profileHandle;
    // Profil žije na serveru, kde je účet — ne na FALLBACK_URL pro sdílení z localhostu.
    const link = `${location.origin}/u/${encodeURIComponent(handle)}`;
    track('share_clicked', { method: 'link' });
    if (navigator.share) { try { await navigator.share({ title: `${handle} — 20 slov`, url: link }); } catch (e) {} return; }
    try { await navigator.clipboard.writeText(link); showToast('Odkaz na profil zkopírován.'); }
    catch (e) { showToast(link); }
}

async function showPublicProfile(handle, back) {
    state.profileHandle = handle;
    state.profileBack = back || null;
    const body = $('publicProfileBody');
    body.replaceChildren(el('p', 'profile-note', 'Načítám profil…'));
    showScreen('publicProfile');
    scrollTo(0, 0);
    try {
        const res = await fetch(`/u/${encodeURIComponent(handle)}?cast=1`, { cache: 'no-store' });
        const html = await res.text();
        if (state.profileHandle === handle) body.innerHTML = html;   // mezitím se otevřel jiný
    } catch (e) {
        body.replaceChildren(el('p', 'profile-note', 'Profil se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.'));
    }
}

function leavePublicProfile() {
    const back = state.profileBack;
    state.profileBack = null;
    state.profileHandle = null;
    back ? back() : showProfile();
}

// Z mezihry tréninku na profil autora a zpátky. Panel po slově i sheet
// s významy zůstanou, jak byly; odpočet na Další se zruší jako u významů.
function openAuthorProfile(handle) {
    holdWordDone();
    const ov = $('wordDoneOverlay');
    const fromSheet = $('defsModal').classList.contains('active');
    if (fromSheet) closeDefs();
    ov.style.display = 'none';
    showPublicProfile(handle, () => {
        showScreen('game');
        ov.style.display = '';
        if (fromSheet) openDefs();
    });
}

// Úprava profilu: současný avatar, nebo náhodný pro toho, kdo žádný nemá;
// „Ukázat jiného" poskládá dalšího. Uloží se až „Uložit", spolu s přezdívkou.
function showProfileEdit() {
    const current = myAvatar();
    rollAvatar(Avatar.valid(current) ? current : Avatar.random());
    $('profileNickInput').value = (auth.user && auth.user.handle) || persist.nick || '';
    formError($('profileNickError'));
    showScreen('profileEdit');
    scrollTo(0, 0);
}

function rollAvatar(code = Avatar.random()) {
    state.avatarDraft = code;
    $('avatarStage').innerHTML = Avatar.svg(code);
}

// Přihlášenému se obojí uloží k účtu (server přepíše přezdívku i u jeho
// významů a hlídá, ať je volná), hostovi jen do zařízení. Posílá se jen, co se
// změnilo; přezdívka první, protože jen ta může narazit. Na server se čeká,
// ať ho refreshAuth v showProfile nepřepíše starým.
async function saveProfile(e) {
    e.preventDefault();
    const nick = $('profileNickInput').value.trim().slice(0, 20);
    const avatar = state.avatarDraft;
    const err = $('profileNickError');
    formError(err);
    if (auth.user) {
        const steps = [];
        if (nick !== auth.user.handle) steps.push(['/api/me/handle', { handle: nick }]);
        if (avatar !== auth.user.avatar) steps.push(['/api/me/avatar', { avatar }]);
        $('profileSaveBtn').disabled = true;
        for (const [path, body] of steps) {
            const r = await apiPost(path, body);
            if (!r.ok) {
                $('profileSaveBtn').disabled = false;
                return formError(err, (r.data && r.data.error) || 'Nepodařilo se uložit. Zkus to znovu.');
            }
            auth.user = r.data.user;
        }
        $('profileSaveBtn').disabled = false;
    }
    persist.nick = nick;
    persist.avatar = avatar;
    savePersist();
    syncAchievements();
    showProfile();
    showToast('Profil uložený.');
}

function playToday() {
    todayDone() ? showWelcome() : startGame();
}

/* ---------------- start hry ---------------- */

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
const shuffleCopy = (arr) => shuffleInPlace(arr.slice());

// Písmena kola nikdy nezačnou ve správném pořadí.
function shuffleLettersOfWord(arr) {
    const original = lettersOf(state.words[state.wordIdx] || '');
    for (let attempts = 0; attempts < 200; attempts++) {
        if (shuffleInPlace(arr).join('') !== original) break;
    }
    return arr;
}

function startGame() {
    const today = todayStr();
    state.gen++;
    state.mode = 'daily';
    $('game').classList.remove('practice');
    $('closeGameBtn').style.display = 'flex';
    $('closeGameBtn').setAttribute('aria-label', 'Ukončit výzvu');
    const idx = dayIndex(today);
    state.words = dayWords(idx);

    const d = persist.day;
    if (d && !d.done && d.date === today && d.dayIdx === idx && d.wordIdx < WORDS_PER_DAY) {
        // rozehraný dnešek — pokračujeme, kde jsme skončili
        state.wordIdx = d.wordIdx;
        state.marks = d.marks.slice();
        state.time = Math.max(1, Math.min(START_TIME, d.time || START_TIME));
        state.resumed = true;
    } else {
        state.wordIdx = 0;
        state.marks = [];
        state.time = START_TIME;
        state.resumed = false;
        persist.day = { date: today, dayIdx: idx, wordIdx: 0, marks: [], time: START_TIME, done: false, perfect: false };
        savePersist();
    }
    state.solved = state.marks.filter(Boolean).length;
    state.playSec = 0;
    track('day_started', { day_idx: idx, resumed: state.resumed });
    placeGameGrid('game');
    showScreen('game');
    if (IS_DESKTOP && !persist.kbHintShown) {
        persist.kbHintShown = true;
        savePersist();
        setTimeout(() => showToast('Můžeš psát i na klávesnici'), 800);
    }
    loadWord();
}

// Obtížnost tréninku = kolik nejčastějších slov z PRACTICE_WORDS se hraje
// (pool je seřazený podle frekvence). Střední je přesně rozsah denní výzvy.
// Lehká navíc jen do 5 písmen: u přesmyčky rozhoduje hlavně délka (5 písmen =
// 120 pořadí, 7 = 5040) a mezi 3000 nejčastějšími je 60 % slov delších.
const PRACTICE_LEVELS = {
    lehka:   { label: 'Lehká',   size: 3000, maxLetters: 5 },   // 1215 slov
    stredni: { label: 'Střední', size: TOTAL_WORDS },
    tezka:   { label: 'Těžká',   size: PRACTICE_WORDS.length },
};
const practiceLevel = () => PRACTICE_LEVELS[persist.practiceLevel] || PRACTICE_LEVELS.stredni;

// Různá uhodnutá slova tréninku: bitmapa nad PRACTICE_WORDS v base64
// (15 000 bitů ≈ 2,5 kB). Jen z nich dává smysl „X % slovníku" — počítadlo
// practiceWords sčítá i opakování.
let practiceIndex = null;
const practiceRank = (word) => (practiceIndex = practiceIndex || new Map(PRACTICE_WORDS.map((w, i) => [w, i]))).get(word);
const seenBytes = () => persist.practiceSeen
    ? Uint8Array.from(atob(persist.practiceSeen), c => c.charCodeAt(0))
    : new Uint8Array(Math.ceil(PRACTICE_WORDS.length / 8));

function markPracticeSeen(word) {
    const i = practiceRank(word);
    if (i === undefined) return;
    const bytes = seenBytes();
    bytes[i >> 3] |= 1 << (i & 7);
    persist.practiceSeen = btoa(String.fromCharCode(...bytes));
}

function practiceSeenCount() {
    let n = 0;
    for (let b of seenBytes()) for (; b; b &= b - 1) n++;
    return n;
}

// Pod 1 % dvě desetinná místa (3 slova = 0,02 %), jinak jedno — první desítky
// slov nesmí vypadat jako „0 %".
function practiceSeenPct() {
    const pct = practiceSeenCount() / PRACTICE_WORDS.length * 100;
    return pct.toLocaleString('cs-CZ', { maximumFractionDigits: pct < 1 ? 2 : 1 });
}

function openPracticePicker() {
    $$('#practiceModal .level-option').forEach(b =>
        b.classList.toggle('current', b.dataset.level === persist.practiceLevel));
    openModal('practiceModal');
}

function pickPracticeLevel(level) {
    persist.practiceLevel = level;
    savePersist();
    closeModal();
    startPracticeGame();
}

function startPracticeGame() {
    const level = practiceLevel();
    const pool = PRACTICE_WORDS.slice(0, level.size)
        .filter(w => !level.maxLetters || lettersOf(w).length <= level.maxLetters);
    state.gen++;
    state.mode = 'practice';
    $('game').classList.add('practice');
    $('closeGameBtn').style.display = 'flex';
    $('closeGameBtn').setAttribute('aria-label', 'Ukončit trénink');
    refreshAuth();                       // mezihra podle něj popisuje odkaz na významy
    state.pool = pool;
    state.practiceQueue = shuffleCopy(pool);
    state.words = [];
    state.wordIdx = 0;
    state.marks = [];
    state.solved = 0;
    state.practiceCount = 0;
    state.lostStreak = 0;
    state.playSec = 0;
    track('practice_started', { level: persist.practiceLevel });
    clearTimeout(state.nextTimer);
    state.nextTimer = null;
    hideWordDone();
    state.time = START_TIME;
    stopConfetti();
    placeGameGrid('game');
    showScreen('game');
    loadWord();
    prefetchDefs();
}

// Bere slova z promíchané fronty bez opakování; když dojde, znovu promíchá
// celý pool (a snaží se nezopakovat úplně poslední slovo hned znovu).
function pickPracticeWord() {
    if (state.practiceQueue.length === 0) {
        state.practiceQueue = shuffleCopy(state.pool);
        const last = state.words[state.wordIdx - 1];
        if (state.practiceQueue.length > 1 && state.practiceQueue[0] === last) {
            [state.practiceQueue[0], state.practiceQueue[1]] = [state.practiceQueue[1], state.practiceQueue[0]];
        }
    }
    return state.practiceQueue.pop();
}

/* ---------------- kolo (jedno slovo) ---------------- */

function loadWord() {
    if (state.mode === 'daily' && state.wordIdx >= WORDS_PER_DAY) return finishDay();
    if (state.mode === 'practice' && !state.words[state.wordIdx]) {
        state.words[state.wordIdx] = pickPracticeWord();
    }
    const target = state.words[state.wordIdx];
    state.letters = lettersOf(target).split('');
    state.selected = [];
    state.processing = false;
    state.shuffledThisWord = false;
    shuffleLettersOfWord(state.letters);
    const isResume = state.resumed;
    state.resumed = false;
    const shouldAnimate = !isResume && state.wordIdx > 0;
    const leftover = state.time;
    renderLetters(shouldAnimate);
    renderGameGrid();
    if (shouldAnimate && leftover < START_TIME) {
        updateUI();
        animateTimerUp(leftover);
    } else {
        if (!isResume) state.time = START_TIME;
        startTimer();
    }
}

function getMaxPerRow(n) {
    if (n <= 4) return 2;
    if (n <= 6) return 3;
    if (n <= 9) return 4;
    return 5;
}

function letterSize(n) {
    if (n <= 8) return { d: 76, f: 34 };
    if (n <= 12) return { d: 62, f: 28 };
    return { d: 50, f: 23 };
}

// Sloty podle celého hesla: nepísmenné znaky (mezera, tečka, pomlčka)
// jsou pevně předvyplněné a neskládají se.
function renderSlots(container, target, animate) {
    container.innerHTML = '';
    const chars = [...target];
    const n = chars.length;
    const avail = Math.min(window.innerWidth - 48, 420);
    const perRow = Math.min(n, 10);
    const size = Math.max(24, Math.min(54, Math.floor((avail - (perRow - 1) * 8) / perRow)));   // mezera 8 = .word-display gap
    chars.forEach((ch, i) => {
        const s = document.createElement('div');
        const locked = !LETTER_RE.test(ch);
        s.className = 'answer-slot' + (locked ? ' locked filled' : '') + (animate ? ' entering' : '');
        if (locked) s.textContent = ch === ' ' ? '␣' : ch;
        if (animate) s.style.animationDelay = (i * 40) + 'ms';
        s.style.width = size + 'px';
        s.style.height = Math.round(size * 1.08) + 'px';
        s.style.fontSize = Math.round(size * 0.56) + 'px';
        container.appendChild(s);
    });
}

function renderLetters(animate) {
    const row = $('letterRow');
    row.innerHTML = '';
    const n = state.letters.length;
    const cols = getMaxPerRow(n);
    const { d, f } = letterSize(n);
    row.style.width = (cols * d + (cols - 1) * 6) + 'px';

    renderSlots($('wordDisplay'), state.words[state.wordIdx], animate);

    state.letters.forEach((letter, i) => {
        const el = document.createElement('div');
        el.className = 'letter' + (animate ? ' entering' : '');
        el.textContent = letter;
        el.dataset.index = i;
        el.style.width = d + 'px';
        el.style.height = d + 'px';
        el.style.fontSize = f + 'px';
        if (animate) el.style.animationDelay = (i * 40) + 'ms';
        el.addEventListener('pointerdown', e => {
            if (e.target !== el) return; // dotyk šel na haptický přepínač níže, ten si volá handleTap sám
            e.preventDefault();
            handleTap(el);
        });
        row.appendChild(el);
        addLetterHapticOverlay(el); // až po appendChild — getComputedStyle potřebuje připojený element
    });
}

// Skutečný, neviditelný přepínač přes celé písmenko: na iOS 26.5+ funguje
// nativní haptika jen na opravdový dotyk switch prvku, ne na programové
// kliknutí (viz iosTap výše). 'input' event pak spustí stejnou herní logiku.
function addLetterHapticOverlay(el) {
    if (NEEDS_SWITCH) hapticSwitch(el, 'border-radius:inherit;').addEventListener('input', () => handleTap(el));
}

function clearIncorrectState() {
    if (!state.incorrectTimeout) return;
    clearTimeout(state.incorrectTimeout);
    state.incorrectTimeout = null;
    $('wordDisplay').classList.remove('shake');
    $('letterRow').classList.remove('shake');
    $$('#letterRow .letter').forEach(l => l.classList.remove('incorrect', 'selected'));
    state.selected = [];
}

function selectLetter(el) {
    if (state.incorrectTimeout) { clearIncorrectState(); updateUI(); }
    const idx = +el.dataset.index;
    if (state.selected.includes(idx)) return;
    haptic('tap');
    state.selected.push(idx);
    playLetterSound(state.selected.length);
    el.classList.add('selected');
    updateUI();
}

function handleTap(el) {
    if (state.processing) return;
    const idx = +el.dataset.index;
    const pos = state.selected.indexOf(idx);
    if (pos !== -1) {
        haptic('tap');
        playRemoveSound();
        state.selected.splice(pos);
        $$('#letterRow .letter').forEach(l => {
            if (!state.selected.includes(+l.dataset.index)) l.classList.remove('selected');
        });
    } else {
        selectLetter(el);
        if (state.selected.length === state.letters.length) checkWord();
    }
    if (!state.processing) updateUI();
}

// Klepnutí na skládané slovo (i Backspace) odebere poslední písmeno.
// Špatně složené slovo se stejně celé maže samo, klepnutí jen nečeká.
function removeLastLetter() {
    if (state.processing || !state.selected.length) return;
    if (state.incorrectTimeout) { clearIncorrectState(); updateUI(); return; }
    haptic('tap');
    playRemoveSound();
    const idx = state.selected.pop();
    const tile = $('letterRow').querySelector(`.letter[data-index="${idx}"]`);
    if (tile) tile.classList.remove('selected');
    updateUI();
}

function resetSelection() {
    if (state.processing) return;
    clearIncorrectState();
    state.selected = [];
    $$('#letterRow .letter').forEach(l => l.classList.remove('selected'));
    updateUI();
}

// Které slovo hráč složil: hledané, uznaná přesmyčka, nebo null. Mezihra
// ukazuje kostky i význam právě toho, co složil, ne hledaného slova.
function acceptedWord(word, target) {
    if (word === lettersOf(target)) return target;
    // Přesmyčky uznává jen trénink. Denní výzva je soutěž — všichni mají dnes
    // stejných 20 slov, takže musí padnout přesně to hledané.
    if (state.mode !== 'practice') return null;
    const alts = (typeof ALTS !== 'undefined' && ALTS[target]) || [];
    return alts.find(a => lettersOf(a) === word) || null;
}

function checkWord() {
    if (state.processing) return;
    const word = state.selected.map(i => state.letters[i]).join('');
    const target = state.words[state.wordIdx] || '';
    const solved = word.length === state.letters.length && acceptedWord(word, target);

    if (!solved) {
        if (state.mode === 'daily' && persist.day) persist.day.wrong = (persist.day.wrong || 0) + 1;   // úspěch Čistá práce
        haptic('error');
        playErrorSound();
        $('wordDisplay').classList.add('shake');
        $('letterRow').classList.add('shake');
        $$('#letterRow .letter.selected').forEach(l => l.classList.add('incorrect'));
        state.incorrectTimeout = setTimeout(() => {
            $('wordDisplay').classList.remove('shake');
            $('letterRow').classList.remove('shake');
            $$('#letterRow .letter.selected').forEach(l => l.classList.remove('incorrect'));
            resetSelection();
            state.incorrectTimeout = null;
        }, 400);
        return;
    }

    state.processing = true;
    clearInterval(state.timer);
    haptic('success');
    playSuccessSound();
    $('wordDisplay').classList.add('pulse', 'found');
    $('letterRow').classList.add('pulse');
    $$('#letterRow .letter.selected').forEach(l => l.classList.add('correct'));

    state.wordIdx++;
    state.solved++;
    state.marks.push(true);
    if (state.mode === 'daily' && persist.day) (persist.day.left ||= []).push(state.time);   // zbylý čas na slovo (statistiky)
    // Úspěch z denní výzvy se oznamuje až po ní. Do konce dne čeká u dne:
    // v persist.ach by ho po reloadu uprostřed hry (iOS Safari po návratu
    // z jiné aplikace) našel start a oznámil na úvodu dřív, než hráč dohraje.
    const ach = state.mode === 'daily' && persist.day ? (persist.day.ach ||= {}) : persist.ach;
    if (START_TIME - state.time <= 3) ach.blesk = 1;
    if (state.time <= 1) ach.chlup = 1;
    if (state.mode === 'practice') {
        state.practiceCount++;
        persist.practiceWords++;   // trénink se jinak nikam neukládá
        persist.practiceBestRun = Math.max(persist.practiceBestRun, state.practiceCount);
        if (persist.practiceLevel === 'tezka') persist.practiceHard++;
        if (solved !== target) persist.ach.presmycka = 1;
        if (auth.user) apiPost('/api/training', { playedOn: todayStr() });   // body v profilu
        markPracticeSeen(target);
        savePersist();
        syncAchievements();
    }
    updateGameGrid(state.marks.length - 1);
    saveDayProgress();

    setTimeout(() => {
        $('wordDisplay').classList.remove('pulse');
        $('letterRow').classList.remove('pulse');
        const els = [$('wordDisplay'), ...$$('#letterRow .letter')];
        els.forEach(el => {
            el.classList.remove('entering');
            el.style.animation = 'none';
            el.style.transition = 'none';
            el.style.opacity = '1';
            el.style.transform = 'scale(1)';
        });
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                els.forEach(el => {
                    el.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
                    el.style.opacity = '0';
                    el.style.transform = 'scale(0.85)';
                });
            });
        });
    }, 450);

    const genOk = state.gen;
    // V tréninku vyjede panel mezihry hned po zeleném bliknutí.
    if (state.mode === 'practice') setTimeout(() => showWordDone(solved, genOk, true), 450);
    setTimeout(() => {
        if (state.gen !== genOk) return;
        $('wordDisplay').classList.remove('found');
        if (state.mode === 'practice') return;   // styl slova vrátí nextWord, ať pod panelem neprobleskne
        $('wordDisplay').style.cssText = '';
        loadWord();
    }, 750);
}

// Čas vypršel: červený budík se chvilku otřese, jako když zvoní, a pak
// praskne — střepy (klony časovače oříznuté clip-pathem na trojúhelníky),
// pár kostek a tlaková vlna se rozletí po displeji po balistické dráze a
// spadnou za panel mezihry (vrstva z-index 999, panel 1000). Původní časovač
// zůstává: hned na jeho místě naskočí bílá 00 a klasicky se převine na 30 s.
// Další slovo pak začne rovnou odpočítávat (loadWord vidí plný čas).
function explodeTimer(gen) {
    const src = document.querySelector('#progress .gp-timer');
    if (!src || !src.animate || REDUCED_MOTION.matches) return;
    src.animate([
        { transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-10deg) scale(1.06)' },
        { transform: 'rotate(9deg) scale(1.08)' }, { transform: 'rotate(-7deg) scale(1.1)' },
        { transform: 'rotate(5deg) scale(1.12)' }, { transform: 'rotate(0) scale(1.14)' },
    ], { duration: 320, easing: 'ease-in-out' });
    setTimeout(() => {
        if (state.gen !== gen || !state.processing || !src.isConnected) return;   // mezitím už další slovo?
        const r = src.getBoundingClientRect();
        const layer = el('div');
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999;overflow:hidden';
        document.body.appendChild(layer);
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const W = innerWidth, H = innerHeight;
        const rnd = (a, b) => a + Math.random() * (b - a);
        // šikmý vrh: x = vx·t, y = vy·t + g·t² — nahoru a do stran, pak dolů za panel
        const fly = (node, ux, uy, power, ms, spin) => {
            const vx = ux * power * W * .55 + rnd(-.08, .08) * W;
            const vy = (uy - .9) * power * H * .45;
            const g = rnd(.9, 1.3) * H;
            node.animate([0, .2, .4, .6, .8, 1].map(t => ({
                offset: t,
                transform: `translate(${vx * t}px, ${vy * t + g * t * t}px) rotate(${spin * t}deg) scale(${1 - .25 * t})`,
                opacity: t < .7 ? 1 : 1 - (t - .7) / .3,
            })), { duration: ms, easing: 'linear', fill: 'forwards' });
        };

        // střepy: mřížka 4×3 s rozházenými vnitřními vrcholy, každé pole = 2 trojúhelníky
        const C = 4, R = 3, pts = [];
        for (let j = 0; j <= R; j++) for (let i = 0; i <= C; i++) {
            const inner = i > 0 && i < C && j > 0 && j < R;
            pts.push([i / C * 100 + (inner ? rnd(-9, 9) : 0), j / R * 100 + (inner ? rnd(-12, 12) : 0)]);
        }
        const P = (i, j) => pts[j * (C + 1) + i];
        for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
            const [a, b, c, d] = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
            const tris = Math.random() < .5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
            for (const t of tris) {
                const mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3;
                const shard = src.cloneNode(true);
                shard.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`
                    + `margin:0;box-sizing:border-box;transform-origin:${mx}% ${my}%;`
                    + `clip-path:polygon(${t.map(([x, y]) => `${x}% ${y}%`).join(',')})`;
                layer.appendChild(shard);
                fly(shard, (mx - 50) / 50, (my - 50) / 50, rnd(.55, 1), rnd(1300, 1800), rnd(-540, 540));
            }
        }
        // kostky jako úlomky a tlaková vlna
        const colors = ['var(--red)', 'var(--orange)', 'var(--gold)', 'var(--red-lip)'];
        for (let k = 0; k < 14; k++) {
            const s = rnd(10, 18), ang = rnd(0, Math.PI * 2);
            const bit = el('div');
            bit.style.cssText = `position:absolute;left:${cx - s / 2}px;top:${cy - s / 2}px;width:${s}px;height:${s}px;`
                + `border-radius:${s / 3.5}px;background:${colors[k % colors.length]}`;
            layer.appendChild(bit);
            fly(bit, Math.cos(ang), Math.sin(ang), rnd(.6, 1.2), rnd(1100, 1600), rnd(-600, 600));
        }
        const ring = el('div'), d = Math.max(r.width, r.height);
        ring.style.cssText = `position:absolute;left:${cx - d / 2}px;top:${cy - d / 2}px;width:${d}px;height:${d}px;`
            + 'border-radius:50%;border:8px solid var(--orange)';
        layer.appendChild(ring);
        ring.animate([{ transform: 'scale(.3)', opacity: .9 }, { transform: 'scale(1.8)', opacity: 0 }],
            { duration: 500, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
        haptic('miss');
        setTimeout(() => layer.remove(), 1900);

        // Původní časovač: na místě červeného naskočí bílá 00 a převine se na 30 s.
        state.time = 0;
        state.rewinding = true;           // updateUI ji nebarví na červeno
        updateUI();
        const fresh = document.querySelector('#progress .gp-timer');
        if (fresh) fresh.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: .7 },
            { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'ease-out' });
        setTimeout(() => { if (state.gen === gen && state.processing) animateTimerUp(0, () => {}); }, 380);
    }, 320);
}

function handleTimeout() {
    if (state.processing) return;
    state.processing = true;
    const gen = state.gen;
    haptic('miss');
    playMissSound();
    explodeTimer(gen);
    clearIncorrectState();

    const wd = $('wordDisplay');
    const target = state.words[state.wordIdx] || '';
    state.wordIdx++;
    state.marks.push(false);
    if (state.mode === 'daily' && persist.day) (persist.day.left ||= []).push(0);
    updateGameGrid(state.marks.length - 1);
    saveDayProgress();

    // Trénink: slovo ukáže až panel mezihry (kostky se v něm přeskládají
    // z rozsypaného pořadí), hra jen zmizí. Série tréninku tu končí.
    if (state.mode === 'practice') {
        state.lostStreak = state.practiceCount;
        state.practiceCount = 0;
        [wd, ...$$('#letterRow .letter')].forEach(el => {
            el.style.transition = 'opacity .25s ease-out, transform .25s ease-out';
            el.style.opacity = '0';
            el.style.transform = 'scale(.85)';
        });
        setTimeout(() => showWordDone(target, gen, false), 300);
        return;
    }

    const chars = [...target];
    const slots = [...wd.querySelectorAll('.answer-slot')];

    slots.forEach(s => {
        if (!s.classList.contains('locked')) {
            s.textContent = '';
            s.classList.remove('filled');
        }
        s.style.animation = 'none';
    });

    // Postupně odhalit hledané slovo červeně.
    const stagger = 65;
    slots.forEach((s, i) => {
        setTimeout(() => {
            s.textContent = chars[i] === ' ' ? '␣' : (chars[i] || '');
            s.classList.add('filled', 'missed');
            s.style.animation = 'missedReveal .34s cubic-bezier(.34,1.56,.64,1) both';
        }, i * stagger);
    });

    const revealDone = slots.length * stagger + 340;
    const hold = 850;

    setTimeout(() => {
        if (state.gen !== gen) return;
        const els = [wd, ...$$('#letterRow .letter')];
        els.forEach(el => {
            el.style.transition = 'opacity .3s ease-out, transform .3s ease-out';
            el.style.opacity = '0';
            el.style.transform = 'scale(.85)';
        });
    }, revealDone + hold);

    setTimeout(() => {
        if (state.gen !== gen) return;
        wd.style.cssText = '';
        loadWord();
    }, revealDone + hold + 320);
}

/* ---------------- FLIP zamíchání (Shift) ---------------- */

function shuffleLetters() {
    if (state.processing || state.shuffledThisWord) return;
    const row = $('letterRow');
    const tiles = [...row.children];
    if (tiles.length < 2) return;
    state.shuffledThisWord = true;
    if (state.mode === 'daily' && persist.day) persist.day.shuffles = (persist.day.shuffles || 0) + 1;
    haptic('tap');

    tiles.forEach(t => { t.classList.remove('entering'); t.style.animation = 'none'; });
    const firstRects = tiles.map(t => t.getBoundingClientRect());

    let order;
    do order = shuffleInPlace(tiles.map((_, i) => i));
    while (order.some((v, i) => v === i));   // každé písmeno se pohne

    order.forEach(i => row.appendChild(tiles[i]));

    tiles.forEach((t, i) => {
        const last = t.getBoundingClientRect();
        const dx = firstRects[i].left - last.left;
        const dy = firstRects[i].top - last.top;
        t.style.transition = 'none';
        t.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    requestAnimationFrame(() => {
        tiles.forEach(t => {
            t.style.transition = 'transform .34s cubic-bezier(.34,1.56,.64,1)';
            t.style.transform = '';
        });
    });
    setTimeout(() => {
        tiles.forEach(t => { t.style.transition = ''; t.style.transform = ''; });
    }, 420);
}

/* ---------------- grid + progress UI ---------------- */

function placeGameGrid(screen) {
    const grid = $('gameGrid');
    if (screen === 'result') {
        $('result').prepend(grid);
        grid.classList.add('result-grid');
    } else {
        $('game').insertBefore(grid, $('progress'));
        grid.classList.remove('result-grid');
    }
}

function renderGameGrid() {
    const el = $('gameGrid');
    if (state.mode === 'practice') { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'grid';
    if (el.children.length !== WORDS_PER_DAY) el.replaceChildren(...dayCells());
    updateGameGrid();
}

function updateGameGrid(popIndex) {
    const el = $('gameGrid');
    const marks = state.marks || [];
    [...el.children].forEach((c, i) => {
        c.classList.toggle('solved', i < marks.length && marks[i]);
        c.classList.toggle('missed', i < marks.length && !marks[i]);
        if (popIndex === i) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    });
}

function updateUI() {
    const chosen = state.selected.map(i => state.letters[i]);
    let li = 0; // index do vybraných písmen — zamčené sloty se přeskakují
    $('wordDisplay').querySelectorAll('.answer-slot').forEach(s => {
        if (s.classList.contains('locked')) return;
        if (li < chosen.length) {
            s.textContent = chosen[li];
            s.classList.add('filled');
        } else {
            s.textContent = '';
            s.classList.remove('filled');
        }
        li++;
    });
    const low = state.rewinding ? '' : state.time <= 0 ? ' zero' : (state.time <= 10 ? ' low' : '');
    const label = state.mode === 'practice'
        ? `Slovo ${state.wordIdx + 1} · ${practiceLevel().label}`
        : `Slovo ${state.wordIdx + 1}/${WORDS_PER_DAY}`;
    const timeStr = String(state.time).padStart(2, '0');
    $('progress').innerHTML = `<div class="gp-timer${low}"><span class="gp-timer-num">${timeStr}</span></div><div class="gp-headline">${label}</div>`;
    // zbývající čas 0–1 pro lištu nahoře (délka i barva, viz .time-bar)
    $('game').style.setProperty('--t', state.time / START_TIME);
}

/* ---------------- časovač ---------------- */

function startTimer() {
    clearInterval(state.timer);
    updateUI();
    state.timer = setInterval(() => {
        state.time--;
        state.playSec++;                                  // aktivní čas hraní pro statistiky
        if (state.time <= 0) {
            clearInterval(state.timer);
            state.time = 0;
            updateUI();
            handleTimeout();
            return;
        }
        if (state.time <= 3) haptic('tick');
        if (state.time <= URGENT_FROM) playUrgentSound(state.time);
        updateUI();
        saveDayProgress();
    }, 1000);
}

// done: co po převinutí — ve hře rozběhnout čas, po explozi jen počkat na další slovo.
function animateTimerUp(from, done = startTimer) {
    clearInterval(state.timer);
    clearInterval(state.rewindTimer);   // nikdy dvě převíjení naráz
    const to = START_TIME;
    state.time = from;
    const steps = to - from;
    if (steps <= 0) { state.time = to; state.rewinding = false; done(); return; }
    let current = from;
    const step = Math.max(12, Math.floor(500 / steps));   // celé převíjení ~0,5 s
    playRewindSound(from, to, step);
    state.rewinding = true;             // převíjení je bílé, ne červené „low"
    state.rewindTimer = setInterval(() => {
        current++;
        state.time = current;
        updateUI();
        if (current >= to) { clearInterval(state.rewindTimer); state.rewinding = false; done(); }
    }, step);
}

function saveDayProgress() {
    if (state.mode !== 'daily' || !persist.day) return;
    persist.day.wordIdx = state.wordIdx;
    persist.day.marks = state.marks.slice();
    persist.day.time = state.time;
    savePersist();
}

/* ---------------- pauza ---------------- */

function pauseGame() {
    if (state.mode !== 'daily' && state.mode !== 'practice') return;
    if (!$('game').classList.contains('active') || state.processing) return;
    clearInterval(state.timer);
    $('pauseOverlay').classList.add('active');
}

function resumeGame() {
    $('pauseOverlay').classList.remove('active');
    startTimer();
}

// Křížek ve hře: trénink rovnou skončí, denní výzva se nejdřív zeptá.
function exitGame() {
    if (state.mode === 'practice') return exitPractice();
    openQuit();
}

// Ukončení denní výzvy je nevratné (dnešek už nejde dohrát), proto potvrzení.
// Čas mezitím stojí; „Hrát dál" i zavření sheetu jiným způsobem ho rozjede.
function openQuit() {
    if (state.mode !== 'daily' || state.processing) return;   // mezi slovy chvíli počkat
    clearInterval(state.timer);
    const left = WORDS_PER_DAY - state.marks.length;
    $('quitText').textContent = (left === 1
        ? 'Poslední slovo se ti započítá jako neuhodnuté.'
        : `${plural(left, '', `Zbývající ${left} slova se ti započítají`, `Zbývajících ${left} slov se ti započítá`)} jako neuhodnutá.`)
        + ' Dnešek už pak nepůjde dohrát.';
    $('quitModal').onclose = () => { if (!state.quitting) startTimer(); };
    openModal('quitModal');
}

// Zbylá slova dne jako neuhodnutá a rovnou výsledek, jako by den doběhl.
function quitDaily() {
    if (state.mode !== 'daily' || !persist.day) return;
    state.quitting = true;
    closeModal();
    state.quitting = false;
    state.gen++;                                          // zahodit naplánované kroky kola
    clearInterval(state.timer);
    const quitAt = state.marks.length;                    // kolik slov se opravdu hrálo
    while (state.marks.length < WORDS_PER_DAY) state.marks.push(false);
    state.wordIdx = WORDS_PER_DAY;
    state.solved = state.marks.filter(Boolean).length;
    state.processing = false;
    updateGameGrid();
    saveDayProgress();
    finishDay(quitAt);
}

function exitPractice() {
    if (state.mode !== 'practice') return;
    const solved = state.marks.filter(Boolean).length;
    track('practice_ended', {
        level: persist.practiceLevel, solved, missed: state.marks.length - solved,
        marks: marksStr(state.marks), duration_s: state.playSec,
    });
    state.gen++;
    clearInterval(state.timer);
    clearTimeout(state.nextTimer);
    state.nextTimer = null;
    hideWordDone();
    closeModal();
    state.processing = false;
    showWelcome();
}

// Na pozadí hra stojí a odpočet mezihry se zruší, ať hráči slovo neuteče.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    // Kdo zavře kartu nebo přepne aplikaci uprostřed hry, jinak nezanechá stopu:
    // pozice, kde hráči odcházejí, a trénink, který neskončil křížkem.
    if ($('game').classList.contains('active') && (state.mode === 'daily' || state.mode === 'practice')) {
        track('game_left', {
            mode: state.mode, words_done: state.marks.length, solved: state.marks.filter(Boolean).length,
            time_left: state.time, duration_s: state.playSec,
            ...(state.mode === 'practice' && { marks: marksStr(state.marks) }),
        });
    }
    pauseGame();
    holdWordDone();
});

/* ---------------- konec dne + výsledek ---------------- */

// quitAt: den byl vzdán po tolika slovech (jen z quitDaily).
function finishDay(quitAt) {
    clearInterval(state.timer);
    const perfect = state.marks.length === WORDS_PER_DAY && state.marks.every(Boolean);
    persist.day.done = true;
    persist.day.perfect = perfect;
    persist.day.marks = state.marks.slice();
    persist.day.realTopPct = persist.day.realTopPct ?? null;
    persist.attempts++;
    persist.results[persist.day.dayIdx] = state.marks.filter(Boolean).length;
    if (perfect) persist.wins++;
    // Série = odehrané dny v kuse, na skóre nezáleží (jako server a úspěchy).
    if (persist.lastPlayDate !== todayStr()) {
        persist.streak = persist.lastPlayDate === daysAgoStr(1) ? persist.streak + 1 : 1;
        persist.lastPlayDate = todayStr();
    }
    persist.bestStreak = Math.max(persist.bestStreak, persist.streak);
    Object.assign(persist.ach, persist.day.ach);          // co čekalo na konec dne (checkWord)
    if (perfect && !persist.day.wrong) persist.ach.cisty = 1;
    if (new Date().getHours() < 4) persist.ach.sova = 1;
    savePersist();
    syncAchievements();
    const played = quitAt ?? WORDS_PER_DAY;
    const left = persist.day.left || [];
    track('day_finished', {
        day_idx: persist.day.dayIdx, score: persist.results[persist.day.dayIdx], perfect,
        marks: marksStr(state.marks.slice(0, played)),   // kratší než 20 = vzdáno
        duration_s: state.playSec, quit: quitAt !== undefined,
        // obtížnost: zbylé sekundy u každého slova (0 = vypršelo), špatné pokusy, přeskládání;
        // den rozehraný před nasazením statistik nemá časy poskládané po pozicích
        time_left: left.length === played ? left : null,
        wrong: persist.day.wrong || 0, shuffles: persist.day.shuffles || 0,
    });
    showResult(false);
    refreshRealPercentile(); // dozdobí % v pozadí, jakmile (a pokud) dorazí z backendu
}

/* ---------------- skutečný percentil (volitelný backend) ---------------- */

// Offline, timeout, nenasazený backend… vždy potichu spadnout na statický odhad.
async function fetchRealPercentile(day, score) {
    const r = await apiPost('/api/result', { day, score, playedOn: todayStr() }, API_TIMEOUT_MS);
    return r.ok && r.data && r.data.real ? r.data : null;
}

async function refreshRealPercentile() {
    const day = persist.day;
    if (!day) return;
    // Server počítá pořadí ze dne hry, ne z dne cyklu — jinak by se po roce
    // míchaly výsledky dvou let se stejnými slovy.
    const survived = day.marks.filter(Boolean).length;
    const real = await fetchRealPercentile(daysSinceEpoch(day.date) + 1, survived);
    if (!real || persist.day !== day) return; // mezitím mohl začít další den
    persist.day.realTopPct = real.topPct;
    savePersist();
    if ($('result').classList.contains('active')) {
        setEmojiText($('percentile'), percentileText(real.topPct));
    }
    prepareShareCard();   // percentil je i na obrázku
}

function restoreFinishedDay() {
    // obnova stavu pro zobrazení výsledku už odehraného dneška
    state.mode = 'daily';
    state.marks = persist.day.marks.slice();
    state.solved = state.marks.filter(Boolean).length;
}

// Statický odhad „top X %" podle skóre — platí, dokud nedorazí (nebo není
// nasazený) skutečný percentil z backendu. Založeno na typickém rozložení
// skóre u podobných her.
function estimatedTopPct(survived) {
    if (survived >= 17) return [5, 3, 2, 1][survived - 17];
    return survived >= 15 ? 10 : survived >= 13 ? 20 : survived >= 9 ? 50 : 100;
}

function percentileText(topPct) {
    if (topPct <= 1) return 'Top 1 % hráčů dneška 👑';
    if (topPct <= 50) return `Top ${topPct} % hráčů dneška ${topPct <= 5 ? '🏆' : '🏅'}`;
    return 'Dnes bez trofeje 💔';
}

function percentileDisplayText(survived, realTopPct) {
    return percentileText(typeof realTopPct === 'number' ? realTopPct : estimatedTopPct(survived));
}

// Jen denní výzva — trénink běží pořád dál a výsledkovou obrazovku nemá.
function showResult(instant) {
    clearInterval(state.timer);
    const survived = state.solved;
    const perfect = survived === WORDS_PER_DAY;

    placeGameGrid('result');
    $('gameGrid').style.display = 'grid';
    if (instant) { renderGameGrid(); }

    showScreen('result');

    $('survivedCount').textContent = perfect
        ? 'Máš všech 20 slov!'
        : `Máš ${survived} z 20 slov!`;
    setEmojiText($('percentile'), percentileDisplayText(survived, persist.day.realTopPct));
    // Ne „den N": číslo dne hráči nic neřekne. Důvod přijít zítra je série.
    const streak = liveStreak();
    setEmojiText($('progressLine'), (perfect ? `🔓 Odehráno ${fmtNum(playedDays())} z ${TOTAL_LEVELS} dní výzvy.\n` : '')
        + (streak >= 2
            ? `🔥 ${fmtNum(streak)} ${plural(streak, 'den', 'dny', 'dní')} v řadě. Zítra v tom pokračuj!`
            : 'Zítra čeká 20 nových slov. Přijď a rozjeď sérii!'));
    updateNotifyPrompt();
    renderStreakNudge();
    prepareShareCard();

    startCountdown();
    animateResultReveal(perfect, instant);
}

// Sérii lidi chrání — a je to jediná věc, o kterou tu můžou reálně přijít.
// Proto se o účtu ozveme až ve chvíli, kdy má série cenu, ne v nastavení.
const NUDGE_AT = [3, 7, 14, 30, 60, 100, 200, 365];

function renderStreakNudge() {
    const box = $('streakNudge');
    box.style.display = 'none';
    box.innerHTML = '';
    const s = liveStreak();
    if (!auth.enabled || auth.user || !NUDGE_AT.includes(s) || persist.nudgedAt === s) return;
    persist.nudgedAt = s;
    savePersist();
    box.appendChild(setEmojiText(el('p'), `🔥 ${fmtNum(s)} dní v řadě — a celá série žije jen v tomhle zařízení.`));
    const b = el('button', 'btn btn-primary', 'Uložit sérii k účtu');
    b.type = 'button';
    b.onclick = () => { track('login_prompt_clicked', { where: 'streak_nudge' }); showProfile(); };
    track('login_prompt_shown', { where: 'streak_nudge' });
    box.appendChild(b);
    box.style.display = 'block';
}

function plural(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
}

let revealTimeouts = [];
function animateResultReveal(perfect, instant) {
    revealTimeouts.forEach(clearTimeout);
    revealTimeouts = [];
    const items = [...$$('#result .reveal-item')].filter(el => {
        const empty = !el.textContent.trim() && !el.querySelector('button');
        return !empty && el.style.display !== 'none';
    });
    if (instant) {
        items.forEach(el => el.classList.add('show'));
        whenCalm();
        return;
    }
    items.forEach(el => el.classList.remove('show'));
    items.forEach((el, i) => {
        revealTimeouts.push(setTimeout(() => el.classList.add('show'), 250 + i * 350));
    });
    // až je výsledek celý venku, smí přijít oznámení úspěchu
    revealTimeouts.push(setTimeout(() => { revealTimeouts = []; whenCalm(0); }, 250 + items.length * 350 + 500));
    if (perfect) revealTimeouts.push(setTimeout(() => { haptic('win'); playWinSound(); launchConfetti(); }, 400));
}

/* ---------------- konfety (perfektní den) ---------------- */

let confettiRaf = null;
function stopConfetti() {
    if (confettiRaf) cancelAnimationFrame(confettiRaf);
    confettiRaf = null;
    $('confetti').classList.remove('on');
}

function launchConfetti() {
    const canvas = $('confetti');
    const ctx = canvas.getContext('2d');
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    canvas.classList.add('on');

    // barvy konfet určuje vzhled přes --confetti (mezerou oddělené)
    const themed = getComputedStyle(document.documentElement).getPropertyValue('--confetti').trim();
    const colors = themed ? themed.split(/\s+/) : ['#2e9e5b', '#4169f1', '#f59e0b', '#e0524a', '#9b59b6'];
    const parts = [];
    for (let i = 0; i < 140; i++) {
        parts.push({
            x: Math.random() * innerWidth,
            y: -20 - Math.random() * innerHeight * 0.4,
            w: 6 + Math.random() * 6,
            h: 8 + Math.random() * 8,
            vy: 2 + Math.random() * 3,
            vx: -1.2 + Math.random() * 2.4,
            rot: Math.random() * Math.PI,
            vr: -0.12 + Math.random() * 0.24,
            color: colors[i % colors.length],
        });
    }
    const start = performance.now();
    function frame(now) {
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        let alive = false;
        for (const p of parts) {
            p.x += p.vx; p.y += p.vy; p.rot += p.vr;
            if (p.y < innerHeight + 30) alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }
        if (alive && now - start < 6000) {
            confettiRaf = requestAnimationFrame(frame);
        } else {
            stopConfetti();
        }
    }
    confettiRaf = requestAnimationFrame(frame);
}

/* ---------------- odpočet ---------------- */

function startCountdown() {
    clearInterval(countdownInterval);
    function update() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setHours(24, 0, 0, 0);
        const diff = tomorrow - now;
        if (diff <= 0) { clearInterval(countdownInterval); showWelcome(); return; }
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        $('countdown').textContent = `Další výzva za ${h}:${m}:${s}`;
    }
    update();
    countdownInterval = setInterval(update, 1000);
}

/* ---------------- sdílení ---------------- */

function buildEmojiGrid() {
    const marks = persist.day ? persist.day.marks : [];
    let out = '';
    for (let i = 0; i < WORDS_PER_DAY; i++) {
        out += marks[i] ? '🟩' : '🟥';
        if (i % 5 === 4 && i !== WORDS_PER_DAY - 1) out += '\n';
    }
    return out;
}

function getTrophyShareLine(survived) {
    const realTopPct = persist.day ? persist.day.realTopPct : null;
    const text = percentileDisplayText(survived, realTopPct);
    if (text.includes('bez trofeje')) return null;
    const clean = text.replace(/[\s\p{Extended_Pictographic}️]+$/u, '');
    return '🏆 ' + clean;
}

// Při sdílení datum, ne „den N": podle data si hráči porovnají výsledky
// (ten den hráli všichni stejná slova), pořadové číslo dne nic neřekne.
function shareDate(day) {
    const [y, m, d] = ((day && day.date) || todayStr()).split('-').map(Number);
    return fmtDateLong(new Date(y, m - 1, d));
}

const fmtDateLong = (d) => d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });

function buildShareMessage() {
    const survived = (persist.day && persist.day.marks) ? persist.day.marks.filter(Boolean).length : 0;
    const grid = buildEmojiGrid();
    let msg = `⏳ 20 slov — ${shareDate(persist.day)}\n\n🔥 Získáno ${survived}/20 slov`;
    if (grid) msg += `\n\n${grid}`;
    const trophy = getTrophyShareLine(survived);
    if (trophy) msg += `\n\n${trophy}`;
    msg += `\n\n🫵 Překonáš mě?`;
    msg += `\n\n${shareUrl('text')}`;
    return msg;
}

function copyFallback(msg, blocked) {
    const note = blocked
        ? 'Zkopírováno! (Nativní sdílení tu prohlížeč blokuje)'
        : 'Zkopírováno do schránky!';
    navigator.clipboard?.writeText(msg).then(() => showToast(note)).catch(() => alert(msg));
}

function isMobileShare() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        ('ontouchstart' in window && window.innerWidth < 768);
}

function shareText(msg) {
    track('share_clicked', { method: 'text' });
    if (isMobileShare() && navigator.share) {
        // Musí běžet přímo v gestu uživatele, jinak iOS sheet neotevře.
        navigator.share({ text: msg }).catch(err => {
            if (err && err.name === 'AbortError') return; // uživatel jen zavřel sheet
            // NotAllowedError = web-share blokované (např. sandboxovaný iframe)
            copyFallback(msg, err && err.name === 'NotAllowedError');
        });
    } else {
        copyFallback(msg, false);
    }
}

/* Obrázek ke sdílení: svislá karta 1080×1920 (příběh na Instagramu
   i Facebooku) v řeči Kostek — kostky s retem, Slovka One, sytá plocha
   jako ve Spotify Wrapped. Barva plochy podle dne: zlatá za všech 20,
   zelená za trofej, modrá za medaili, fialová bez trofeje. Pochlubit se
   musí jít s každým skóre — i bez trofeje má karta nálepku a výzvu. */
const CARD_THEMES = {
    perfect: { bg: '#ffc21a', shape: '#ffac00', ink: '#4a3200', lip: '#d98f00', dare: 'Dáš taky všech 20?' },
    top:     { bg: '#4cb82b', shape: '#42a723', ink: '#ffffff', lip: '#2f7d14', dare: 'Překonáš mě?' },
    medal:   { bg: '#1b93e6', shape: '#1584d2', ink: '#ffffff', lip: '#0f62a0', dare: 'Překonáš mě?' },
    none:    { bg: '#9b5de5', shape: '#8d4dd9', ink: '#ffffff', lip: '#6c35b0', dare: 'Dáš to líp?' },
};
const STICKERS = {
    gold:   { edge: '#e09a00', face: '#fff4d1', ink: '#8a5a00' },
    streak: { edge: '#ff9600', face: '#fff1dc', ink: '#b85400' },
    plain:  { edge: '#d3dce0', face: '#ffffff', ink: '#2b3a42' },
};
const CARD_DISPLAY = '"Slovka One", Nunito, sans-serif';

function loadImage(src) {
    return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
}

// Kostka s retem: spodní „ret" je tentýž tvar posunutý dolů v tmavším odstínu.
function cardTile(g, x, y, w, h, r, face, lip, lipH) {
    g.fillStyle = lip; g.beginPath(); g.roundRect(x, y + lipH, w, h, r); g.fill();
    g.fillStyle = face; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}

function turned(g, cx, cy, deg, draw) {
    g.save(); g.translate(cx, cy); g.rotate(deg * Math.PI / 180); draw(); g.restore();
}

// Nálepka zarovnaná pravým okrajem k `right`: text + ikona z Kostek, nakřivo.
function cardSticker(g, right, cy, deg, size, label, icon, c) {
    g.font = `${size}px ${CARD_DISPLAY}`;
    const IS = icon ? size * 1.3 : 0, pad = size * .75;
    const pw = g.measureText(label).width + 2 * pad + (icon ? IS + size * .3 : 0), ph = size * 2.07;
    turned(g, right - pw / 2, cy, deg, () => {
        cardTile(g, -pw / 2, -ph / 2, pw, ph, ph * .26, c.edge, c.edge, 10);
        g.fillStyle = c.face; g.beginPath(); g.roundRect(-pw / 2 + 6, -ph / 2 + 6, pw - 12, ph - 12, ph * .26 - 5); g.fill();
        g.fillStyle = c.ink; g.textBaseline = 'middle';
        g.fillText(label, -pw / 2 + pad, size * .07);
        if (icon) g.drawImage(icon, pw / 2 - pad - IS, -IS / 2, IS, IS);
    });
    g.textBaseline = 'alphabetic';
}

function cardTier(day) {
    const survived = day.marks.filter(Boolean).length;
    const pct = percentileDisplayText(survived, day.realTopPct);
    const badge = Object.keys(EMOJI_NAMES).find(e => pct.endsWith(e));
    const trophy = !pct.includes('bez trofeje');
    const theme = CARD_THEMES[survived === WORDS_PER_DAY ? 'perfect' : !trophy ? 'none' : badge === '🏅' ? 'medal' : 'top'];
    return { survived, pct, badge, trophy, theme };
}

async function drawShareCard() {
    const day = persist.day;
    const { survived, pct, badge, trophy, theme: t } = cardTier(day);
    const streak = liveStreak();
    const icon = name => loadImage(`designs/kostky/${name}.svg`).catch(() => null);
    const [, , badgeIcon, flame] = await Promise.all([
        document.fonts.load(`100px ${CARD_DISPLAY}`), document.fonts.load('800 40px Nunito'),
        icon(trophy && badge ? EMOJI_NAMES[badge] : 'palec'), streak >= 2 ? icon('plamen') : null,
    ]);

    const W = 1080, H = 1920, X = 90;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = t.bg; g.fillRect(0, 0, W, H);
    // dvě obří kostky v pozadí, uříznuté okrajem
    turned(g, 960, 560, 16, () => { g.fillStyle = t.shape; g.beginPath(); g.roundRect(-260, -260, 520, 520, 110); g.fill(); });
    turned(g, 40, 1560, -12, () => { g.fillStyle = t.shape; g.beginPath(); g.roundRect(-240, -240, 480, 480, 100); g.fill(); });

    // „20 SLOV" z kostek písmen jako na klávesnici hry, každá trochu nakřivo
    const TS = 112, tilt = [-7, 4, -4, 6, -3, 5];
    let x = X, k = 0;
    for (const ch of '20 SLOV') {
        if (ch === ' ') { x += 34; continue; }
        const d = tilt[k++];
        turned(g, x + TS / 2, 170 + TS / 2, d, () => {
            cardTile(g, -TS / 2, -TS / 2, TS, TS, 26, '#ffffff', '#d3dce0', 10);
            g.fillStyle = '#2b3a42'; g.font = `74px ${CARD_DISPLAY}`;
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(ch, 0, 4);
        });
        x += TS + 12;
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = t.ink; g.font = `56px ${CARD_DISPLAY}`;
    g.fillText(shareDate(day), X, 392);
    // série od dvou dní, s jakýmkoli skóre
    if (streak >= 2) cardSticker(g, W - X, 372, 4, 50, `${fmtNum(streak)} ${plural(streak, 'den', 'dny', 'dní')} v řadě`, flame, STICKERS.streak);

    // skóre: obří číslo s retem, vedle „z 20 / slov"
    const num = String(survived);
    g.font = `120px ${CARD_DISPLAY}`;
    const colW = Math.max(g.measureText('z 20').width, g.measureText('slov').width);
    g.font = `440px ${CARD_DISPLAY}`;
    const size = Math.min(440, 440 * (W - 2 * X - 40 - colW) / g.measureText(num).width);
    g.font = `${size}px ${CARD_DISPLAY}`;
    const numW = g.measureText(num).width;
    g.fillStyle = t.lip; g.fillText(num, X, 800 + 16);
    g.fillStyle = '#ffffff'; g.fillText(num, X, 800);
    g.fillStyle = t.ink; g.font = `120px ${CARD_DISPLAY}`;
    g.fillText('z 20', X + numW + 40, 680);
    g.fillText('slov', X + numW + 40, 800);

    // mřížka dne na tmavé desce, nakřivo jako nalepená
    const CS = 96, GAP = 18, PAD = 40;
    const bw = 5 * CS + 4 * GAP + 2 * PAD, bh = 4 * CS + 3 * GAP + 2 * PAD;
    turned(g, W / 2, 1160, -3, () => {
        cardTile(g, -bw / 2, -bh / 2, bw, bh, 50, '#131f24', '#0a1418', 18);
        day.marks.forEach((ok, i) => {
            const cx = -bw / 2 + PAD + (i % 5) * (CS + GAP), cy = -bh / 2 + PAD + Math.floor(i / 5) * (CS + GAP);
            cardTile(g, cx, cy, CS, CS, 24, ok ? '#4cb82b' : '#ff5a5a', ok ? '#38931a' : '#c93636', 10);
        });
    });

    // percentil jako zlatá nálepka přes roh desky; bez trofeje hlavu vzhůru
    const label = trophy ? pct.replace(/[\s\p{Extended_Pictographic}️]+$/u, '') : 'Zítra to dám!';
    cardSticker(g, W - X + 10, 1450, 4, 56, label, badgeIcon, trophy ? STICKERS.gold : STICKERS.plain);

    // výzva a adresa na střed, spolu nakřivo jako nálepky
    turned(g, W / 2, 1705, -5, () => {
        g.fillStyle = t.ink; g.textAlign = 'center';
        g.font = `104px ${CARD_DISPLAY}`;
        g.font = `${Math.min(104, 104 * (W - 2 * X) / g.measureText(t.dare).width)}px ${CARD_DISPLAY}`;
        g.fillText(t.dare, 0, -40);
        g.font = '800 54px Nunito, sans-serif';
        g.globalAlpha = .85;
        g.fillText('20slov.cz', 0, 42);   // na kartě vlastní doména, ne adresa, odkud se zrovna hraje
    });
    return new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(), 'image/png'));
}

// navigator.share musí běžet ještě v gestu klepnutí a iOS čekání na
// vykreslení nepočká — karta se proto kreslí, jakmile je výsledek vidět.
let shareCard = null;   // { key, ready: Promise<File>, file }
function prepareShareCard() {
    const day = persist.day;
    if (!day || !day.done) return null;
    const key = JSON.stringify([day.dayIdx, day.marks, day.realTopPct, liveStreak()]);
    if (shareCard && shareCard.key === key) return shareCard.ready;
    if (shareCard && shareCard.url) URL.revokeObjectURL(shareCard.url);
    const card = { key, file: null, url: null };
    card.ready = drawShareCard().then(blob => {
        card.file = new File([blob], `20-slov-${day.date}.png`, { type: 'image/png' });
        card.url = URL.createObjectURL(blob);
        return card.file;
    });
    card.ready.catch(() => { if (shareCard === card) shareCard = null; });
    shareCard = card;
    return card.ready;
}

function canShareCard(file) {
    return isMobileShare() && !!navigator.canShare && navigator.canShare({ files: [file || new File([], 'x.png', { type: 'image/png' })] });
}

function downloadCard(file) {
    const a = el('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast('Obrázek uložený — přidej ho na Instagram nebo Facebook.');
}

// Pochlubit se → náhled karty v sheetu; sdílí se až tlačítkem pod ním,
// takže navigator.share běží v čerstvém gestu a karta je dávno hotová.
async function shareScore() {
    track('share_clicked', { method: 'card_preview' });
    const ready = prepareShareCard();
    const day = persist.day;
    const img = $('sharePreview'), btn = $('shareCardBtn');
    $('shareTitle').textContent = `Karta ze dne ${shareDate(day)}`;
    img.alt = `Karta ke sdílení: ${day.marks.filter(Boolean).length} z 20 slov, ${shareDate(day)}`;
    img.removeAttribute('src');
    btn.textContent = canShareCard() ? 'Sdílet obrázek' : 'Stáhnout obrázek';
    btn.disabled = true;
    openModal('shareModal');
    const file = await (ready && ready.catch(() => null));
    if (!file) { closeModal(); return shareText(buildShareMessage()); }   // kreslení selhalo — aspoň text
    img.src = shareCard.url;
    btn.disabled = false;
}

function shareCardFile() {
    const file = shareCard && shareCard.file;
    if (!file) return;
    track('share_clicked', { method: 'card' });
    // Chlouba počítá dny se sdílenou kartou, ne klepnutí
    if (persist.ach.sdilenoDen !== todayStr()) {
        persist.ach.sdileno = (persist.ach.sdileno || 0) + 1;
        persist.ach.sdilenoDen = todayStr();
    }
    savePersist();
    syncAchievements();
    if (!canShareCard(file)) { downloadCard(file); closeModal(); return; }
    navigator.share({ files: [file], text: `${cardTier(persist.day).theme.dare} ${shareUrl('card')}` }).then(() => closeModal()).catch(err => {
        if (err && err.name === 'AbortError') return;   // jen zavřel share sheet — náhled zůstává
        downloadCard(file);   // sdílení souborů blokované
    });
}

/* ---------------- web push: připomínka dalšího dne ---------------- */

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Na iOS Push funguje jen z nainstalované PWA (Add to Home Screen), ne z karty
// Safari — proto se tam nejdřív nabídne instalace, tlačítko notifikací přijde
// na řadu až po ní. Jinde (Android/desktop) jde rovnou žádost o oprávnění.
let a2hsTracked = false;
function showA2hs(banner) {
    banner.style.display = 'block';
    if (!a2hsTracked) { a2hsTracked = true; track('a2hs_shown'); }   // jednou za načtení, ne při každém překreslení
}

function updateNotifyPrompt() {
    const banner = $('a2hsBanner');
    const notifyBtn = $('notifyBtn');
    banner.style.display = 'none';
    notifyBtn.style.display = 'none';
    if (!VAPID_PUBLIC_KEY) return;

    if (IS_IOS && !IS_STANDALONE) {
        if (!persist.a2hsPromptDismissed) showA2hs(banner);
        return;
    }
    // Chrome/Android: beforeinstallprompt přijde jen neinstalované hře, takže
    // nabídka zmizí sama. Safari nic takového nemá (viz a2hsPromptDismissed).
    if (installPrompt && !IS_STANDALONE && !persist.a2hsPromptDismissed) showA2hs(banner);
    if (!('Notification' in window && 'PushManager' in window)) return;
    if (Notification.permission === 'default') notifyBtn.style.display = 'flex';
    // Povolení ještě neznamená odběr: mohl selhat nebo vypršet a připomínky by
    // tiše nechodily. Bez odběru se tlačítko nabídne znovu — klepnutí ho obnoví
    // bez dalšího dotazu (requestPermission rovnou vrátí 'granted').
    else if (Notification.permission === 'granted') {
        navigator.serviceWorker.ready
            .then(reg => reg.pushManager.getSubscription())
            .then(sub => { if (!sub) notifyBtn.style.display = 'flex'; })
            .catch(() => {});
    }
}

// Safari: instalaci nejde spustit ani poznat (plocha má vlastní úložiště,
// o přidání se hra v prohlížeči nedozví), zbývá ukázat postup.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();                                   // vlastní tlačítko místo lišty prohlížeče
    installPrompt = e;
    if ($('result').classList.contains('active')) updateNotifyPrompt();
});
window.addEventListener('appinstalled', () => {
    track('a2hs_accepted');
    installPrompt = null;
    persist.a2hsPromptDismissed = true;
    savePersist();
    $('a2hsBanner').style.display = 'none';
});

function addToHomeScreen() {
    if (installPrompt) {
        installPrompt.prompt();
        installPrompt.userChoice.then(() => { installPrompt = null; updateNotifyPrompt(); });
        return;
    }
    const steps = $('a2hsSteps'), open = steps.hidden;
    steps.hidden = !open;
    $('a2hsBtn').setAttribute('aria-expanded', String(open));
}

function dismissA2hs() {
    persist.a2hsPromptDismissed = true;
    savePersist();
    $('a2hsBanner').style.display = 'none';
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from([...atob(base64)].map(c => c.charCodeAt(0)));
}

async function enableNotifications() {
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        const { endpoint, keys } = sub.toJSON();
        await apiPost('/api/subscribe', { endpoint, keys });
        track('notif_enabled');
        showToast('Upozornění zapnuto!');
    } catch (e) {
        // tichý fail — notifikace jsou čistě volitelné vylepšení
    }
    $('notifyBtn').style.display = 'none';
}

/* ---------------- denní výzva: přehled dní (dřív „Sbírka slov") ---------------- */

// Datum dne `lvl` v dnešním ročním cyklu. V přehledu data bez roku, ne „Den N":
// den se každý rok vrací, cílem je nasbírat všech 365.
function cycleDate(lvl, today = dayIndex()) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);                              // poledne: posun o dny nepřeskočí změna času
    d.setDate(d.getDate() + lvl - today);
    return d;
}

// Slova dne se skládají a vykreslují až na klepnutí, ne dopředu pro
// každý odehraný den — s roky hraní by to sestavení kalendáře znatelně
// zpomalilo (stovky×20 prvků navíc, viz devlog).
function revealDayWords(li, lvl) {
    if (li.querySelector('.archive-words')) return;
    const words = document.createElement('div');
    words.className = 'archive-words';
    dayWords(lvl).forEach(w => {
        const s = document.createElement('span');
        s.textContent = w;
        words.appendChild(s);
    });
    li.appendChild(words);
}

function buildDayItem(lvl, today) {
    const li = document.createElement('li');
    li.className = 'archive-item';
    const score = persist.results[lvl];
    const played = score !== undefined;
    const current = lvl === today;
    const label = document.createElement('span');
    label.className = 'archive-date';
    label.textContent = cycleDate(lvl, today).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' });
    const badge = document.createElement('span');
    badge.className = 'archive-score';
    if (played) {
        badge.textContent = `${score === WORDS_PER_DAY ? '✓ ' : ''}${score} ${plural(score, 'slovo', 'slova', 'slov')}`;
        li.append(label, badge);
        li.onclick = () => { revealDayWords(li, lvl); li.classList.toggle('open'); };
    } else {
        badge.classList.add('not-played');
        setEmojiText(badge, current ? 'dnes' : '🔒');
        li.classList.toggle('locked', !current);
        li.append(label, badge);
        // Dny se drží kalendáře: minulé už nedohraješ, budoucí ještě nepřišly.
        if (!current) li.onclick = () => showToast(lvl < today
            ? 'Tenhle den ti utekl — vrátí se za rok.'
            : 'Ještě nepřišel na řadu!');
    }
    return li;
}

// 365 zaoblených dlaždic najednou (i .archive-score, viz squircle.js) je
// v Safari bez nativní podpory corner-shape znát — proto se staví jen při
// první otevření nebo když se výsledky od minule opravdu změnily, jinak
// zůstává hotový DOM ze zásobníku a další otevření je stejně rychlé jako
// ostatní tlačítka na obrazovce.
let collectionCache = null;   // { key, today }
function showCollection() {
    const played = playedDays();
    $('collectionCount').textContent = `${fmtNum(played)}/${TOTAL_LEVELS}`;
    $('collectionBar').style.width = played / TOTAL_LEVELS * 100 + '%';
    const today = dayIndex();
    const key = today + ':' + JSON.stringify(persist.results);
    const list = $('collectionList');
    if (!collectionCache || collectionCache.key !== key) {
        list.innerHTML = '';
        // Do fragmentu, ne rovnou do stránky: 365 appendChild na živý DOM by
        // znamenalo 365 přepočtů layoutu místo jednoho.
        const frag = document.createDocumentFragment();
        for (let lvl = 0; lvl < TOTAL_LEVELS; lvl++) frag.appendChild(buildDayItem(lvl, today));
        list.appendChild(frag);
        collectionCache = { key, today };
    }
    openModal('collectionModal');
    // aktuální den nascrollovat do záběru
    const cur = list.children[today];
    if (cur) cur.scrollIntoView({ block: 'center' });
}

/* ---------------- zpětná vazba ---------------- */

function openFeedbackModal() {
    $('feedbackForm').style.display = 'flex';
    $('feedbackSuccess').style.display = 'none';
    $('feedbackError').style.display = 'none';
    openModal('feedbackModal');
}

/* ---------------- sheety ---------------- */

// Sheet se otevírá i zavírá animací. Zavření ho nechá sjet dolů z místa, kde
// právě je (i z půlky tahu prstem nebo otevírání), pozadí se rozplyne a teprve
// pak sheet zmizí — nikdy jen neblikne pryč.
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
// Čím se naposledy ovládalo — podle toho se po zavření sheetu vrací fokus.
let lastInput = 'pointer';
document.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
document.addEventListener('keydown', () => { lastInput = 'key'; }, true);
const SHEET_CLOSE_MS = 300;

function openModal(id) {
    const modal = $(id);
    if (!modal.classList.contains('active') || modal.classList.contains('closing')) playSheetSound(true);
    modal.classList.remove('closing');                    // otevřený během zavírání zůstane
    modal.querySelector('.modal-content').style.cssText = '';
    modal.classList.add('active');
    lockScroll(true);
    // Fokus na sheet samotný (role=dialog), ne na tlačítko — čtečka se ocitne
    // uvnitř, ale nic se nerozsvítí; Zavřít ukáže až Tab. Na původní místo se
    // fokus vrací jen klávesnici: po klepnutí by na kartě zůstal rámeček.
    if (!modal.contains(document.activeElement)) modal.opener = lastInput === 'key' ? document.activeElement : null;
    modal.querySelector('.modal-content').focus({ preventScroll: true });
}

function closeSheet(modal) {
    if (!modal.classList.contains('active') || modal.classList.contains('closing')) return;
    const sheet = modal.querySelector('.modal-content');
    playSheetSound(false);
    modal.classList.add('closing');
    // co má sheet po zavření udělat (quitModal rozjede čas), ať se zavře jakkoli
    const onclose = modal.onclose;
    modal.onclose = null;
    if (onclose) onclose();
    const finish = () => {
        if (!modal.classList.contains('closing')) return; // mezitím se znovu otevřel
        modal.classList.remove('active', 'closing');
        sheet.style.cssText = '';
        if (!document.querySelector('.modal.active')) lockScroll(false);
        if (modal.opener && modal.opener.isConnected) modal.opener.focus({ preventScroll: true });
        modal.opener = null;
        whenCalm(250);   // další úspěch ve frontě (nebo ten, co čekal na zavření sheetu)
    };
    if (REDUCED_MOTION.matches) return finish();
    slideDown(sheet, SHEET_CLOSE_MS);
    // časovač, ne transitionend — ten probublává i z přechodů uvnitř sheetu
    setTimeout(finish, SHEET_CLOSE_MS);
}

// Stránka pod otevřeným sheetem stojí. Profil a výsledek scrolluje celý
// dokument a iOS overflow: hidden na něm při tahu prstem nerespektuje, proto
// body na chvíli position: fixed a po zavření zpět na stejné místo.
function lockScroll(on) {
    const b = document.body;
    if (on === ('lockY' in b.dataset)) return;
    if (on) {
        b.dataset.lockY = String(scrollY);
        Object.assign(b.style, { position: 'fixed', top: `-${scrollY}px`, left: '0', right: '0' });
    } else {
        const y = +b.dataset.lockY;
        delete b.dataset.lockY;
        Object.assign(b.style, { position: '', top: '', left: '', right: '' });
        scrollTo(0, y);
    }
}

// Sjede prvkem dolů z místa, kde právě je (i z půlky tahu nebo otevírání).
function slideDown(el, ms) {
    const from = getComputedStyle(el).transform;
    el.style.animation = 'none';
    el.style.transition = 'none';
    el.style.transform = from;
    el.getBoundingClientRect();                           // zapsat výchozí polohu, než se rozjede
    el.style.transition = `transform ${ms}ms cubic-bezier(.32,.72,0,1)`;
    el.style.transform = 'translateY(110%)';
}

function closeModal() {
    $$('.modal.active').forEach(closeSheet);
}

function submitFeedback(e) {
    e.preventDefault();
    const form = $('feedbackForm');
    fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
    }).then(r => {
        if (!r.ok) throw new Error();
        track('feedback_sent', { has_email: !!form.elements.email.value });
        form.reset();
        form.style.display = 'none';
        $('feedbackSuccess').style.display = 'block';
    }).catch(() => {
        $('feedbackError').style.display = 'block';
    });
}

// Klepnutí do pozadí sheet zavře. Na click, ne pointerdown: tah přes
// pozadí sheet nezavírá.
document.addEventListener('click', e => {
    const modal = e.target.closest('.modal');
    if (modal && e.target === modal) closeModal();
});

// Stažení sheetu dolů ho zavře, jak je zvykem na iOS. Tahá se jen za hlavičku
// (úchyt) nebo za obsah, který už je nascrollovaný nahoře — jinak by tah
// kradl scrollování seznamu.
(function sheetDrag() {
    let box = null, y0 = 0, dy = 0, fromHeader = false;
    document.addEventListener('pointerdown', e => {
        const content = e.target.closest('.modal.active .modal-content');
        if (!content || e.target.closest('input, textarea, button, a')) return;
        fromHeader = !!e.target.closest('.modal-header');
        if (!fromHeader && content.scrollTop > 0) return;
        box = content; y0 = e.clientY; dy = 0;
        box.style.transition = 'none';
    });
    // Na dotyku by tah dolů prohlížeč vzal jako scroll (a pointercancel tah
    // ukončil). Dolů z vrcholu = tah sheetu, tak mu scroll nedovolit. Nahoru
    // v obsahu = obyčejné scrollování seznamu, tah se pustí.
    document.addEventListener('touchmove', e => {
        if (!box) return;
        const d = e.touches[0].clientY - y0;
        if (d > 0 && (fromHeader || box.scrollTop <= 0)) e.preventDefault();
        else if (d < 0 && !fromHeader && !dy) { box.style.transition = ''; box = null; }
    }, { passive: false });
    document.addEventListener('pointermove', e => {
        if (!box) return;
        dy = Math.max(0, e.clientY - y0);
        box.style.transform = dy ? `translateY(${dy}px)` : '';
    });
    const end = () => {
        if (!box) return;
        const el = box; box = null;
        // Dost daleko → sheet dojede dolů z místa, kam ho prst dotáhl; jinak se vrátí.
        if (dy > Math.min(120, el.offsetHeight * 0.25)) return closeModal();
        el.style.transition = 'transform .25s cubic-bezier(.32,.72,0,1)';
        el.style.transform = '';
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
})();

// Mezihra, ovládání prstem (jako příběhy na Instagramu):
//  - podržení kdekoli na panelu mimo tlačítka odpočet na chvíli zastaví —
//    dlouhý význam jde dočíst; puštěním běží dál,
//  - na tlačítku Další se čas zastaví hned, ať nedoběhne pod prstem; puštěním
//    na tlačítku se jde dál (běžné klepnutí), sjetím z něj odpočet pokračuje,
//  - krátké klepnutí na kartu otevře detail slova, jinam = hned další slovo.
// Puštění po podržení mimo Další se nepočítá jako klepnutí, i kdyby z něj
// prohlížeč udělal click.
const HOLD_MS = 250;
let wdPress = null;
$('wordDoneOverlay').addEventListener('pointerdown', e => {
    const onNext = !!e.target.closest('#wdNextBtn');
    if (!onNext && (e.target.closest('button, a') || !e.target.closest('.wd-panel'))) return;
    const press = wdPress = { onNext, long: false, paused: onNext && pauseCountdown() };
    press.timer = setTimeout(() => {
        press.long = true;
        if (!press.paused) press.paused = pauseCountdown();
        if (!press.paused) return;
        $('wdNextBtn').classList.add('paused');
        haptic('tap');
    }, HOLD_MS);
});
const wdRelease = (e) => {
    if (!wdPress) return;
    clearTimeout(wdPress.timer);
    // Na Další se puštěním jde dál jen na tlačítku samém; sjetí z něj (i puštění
    // nad hrou, kam by prohlížeč poslal click) je zrušení.
    // Cíl pointerupu u dotyku nepomůže (prst má implicitní capture na tlačítku),
    // proto se ptá, co je opravdu pod prstem.
    const under = e && e.type === 'pointerup' && document.elementFromPoint(e.clientX, e.clientY);
    const offNext = wdPress.onNext && !(under && under.closest('#wdNextBtn'));
    state.wdSkipClick = (wdPress.long && !wdPress.onNext) || offNext;
    wdPress = null;
    resumeCountdown();
};
document.addEventListener('pointerup', wdRelease);
document.addEventListener('pointercancel', wdRelease);
$('wordDoneOverlay').addEventListener('click', e => {
    if (state.wdSkipClick) { state.wdSkipClick = false; return; }
    if (e.target.closest('button, a')) return;
    if (e.target.closest('.wd-card')) return openDefs();   // celý význam a ostatní kandidáti
    nextWord();
});
// Podržení nesmí otevřít kontextové menu (Android, pravé tlačítko myši).
$('wordDoneOverlay').addEventListener('contextmenu', e => e.preventDefault());

/* ---------------- klávesnice ---------------- */

const STRIP = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

document.onkeydown = e => {
    if (e.key === 'Escape') { closeModal(); return; }
    // Mezihra: Enter nebo mezerník = další slovo (když fokus nestojí na tlačítku).
    if ($('wordDoneOverlay').classList.contains('active') && !document.querySelector('.modal.active') &&
        (e.key === 'Enter' || e.key === ' ') && !e.target.closest('button, a, input, textarea')) {
        e.preventDefault();
        return nextWord();
    }
    if (
        !$('game').classList.contains('active') ||
        state.processing ||
        document.querySelector('.modal.active') ||
        $('wordDoneOverlay').classList.contains('active') ||
        $('pauseOverlay').classList.contains('active')
    ) return;

    if (state.incorrectTimeout && e.key !== 'Enter') {
        clearIncorrectState();
        updateUI();
    }

    if (e.key === 'Backspace' && state.selected.length > 0) {
        e.preventDefault();
        return removeLastLetter();
    }

    if (e.key === 'Enter' && state.selected.length === state.letters.length) {
        e.preventDefault();
        return checkWord();
    }

    if (e.key === 'Shift') { shuffleLetters(); return; }

    if (e.key.length !== 1 || state.selected.length >= state.letters.length) return;
    const key = e.key.toLowerCase();
    // přesná shoda (č, š, ž…), pak shoda bez diakritiky (e → é/ě)
    let tile = [...$$('#letterRow .letter')].find(l =>
        !state.selected.includes(+l.dataset.index) && state.letters[+l.dataset.index] === key
    );
    if (!tile) {
        tile = [...$$('#letterRow .letter')].find(l =>
            !state.selected.includes(+l.dataset.index) && STRIP(state.letters[+l.dataset.index]) === STRIP(key)
        );
    }
    if (tile) {
        selectLetter(tile);
        if (state.selected.length === state.letters.length) checkWord();
    }
};

document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

/* ---------------- start ---------------- */

(function init() {
    // rozehraný, ale nedokončený den z minulosti zahodit (hraje se znovu);
    // úspěchy z něj ale platí a oznámí se na úvodu
    if (persist.day && !persist.day.done && persist.day.date !== todayStr()) {
        Object.assign(persist.ach, persist.day.ach);
        persist.day = null;
        savePersist();
    }
    addHapticOverlays();
    registerServiceWorker();
    Analytics.init({ id: persist.clientId, off: persist.noStats, traits: statTraits() });
    renderStatsToggle();
    showWelcome();
    restoreRoute();
    syncAchievements();   // tečka na Profilu, i pro úspěchy z dřívějška
})();

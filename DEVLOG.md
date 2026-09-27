# Devlog

## 2026-09-27

### Přihlášení na novém zařízení obnoví odehrané dny ze serveru
Denní výzva (`profile_days`) se na serveru vždycky ukládala per účet, ale
klient statistiky v profilu (série, odehrané dny, úspěšnost) i úspěchy
počítal jen z `persist.results` v `localStorage` — na novém zařízení tedy
po přihlášení vypadal profil prázdně, i když účet měl reálnou historii
(ta byla vidět jen na veřejném profilu, který si ji čte přímo ze serveru).
Přihlášení teď odehrané dny stáhne a doplní si je lokálně.

**Root cause / approach:** Nový `GET /api/me/results` (`worker/src/profile.js`,
`myResults`) vrátí `[{dayIdx, score}]` z `profile_days` podle session, ne
podle přezdívky jako `apiProfile` — ten by se skrytým profilem vrátil
404 i vlastníkovi. Klientská `restoreResults()` (game.js, volá se z
`onLoggedIn()` vedle stávající `backfillProfile()`, opačným směrem) doplní
jen chybějící indexy dní — nikdy nepřepíše, co je lokálně už teď — a
přepočítá sérii přes stávající `migrateStreak()`. Úspěchy, které doplněná
historie nově splní, se potichu označí za získané (tečka, bez fronty na
oznámení) stejně, jako to `syncAchievements()` už dělá při úplně prvním
spuštění appky s odehranou historií — jinak by `renderProfile()` hned
po přihlášení vypsal „Nový úspěch!“ za něco, co hráč ve skutečnosti
dohrál dávno, jen na jiném zařízení. Ověřeno v Chromiu (dev-login + ruční
`restoreResults()`, protože ten jede jen přes skutečné přihlášení):
doplnění dnů beze změny lokálních/konfliktních dat, přepočet série,
statistiky v profilu i tichý zápis úspěchů.

Trénink (`persist.practiceSeen`/`practiceBestRun`/`practiceHard`) tímhle
neprochází — server má jen souhrnný počet slov za den
(`training_days.words`), ne která slova to byla, takže se bitová mapa
`practiceSeen` odsud nedá zpětně sestavit. Necháno beze změny.

**Vedlejší nález, neopraveno:** stejné přihlášení na novém zařízení
nezávisle na tomhle vyvolá falešné „Nový úspěch! Nová tvář“ — `auth.user.avatar`
z `refreshAuth()` dorazí až po prvním `syncAchievements()` (voláném při
startu appky), takže se avatarový úspěch tváří jako čerstvě splněný.
Reprodukováno i bez týhle změny (holé přihlášení + otevření profilu).

→ *No new memory entries.*

## 2026-09-25

### Hlavička profilu (soukromého i veřejného) fixní při scrollu
`.screen-bar` (šipka zpět, název obrazovky) se dřív scrollovala pryč s
obsahem — teď zůstává nahoře. Dokud se nescrolluje, plave nad obsahem beze
změny; jakmile scroll začne, dostane pozadí a linku dole, ať je vidět, kde
hlavička končí a obsah pod ní začíná.

**Root cause / approach:** `.screen-bar` byla `position: absolute` uvnitř
`.screen` — ten ale při delším obsahu neroste do fixní výšky, takže se
absolutně umístěný prvek posouval s ním. `position: fixed` řeší scroll, ale
`.screen-bar` musí sama nahradit centrování, které dřív dědila od `.screen`
(`max-width: 440px; margin: auto`), jinak by na širším viewportu neseděla
nad obsahem. `html.scrolled` (nový scroll listener v game.js, `scrollY > 0`)
přepíná pozadí/linku; `.screen-bar` je jen na pěti obrazovkách, co se vůbec
scrollují (`#profile`, `#myDefs`, `#achievements`, `#publicProfile`,
`#profileEdit`), takže se to týká všech stejně. Veřejný profil jako
samostatná sdílená stránka (`/u/<přezdívka>`, jen `page.js`) `.screen-bar`
nemá — tam je hlavička jiný vzor (`.profile-head`), beze změny.

→ *No new memory entries.*

### Odkazy stylované jako tlačítko byly podtržené
`.btn` nikdy neresetoval `text-decoration`, takže `<a class="btn …">` (např.
„Všechny úspěchy" na veřejném profilu) dostal od prohlížeče výchozí
podtržení odkazu. Dvě cílené záplaty (`.page-cta > .btn-play`, `#accountBox
a.btn`) to řešily jen pro konkrétní místa — teď má `text-decoration: none`
rovnou `.btn` a obě záplaty jsou (teď zbytečné) pryč.

→ *No new memory entries.*

### Obrazovka Úspěchy: víc odstupu kolem Na dosah; Denní výzva: počet v hlavičce
„Na dosah" mělo od první skupiny úspěchů pod sebou jen 22 px místo 26 px,
které mají skupiny mezi sebou — teď `#achievements` používá stejných 26 px,
takže „Na dosah" vypadá jako každá jiná sekce. U Denní výzvy byl počet
odehraných dní vlevo od pruhu; teď je v záhlaví vedle „Denní výzva" (stejný
vzor jako „Úspěchy 27/27") a pruh zůstává sám na svém řádku.

**Root cause / approach:** Když se počet přesunul z `.ach-sum.challenge-sum`
(řádkové flex, počet + pruh vedle sebe) přímo do sloupcové hlavičky
(`#collectionModal .modal-header`), zůstalo na `.ach-bar` `flex: 1 1 0%` —
ve sloupci to je hlavní osa (výška), takže bez volného místa k rozdělení
spadla na 0 px místo svých `height: 16px`. Oprava: `#collectionModal
.modal-header .ach-bar { flex: none; }`, ať platí explicitní výška.

→ *No new memory entries.*

### Odkaz Všechny úspěchy: tah po stránce ho stiskl a blokoval scroll
Na samostatných stránkách (404, zásady soukromí, veřejný profil) se
u odkazu „Všechny úspěchy" na veřejném profilu tah prstem přes něj
choval jinak než u ostatních tlačítek v appce — místo scrollu stránky
se odkaz „stiskl" a scroll se zablokoval.

**Root cause / approach:** Dvě mezery proti sobě. (1) `<a href>` je na
iOS/iPadOS Safari nativně „draggable" (odkaz jde odtáhnout jako sdílený
prvek, např. do Split View) — konkurující gesto proti scrollu stránky,
vlastní jen odkazům uprostřed scrollovatelného obsahu, ne tlačítkům
v appce (skutečné `<button>`) ani sticky patičce (`.page-cta`), na
kterou se přirozený tah stránkou tolik netrefí. Přidáno `-webkit-user-drag:
none` vedle stávajícího `-webkit-touch-callout: none` v `*` (style.css) —
stejná dvojice, jakou appka na iOS už potlačuje u podržení prstu.
(2) `page.js` (samostatné stránky bez game.js) měl jen prázdný
`touchstart` posluchač kvůli `:active` stylu, chyběla mu ochrana
`touchFrom` z game.js, která ruší `click`, když mezi dotykem a puštěním
prst posunul stránku — teď je stejný mechanismus i v `page.js`.

→ *No new memory entries.*


### Tlačítko Denní výzva: jen „Uhodnutá slova", bez počtu
Tlačítko v profilu ukazovalo počet i slovo („53 uhodnutých slov"). Teď má
pevný text „Uhodnutá slova", bez čísla.

→ *No new memory entries.*

### Obrazovka Úspěchy: počet v záhlaví místo velkého bloku pod ním
Pod záhlavím „Úspěchy" byl samostatný řádek s velkým číslem „5 z 27" a
širokým pruhem — zabíral místo, než začaly první úspěchy. Teď je počet
rovnou v záhlaví: „Úspěchy 5/27", pruh pryč.

**Root cause / approach:** `#achSumCount` přesunuté z vlastního
`.profile-section` do `<span class="screen-title">` jako `<small>`,
`#achSumBar` (a jeho `.profile-section`/`.ach-sum` obal) smazané —
sdílené třídy `.ach-sum`/`.ach-bar` pro velký blok s pruhem zůstávají,
používá je i sheet Denní výzvy (`challenge-sum`). Ověřeno v Chromiu:
záhlaví „Úspěchy 27/27", starý blok v DOM není.

→ *No new memory entries.*

### Statistiky profilu: dlaždice vedle sebe, ne pod sebou; smazání účtu bez čáry
Dvě „široké" dlaždice (úspěšnost, trénink) na soukromém profilu stály pod
sebou přes celou šířku — teď sedí vedle sebe jako ostatní, čistá mřížka
2×2. Odhlásit se / Smazat účet na soukromém profilu odděluje jen odstup,
ne čára navíc.

**Root cause / approach:** `stat-tile--wide` u obou dlaždic pryč, `.stat-grid`
teď dlaždici sama rozšíří na celý řádek, jen když je poslední a lichá
(`:last-child:nth-child(odd)`) — u soukromého profilu (4 dlaždice, sudý
počet) se to netýká ničeho, u veřejného (3 dlaždice: série, dny, úspěšnost)
zůstane úspěšnost přes celou šířku jako dřív, bez ruční značky v kódu.
`<hr class="account-divider">` mezi Odhlásit se a spodní řádkou pryč,
`.account-fine` má `margin-top: 24px` místo čáry. Ověřeno v Chromiu:
soukromý profil 2×2, veřejný 2+1 přes celou šířku, mezera nad Smazat
účet 36 px.

→ *No new memory entries.*

### Veřejný profil: náhled 4 úspěchů s odkazem na všechny, statistiky sladěné se soukromým
Veřejný profil ukazoval všechny získané úspěchy najednou — s aktivním
hráčem to rostlo bez konce. Teď je vidět jen posledních 4, s odkazem
„Všechny úspěchy" (stejné jméno jako tlačítko v aplikaci) na `?ach=1` —
samostatná stránka se všemi, po skupinách jako v aplikaci (Začátky, Série,
Denní výzva, …). Statistiky sloučené jako u soukromého profilu: „slov
v denní výzvě" a „úspěšnost" byly dvě dlaždice se stejnou informací
dvakrát, teď jedna široká „úspěšnost z X slov v denní výzvě".

**Root cause / approach:** „Poslední" bere čas z `user_achievements.created_at`
— hra ho nahlásí při každé synchronizaci (`syncAchievements`), a to i za
úspěchy, které server spočítá sám ze statistik (dny, série, …), takže časové
razítko má prakticky každý získaný odznak, ne jen ty čistě klientské
(sdílení, Bleskovka). Bez záznamu (starý účet, úspěch nikdy nenahlášený)
se řadí jako nejstarší. `achievementsSection` teď vrací náhled + odkaz,
nový `achievementsPageBody` celý seznam seskupený přes `Achievements.GROUPS`
— stejný vzor jako `renderAchievements` v game.js. `profilePage` routuje
`?ach=1` (a `?cast=1&ach=1` pro SPA) přes stejný `page()` wrapper jako
hlavní profil, se zpětným odkazem nahoře. Ikony a odkazy v novém markupu
mají absolutní cesty (`/designs/...`) — na `/u/handle?ach=1` by relativní
`designs/...` mířilo o úroveň vedle. Test „veřejný profil ukáže i odznaky
z klienta" přepsaný na nové chování (náhled ≤ 4, `?ach=1` má všechno).
Ověřeno v `wrangler dev` s dev seedem (Tester, 8 úspěchů): náhled 4 dlaždice
+ odkaz, `?ach=1` všech 8 po skupinách, zpět funguje, SPA vestavěná verze
beze změny chování a bez chyb v konzoli.

→ *No new memory entries.*

### Profil: méně mezery pod Moje významy, obecnější výzva, smazání účtu jako odkaz
Mezera mezi prázdnou kartou „Moje významy" a řádkem zpětné vazby byla dvojitá
(22 px mezera sekcí + 40 px vlastní `margin-top`) — teď jen 22 px jako mezi
ostatními sekcemi. Výzva ke zpětné vazbě mluví v množném čísle („Napiš nám.
Každou zprávu čteme…"), ať není znát, že hru dělá jeden člověk — stejně
upravený placeholder ve formuláři samotném. Odhlášení a smazání účtu už
nejsou dvě stejně velká tlačítka pod sebou: mezi nimi je tenká čára,
„Smazat účet" je pod ní prostý červený textový odkaz vedle Zásad soukromí.

**Root cause / approach:** Zbylé dvě věci jen CSS. „Smazat účet" zůstává
`<button>` (spouští potvrzení a mazání, nikam nevede), jen bez chlopně,
pozadí a rámečku — zásady soukromí dál mluví o „tlačítku Smazat účet" a
platí to beze změny, i vizuálně je to teď spíš odkaz. Ověřeno v Chromiu:
mezera 22 px, klik na smazání pořád funguje (potvrzovací dialog).

→ *No new memory entries.*

### Tlačítko Denní výzva: uhodnutá slova, a otevírá se rychleji
Tlačítko v profilu ukazovalo „Odehráno N dní“. Teď ukazuje „N uhodnutých
slov“ (celkem ze všech dní, stejné číslo jako v dlaždici úspěšnosti).
Otevření kalendáře (`showCollection`) bylo taky znatelně pomalejší než
ostatní tlačítka na obrazovce — v Safari bez nativní podpory `corner-shape`
citelně.

**Root cause / approach:** Tři věci najednou. (1) `showCollection` stavěla
365 `<li>` vždy znovu při KAŽDÉM otevření, i beze změny dat — teď se
sestavený seznam cachuje podle otisku `persist.results` a data, druhé
otevření beze změny jen ukáže hotový sheet. (2) Slova dne (20 dlaždic na
každý odehraný den) se stavěla dopředu pro každý odehraný den, i skryté —
teď se sestaví líně, až na klepnutí (`revealDayWords`). (3) 365 kolečkových
odznaků skóre (`.archive-score`, rádius 999px = plná pilulka) navíc
procházelo `squircle.js` — v Safari bez nativní podpory `corner-shape` to
pro každý spočítá ořez přes `getComputedStyle` a trigonometrii. U plné
pilulky je čtverec vs. přesná squircle křivka k nerozeznání, takže
`.archive-score` přibyl do `SKIP` v `squircle.js`. Nezasahoval jsem do
mechanismu `squircle.js`, který po jakékoli změně třídy na rodiči (tady
otevření sheetu) přepočítá i celý podstrom bez ohledu na to, co se doopravdy
změnilo — reálně přispívá k opakovanému otevření taky, ale je to široké
místo mimo rozsah týhle opravy a nejde ověřit bez skutečného Safari.

Změřeno v Chromiu s vynuceným squircle fallbackem (200 odehraných dní):
první otevření 422 → 274 ms, druhé (cache) 340 → 112 ms — pořád víc než
ostatní tlačítka (~60 ms), ale citelně méně. Bez fallbacku (nativní
`corner-shape`, jako v Chromiu bez úpravy) byl dopad menší, tam dělal
většinu rozdílu jen fragment a líná slova.

→ *No new memory entries.*

### Statistiky v profilu: počet slov jen jako rozpis úspěšnosti, ne vlastní dlaždice
Dlaždice „slov v denní výzvě“ ukazovala celkový počet uhodnutých slov ze
všech odehraných dní — číslo samo o sobě nic neříkalo (kdo hraje déle, má
ho víc, bez ohledu na to, jak mu to jde). Teď je to jen rozpis v popisku
dlaždice úspěšnosti: „82 % — úspěšnost z 780 slov v denní výzvě“. Kolik toho bylo
uhodnuto, řekne procento samo, druhé číslo navíc by bylo zbytečné — jen z
kolika slov se počítá. Bez odehraného dne zůstane jen „úspěšnost“.

**Root cause / approach:** V `renderProfile` zmizela samostatná dlaždice
`words`, `pct` dostala širokou dlaždici s popisem podle vzoru tréninkové
dlaždice pod ní. Ikony `.stat-tile:nth-child()` přečíslované (terč teď na
3. místě u úspěšnosti — sedí líp než dřívější kostka k holému počtu, dýnko
na 4.). Ověřeno v Chromiu při 0, 3 a 5 odehraných dnech.

→ *No new memory entries.*

### Poznámka pod přihlašovacím tlačítkem na střed a s odstupem
Text „Pošleme ti odkaz a kód…“ pod tlačítkem Poslat přihlašovací odkaz byl
zarovnaný vlevo a nalepený hned pod tlačítko. Teď je na střed a s větším
odstupem shora.

**Root cause / approach:** `.profile-note` sdílí desítka míst v profilu
(štítky nad formulářem, jako „Vyber si přezdívku“) a má schválně `margin:
-6px` — táhne se pod nadpis sekce. Tahle poznámka je jediná, co stojí pod
tlačítkem, ne nad formulářem, proto novmeasure modifikátor
`.profile-note--login` jen na ní (`#profile .profile-note--login`, ať
přebije specifičtější `#profile .profile-note`). Ostatní místa se stejnou
třídou beze změny (ověřeno v Chromiu).

→ *No new memory entries.*

### Výzva ke zpětné vazbě říká, s čím a proč psát
V profilu místo „Díky za hru! Můžeš mi poslat zpětnou vazbu.“ stojí: „Něco
nefunguje, slovo ti nesedí, nebo tě napadlo, co přidat? **Napiš mi.** Každou
zprávu čtu a hru podle hráčů ladím.“ Odkaz je „Napiš mi.“ a otevírá stejný
formulář.

**Root cause / approach:** Jen text v index.html. Tři konkrétní důvody
(chyba, slovo, nápad) napoví, o čem psát. Druhá věta říká, proč to má smysl.
Věta „Díky za hru“ je pryč. Formulář (nadpis „Jak se ti hraje?“, placeholder)
zůstal beze změny.

→ *No new memory entries.*

### Zpět do hry drží u spodního okraje na zásadách, profilu i 404
Na dlouhých stránkách (zásady soukromí, veřejný profil /u/) bylo tlačítko
zpět do hry až na konci pod textem a nebylo vidět. Teď drží u spodního okraje
po celou dobu čtení a text pod ním mizí do pozadí. Na 404 sedí dole jako Hrát
na úvodu.

**Root cause / approach:** Nová třída `.page-cta` ve style.css: sticky pruh
u spodního okraje s přechodem do pozadí, tlačítko 30 px + safe area od spodku
jako Hrát. Obaluje tlačítko na soukromi.html, 404.html i v `page()` v profile.js.
Na zásadách se sticky nejdřív nechytil, protože jejich styl dělal z `body`
scroll kontejner (`overflow-y: auto`), který se nikdy nescrolluje. Scrolluje
teď jen html, jak radí záznam ze 24. 9. U profilu přebíjel `#publicProfile`
spodní okraj, pomohl `#publicProfile.public-page`. Stránka 404 se na
320×568 (SE se zvětšeným zobrazením) nevešla a nešla scrollovat, tlačítko
pak překrylo text. Teď scrolluje a mezery se zmenšily, takže se na běžné
telefony vejde celá. Změřeno v Chromiu na SE, 8, 13 i 15 Pro Max: tlačítko
je nahoře, uprostřed i na konci stránky 30 px od spodku.

→ *No new memory entries.*

### Tlačítka na 404, zásadách soukromí a veřejném profilu se zamáčknou jako ve hře
„Zpět do hry“ (404, zásady soukromí) a „Zahrát si taky“ (profil /u/) na
iPhonu při stisku nic neukazovaly. Teď se zamáčknou o ret jako tlačítka
ve hře a v Safari mají stejné squircle rohy.

**Root cause / approach:** Styly byly stejné (`.btn:active`), ale iOS Safari
ukáže `:active` jen na stránce, která poslouchá dotyk. Hra má posluchače
v game.js, samostatné stránky žádné neměly a nenačítaly ani squircle.js.
Nový `public/page.js` přidá prázdný pasivní `touchstart` a spolu se
squircle.js je na 404.html, soukromi.html i ve `page()` v profile.js.
Při ověřování se ukázala slabina opravy useknutého retu: `transitionend`
při stisku přepočítal ořez bez retu, takže ret po puštění do konce přechodu
chyběl. Během `:active` se proto ořez nepřepočítává. Ověřeno v Chromiu
s vynuceným squircle fallbackem: stisk posune tlačítko o 4 px a schová stín,
ořez s retem zůstává a písmena ve hře jsou po odebrání dál s retem.
Skutečné `:active` na iOS se v Chromiu ověřit nedá.

→ *No new memory entries.*

### Stránka 404 se na webu opravdu ukáže
Po nasazení vracela neznámá adresa na 20slov.cz holé `{"error":"not found"}`
místo stránky s duchem. Teď dostane `public/404.html` se stavem 404.
Neznámé `/api/…` dál vrací JSON.

**Root cause / approach:** Když má projekt worker, Cloudflare mu pošle každou
adresu, pro kterou `[assets]` nenašly soubor. `not_found_handling = "404-page"`
se tak samo neuplatní a worker vrátil svou JSON chybu. Nově worker neznámou
GET/HEAD adresu mimo `/api/` předá `env.ASSETS.fetch(request)` a teprve
statika podle wrangler.toml pošle 404.html. Ověřeno ve `wrangler dev`:
`/tohle-neexistuje` a `/a/b/c` → 404 s duchem (i písmo a avatar.js z kořene),
`/api/neexistuje` → JSON 404, `/u/nikdo` → vlastní 404 profilu, ostatní beze změny.

→ *No new memory entries.*

### Stránka 404: duch z avatarů hry místo sovy
Na stránce 404 je místo sovy avatar ze hry: levandulový duch (`17-9-6-5`,
tvar duch, oči stranou, zmatená vlnka), jak hledá stránku, která není.
Vznáší se nad kostkami 4 0 4 a kolébá se. Spodní vlnky vlají, panenky se
rozhlížejí a po zamíchání kostek na ně kouknou dolů. Otazníky se střídavě
nafukují a naklánějí.

**Root cause / approach:** Avatar se kreslí přes `public/avatar.js`
(`Avatar.svg`), takže mrká stejně jako v profilu. Vlnitý spodek, podle
kterého je to duch, by kostky zakryly. Proto duch nekouká zpoza dlaždic
jako sova, ale vznáší se nad nimi (`nfFloat`). Texty se sovou přepsané
na ducha. Animace jsou jen na téhle stránce, avatar.js se nemění. Vlnky
jsou SMIL `<animate attributeName="d">` na výplni i retu těla, mezi tvarem
z avatar.js a tvarem s prohozenými řídicími body vln (82 ↔ 95). CSS `d`
Safari animovat neumí. Kdyby se tvar ducha změnil, náhrada nic nenajde
a vlnky jen stojí. Panenky (tmavé tečky v `.av-eye`) mají CSS `nfLook`.
Při `prefers-reduced-motion` se nic z toho nespustí. Ověřeno v Chromiu
vzorkováním hodnot v čase a snímky vln ve dvou fázích (`setCurrentTime`).

→ *No new memory entries.*

### Stránka 404: sova nad kostkami 4 0 4
Neznámá adresa už nevrací holou chybu Cloudflaru, ale stránku ve stylu hry:
„Slovo 404 · neexistuje", sova se zdviženým obočím kouká přes kostky 4 0 4
a nula je červená a spadlá na bok jako nestihnuté slovo. Klepnutím se kostky
zamíchají a pod nimi se střídají hlášky („Víc přesmyček tři kostky nemají.").

**Root cause / approach:** `public/404.html` na sdíleném `style.css`, všechno
z kořene, protože cesta může být libovolně hluboká. Ve `wrangler.toml`
`not_found_handling = "404-page"`, takže ji assets vrátí se stavem 404.
`/api/*` a `/u/*` jdou dál přes worker a svoje 404 si řeší samy.

→ *No new memory entries.*

### Mezihra: podržení palcem už panel nezmenšuje
Při podržení se panel mezihry nepatrně zmáčkl (scale .985). Zbytečné, pauzu
ukazuje tlačítko Další. Odstraněno i s třídou `holding`.

→ *No new memory entries.*

### Trénink: mezihra ukazuje složenou přesmyčku a její význam
Když hráč v tréninku složí jiné platné slovo ze stejných písmen (ocet místo
otec, okr místo rok), hra ho uzná jako dřív. Mezihra teď ukáže kostky
i význam toho, co složil, ne hledaného slova.

**Root cause / approach:** `isAcceptedWord` vracel jen ano/ne, takže
`showWordDone` dostal hledané slovo a načetl jeho význam. Nově `acceptedWord`
vrací složené slovo (hledané, nebo přesmyčku z `ALTS` i s mezerami a
interpunkcí) a mezihra, význam, přidání významu i úspěch Přesmyčkář jedou
podle něj. Do „už padlo“ se dál zapisuje hledané slovo. Ověřeno v Chromiu:
otec → ocet, rok → okr, dotaz na význam jde na složené slovo.

→ *No new memory entries.*

### Pauza: větší stopky, Pokračovat dole u palce
Obrázek spících stopek je o polovinu větší (140 → 210 px). Tlačítko Pokračovat
sedí dole jako Hrát na úvodu: stejná šířka a 30 px nad spodním okrajem
(+ safe area). Stopky s nadpisem jsou uprostřed zbylého místa.

**Root cause / approach:** Jen CSS. `.pause-overlay` dostal odsazení jako
`.screen`. Auto marginy nad stopkami a nad tlačítky rozdělí volné místo, takže
nadpis zůstane u obrázku a tlačítko u palce. Změřeno v Chromiu na iPhonu 13
i SE: tlačítko má stejnou polohu i šířku jako Hrát.

→ *No new memory entries.*

### Písmena v Safari už nezůstávají dole useknutá; klepnutí na slovo bere poslední písmeno
Na iPhonu zůstávalo písmeno po vybrání a odebrání bez spodního retu, jako
by bylo useknuté. Klepnutí do skládaného slova teď odebere jen poslední
písmeno, stejně jako Backspace, místo celého slova.

**Root cause / approach:** V Safari kreslí rohy i ret `squircle.js` jako
`clip-path` spočítaný z aktuálního `box-shadow`. Po odebrání písmena změna
třídy spustí přepočet hned, ale stín v tu chvíli teprve dojíždí přechodem
(`box-shadow .08s` z `none`). Ořez se proto spočítal bez retu a už se nezměnil.
Nově se ořez přepočítá i po `transitionend` stínu. Reprodukováno v Chromiu
s vynuceným squircle fallbackem: před opravou měla dlaždice po odebrání
ořez bez retu, po opravě s ním. Klepnutí na slovo i Backspace sdílí
`removeLastLetter`, `playClearSound` (zvuk smazání celého slova) zmizel.

→ *No new memory entries.*

### Správa hry na /admin
Nová stránka `/admin` (`public/admin.html`, API `worker/src/admin.js`) nahrazuje
ruční SQL. Přehled ukazuje čísla, posledních 7 dní denní výzvy a nahlášené
i skryté významy ke kontrole. Významy jde hledat a vrátit, skrýt nebo smazat.
Hráče jde hledat, zablokovat, přejmenovat nebo jim skrýt profil. Správce se
přihlásí normálně ve hře, pozná ho secret `ADMIN_EMAILS`.

**Root cause / approach:** Admin rozhraní dosud neexistovalo v repu, v nasazeném
workeru ani na GitHubu. Moderace šla jen přes `wrangler d1 execute`. Správce
se nepozná tokenem, ale existující session: e-mail v DB není, takže se
porovnávají hashe s pepřem (`peppered`, nově exportované z auth.js).
Ostatním vrací `/api/admin/*` 404. Opravené mezery z auditu: vrácení
významu maže i jeho nahlášení (jinak by další jedno skrylo význam znovu)
a zablokovaný hráč už nemá veřejný profil (`loadProfile`). Blokace ho navíc
odhlásí a skryje mu významy. Cache významů (`defCacheKey`, `dropDefCache`) se
přesunula do `src/defcache.js`, aby ji mohl používat i admin.js. Testy
v `test.mjs` jedou proti SQLite. Celé rozhraní je proklikané v `wrangler dev`
s dev seedem. Dev login ve Wrangleru 4 potřebuje `--local-upstream localhost:8787`,
jinak worker dostane adresu `20slov.cz` a stráž vrátí 404.

→ *No new memory entries.*

### Úspěch z denní výzvy až po ní, ne uprostřed
Na iPhonu v Safari (neregistrovaný hráč, první hra) po návratu z jiné
aplikace čekal uprostřed rozehrané denní výzvy sheet „Nový úspěch!“
s Bleskovkou. Úspěchy získané v denní výzvě (Bleskovka, Na chlup) teď
čekají u dne a oznámí se až po jejím konci, po odhalení výsledku.

**Root cause / approach:** Oznámení během hry nikdy nešlo, `announceAchievements`
hru hlídá a `syncAchievements` se během denní výzvy nevolá. Jenže `checkWord`
zapisoval příznak rovnou do `persist.ach` a `saveDayProgress` ho každou
vteřinu uložil. Safari po návratu z jiné aplikace stránku znovu načetl
(proces stránky na pozadí skončil). Start (`init` → `syncAchievements`) příznak
našel a `showWelcome` → `whenCalm` úspěch oznámil na úvodu, přestože den
ještě běžel. Po zavření sheetu šlo hrát dál z uloženého stavu. Nově jdou
příznaky z denní výzvy do `persist.day.ach` a do `persist.ach` se přelijí
ve `finishDay` (i po křížku). Když start zahazuje nedohraný den z minulosti,
úspěch z něj zůstane a oznámí se na úvodu. Ověřeno v Chromiu: stejný scénář
(slovo do 3 s, reload, dohrát) ukazoval před opravou Bleskovku na úvodu,
po opravě přijde až po výsledku za Prvním kolem.

Poznámka k černé obrazovce níž: reload po návratu ukazuje, že Safari proces
stránky ukončuje. Černá obrazovka ve hře může být totéž v popředí (konec
procesu stránky), ne gesto zpět. Na zařízení to pořád není ověřené.

→ *No new memory entries.*

### Denní výzva: černá obrazovka po gestu zpět
Během denní výzvy občas na telefonu zčernala obrazovka, zmizela všechna
tlačítka a hra přestala reagovat, třeba u posledního slova. V denní výzvě
už gesto zpět od levého okraje na iOS nezačne. Ven vede křížek, Android
a tlačítko zpět v prohlížeči se dál ptají přes potvrzení.

**Root cause / approach:** Od zapojení historie prohlížeče (5b18a93) přidává
start hry záznam `#hra`, takže tah od levého okraje je na iOS gesto Zpět
(v Safari i v aplikaci na ploše). Při rychlém ťukání do písmen se spustí
omylem. Safari při gestu ukáže snímek předchozí obrazovky, a když ho nemá,
jen pozadí stránky, což je v tmavém vzhledu černá. Obsluha `popstate`
v denní výzvě gesto hned vracela `pushState` a otevřela potvrzení konce
(čas stojí). Nový záznam uprostřed návratu nejspíš Safari nechal snímek
viset, a pod ním nebylo vidět nic. V Chromiu se chyba nedá vyvolat, na
iPhonu to ověřené není. Oprava má dvě vrstvy: nepasivní `touchstart`
s `preventDefault` v pásu 24 px u levého okraje, jen v denní výzvě
a mimo tlačítka a písmena, gesto zruší (iOS 13.4+). Na 320px displeji se
zvětšeným zobrazením sahají písmena až k okraji, klepnutí na ně zůstává.
Kdyby gesto přesto prošlo, vrací se záznam `#hra` až po dokončení návratu
(`setTimeout`), ne přímo v `popstate`.

→ *No new memory entries.*

### Úvodní obrazovka: tlačítko dole, plynulé přechody
Top-bar odstraněn z absolutní pozice a zařazen do flex flow; `welcome-body` s `flex:1` centruje střední obsah; `welcome-actions` zůstává u spodního okraje na libovolně velké obrazovce. Přechody push/pop opraveny — příchozí obrazovka nově přijíždí z `window.innerWidth` (celý viewport), ne jen z 440 px od středu, kde byla na desktopu viditelně uvnitř okna.

**Root cause / approach:** `translate: '100% 0'` je 100 % šířky elementu (440 px), ne viewportu — na velkých obrazovkách animace začínala viditelně uprostřed. `will-change: transform, opacity` přidáno na `.screen-leaving` a `.screen-over` pro GPU kompozici před startem animace.

→ *No new memory entries.*

### Zásady soukromí, náhled odkazu (og.png) a pravdivé smazání účtu
Nová stránka `/soukromi` (`public/soukromi.html`, shell jako veřejný profil). Správce je Michal Acler, kontakt `ahoj@20slov.cz`. Odkaz na ni je u přihlašovacího formuláře a v profilu. Hra i profily mají `og:image` 1200×630 (`public/og.png`), obrázek se kreslí na `public/dev-og.html` stejnými kostkami jako karta ke sdílení. Tvrzení „žádná osobní data“ v README, `schema.sql` a `game.js` nahradil popis toho, co se skutečně ukládá. DNSSEC na `20slov.cz` je aktivní a validovaný (`ad` na 1.1.1.1, 8.8.8.8 i 9.9.9.9).

**Root cause / approach:** Text o soukromí sliboval víc, než kód dělal. `meDelete` nechával `profile_days` a hlasy smazaného hráče zůstávaly v `definitions.votes`. Navíc `schema.sql` mělo `definitions.user_id NOT NULL`, takže na čerstvé databázi padalo smazání účtu s významy na constraintu. Produkce má sloupec z `ALTER TABLE`, a tedy nullable. Chytil to nový test v `test.mjs`. Service worker ukládal každou navigaci jako `/`, takže otevřená `/soukromi` nebo dev stránka by offline nahradila hru. Teď se ukládá jen `/`.

→ *No new memory entries.*

### Doména 20slov.cz: Cloudflare, Resend, Email Routing, přihlášení zapnuté
`20slov.cz` je registrovaná u Wedosu (NSSET `CLOUDFLARE-GO`: anna + keanu) a zóna běží v Cloudflare. Worker `20slov` ji má jako custom domain, `www` přesměrovává na hlavní doménu 301 (Single Redirect), Always Use HTTPS je zapnuté. `SITE_URL` a `FALLBACK_URL` míří na `https://20slov.cz/`. Resend má ověřený DKIM a SPF (region eu-west-1). Na workeru jsou `RESEND_KEY`, `MAIL_FROM` a `HASH_PEPPER`, takže přihlášení je zapnuté. Email Routing je zapnutý, přeposílání čeká na ověření cílové adresy. DNSSEC je v Cloudflare `pending`, dokud se klíč nezadá ve Wedosu.

**Root cause / approach:** Resend nabízí Auto configure jen tehdy, když doména veřejně ukazuje na Cloudflare. U čerstvé `.cz` domény chvíli trvá, než ji CZ.NIC zveřejní, do té doby vrací NXDOMAIN. Stav „Partially Verified“ v Resendu způsobuje zapnutý přepínač Receiving, nikoli odesílání. `dig +short NS … @a.ns.nic.cz` vrací u delegace prázdný výstup (odpověď je v AUTHORITY), proto hlídání čekalo zbytečně. Email Routing vyžaduje aktivní zónu a pravidlo jde vytvořit jen pro ověřenou cílovou adresu.

→ *Memory saved: `domain_20slov_setup.md`, `cloudflare_do_it_yourself.md`*

### Přejmenování i identifikátorů na 20slov: worker, D1, repo, sůl slov
Hru zatím nikdo nehraje, takže se po textech pro hráče (2026-09-21) přejmenovaly i identifikátory. Worker je `20slov` (na `https://20slov.slov2000.workers.dev/`), D1 `20slov`, klíč v localStorage `20slov`, cache SW `20slov-…`, sůl denních slov `20slov` a repo `agilek/20slov`. Denní slova zůstala stejná, jen se přebalila novou solí. Stará D1 `slov2000` zatím leží netknutá.

**Root cause / approach:** Worker jde přejmenovat na místě: `PATCH /accounts/:a/workers/workers/:id {"name"}` mu nechá secrety, cron i verze. D1 přejmenovat nejde, takže `d1 export` → `d1 create` → `d1 execute --file`. Lokální D1 má soubor pojmenovaný podle `database_id`, proto se dev data přesunula přejmenováním sqlite souboru. Subdoména workers.dev (`slov2000`) patří celému účtu a sdílí ji `barcelonacardfamily-com`, zůstala tedy beze změny.

→ *Memory saved: `cloudflare_rename.md`*

## 2026-09-24

### Styleguide: scrollování a stará CSS ze service workeru
Na `dev-styleguide.html` nešlo scrollovat a pořád tam byla vidět stará podoba stránky. Přebití layoutu hry dávalo `body` `overflow-x: hidden`, čímž z něj udělalo nescrollovatelný kontejner; `overscroll-behavior: none` ze `style.css` pak spolklo kolečko i tah prstem. Navíc dev stránky ovládá service worker hry (scope `/`) a `style.css` servíruje cache-first, takže opravy CSS nebyly vidět.

**Root cause / approach:** `body` musí zůstat `overflow: visible` — jakákoli jiná hodnota (i jen na jedné ose) z něj udělá scroll kontejner. Přebití rozděleno na `html` a `body.sg`; dev stránky se navíc odregistrují ze SW a jednou reloadnou, když je ovládá.

Zbývá tmavá čára na hranici prvního viewportu, kterou hlásí jen headed Chrome — v Safari ani v headless Chromiu 146 (stejná verze, stejné okno, dark i light) se neobjeví a v DOMu jí neodpovídá žádný prvek ani pseudo-prvek. Vypadá na artefakt GPU compositoru; pro jistotu na dev stránce vypnutý `transition` pozadí z `style.css`.

→ *Memory saved: `dev_pages_scroll_and_sw.md`*

### Refaktoring celé appky: rychlejší načtení, Safari bez zbytečné práce, jeden stylesheet
Architektura (jeden Worker + D1, statika bez buildu, sdílené moduly hra/worker)
zůstala. Vzhled se nezměnil, ověřeno snímky HEAD proti stromu v Chromiu
i WebKitu. Na první načtení jde o ~70 kB méně a nic se nestahuje z cizích
domén. `words.js` 132 → 86 kB brotli, v cestě už není Google Fonts, zmizely
preloady nepoužitých řezů. `squircle.js` v Safari dělá ~36× méně
`getComputedStyle`. CSS je jeden `style.css` (kostky.css v něm, 403 přebitých
deklarací a mrtvé třídy pryč). `?v=`/CACHE/SHELL počítá `tools/stamp.mjs`.
Worker má sdílené `http.js`, percentil jedním dotazem a opravu pro druhý rok.

**Root cause / approach:**
- `squircle.js`: MutationObserver po každé změně DOM prošel celý dokument.
  Časovač ji dělá každou sekundu. Teď bere jen přidané, odebrané a přetříděné
  prvky a odebrané pouští z ResizeObserveru, který je dřív držel navždy.
- `PACKED`: nese pořadí v poolu místo šifrovaného textu, který nešel komprimovat.
- Baloo 2 i Slovka ExtraLight se stahovaly, ale nikde nevykreslovaly (`document.fonts`).
- `results` měl klíč podle dne v cyklu 1–365, takže od 21. 9. 2027 by se míchaly
  výsledky dvou let. Klient teď posílá pořadí dne od startu (v prvním roce je
  totéž číslo).

→ *Memory saved: `visual_regression_harness.md` (nové); upraveno `squircle_corners.md`, `packed_daily_words.md`, `slovka_weights.md`, `ios_native_feel_gotchas.md`, `parallel_sessions_commits.md` + odkazy na kostky.css*

### Obrazovky v historii prohlížeče: zpět gestem a reload na stejné místo
Reload vracel hráče vždy na úvod a gesto zpět z Profilu opustilo hru.
Každá obrazovka má teď adresu za # a historie prohlížeče kopíruje zásobník
navigace. Popsané v GAME_DESIGN.md u navigace.

**Root cause / approach:** Jen v `showScreen`: když zásobník roste,
`pushState`, když se zkrátí (zpět v appce, návrat domů), `history.go(-n)`
a výsledný popstate se spolkne (`navIgnorePops`). Popstate zvenku přepne
obrazovku přes `openRoute` s `navFromPop`, aby se historie nehnula podruhé.
Záznam nese celý zásobník (`navState`). Bez toho reload znovu pushoval
a historie rostla o duplikáty. Ručně přepsaný # nemá `state`, obrazovku
dá `parseHash`. Ověřeno ve WebKitu: reload ×2, zpět, šipka, trénink,
ruční #, nová karta s #.

→ *Memory saved: `ios_native_feel_gotchas.md` (doplněno)*

### Přechody obrazovek jako v mobilních appkách (push/pop, hra jako vrstva)
Místo stejného náběhu zespodu pro všechno mají přechody směr podle
hierarchie. Hlouběji přijede nová obrazovka zprava, zpět odjede doprava
a předchozí se vrátí i se scrollem. Hra se otevírá a zavírá jako vrstva přes
aplikaci. Popsané v GAME_DESIGN.md „Navigace a přechody“.

**Root cause / approach:** Jedno místo, `showScreen`: zásobník `navStack`.
Obrazovka, která už v něm je, znamená zpět, jinak jde hlouběji; `result`
a `welcome` jsou jeden klíč „domov“. Obrazovky se jinak jen přepínají
`display` a stránka scrolluje celý dokument. Proto odcházející dostane na
dobu animace `.screen-leaving` (`position: fixed`, `top: -scrollY`) a zůstane
vidět přesně, kde byla. Příchozí je v toku. Animace přes WAAPI (`translate`,
`opacity`, `scale`), nahoře je vždy ta, která se hýbe přes druhou
(`.screen-over`). Ověřeno ve WebKitu snímky uprostřed přechodu.

→ *Memory saved: `ios_native_feel_gotchas.md` (doplněno)*

### Odlesk odznaku jako na ikonách, celkový pruh úspěchů u „N z 27“
Odlesk je krátká světlá pilulka u horní hrany vlevo (30 % × 8 %, bílá .35),
stejná jako na ikonách v `designs/kostky/` (kostka.svg, kalendar.svg).
Oblouky podle rohu uživateli stylově neseděly. Malé oranžové pruhy pod
zamčenými dlaždicemi nebylo jasné, co znamenají. Jsou pryč a v nadpisu
sekce je jeden celkový pruh vedle „N z 27“. Postup jednotlivých odznaků
zůstal v detailu a v „Na dosah“, kde má popisek.

→ *No new memory entries.*

### Série v mezihře nad slovem, profil bez věty „Série i postup…“
Odznak „N v řadě“ je v mezihře hned pod nadpisem („Výborně!“), přímo nad
slovem (`#wdStreak` zpátky v `.wd-head`, za nadpisy). Z profilu zmizela
i druhá věta nahoře, „Série i postup žijí jen v tomhle zařízení…“
(`#profileDeviceNote`).

→ *No new memory entries.*

### Otisk po vzatém písmenu čárkovaně, víc místa nad symbolem mezihry
Vzaté písmeno nechá tmavší důlek (`--ghost` + 7 % `--ink`) s čárkovaným
okrajem `--muted`; rámeček 2 px už písmeno mělo, takže nic neposkočí.
Panel mezihry má nad symbolem 40 px místo 20.

→ *No new memory entries.*

### Hra bez ikony hodin
Ikona hodin před „Slovo N · obtížnost“ je pryč, i s pravidlem, které ji
v posledních sekundách barvilo červeně. Nahoře zůstal jen text, pod ním čas.

→ *No new memory entries.*

### Mezihra po slově: symbol, nadpis, slovo pod sebou na střed
Panel po slově (uhodnuté i „Čas vypršel“) má každou část na vlastním řádku
na střed: velký symbol ✓/✗ (88 px), nadpis s podtitulkem, kostky slova,
pak série „N v řadě“, význam a tlačítka. Série se v markupu přesunula za
slovo (`#wdStreak` za `#wdTiles`), `.wd-head` je sloupec.

→ *No new memory entries.*

### Hra: políčka pod časem, víc místa dole
Políčka odpovědi jsou hned pod časem (`margin-top: 14px`) a volné místo
jde nad písmena (`#game .letter-row { margin-top: auto }`). Spodní okraj hry
je 44 px (dřív 20) + safe area. Na iPhonu SE i 13 v tréninku i ve výzvě
čas → políčka 34 px, dole 44 px. Starý SE 320×568 se do výšky nevejde celý
(dole 31 px) a písmena tam přetékají do šířky; to bylo i dřív.

→ *No new memory entries.*

### Profil bez věty o přezdívce, zlatá ocenění bez retu, celá tužka u avataru
Z profilu zmizela věta „Přezdívka se ukazuje u…“. Hláška „Top X % hráčů“
na výsledku a bodová pilulka v profilu nemají spodní ret: jsou to ocenění,
ne tlačítka. V Safari už clip-path neusekne tužku u avataru (`.avatar-btn`
v `SKIP` squircle.js, tužka vyčnívá přes kruh).

→ *No new memory entries.*

### Ret tlačítek zpět v Safari, hlavička hry, větší políčka, Přidat na plochu jako jedno tlačítko
V Safari chyběl od prvního nasazení squircle.js (17:43) spodní ret všech
tlačítek. Hlavička hry je jeden centrovaný řádek „🕐 Slovo 3/20 · Lehká“
a pod ním velký čas; hodiny zčervenají spolu s časem. Políčka odpovědi jsou
větší (až 54 px, mezera 8) a o 30 px dál od písmen. Přidat na plochu je
jedno tlačítko přes celou šířku: akce | křížek, oddělené svislou čárou.

**Root cause / approach:** Maska ve WebKitu kreslí jen uvnitř boxu,
`mask-clip: no-clip` neumí a `box-shadow` (ret) padne pod ořez. squircle.js
proto používá `clip-path: path()`: cesta smí z boxu vyčnívat, takže je v ní
tvar a stejný tvar posunutý o každý ostrý stín. Prvky s rozostřeným stínem
se nechají s obyčejným zaoblením. Ověřeno barvou pod tlačítkem ve WebKitu.
Ret „zmizel“ jen v Safari, v Chromu (nativní corner-shape) byl vždycky.

→ *Memory saved: `squircle_corners.md` (přepsáno na clip-path)*

### Nadpisy obrazovek se zpětným tlačítkem uprostřed
Profil, Moje významy, Úspěchy, Upravit profil a Veřejný profil mají nadpis
uprostřed obrazovky, ne hned vedle šipky zpět. `.screen-bar` je mřížka
`1fr auto 1fr`: zpět vlevo, nadpis ve středním sloupci, akce (`.screen-bar-end`)
vpravo. Postranní sloupce jsou stejně široké, takže nadpis sedí na středu
i bez akce vpravo (ověřeno ve WebKitu, střed nadpisu = polovina šířky).

→ *No new memory entries.*

### „Sbírka slov“ → „Denní výzva“: cílem je nasbírat 365 dní
Přehled dní se jmenuje Denní výzva. Tlačítko v profilu ukazuje „Odehráno
N dní“, sheet má nahoře „N z 365 dní“ s pruhem a větu „Co propásneš, vrátí
se až za rok“. Data jsou bez roku, den se každý rok vrací. Odznaky skupiny
„Sbírka“ jsou teď „Kalendář“ na dny (5, 50, 365). Id i prahy zůstaly
(100/1000/7300 slov = 5/50/365 dní), získané nezmizí. Odlesk odznaku je
krátký SVG oblouk s kulatými konci, soustředný s rohem.

**Root cause / approach:** Hlavička sheetu ve sloupci (`flex-direction:
column`) posunula absolutně umístěný úchyt `::before` doleva: nemá `left`,
bere statickou polohu. Opravuje to `left: 50%; translate: -50% 0`.

→ *No new memory entries.*

### Začátky těžší: Rozcvička 5 slov v řadě, Chlouba 3 dny sdílení
Hráč získal všechny Začátky za pár minut. Rozcvička teď chce 5 uhodnutých
slov tréninku v řadě, Chlouba kartu sdílenou ve 3 různých dnech (počítá se
den, ne klepnutí). Popis v detailu odznaku má `text-wrap: pretty`. Kdo už
odznak má, o něj nepřijde (`achGot`).

→ *No new memory entries.*

### Mobilní doladění: sheety, scroll, tap po tahu, blikající pruh, Přidat na plochu
Sheety (hlavně Sbírka z profilu) jdou stáhnout prstem a stránka pod nimi
stojí. Scrollovací obrazovky se nahoře a dole pružně dotahují. Tah prstem
přes tlačítko ho už nespustí. Pruh času ve hře na iPhonu nebliká. „Přidej
si hru na plochu“ je tlačítko, které rozbalí postup, v Chromu spustí
instalaci. Sbírka ukazuje data a v profilu je tlačítkem přes celou šířku.
Odznaky mají zahnutý odlesk podle rohu místo rovné čárky: plný oblouk
(border-top/left na vnořeném rámečku, ořez maskou na 45 % × 45 %), bez
přechodu do ztracena. Přechod se uživateli nelíbil.

**Root cause / approach:**
- Sheet: tah dolů na scrollovatelné stránce vzal prohlížeč jako scroll
  dokumentu a `pointercancel` tah ukončil. Nově `lockScroll` (body
  `position: fixed` po dobu sheetu), `touch-action: none` na backdropu
  a úchytu a nepasivní `touchmove`, který tah dolů z vrcholu nepustí do scrollu.
- Tvrdé zaseknutí: globální `overscroll-behavior: none` na html/body.
  Scrollovací obrazovky mají `contain`: iOS bounce zůstane, Android
  neobnoví stránku.
- Tap po tahu: iOS přepínač uvnitř tlačítek (haptika) jde posunout a pošle
  click. Globální capture guard zahodí click po posunu o víc než 10 px nebo
  po scrollu. Backdrop zavírá na click, ne na pointerdown.
- Blikání: `ResizeObserver` v squircle.js skládal výplni pruhu novou masku
  v každém snímku a Safari ji mezitím zahodilo. Výplně pruhů jsou v `SKIP`.

→ *Memory saved: `squircle_corners.md`, `ios_native_feel_gotchas.md` (doplněno)*

### Datum místo „den N“, odznaky z klienta na veřejném profilu, ořez v Safari
Karta, text sdílení a nadpis náhledu ukazují datum („24. září 2026“), ne
pořadí dne. Podle data si hráči porovnají výsledky. Řádek pod skóre místo
„Den 4 ti utekl, zítra den 5“ ukazuje sérii. Veřejný profil ukáže i odznaky,
které zná jen klient: přihlášenému se zapíšou do `user_achievements`. V Safari
se useklo číslo pod odznakem a tečka na Profilu.

**Root cause / approach:** Ořez dělá `squircle.js`: ve WebKitu kreslí squircle
SVG maskou a maska ořízne všechno, co přesahuje box prvku (pseudoprvky,
vyčnívající děti). `.ach` a `.ach-medal` jsou teď v `SKIP` a tečka je na
`.icon-btn`, ne na maskované kostce. V Chromu (nativní `corner-shape`) se
chyba neprojeví, ověřit jde jen ve WebKitu.

→ *Memory saved: `squircle_corners.md` (doplněno)*

### Jedna série (odehrané dny), oznámení úspěchů až po aktivitě, „Má ho X % hráčů“
Série je teď všude „odehrané dny v kuse“, dřív lokálně jen dny 20/20.
Starý stav se jednou přepočítá z `results`. Nálepka série je na kartě
při každém skóre. Nový úspěch čeká ve frontě `persist.achQueue` a oslava
vyjede až v klidu: po odhalení výsledku, po ukončení tréninku nebo po
zavření sheetu. Server sbírá id získaných úspěchů (`achievements` v D1)
a vrací procenta.

**Root cause / approach:** Migrace se pozná podle chybějícího `lastPlayDate`
v uloženém JSON. V `defaultPersist` ho testovat nejde, `Object.assign` ho
doplní. Totéž u `achInit`: bez něj v defaultu jde odlišit první spuštění
(historie → jen tečky) od skutečného odemčení (→ fronta). Klid hlídá
`announceAchievements()`: aktivní `#game`, otevřený sheet nebo běžící
`revealTimeouts` → počká. Volá se ze `showScreen`, z konce odhalení
a z `closeSheet`. Při ladění servíruje service worker starý `game.js`,
dokud se nezvedne `?v=`.

→ *Memory saved: `achievements_proposal.md` (doplněno)*

### Úspěchy ve hře: 27 odznaků v profilu, obrazovka Úspěchy, oslava v sheetu
Místo čtyř zamčených kostek má profil skutečné úspěchy. Sekce ukazuje nové,
čerstvé a nejbližší odznaky, obrazovka `#achievements` souhrn, „Na dosah“
a 7 skupin, detail je v sheetu `#achModal`. Nový odznak má červenou tečku na
Profilu, první otevření je oslava. Veřejný profil ukazuje odznaky, které zná
server. Návrh s ukázkovými hráči je v `dev-uspechy.html`. Přibylo 7 ikon
(blesk, raketa, hodiny, kladívko, sova, přesmyčka, celé srdce).

**Root cause / approach:** Jeden `achievements.js` (IIFE + `module.exports`
jako avatar.js) drží seznam i markup pro hru, worker a dev stránku. Odznak
je HTML/CSS (kostka, medailon, existující ikona), ne 27 kreseb. Každý odznak
čte jeden klíč plochého stavu. Získané se píšou do `persist.achGot` a stav
je zdvihne na práh, takže nezmizí. Ikony nemají kresbu uprostřed plátna:
`OFFSET` (změřeno getBBox) je v medailonu opticky vycentruje. Medailon
potřebuje `corner-shape: round`, globální squircle z kruhu dělá čtverec.

→ *Memory saved: `achievements_proposal.md`*

### Výbuch času: červená 00 praskne, bílá se převine na 30 s
Na základě prvního výbuchu. Střepy a kostky teď létají po celém displeji
po balistické dráze (nahoru a do stran, pak gravitace za panel mezihry).
Na místě červené 00 naskočí bílá a klasicky se převine na 30 s
(stejné převíjení i zvuk jako mezi slovy). Pak čeká, další slovo rovnou
odpočítává. Převíjení je nově vždy bílé, dřív bylo 1–10 s krátce červené „low“.

**Root cause / approach:** Původní časovač zůstává, explodují jen klony.
`animateTimerUp(from, done)` dostala `done`: po explozi se nerozbíhá čas,
jen se počká. Interval je ve `state.rewindTimer` a nové převíjení staré zruší.
Zpožděné kroky kontrolují `state.processing`, protože rychlé „Další slovo“
by jinak starou dohrávkou přebilo časovač nového slova.
`state.rewinding` v `updateUI` vypíná červené třídy.

→ *No new memory entries.*

### Vypršený čas: budík se otřese a rozletí na střepy
Po vypršení času (trénink i denní výzva) se časovač ~0,3 s třese jako
zvonící budík. Pak se rozpadne na 24 trojúhelníkových střepů, rozletí se pár
červeno-oranžových kostek a tlaková vlna. Střepy padají s gravitací a mizí
pod panelem mezihry. `prefers-reduced-motion` efekt vypíná.

**Root cause / approach:** Střepy jsou klony skutečného `.gp-timer`
(stejné písmo, ikona i červená), každý oříznutý `clip-path: polygon`
na trojúhelník z rozházené mřížky 4×3 a animovaný přes Web Animations API.
Žádné nové CSS, vrstva `position: fixed; z-index: 999` leží těsně pod
`.word-done` (1000). Originál dostane `visibility: hidden`, další slovo ho
`updateUI()` vykreslí znovu.

→ *Memory saved: `kostky_live_icons.md` (aktualizace)*

### Info chipy a labely formulářů o stupeň lehčí
`.info-chip` (pořadí slova, obtížnost, počet písmen v detailu slova) a
`.feedback-form label` (např. „Tvůj význam" u přidávání definice) měly
`font-weight: 600` — teď `300`, stejný krok jako u ostatních dnešních
zlehčení.

### Čas vždy dvojciferný (00, 01, … 30), ne osamocená jedna číslice
Při 0–9 s vypadal čas jako jedna vlající číslice vedle ikony hodin —
`padStart(2, '0')` v `updateUI()` (game.js) ho vždycky vypíše jako „00"–„09".
`.gp-timer-num`'s `min-width`/`text-align:left` z předchozí oprava ikony
zůstává jako pojistka, ale teď už není potřeba — obsah má vždycky stejnou
délku.

### Časovač +30 %, opticky vycentrovaný; titulek panelu po slově zpět na výchozí váhu
`.gp-timer` (ikona + číslo) o 30 % větší (92→120px, ikona 45→58px), popisek
pod tím („Slovo X · obtížnost") beze změny. Ikona dělala skupinu opticky
nevyváženou doprava — `.gp-timer` má `margin-left: -78px`, aby ČÍSLO (ne celý
box) vyšlo na střed sloupce; hodnotu jsem nedopočítal zpaměti, ale
odzkoušel binárně přes `getBoundingClientRect()` (align-items:center centruje
margin-box, takže posun čísla = 2× velikost záporného marginu, ne 1:1 — snadno
se to spočítá špatně). Titulek panelu po slově (`.wd-title`, „Čas vypršel"
apod.) se po zpětné vazbě vrátil na výchozí váhu (žádné explicitní
`font-weight` navíc — spadá na blanketové 400, což na jediném řezu Slovka One
vypadá stejně jako 700). `.wd-sub` zůstává Light (300).

### Titulek panelu po slově ještě o stupeň lehčí (i podtitulek)
`.wd-title` („Správně!"/„Čas vypršel") šel z Light (300) na ExtraLight (200),
`.wd-sub` („KOSTKA"/„Hledané slovo") z Regular (600) na Light (300) — platí
stejně pro zelenou (solved) i červenou (missed) variantu, barvu řeší
samostatné pravidlo `.word-done.missed .wd-title, .word-done.missed .wd-sub`,
váhu ne. Ověřeno screenshoty obou stavů.

### Regrese: nový span kolem čísla času spadl do Nunita
Při fixaci ikony hodin (viz níže) jsem číslo obalil do `<span class="gp-timer-num">`
bez `font-family`. Univerzální `* { font-family: 'Nunito' }` ze style.css je
PŘÍMÉ pravidlo na tom spanu, takže vyhrálo nad zděděním Slovka One z `.gp-timer`
— číslo se najednou kreslilo Nunitem. Přesně tahle chyba se řešila kdysi u
`.gp-timer-unit` (komentář „ne Nunito z *"), zapomněl jsem tam dát to samé
`font-family: inherit` na nový span. Opraveno, ověřeno computed stylem.

### Ikona hodin se posouvala s ubývajícími číslicemi času
Box `.gp-timer` (ikona + číslo) se centroval jako celek, takže při přechodu
z dvojciferného na jednociferný čas se zúžil a ikona se posunula. `.gp-timer-num`
(nový span kolem čísla v `updateUI()`) má `min-width: 1.28em; text-align:left;
font-variant-numeric: tabular-nums` — box má teď vždycky stejnou šířku, ikona
stojí na místě. Ověřeno `getBoundingClientRect()`: shodné `left`/`width` pro
„9" i „30".

### Časovač nahoře, bez „s", menší popisek; obtížnost a nadpisy sheetu lehčí
Ve hře je teď první číslo času (o něco větší, 92px), pod ním menší a lehčí
„Slovo X · obtížnost" — dřív to bylo obráceně a čas nesl jednotku „s". `.gp-timer-unit`
tím padlo jako mrtvé CSS (smazáno ze style.css i kostky.css). Nadpis sheetu
obtížnosti („Jak těžká slova chceš?") a jména úrovní (Lehká/Střední/Těžká) mají
teď taky Light řez (300) místo Regular (700).

**Root cause / approach:** Pořadí je čistě pořadí uzlů v `updateUI()`
(`$('progress').innerHTML`), žádná CSS gymnastika. `.modal-header h2` má v
kostky.css dvě pravidla se stejnou specificitou (700 dřív, 400 blanketové
později v souboru) — vyhrává to pozdější, takže i weight:400 dnes vykresloval
tu samou těžkou Regular kresbu (viz níže); zlehčení musí jít do nového pravidla
za obojím, ne přepisovat starší.

### Slovka One: dva lehčí řezy (Light 300, ExtraLight 200) erozí z Fredoka One
`.wd-title` a `#percentile` měly být o stupeň lehčí, ale Slovka One měla jediný
řez pro `font-weight: 100 900`, takže změna tloušťky nedělala nic. Z uživatelova
originálu FredokaOne-Regular.otf (2011) vznikly `tools/thin_font.py` dva lehčí
řezy (eroze o 24 a 40 jednotek), `cz_font.py --thin` do nich doplní češtinu.
V CSS tři `@font-face` jedné rodiny: Regular 400–900, Light 250–399, ExtraLight
100–249; `.wd-title`, `#percentile`, `.modal-header h2` a `.level-name` mají
`font-weight: 300`, `.gp-headline` taky. Ostatní obrazovky bajtově beze změny
(ověřeno screenshoty před/po na `.btn-play` a nadpisech).

**Root cause / approach:** Posouvat body obrysu (FreeType embolden) nestačí —
u spojů oblouku s dříkem to dělá smyčky a hroty. Funguje morfologická eroze přes
skia-pathops (odečíst tah šířky 2d s pokosem), pak zóny vrátit po částech
lineární mapou y a šířky nechat. Hranice pásem je 400, protože `.wd-title` i
výchozí `normal` jsou dnes 400; nic v CSS nejde pod 400. Vyrobeno subagentem
(Opus 5.5) v izolovaném worktree, poté portováno do hlavního stromu ručně
(sdílená pracovní složka — cílené edity přes čtení aktuálního obsahu, ne
strojový merge/patch, viz `parallel_sessions_commits.md`).

→ *Memory saved: `slovka_weights.md`*

### Tlukot srdce tišší a bez plechu, podle skutečných ozev srdce
Srdce v posledních sekundách znělo plechově a moc nahlas. `heartSound` teď
staví každou ozvu podle fonokardiogramu: S1 („lub“) 55 Hz a 150 ms, S2
(„dub“) 70 Hz, 120 ms a tišší, po třetině tepu. Obě ozvy jsou sinus, tišší
oktáva a 50 ms šumu, všechno přes lowpass 220 Hz s náběhem 15 ms.

**Root cause / approach:** Plech dělal trojúhelník s 4× parciálem a náběhem
4 ms. Telefon basy nezahraje, takže zbyly jen vyšší harmonické. Nad 400 Hz
má nová verze 0,4 % energie, stará 5,5 %. Hlasitost naplno je 0,015 → 0,021,
pod písmenkem (0,019) až do poslední sekundy. Z telefonu (highpass 250 Hz)
je 0,003 proti dřívějším 0,011. Rytmus 833 → 375 ms, po uhodnutí ani po pauze
nic nedozní.

→ *Memory saved: doplněno `sound_levels_offline.md`*

### Poslední sekundy jako zrychlující tlukot srdce místo tiků
Vysoké tiky (A6–C♯7) byly moc pisklavé. `playUrgentSound` teď od 5 s hraje
„lub-dub“ (98 a 123 Hz), který zrychluje ze 72 na 160 tepů za minutu
(rozestupy 833 → 375 ms) a mírně zesiluje.

**Root cause / approach:** Údery mezi sekundami se plánují `setTimeout`em
dopředu. Odpočet ale zastavuje deset míst `clearInterval(state.timer)`
a `state.timer` pak nenulují, takže každý úder před zahráním ověří
`counting()`: nic nezpracovává, čas > 0, hra je vidět, žádná pauza ani sheet.
Po uhodnutí i po pauze pak nezazní nic. Telefon pod ~200 Hz nehraje, proto
trojúhelník s bendem a trochou 4× parciálu. Změřeno s highpassem 250 Hz:
srdce v 5 s 0,018 (≈ tap), v 1 s 0,026 < písmenko 0,037.

→ *Memory saved: doplněno `sound_levels_offline.md`, `sound_tap_dedupe.md`*

### Naléhavé tikání v posledních sekundách slova
Od 5 s zazní každou sekundu dřevěné „tok“ (`playUrgentSound`), pokaždé
o půltón výš a hlasitěji. Od 3 s je dvojité „ti-tik“ jako zrychlený tep.
V nule dál hraje zvuk vypršení. Platí pro trénink i denní výzvu, při pauze
tikání stojí spolu s odpočtem.

**Root cause / approach:** Jeden řádek ve `startTimer` vedle haptiky.
Trojúhelník s `bright: 0` a výš než písmenka (A6–C♯7 proti C5–E6) se s nimi
nesplete. Bez vyšších parciálů navíc nehrozí, že by 10× parciál vyjel nad
Nyquista. Offline RMS: tik v 5 s 0,016 (≈ tap), v 1 s 0,026, písmenko 0,034.

→ *No new memory entries.*

### Písmenka stíhají i rychlé klepání; zvuk na smazání slova
Při rychlém klepání nebylo slyšet každé písmeno. Zvuk písmenka se zkrátil
z 0,35 s na 0,16 s. Klepnutí na skládané slovo (`clearWord`) ho smaže se
zvukem `playClearSound`: vybraná písmena se rychle odťukají pozpátku dolů.
Backspace na klávesnici má nově stejný zvuk jako odebrání písmene klepnutím.
Automatický reset po chybě dál hraje jen chybový zvuk.

**Root cause / approach:** Engine stíhal, v Chromiu i WebKitu (i s dotykovou
cestou) se každé klepnutí po 80 ms naplánovalo včas. Tóny se ale slévaly: nový
úder byl jen 3,6× hlasitější než doznívání předchozích (při 150 ms 15×), s 0,16 s
je to 17× i při 80 ms. Dozvuk na tom skoro nic nemění. Měřeno offline renderem,
viz paměť.

→ *Memory saved: doplněno `sound_levels_offline.md` (kontrast nástupu)*

### Zvuky jako z Duolinga: tap na tlačítka, převíjení času, hlas, sheety
Holé sinusovky a sawtooth nahradil úder paličkou (marimba: parciály 1×, 4×,
10×, krátký pitch bend) přes jednu sběrnici s lowpassem a krátkým „pokojem“
z ConvolverNode. Chyba je tupé „bonk“ z trojúhelníku. Nově: tichý tap na každé
tlačítko a záložku, převíjení času jako stoupající tiky v rytmu `animateTimerUp`,
dvojí „plink“ u hlasu, bublina při otevření a zavření sheetu.

**Root cause / approach:** Tap poslouchá `click` v capture fázi (obsluhy volají
`stopPropagation`) a hraje až v `setTimeout`, jen když `playTone` mezitím nic
nezahrálo (`soundAt`). Tlačítko s vlastním zvukem tak nikdy nezní dvakrát, bez
seznamu výjimek. Délka převíjení bere `step` ze stejného výpočtu jako interval.
Hlasitosti ověřené renderem do OfflineAudioContext v Chromiu i WebKitu.

→ *Memory saved: `sound_tap_dedupe.md`, `sound_levels_offline.md`*

### Z významu v tréninku na veřejný profil autora; úspěchy i na veřejném profilu
Jméno autora u významu (karta na panelu po slově i sheet Významy) je tlačítko
na jeho veřejný profil uvnitř hry. Zpět vede tam, odkud hráč přišel: na panel,
případně znovu do sheetu. Veřejný profil má teď i místo pro Úspěchy. Rozhodnutí
k bodům (váhy, tichý strop, body veřejně) jsou v `OTEVRENE-OTAZKY.md` v „Rozhodnuto“.

**Root cause / approach:** `#wordDoneOverlay` je fixní vrstva mimo obrazovky,
`showScreen` ji neschová. `openAuthorProfile` ji skryje přes `style.display`
(ne `hideWordDone`, to by panel zrušilo) a vrátí ji callbackem `back`, který si
`showPublicProfile(handle, back)` pamatuje. `show.onclick = showPublicProfile`
by teď jako přezdívku dostal event, proto šipka. Smazaný účet (author null)
odkaz nemá.

→ *No new memory entries.*

### Body za aktivitu v profilu + místo pro úspěchy
Hráč s účtem sbírá body (karma): 10 za odehraný den, 1 za slovo tréninku
(max 10/den), 5 za význam, 2 za získaný a 1 za daný hlas (max 10/den). Vidí je
jen v profilu jako zlatý odznak pod jménem (vlastní i `/u/`). Pod statistikami
jsou „Úspěchy“ se čtyřmi zamčenými kostkami jako místo pro pozdější systém.
Pravidla jsou v `GAME_DESIGN.md`, otevřené otázky v `OTEVRENE-OTAZKY.md` 1.6.

**Root cause / approach:** Body nemají tabulku. `points()` v `profile.js` je
spočítá jedním SQL dotazem z řádků, které už existují, takže nejdou napočítat
dvakrát a váhy jdou měnit zpětně. Nová je jen `training_days`, protože trénink
žil jen v localStorage. Test v `test.mjs` pouští ten SQL proti skutečnému SQLite
ze `schema.sql` přes vestavěné `node:sqlite`. Past: `.profile-section
{ display: flex }` přebije atribut `hidden`, proto má vlastní `[hidden]` pravidlo.

→ *Memory saved: `node_sqlite_d1_tests.md`, doplněno `dev_accounts_and_seed.md`*

### „Upozornit na další výzvu“ se řídí skutečným odběrem, ne jen povolením
Tlačítko se ukazovalo jen při `Notification.permission === 'default'`.
Když prohlížeč notifikace povolil, ale odběr se nepovedl nebo vypršel,
tlačítko zmizelo navždy a připomínky tiše nechodily. Nově se při `granted`
ptá `pushManager.getSubscription()`: bez odběru se tlačítko ukáže
a klepnutí odběr obnoví bez dalšího dotazu.

**Root cause / approach:** Povolení a odběr jsou dvě různé věci a obojí
platí jen pro jeden prohlížeč a jednu adresu. Zapnuté na telefonu na
20slov.cz neschová tlačítko na `localhost` ani v jiném prohlížeči. Ověřeno
podvržením `Notification.permission` a `getSubscription` ve všech čtyřech
stavech (default → ukázat, denied → ne, granted bez odběru → ukázat,
granted s odběrem → ne).

→ *No new memory entries.*

### Ocenění na výsledku se občas zaleskne
„Top X % hráčů dneška“ (`#percentile`) má každých 5 s pruh světla, který za
0,9 s přejede zleva doprava. „Dnes bez trofeje 💔“ se neleskne
(`:has([data-emoji="srdce"])`), při omezení pohybu také ne.

**Root cause / approach:** Čistě CSS `::after` s `translate` animací.
Bílý pruh přes text ho přebledil, proto je pod textem: `isolation: isolate`
na odznaku a `z-index: -1` na pruhu ho kreslí nad pozadím, ale pod písmem.
Na světlém `--gold-bg` (skoro bílá) by čistě bílý pruh nebyl vidět, proto
má zlaté okraje. Spodní ret (`box-shadow`) `overflow: hidden` neořízne.

→ *No new memory entries.*

### Pochlubit se: zlatá šipka jako samolepka Kostek
Tlačítko mělo bílou obrysovou šipku z jiné sady (Phosphor), hned pod ním
zvoneček ve stylu Kostek. Nově `designs/kostky/sdilet.svg`: zlatá šipka
v barvách zvonečku (výplň, stín na spodní polovině hrotu, tmavší ret,
odlesk), zapojená jako `.emoji[data-emoji="sdilet"]`.

**Root cause / approach:** První pokus, bílá šipka s tmavě zeleným retem,
vypadal skoro stejně jako původní. Tenký ret na zeleném zanikne. Zlatá je
na zeleném neutrální přízvuk (viz paměť `kostky_gold_neutral_accent.md`)
a sedí ke zvonečku.

→ *No new memory entries.*

### Ikony Kostek v horní liště a u Zpět
Profil, Trénink a Zpět byly tenké obrysové ikony (Tabler), zbytek aplikace má
barevné „samolepky“ se spodním okrajem. Nově `designs/kostky/profil.svg`
(modrá postava), pro Trénink stávající `cinka.svg` (stejná fialová činka jako
ve statistikách) a `zpet.svg` (tlustá šedá šipka s okrajem) na všech čtyřech
obrazovkách se zpět.

**Root cause / approach:** Styl sady = 48×48, plochá barva, tmavší kopie
o 3 níž jako ret, bílý odlesk s opacity .45. Ikony jsou `<img>` (barvy jsou
pevné, `currentColor` netřeba), pravidla `color` pro horní lištu zmizela.

→ *No new memory entries.*

### Avatary: useknuté tvary, skoro černý obličej, dva tesáky, mrkání
8 ze 40 tvarů (květ, odznak, jiskra, plus, list, ozubené kolo, jetel,
nakřivo) přetékalo plátno. Ret je kopie tvaru o 5 níž a u nich vyjel pod
y = 100, u listu špička i nahoru. Tvary jsou zmenšené/posunuté.
`dev-styleguide.html` teď sám měří všechny tvary i s retem a vypíše
useknuté červeně. Oči a pusy mají `INK #0b1215` (tmavší než tmavé pozadí),
upírek má místo jednoho tesáku dva. Sub-agent přidal mrkání otevřených očí,
jemný pohyb pusy a brýlí.

**Root cause / approach:** Animace jsou CSS třídy (`av-blink`, `av-mouth`,
`av-glasses`) na *vnitřních* `<g>` bez atributu transform. CSS transform
by atribut skupiny nahradil a oko by skočilo do rohu. Načasování je
odvozené z kódu avatara jako CSS proměnné v `style` na `<svg>`, takže server
i klient kreslí stejně a seznam autorů nemrká unisono. Pozor: kvůli tomu
`<svg>` už `style` má a druhý atribut vložený přes `replace('<svg ', …)`
se tiše zahodí (spravené ve styleguidu přes `el.style.width`).

→ *Memory saved (sub-agent): `avatar_idle_animations.md`*

### Squircly rohy všude — nativní CSS + JS fallback pro Safari
Všechny zaoblené kontejnery (tlačítka, dlaždice, karty, chipy...) mají teď
squircle rohy (hladší superellipsa místo obyčejného kruhového oblouku
border-radius), na uživatelovo přání „ne obyčejné obdélníky se zaoblenými
rohy". `* { corner-shape: squircle; }` v kostky.css stačí na Chrome/Edge, ale
Safari 26/WebKit tuhle CSS vlastnost ještě nemá (ověřeno reálným WebKitem
přes Playwright, ne jen odhadem) — a appka cílí primárně na iOS.

**Root cause / approach:** Uživatel po zjištění mezery na iOS chtěl i těžší
fallback, ne jen čekat na Safari. Napsán `public/squircle.js`: feature-detect
`CSS.supports`, a pokud chybí, pro každý prvek přepočítá superellipsu
`|x/r|^n+|y/r|^n=1` (n≈4.5) v jeho SKUTEČNÝCH pixelech (ne jedna univerzální
maska natažená přes celý prvek — to by na širokých tlačítkách zkreslilo
zakřivení) a nasadí jako SVG `mask-image`. `MutationObserver`+`ResizeObserver`
pokryje i dynamicky stavěný obsah (panel po slově, písmenka). Vizuálně
ověřeno v reálném WebKitu — squircle i box-shadow „ret" pod tlačítky obojí
sedí.

→ *Memory saved: `squircle_corners.md`*

### Upravit profil jako Tinder: ✗ jiný avatar, ✓ uložit
Obrazovka úprav má dole dvě kulatá tlačítka s retem: bílé ✗ (poskládá jiného
avatara) a zelené ✓ (uloží avatar i přezdívku). Nad nimi je pole Přezdívka.
Avatar je uprostřed volného místa a o 40 % větší (`min(70vw, 280px)`).

**Root cause / approach:** ✓ je `type="submit"` formuláře, takže Enter
v poli ukládá taky a `saveProfile` zůstal beze změny. ✗ je `type="button"`
s `rollAvatar()`. Obě tlačítka mají jen `aria-label`, text by se do kolečka
nevešel.

→ *No new memory entries.*

### Jedna tužka v profilu: obrazovka „Upravit profil“ s avatarem i přezdívkou
Dvě tužky (na avataru a u jména) se vizuálně tloukly. Zůstala jen ta na avataru.
Otevře „Upravit profil“: avatar, „Ukázat jiného“, pole Přezdívka a „Uložit“
dole na dosah palce. Nahradila obrazovku „Vyber si avatara“ („Tenhle chci“)
i inline formulář přezdívky. Jméno v profilu je zase čistý text.

**Root cause / approach:** Obrazovka se otevírá se *současným* avatarem,
náhodný dostane jen ten, kdo žádný nemá. Jinak by úprava samotné přezdívky
tiše přehodila avatar. `saveProfile` posílá jen změněné části, přezdívku
první, protože jen ta může narazit (obsazená), a pak se neuloží nic.
`#profileEdit` je ve skupině scrollovatelných obrazovek kvůli klávesnici.

→ *Memory updated: `dev_accounts_and_seed.md` (dev login hledá podle přezdívky).*

### Přezdívka jde změnit i s účtem: tužka u jména v profilu
Přihlášený hráč přezdívku změnit nemohl, tlačítko se mu schovávalo
a formulář ukládal jen do localStorage. Teď má jméno v profilu stejnou tužku
jako avatar (`.edit-badge`, dřív `.avatar-edit`). Klepnutí otevře formulář.
S účtem se ukládá přes existující `POST /api/me/handle`, který přepíše
i autora u významů a hlídá obsazenost. Hostovi se dál ukládá jen do zařízení.
Tlačítko „Nastavit/Změnit přezdívku“ zmizelo.

**Root cause / approach:** Server změnu uměl od začátku, chybělo jen UI.
Chyby (`Tuhle přezdívku už někdo má.`, `3–20 znaků, bez mezer.`) byly šedé
20px, protože `.screen p` (0,2,1) přebíjel `.feedback-error`. Oprava
`.screen p.feedback-error` spravila i chyby přihlášení v sekci Účet.
Poznámka pod jménem už přihlášenému netvrdí „přihlášení přijde později“.
Změna přezdívky mění i adresu `/u/<přezdívka>`, staré sdílené odkazy
přestanou fungovat.

→ *Memory updated: `ios_native_feel_gotchas.md` (bod 2).*

### Kalendář profilu přes celou šířku, měsíce otočené a celým názvem
Kostky vyplní šířku sloupce (7 × `1fr`, na 390px telefonu 40 px místo 34).
Měsíc je svislý popisek na podkladu přes všechny řádky svých týdnů,
jednořádkový měsíc dostane zkratku. Simulace 5 měsíců hraní:
dev hráčka „Klára“ (`dev-sim-klara`, 128 dní) vložená přímo do lokální D1,
`seed-dev.mjs` zůstal beze změny.

**Root cause / approach:** Popisek měsíce je grid položka se
`grid-row: span N`. Automatické umístění pak kostky dalších řádků samo
posune za obsazený první sloupec. Týden patří měsíci svého čtvrtka.
`writing-mode: vertical-rl` + `rotate(180deg)` čte zdola nahoru.

→ *Memory saved: `parallel_sessions_commits.md` (aktualizace: nikdy `open(p, 'w')` před kontrolou)*

### Avatary i u autorů významů, produkční D1 zmigrovaná
Karta s významem po slově i seznam významů ukazují místo zlatého/modrého
kolečka s iniciálou avatar autora (32 px, bez kruhu pod ním). Kdo avatar
nemá, má dál iniciálu. Produkční D1 dostala `users.avatar`
(`ALTER TABLE` na `--remote`, ověřeno přes `pragma_table_info`).

**Root cause / approach:** Význam nese jen snímek přezdívky (`author`),
takže `/api/defs` i `/api/defs/word` dělají `LEFT JOIN users` pro `avatar`.
Pozor, `users` má taky `created_at`, proto jsou sloupce v ORDER BY
a v oknu `ROW_NUMBER` s prefixem `d.`. Dávka významů je v edge cache 300 s,
změna avatara se u cizích hráčů projeví až po vypršení. `seed-dev.mjs` dává
avatary všem kromě Ondry, aby byla vidět i iniciála.

→ *No new memory entries.*

### Avatary místo iniciál: náhodně poskládaný tvar s obličejem
Tužka na avataru v profilu otevře obrazovku „Vyber si avatara“ s tlačítky
„Tenhle chci“ a „Ukázat jiného“. Avatar se skládá z 40 tvarů, 10 barev
(světlejší paleta Kostek s retem), 18 variant očí a 18 variant pusy.
Ukládá se jen kód `tvar-barva-oči-pusa`: bez účtu do localStorage,
s účtem do `users.avatar` (`POST /api/me/avatar`). Ukazuje ho i veřejný profil.

**Root cause / approach:** `public/avatar.js` je jeden soubor pro hru, worker
i test (IIFE + `module.exports`). Obličej je v pevné mřížce (oči −7, pusa +11),
takže oči nikdy neskončí pod pusou. Každý tvar má jen `[x, y, měřítko]` místa
pro obličej, doladěné podle náhledového archu všech tvarů v nejvyšší
a nejširší kombinaci. Pořadí v polích je součást uložených kódů, nové
položky proto jen na konec. Produkční D1 potřebovala
`ALTER TABLE users ADD COLUMN avatar TEXT` (provedeno, viz výš).

→ *Memory saved: `shared_browser_worker_script.md`, `agent_browser_flags.md`*

### Profil: „všech 20“ zeleně s fajfkou, záložky Denní výzvy / Významy
Zlatá kostka za všech 20 v kalendáři mátla, působila jako jiná kategorie. Teď
je to plná zelená s bílou fajfkou na konci stejné zelené řady. Kalendář
a významy jsou v záložkách, protože po roce má kalendář ~53 řádků a významy
by odjely úplně dolů.

**Root cause / approach:** Záložky jsou dvě rádia + `:checked ~` v CSS,
bez JS. Obsah profilu se do hry vkládá přes `innerHTML` (skripty by neběžely)
a sdílená stránka JS nemá vůbec. Rádia zůstávají v DOM (průhledná), takže
přepínání šipkami na klávesnici funguje samo.

→ *No new memory entries.*

### Veřejný profil v podobě hry, otevírá se uvnitř aplikace
Profil `/u/<přezdívka>` měl vlastní starý vzhled (Baloo, béžová, zelená škála)
a otevíral se v nové kartě. Teď používá markup a styly hry: avatar, dlaždice
statistik s ikonami Kostek, sekce. Rok denních výzev je svisle jako kalendář
(týden = řádek Po–Ne, zlatá za všech 20, dnešek v kroužku) a začíná týdnem
prvního odehraného dne. Nově ukazuje i hráčovy významy slov. Ve hře
„Můj veřejný profil“ otevře obrazovku se šipkou zpět do profilu.

**Root cause / approach:** Jeden markup pro dvě cesty. `profileBody()`
ve `worker/src/profile.js` vrací obsah. `?cast=1` ho pošle samotný (no-store)
a hra ho vloží do `#publicProfileBody` (`display: contents`, ať sekce sedí
v mezerách obrazovky). Bez parametru ho server obalí stránkou, která linkuje
`/style.css` a `/designs/kostky.css`. „Nejlepší význam“ se ukáže, jen když
význam porazil jiné kandidáty. Legenda je `<p>`, takže ji přebíjel
`.screen p:not(.welcome-instruction)` (20px, margin 34px) a potřebovala
`#publicProfile` v selektoru.

→ *Memory saved: `public_profile_shared_markup.md`*

### Dohledávka: hlasovací tlačítko měnilo jen text, ne pozadí; dev-styleguide dohnán na realitu
Po přebarvení palce/avatara na zlatou (viz níže) hlasované tlačítko v paneli
po slově měnilo jen barvu textu a ikony — pozadí a obrys zůstaly zelené na
solved i červené na missed. `dev-styleguide.html` navíc ukazoval smyšlenou
třídu `.def-report` (textový „Nahlásit" link), která v `game.js` nikde
nevzniká, a chyběl v ní stav „hlasováno vs. nehlasováno" k prokliknutí.

**Root cause / approach:** `.word-done .wd-card .wd-vote` a `.word-done.missed
.wd-card .wd-vote` (3–4 třídy) nastavovaly `background`/`border-color`/
`box-shadow` bez ohledu na `.voted` a přebíjely méně specifické `.wd-vote.voted`
(2 třídy) — jen `color` zůstal na `.voted` nedotčený, proto se hnulo jen
písmo. Oprava: `:not(.voted)` na obou scoped pravidlech. `dev-styleguide.html`
teď má oba stavy (solved/missed) klikatelné (`sgToggleVote`, přepíná
`.voted` + počet) a sekci Významy slov přestavěnou podle skutečné markup
struktury z `game.js` (`.def-icon-btn.def-flag`/`.def-edit`, ne `.def-report`),
včetně odlišení dvou různých obrazovek, co `.def-item` sdílejí (sheet Významy
vs. Profil → Moje významy).

→ *Memory saved: `kostky_gold_neutral_accent.md` (aktualizace — specificita a mrtvé CSS)*

### Palec a avatar v panelu po slově: zlatá místo modré; SLOVO/časovač o 50 % větší
Avatar autora významu a ikona palce u hlasování byly natvrdo modré (i barvy
uvnitř `palec.svg`) a na zeleném (solved) i červeném (missed) panelu po slově
bily oči. `.wd-vote.voted` byl navíc vždycky zelený bez ohledu na to, jestli
je panel červený. `.gp-headline`/`.gp-timer` (nadpis „Slovo X · obtížnost" a
countdown) zvětšeny o 50 %.

**Root cause / approach:** V kostky.css je pro tuhle přesnou situaci (accent,
co musí sedět na zeleném i červeném) už zavedený vzor — `.wd-add` je zlatá
s komentářem „ladí s tužkou i se zeleným/červeným panelem". Přebarveno
`palec.svg` z modré na stejnou zlatou paletu jako `koruna.svg`, `.wd-avatar`
a `.wd-vote.voted` na `--gold*` tokeny. Ověřeno v obou stavech (`solved`/
`missed`) přes DOM injekci reálné markup struktury v běžící appce.

→ *Memory saved: `kostky_gold_neutral_accent.md`*

### Progress bar ve hře nebyl vertikálně zarovnaný s křížkem
`.time-bar` v hlavičce hry seděla o 5 px níž než `#closeGameBtn` vedle ní.
Kostky.css zvýšila výšku lišty (8→10px) a zmenšila `top`/zvětšila velikost
křížku, ale `margin-top: 18px` z `style.css` (tuned na starou geometrii)
nikdo nedopočítal znovu.

**Root cause / approach:** Přeměřeno `getBoundingClientRect()` na obou
prvcích v běžící hře (Trénink → `playToday()`) — středy 37px vs 32px.
Oprava v `designs/kostky.css` hned vedle `height:10px`, kde vznikl rozjezd:
`margin-top: 13px` (14px padding-top .game-screen + 13 + 10/2 = 32 = shodné
se středem křížku). `style.css`s starší `margin: 18px 0 -8px` zůstal
nedotčený — je to obecná vrstva, kostky.css ji přebíjí lokálně.

→ No new memory entries.

### Tlačítka výsledku dole na dosah palce; odkaz na veřejný profil z localhostu
Pochlubit se, Upozornit na další výzvu (zase se zvonkem), iOS banner, nudge
série a odpočet jsou v `.result-bottom` u spodního okraje. Skóre a mřížka jsou
na středu nad nimi. Odkaz „Můj veřejný profil“ vedl na localhostu na produkční
workers.dev, kde dev účet neexistuje.

**Root cause / approach:** `siteUrl()` na localhostu vrací `FALLBACK_URL`.
Je to schválně, aby sdílený odkaz na hru byl veřejný. Profil ale žije na
serveru s účtem, proto `location.origin`. Rozložení: dvě `margin-top: auto`
(mřížka a `.result-bottom`) si dělí volné místo, takže obsah zůstane na středu
a tlačítka dole. Zvonek v `.btn` s `nowrap` se smrskl na 0, dokud neměl
`flex-shrink: 0`.

→ *Memory saved: `home_is_result_when_done.md` (aktualizace)*

### Výsledek: upozornění jako tlačítko pod Pochlubit se, klidnější odpočet
- „Zapnout upozornění na další den“ (terciární odkaz se zvonkem) je teď obrysové
  tlačítko „Upozornit na další výzvu“ hned pod Pochlubit se.
- iOS banner „Přidej si hru na plochu“ je na stejném místě.
- Odpočet „Další výzva za…“ je pod nimi, bez rámečku (vypadal jako tlačítko)
  a v Nunitu místo Slovka One.
- Na kartě ke sdílení je adresa `20slov.cz`.
- Pochlubit se má ikonu tučné šipky (Phosphor ShareFat, zaoblenou tahem).

**Root cause / approach:** Tlačítko upozornění sedí uvnitř `.share-actions`
s `flex-basis: 100%`, takže se odhaluje spolu se sdílením. Slovka One má jen
jednu (těžkou) řez, „méně tučně“ proto znamená přepnout na Nunito.

→ *No new memory entries.*

### Náhled karty před sdílením, série na kartě, karta pro každé skóre
Pochlubit se otevře sheet s náhledem karty a tlačítkem „Sdílet obrázek“
(na desktopu „Stáhnout obrázek“). Perfektní den se sérií od 2 dnů má na kartě
oranžovou nálepku „N dní v řadě“ s plamenem. Karty bez trofeje (0–8) dostaly
vlastní nálepku „Zítra to dám!“ a výzvu „Dáš to líp?“, perfektní den výzvu
„Dáš taky všech 20?“. Pochlubit se tak může každý.

**Root cause / approach:** Sdílí se až tlačítkem v sheetu, takže
`navigator.share` běží v čerstvém gestu. Předkreslení teď slouží hlavně
k tomu, aby náhled naskočil hned. Výška náhledu je
`88dvh − 186px`: sheet má max 88dvh a zbytek zabere hlavička, tlačítko
a okraje. Bez toho tlačítko na iPhonu přetékalo.

→ *Memory saved: `share_card_canvas.md` (aktualizace)*

### Pochlubit se sdílí obrázek ve stylu Spotify Wrapped
Místo textu s emoji mřížkou se sdílí svislá karta 1080×1920 (příběh na IG/FB).
Obsahuje „20 SLOV“ z kostek písmen, obří skóre s retem, mřížku dne na tmavé
desce nakřivo, zlatou nálepku percentilu s ikonou z Kostek a „Překonáš mě?“ s adresou.
Plocha je zlatá, zelená, modrá nebo fialová podle výsledku. Na desktopu se PNG stáhne.

**Root cause / approach:** `navigator.share` se souborem musí běžet
v přechodné aktivaci klepnutí. Kreslení (čekání na fonty, načtení SVG, `toBlob`)
je asynchronní, takže karta se kreslí předem v `showResult`
(`prepareShareCard`, klíč den+marks+percentil). Klepnutí pak sdílí synchronně.
Canvas kreslí Slovka One až po `document.fonts.load`, jinak spadne na záložní písmo.

→ *Memory saved: `share_card_canvas.md`*

### Po dohrání dne je domovem rovnou výsledek
Když je dnešní výzva hotová, úvodní obrazovka (název a pravidla) se nezobrazuje.
Domovem je výsledková obrazovka: kostky, skóre, percentil, Pochlubit se, odpočet
a upozornění, nahoře lišta Profil/Trénink. Tlačítko Trénink a odkaz Sbírka slov
z výsledku zmizely, protože by tam byly podruhé. „Díky za hru + zpětná vazba“
se přesunulo na konec profilu.

**Root cause / approach:** Lišta je jeden uzel. `showScreen` ji přesune
do `#welcome` nebo `#result` (stejně jako `placeGameGrid` přesouvá mřížku).
`showWelcome` při dohraném dni rovnou zavolá `showResult(true)`, takže každé
„zpět domů“ (profil, konec tréninku, start aplikace) skončí správně bez úprav
volajících. Mřížka úvodu je proto vždy šedá.

→ *Memory saved: `home_is_result_when_done.md`*

### Dev stránka se všemi herními prvky a písmy
`public/dev-styleguide.html` — jedna stránka (jen pro dev, appka na ni
neodkazuje), co natáhne stejné `style.css`/`kostky.css`/fonty jako appka a
vylistuje tlačítka, chipy, nadpisy, mřížku, sloty/písmenka, profil/statistiky,
panel po slově, významy slov a specimeny všech tří fontů (Slovka One, Baloo 2,
Nunito) s českou diakritikou. Pod každou ukázkou je popisek dopočítaný
z `getComputedStyle` (font, řez, velikost, řádkování), takže se nerozejde
s CSS.

**Root cause / approach:** Žádný — čistě nová statická stránka. Jediná
past: `html, body` z `style.css` dělá pevnou `100dvh` krabici s
`overflow:hidden` a temným `background:var(--bg)`, což se na cizí stránce
projeví jako tmavý blok za prvními řádky a zastavený scroll — potřeba
explicitně přebít `!important`.

→ *Memory saved: `ios_native_feel_gotchas.md`* (bod 5 — dev stránka nad stejným CSS)

### Denní výzvu jde ukončit křížkem; sbírka slov přesunutá do profilu
Denní hra má vpravo nahoře stejný × jako trénink. Otevře sheet „Ukončit dnešní
výzvu?“ s počtem zbývajících slov; čas mezitím stojí. „Hrát dál“, klepnutí vedle,
tažení nebo Esc hru obnoví. „Ukončit výzvu“ zapíše zbývající slova jako
neuhodnutá (červená) a ukáže výsledek, den je pak hotový. Štítek
„Den X/365 · N slov“ se přesunul z úvodu do profilu (sekce Sbírka slov) a ikony
horní lišty mají o 4 px větší mezeru k popisku.

**Root cause / approach:** `closeSheet` teď volá `modal.onclose` jednou,
ať sheet zavře cokoli. Obnovu času stačí pověsit na to jedno místo; při
potvrzení ji přeskočí příznak `state.quitting`.

→ *Memory saved: `modals_are_bottom_sheets.md` (hook `onclose`)*

### Celé Kostky ve Slovka One — „špatné háčky" byly záložní Nunito
Google Fredoka, kterou Kostky používaly na tlačítka, kostky písmen, štítky
a popisky, **nemá ů č ď ě ň ř ť ani velké** — přesně ty, co chyběly i ve Fredoka
One. Prohlížeč je kreslil záložním Nunitem, takže uprostřed slov (Těžká,
Střední, ZMĚNIT PŘEZDÍVKU, kostka Ř) byl cizí znak. `--display` je teď Slovka
One a Google Fredoka se už nestahuje.

**Root cause / approach:** Nepoznáš to od oka ani z `getComputedStyle` (hlásí
jen deklarovaný stack) — až `CSS.getPlatformFontsForNode` přes CDP ukáže, kterým
písmem se znaky opravdu vykreslily („Fredoka ×4 + Nunito ×1" v „Těžká"). Po
změně scan 105 listových prvků ve Slovka One: žádný znak nespadne jinam.
`@font-face` má `font-weight: 100 900`, ať prohlížeč jediný řez neztučňuje;
jednotka „s" u času dědí písmo (globální `* { font-family: Nunito }` ji dřív
přepisoval).

→ *Memory updated: `slovka_font.md`*

### Slovka One: Fredoka One s doplněnými českými znaky na nadpisech
Fredoka One (2011) sedí hře nejvíc, ale chybělo jí 14 českých znaků
(ů č ď ě ň ř ť, Ů Č Ď Ě Ň Ř Ť). `tools/cz_font.py` je doplní a uloží kopii jako
**Slovka One**; hra ji má na nadpisech místo Capriole (`public/fonts/`, preload,
v shellu service workeru). Kopie OTF je i vedle originálu ve složce s fonty.

**Root cause / approach:** Hotové Š/š/Å jsou ve fontu slité obrysy, ne složeniny,
takže polohy znamének se musely *změřit* z kontur nad písmenem: háček stejný
tvar všude, velká o +200, vystředěný (+5); kroužek převzatý z å; ď/ť apostrof
×0,55 vpravo od dříku, u ť nad příčkou. Nové znaky jsou složeniny s převzatým
kerningem (Ť+o = T+o = −240), u ď/ť jen zprava. OFL vyhrazuje jméno „Fredoka",
proto jiné jméno; copyright autorky a text OFL jdou s fontem.

→ *Memory saved: `slovka_font.md`*

### Pauza s animovaným obrázkem
Nad „Pauza" jsou spící stopky v jazyce Kostek (`pauza-ziva.svg`): pohupují se,
symbol pauzy na ciferníku dýchá a stoupají písmena Z. Pod omezeným pohybem
statická verze `pauza.svg`.

**Root cause / approach:** Stejná technika jako živý plamen — SVG s CSS
animací uvnitř jako background-image, statická kopie pro reduced motion
z vnějšího CSS. Obě verze generuje jeden skript, ať se nerozjedou.

→ *Memory updated: `kostky_live_icons.md`*

### Nadpisy v Capriole, tlačítka zpět ve Fredoce
Pokus s Grandstanderem na tlačítkách je vrácený (revert). Problém s háčky byl
u nadpisů, ty jsou teď v Capriole: „20 slov", nadpisy obrazovek, sekcí
a sheetů, výsledek dne, hláška v mezihře, „Pauza", „Další kandidáti".

**Root cause / approach:** Capriola má jen řez 400 — s `font-synthesis: none`,
jinak by prohlížeč nadpisy uměle ztučnil (pozdější pravidla chtějí 700).
Pravidlo je na konci `kostky.css`, ať přebije dřívější Fredoku u týchž prvků.

→ *No new memory entries.*

### Detail slova s kandidáty, ikony akcí, lišta času nahoře ve hře
Klepnutí na kartu v mezihře otevře detail slova: štítky (pořadí podle častosti,
obtížnost, počet písmen, přesmyčky), nahoře zlatý „Nejlepší význam" s korunou,
pod ním „Další kandidáti" s hlasováním; po hlasu se pořadí přepočítá. Nahlášení
je vlaječka s potvrzením („Nahlásit?"), úprava tužka (i na stránce Moje
významy). Karta v mezihře má 3 řádky s výpustkou a odstín panelu, odkaz na
významy barvu panelu. Podržení Další slovo zastaví čas (puštění na tlačítku =
další, sjetí z něj = běží dál), pauza je klasický symbol. Nahoře ve hře je lišta
zbývajícího času, která plynule ubývá a barví se ze zelené do červené.

**Root cause / approach:** API nevracelo `voted`, takže po otevření vypadal hlas
jako nedaný a další klepnutí ho *odebralo* — `votedSet()` dotáhne hlasy
přihlášeného. U dotyku má prst implicitní pointer capture, takže `pointerup`
cílí vždy na tlačítko — „sjel z Další?" se proto ptá `elementFromPoint`. Lišta
času: `--t` (0–1) z `updateUI`, registrovaná přes `@property` s přechodem 1 s,
takže mezi vteřinami plyne; zelená → zlatá míchaná v HSL (v oklch vyšla kalná
oliva), zlatá → červená v oklch, prahy 18 s a 10 s.

→ *No new memory entries.*

### Moje významy: oblak štítků na profilu + stránkovaná obrazovka; % slovníku
Na profilu jsou vlastní významy jako oblak štítků (slovo + palce, 12 nejlépe
hodnocených) s odkazem na novou obrazovku **Moje významy**: karty jako dřív,
10 na stránku, úprava, označení skrytých po nahlášení. `/api/defs/mine` umí
`limit`/`offset`/`sort=votes` a vrací `total`. Dlaždice tréninku ukazuje různá
uhodnutá slova a „to je X % slovníku". Odhlášení je těsně nad Smazat účet.

**Root cause / approach:** Procento slovníku jde poctivě jen z různých slov —
`practiceWords` sčítá i opakování (mohlo by přes 100 %). Nové `practiceSeen` je
bitmapa nad PRACTICE_WORDS v base64 (~2,5 kB); počítá se až od teď, starší
tréninky neznáme. Pod 1 % dvě desetinná místa, jinak by první slova ukázala
„0 %". `editDef` dostal callback po uložení — dřív natvrdo překresloval mezihru.

→ *No new memory entries.*

### Podržení pauzne mezihru, kolečko myši na profilu, Smazat účet dole
Podržení prstu kdekoli na panelu mezihry (mimo tlačítka) odpočet na chvíli
zastaví — vyplňování tlačítka stojí a ukáže se pauza; puštěním běží dál. Krátké
klepnutí funguje jako dřív (mimo kartu = další slovo). Profil a výsledek jdou
zase scrollovat kolečkem myši. „Smazat účet" je červené tlačítko na konci profilu.

**Root cause / approach:** Scroll: pravidla `html:has(#profile.active),
body:has(#profile.active) { overflow-y: auto }` dělala z body scroll kontejner,
který sám scrollovat nemůže, a spolu s `overscroll-behavior: none` kolečko ani
tah nepustil dál k viewportu — programový `scrollTo` přitom fungoval, proto to
nebylo vidět. Scrolluje teď jen html, body má `overflow: visible`. Podržení:
po puštění se click nepočítá (prohlížeč ho po dlouhém stisku klidně pošle)
a text významu v mezihře nejde označit, jinak by podržení vybíralo text.

→ *Memory updated: `ios_native_feel_gotchas.md`*

### Vývojové prostředí pro účty a významy: DEV=1, seed, přihlášení bez e-mailu
Účty a komunitní významy jdou konečně vyzkoušet lokálně. `DEV=1` v `.dev.vars`
zapne přihlášení bez Resendu (kód a odkaz se vypíšou do terminálu wrangleru),
cookie bez `Secure` (jde i z telefonu přes http), vypne edge cache významů a
přidá `GET /api/dev/login?kdo=Tester`. `node worker/seed-dev.mjs` založí účty
Tester + 5 autorů, ~870 významů (48 ručně psaných, zbytek ukázkový pro ~70 %
Lehké) a hlasy; jde pouštět opakovaně. Karta v mezihře se po hlasu ze sheetu
nově přepočítá.

**Root cause / approach:** Bez secretů vracel `/api/me` `auth:false` a psaní
významů bylo nedosažitelné i lokálně — proto „význam není vidět". Tři tiché
pasti: `Secure` cookie se přes `http://192.168…` z telefonu neuloží; edge cache
drží i „slovo nemá význam" 5 minut, takže by čerstvý seed nebyl vidět; a stará
lokální D1 má `definitions.client_id NOT NULL`, protože `CREATE TABLE IF NOT
EXISTS` existující tabulku nezmění (seed píše `'dev-seed'`). Dev přihlášení je
za stráží `DEV=1` + lokální adresa + jen účty `dev-…` a hlídá ho `test.mjs`.

→ *Memory saved: `dev_accounts_and_seed.md`*

### Mezihra: víc hlášek, bez času, výzva k doplnění významu
Hlášky po uhodnutí mají tři zásobníky po 6–8 (do 5 s, zbývalo ≤ 10 s, běžně),
nikdy stejná dvakrát po sobě a všechny ≤ 12 znaků kvůli štítku série. Čas pod
hláškou zmizel — dobu do dalšího slova ukazuje tlačítko. Když slovo nemá význam,
je místo karty výzva „Víš, co znamená „…“?" s tužkou, která otevře sheet významů.

**Root cause / approach:** Význam nebyl vidět vůbec, protože jsem „Přidat
význam" schovával, když neběží účty (v produkci pořád chybí secrety,
OTEVRENE 1.1), a lokální statický server nemá API. Výzva je teď vždy; co se
stane po klepnutí, řeší sheet významů.

→ *No new memory entries.*

### Mezihra v tréninku jako panel zdola, živý plamen
Mezihra po slově byla všude stejná (text uprostřed, „Další slovo za 5 s"),
nešlo z ní přejít dál ani odejít a klepnutí ji *pozastavilo*. Teď vyjede panel
zdola jako Duolingo po odpovědi: zelený/červený, odznak ✓/✗, slovo jako kostky
(uhodnuté poskočí, nestihnuté se přeskládají z rozsypaného pořadí), série
„🔥 N v řadě" s plamenem, který plápolá a na milnících vzplane s jiskrami.
Tlačítko Další slovo se vyplňuje (3 s / 6 s po chybě), klepnutí mimo kartu
nebo Enter jde hned, sáhnutí na význam odpočet zruší, křížek funguje i tady.
„Přidat význam" se bez účtů neukáže (vedlo do slepé uličky). Živý plamen je
i v profilu (šedý při nulové sérii) a v pobídce k sérii.

**Root cause / approach:** Plamen je jedno SVG s CSS animací uvnitř
(`plamen-zivy.svg`) — jako background-image plápolá v Chromu i WebKitu, pod
omezeným pohybem ho Kostky vymění za statický. Přeskládání kostek je FLIP bez
měření: kostky jsou v jedné řadě, takže posun = rozdíl indexů × (šířka + mezera)
do `--from`, oblouček `--hop`, animace v keyframes s `var()`. Panel „Paráda!"
ze hry je v tréninku schovaný (`#game.practice`), jinak by vyjely dva.
Sjetí dolů sdílí se sheety `slideDown()`.

→ *Memory saved: `kostky_live_icons.md`*

### Sheety: čisté záhlaví a zavírání vždy animací
Ze sheetů zmizel křížek i dělicí čára; zůstal úchyt a nadpis, který nese
informaci — v tréninku rovnou otázka „Jak těžká slova chceš?", ve zpětné vazbě
„Jak se ti hraje?" (dřív opakovaly tlačítko, kterým se sheet otevřel). Zavírá
se klepnutím do pozadí, tažením dolů, Escapem nebo tlačítkem v obsahu —
a vždy animací: sheet sjede dolů z místa, kde právě je, pozadí se rozplyne.
Místo čáry pod nadpisem měkký přechod, pod který seznam zajíždí.

**Root cause / approach:** Dřív `closeModal()` jen sundal `.active`, takže sheet
zmizel naráz. `closeSheet()` vezme aktuální `transform` (i z půlky tahu nebo
otevírací animace), dotáhne ho na `translateY(100%)` a sheet schová až po
300 ms. Konec hlídá časovač, ne `transitionend` — ten probublává z přechodů
uvnitř sheetu (karty, položky sbírky) a zavřel by ho předčasně. Fokus jde na
`.modal-content` (`role=dialog`), ne na skryté „Zavřít" — programový fokus
tlačítka ho rozsvítil i po klepnutí prstem.

→ *Memory updated: `modals_are_bottom_sheets.md`*

### Lehká obtížnost jen do 5 písmen
Lehká bere z 3000 nejběžnějších slov jen ta do 5 písmen (1215 slov, třeba
*hotel, nákup, beton*). Střední a Těžká beze změny.

**Root cause / approach:** Lehká byla pořád těžká kvůli délce, ne frekvenci:
mezi 3000 nejčastějšími má 60 % slov 6+ písmen (*inteligence, trojúhelník*)
a obtížnost přesmyčky roste s délkou faktoriálně (5 písmen = 120 pořadí,
7 = 5040). Úroveň má proto volitelné `maxLetters` vedle `size`.

→ *No new memory entries.*

### Modály jsou sheet zdola i na desktopu
Z `style.css` i `designs/kostky.css` zmizela desktopová varianta
(`@media (min-width: 600px) and (hover: hover)`), která z sheetu dělala dialog
na střed. Teď je jediný vzor: sheet přilepený dole s úchytem, na širokém
displeji jen užší (460 px); Kostky mu daly okraj i po stranách.

**Root cause / approach:** Uživatel chce sheet jako stabilní vzor napříč
zařízeními. Tažení dolů funguje i myší — `sheetDrag` v `game.js` je na pointer
eventech, takže desktop nepotřeboval nic navíc.

→ *Memory saved: `modals_are_bottom_sheets.md`*

### Obtížnost tréninku: Lehká / Střední / Těžká
Trénink teď před startem nabídne tři úrovně (sheet po klepnutí na Trénink
na úvodu i ve výsledku): Lehká = 3000 nejčastějších slov, Střední = 7300
(přesně slova denní výzvy, výchozí), Těžká = všech 15 000. Klepnutí na úroveň
trénink rovnou spustí, volba se pamatuje v `persist.practiceLevel` a je vidět
v liště („Slovo 5 · Lehká"). V Kostkách karty s retem a ikonou síly 1–3 sloupků.

**Root cause / approach:** Trénink míchal celý pool, a protože je seřazený podle
frekvence, polovina slov chodila z řídkého konce (7300–15 000: *douglaska,
větrolam*), navíc delších (průměr 7,7 písmene proti 5,9 u prvního tisíce).
Úroveň je proto jen `PRACTICE_WORDS.slice(0, N)`. Popisek „Střední = jako denní
výzva" hlídá nový test (denní výzva = přesně prvních 7300 slov poolu).

→ *No new memory entries.*

### Ikona aplikace v jazyce Kostek
Nová ikona na plochu: zelené pole, mřížka 2×2 jako sdílený výsledek, tři bílé
klávesy s šedým retem a jedno propadlé pole — otisk použitého písmene. Navazuje
na starou ikonu (stejná mřížka, prázdné pole vlevo dole), jen v barvách a tvarech
Kostek. Zdroj je `public/icons/icon.svg`, PNG (512, 192, 180, 32) jsou z něj
přes `rsvg-convert`.

**Root cause / approach:** Písmena na ikoně (např. SLOV) by ve 32px faviconu
splynula a bez fontTools nešla převést z Fredoky do křivek, proto motiv bez
textu. PNG bez alfa kanálu — iOS průhlednost v apple-touch-icon vyplní černou.
Už nainstalované PWA si ikonu nechají, dokud ji hráč nepřidá na plochu znovu.

→ *No new memory entries.*

### Větev kostky-trenink: Kostky jako jediný vzhled
Z průzkumu šesti směrů zůstaly Kostky. `designs/kostky.css` se načítá natrvalo
za `style.css`; ostatních pět směrů, nástěnka `/designs.html` a přepínací
skript `?design=` jsou pryč (zůstávají na `design/genz-directions`). Fredoka
se stahuje v hlavním odkazu na Google Fonts místo `@import` (bez řetězení),
service worker má Kostky v shellu (`slov2000-v4`), `theme-color` a manifest
mají barvy Kostek. Z `game.js` zmizel hák `--t`, Kostky ho nepoužívají.

**Root cause / approach:** Kostky zůstaly vrstvou nad `style.css`, ne sloučené
do něj — sloučení by byl velký přepis bez viditelného rozdílu a změny
v tréninku se dají dělat hned.

→ *Memory updated: `design_directions_board.md`*

### Kostky: vlastní ikony místo systémových emoji
Čtrnáct SVG v `public/designs/kostky/` ve stylu směru (ploché barvy z palety,
spodní ret, světlý pruh, žádné obrysy): statistiky v profilu, trofej / koruna /
medaile / zlomené srdce u umístění, palec u hlasů, zámky ve sbírce a u
odkrytých slov, plamen v pobídce k sérii, zvonek, telefon „na plochu"
a odškrtnutí po odeslání zpětné vazby. Ostatní směry ukazují emoji jako dřív.

**Root cause / approach:** Emoji, která píše JS do textu, CSS nepřebije.
`setEmojiText()` v `game.js` je proto obalí do `<span class="emoji"
data-emoji="…">` (staví DOM, ne HTML — percentil může přijít z backendu)
a kůže znak odsune `text-indent`em mimo box a ukáže ikonu. `color:
transparent` barevné emoji neschová. Text do sdílení zůstává emoji.

→ *No new memory entries.*

### Šest vizuálních směrů pro Gen Z (větev design/genz-directions)
Průzkum vzhledu bez změny funkcí: šest vrstev CSS v `public/designs/` nad
`style.css`, zapínaných `?design=<název>` (pamatuje se, `?design=off` vypne).
Tři vlastní (Kostky/Duolingo, Sešit, Záře) a tři podle identit aplikací
(Plakát/Spotify Wrapped, Cvak/Snapchat, Smyčka/TikTok). `/designs.html` je
ukazuje živě vedle sebe a přepíná všechny do stejného stavu i režimu. Do
`game.js` přibyly jen dva prezentační háky: `--t` (zbývající čas 0–1) na
`#game` a barvy konfet z `--confetti`. Který směr, čeká v OTEVRENE-OTAZKY 1.6.

**Root cause / approach:** Nástěnka řídí iframy přes `contentWindow.eval`, který
vidí i `let`/`const` globály hry (`state`, `persist`, `defCache`); `savePersist`
je deklarace funkce, takže jde v rámečku přepsat na no-op a ukázková data
nepřepíšou uloženou hru. Chrome dává iframu `prefers-color-scheme` podle
`color-scheme` rámečku — přepínač režimu tak nesahá do hry. Past pro každou
kůži: `.answer-slot` si nechává `entering` i inline `animation-delay` napořád,
keyframe na `.filled` pak dědí zpoždění i×40 ms.

→ *Memory saved: `design_directions_board.md`, `webkit_check.md`*

## 2026-09-21

### Revize očima iOS designéra: bezpečné zóny, sheety, palcová zóna
Prošel jsem aplikaci jako nativní iOS appku a opravil, co ji prozrazovalo jako
web. Modály jsou teď sheety zdola s úchytem, přilepenou hlavičkou a zavíráním
stažením dolů; písmena ve hře sedí v palcové zóně, HUD (mřížka + čas) zůstal
nahoře; `:hover` platí jen tam, kde je myš.

**Root cause / approach:** `viewport-fit=cover` chybělo v meta viewportu, takže
**všech ~10 `env(safe-area-inset-*)` v CSS vracelo 0** — celá práce s bezpečnými
zónami byla mrtvá a nebylo to nijak vidět, protože 0 je validní hodnota.
Druhá tichá chyba: `.screen p:not(.welcome-instruction)` (0,2,1) přebíjelo
`.profile-note` (0,1,0), takže poznámky v profilu jely 20 px na střed místo
13 px vlevo. A komentář v `sw.js` tvrdil, že fonty jsou `opaque` — Google Fonts
chodí s CORS hlavičkami (`type === 'cors'`), takže cachovat jdou; bez toho
appka offline naskočila v systémovém fontu.

→ *Memory saved: `ios_native_feel_gotchas.md`*


### Denní slova zamíchaná ve words.js — zítřek už ze zdrojáku nevyčteš
`words.js` posílal všech 7300 slov v pořadí dnů, takže si kdokoli přečetl
zítřek. Nově se do souboru zapisuje 365 blobů (`PACKED`), jeden na den,
a `unpackDay(den)` je rozbalí až na vyžádání. Offline hra zůstala beze změny —
slova jsou pořád v balíčku, jen nečitelná.

**Root cause / approach:** Tajemství není slovník, ale **mapování den → slova**;
`PRACTICE_WORDS` (15 000, nadmnožina) je veřejný tak jako tak. Šifra je
synchronní (mulberry32 + XOR), ne WebCrypto — klíč stejně leží v balíčku, takže
by se za sílu AES zaplatilo jen tím, že `dayWords()` bude `async` a nakazí
volající. Vědomý strop: `for (i…) dayWords(i)` pořád vypíše rok; skutečné
utajení = servírovat den z workeru, čímž padá offline. Šifra běží ve dvou
jazycích (Python packuje, JS rozbaluje) a parita bitů se hlídá tím, že
existující testy slovníku běží nad rozbalenými daty — rozjetý bit je shodí hned.

→ *Memory saved: `packed_daily_words.md`*

### Významy jen pro přihlášené, úprava pro autora, pobídka na sérii
Psát, hlasovat, nahlašovat i upravovat významy smí nově jen přihlášený hráč.
Číst je může kdokoli. Autor smí svůj význam upravit — když už má hlasy, úprava
je smaže. Na výsledkové obrazovce se při sérii 3/7/14/30/60/100/200/365 dní
jednou ozveme, že série žije jen v tomhle zařízení.

**Root cause / approach:** Anonymní autorství byla tikající bomba. Přezdívka
nebyla nijak ověřená ani rezervovaná, a přitom se tiskla k publikovaným
významům — dva lidé mohli psát jako „Michal" a po zavedení účtů by nešlo určit,
kdo je kdo (nebo by se skutečná Kačka po registraci ocitla vedle cizího obsahu).
Zrušením anonymního zápisu ten problém mizí celý: jméno u významu je vždy
přezdívka z účtu. Zároveň to spravilo hlasování — dosud šlo hlasy sypat
libovolným počtem vymyšlených `clientId`, protože identita byla self-asserted.
Identitou je teď účet, takže se unikátní index posunul z `(client_id, word)`
na `(user_id, word)` — na jednom telefonu tak můžou psát dva lidé.

Úprava vynuluje hlasy, pokud nějaké byly. Bez toho by šlo vyhlasovat neškodnou
větu a pak ji přepsat na cokoli — a hlasy by se zdědily.

Pobídka k účtu sedí na sérii, ne v nastavení: je to jediná věc, o kterou tu jde
reálně přijít, a lidi si sérii chrání. Ukáže se jednou na milník (`nudgedAt`)
a jen když jsou účty vůbec spuštěné, jinak by to byla slepá ulička.

**Důsledek, se kterým je třeba počítat:** dokud nebude doména a Resend, nejde
přidat význam vůbec. Je to přímý důsledek rozhodnutí, ne regrese.

→ No new memory entries.

## 2026-09-21

### Účty připravené „na klíč" — spí, dokud nepřijdou secrety
Celé přihlášení magic linkem je hotové a nasazené, ale **neaktivní**: bez
`RESEND_KEY`/`MAIL_FROM` vrací `/api/me` `auth:false`, `/api/auth/start` končí
na 503 a aplikace sekci účtu vůbec nevykreslí. Zapnutí = doména + ověření
v Resendu + tři secrety, v kódu se nemění nic.

**Root cause / approach:** Odkaz session **nevytváří**, jen ji schválí — vyzvedne
si ji poll té instance, která o přihlášení požádala. Důvod: odkaz z Mailu otevře
Safari/Chrome, ne nainstalovanou PWA, a ta má na iOS 17.4+ vlastní úložiště
cookies oddělené od Safari, takže cookie z mailu se do aplikace nedostane nikdy.
Schválení je navíc `POST` za tlačítkem: poštovní skenery odkazy předběžně
stahují a `GET` by tiše přihlásil cizího člověka (ověřeno — pouhý GET na odkaz
nechá žádost ve stavu `pending`). Jako druhá cesta je v mailu šestimístný kód
pro případ, že se hráč vrátí do aplikace dřív, než doklikal.
E-mail se neukládá, v DB je jen `sha256(adresa + HASH_PEPPER)`.

Tři věci, které se ukázaly až při zkoušení:
- **`.dev.vars` se od přesunu konfigurace do kořene repa vůbec nenačítal.**
  Wrangler ho hledá vedle `wrangler.toml`, ne u zdrojáků, takže lokálnímu vývoji
  tiše zmizel i VAPID klíč. Soubor je teď v kořeni — a **nejdřív** přibyl do
  `.gitignore`, protože tam pro něj dosud žádné pravidlo nebylo.
- **Export konstant ze vstupního modulu workeru shodí runtime.** Cloudflare
  kontroluje každý pojmenovaný export jako handler (`not of type 'function or
  ExportedHandler'`), takže validace bydlí v `validate.js` a přihlášení v
  `auth.js`.
- **Vypnuté přihlášení musí být vypnuté doopravdy.** Zbylá `sid` cookie dál
  identifikovala hráče, i když byl zbytek účtu skrytý — zůstal „přihlášený" bez
  jakéhokoli ovládání. `currentUser()` teď při vypnutém auth vrací `null`.

Ověřeno proti běžícímu workeru s mockem pošty: start → odkaz i kód v mailu →
GET nic neschválí → POST schválí → poll vydá session v `HttpOnly` cookie →
druhý poll už je `expired` → přezdívka → význam se podepíše účtem (podvržený
`author` z těla requestu se ignoruje) → anonymní významy ze zařízení se při
přihlášení navážou na účet → odhlášení → smazání účtu významy zachová a jen
z nich sundá jméno.

→ No new memory entries.

## 2026-09-21

### Přesmyčky jen pro trénink + doplacení vlastních dluhů
Přesmyčky se nově uznávají **jen v tréninku** — denní výzva je soutěž, všichni
v ní mají stejných 20 slov, takže musí padnout přesně to hledané
(`isAcceptedWord()` končí na `state.mode !== 'practice'`). K tomu tři věci,
které jsem dlužil: spustitelná kontrola, edge cache na významy a konec
mrtvého tlačítka „Přihlásit se".

**Root cause / approach — a jedna chyba, která málem šla do produkce:**
Pro `test.mjs` jsem nejdřív přidal `export { clean, defTextError, DEF_MAX… }`
přímo do `worker/src/index.js`. Cloudflare ale kontroluje **každý pojmenovaný
export vstupního modulu** jako handler, takže runtime odmítl nastartovat:
*„Incorrect type for map entry 'DEF_MAX': the provided value is not of type
'function or ExportedHandler'"*. Chytil to až `wrangler dev` — deploy by spadl.
Validace se proto přestěhovala do `worker/src/validate.js`, odkud ji importuje
worker i test.

- **`node test.mjs`** — 18 kontrol, bez frameworku: validace významů (hranice
  délky, sprostá slova, odkazy, řídicí znaky), vlastnosti slovníku (počty,
  podmnožina, jedno slovo z každého pásma na den) a úplnost přesmyček.
  Ověřeno mutací: když se z `ALTS` odebere vazba `síla→lísa`, test spadne
  s exit 1 a vypíše, která vazba chybí.
  Pozor na past: `words.js` se spouští ve `vm`, takže pole z něj mají prototyp
  z jiného realmu a `deepStrictEqual` je odmítne — porovnává se proto obsah.
- **Edge cache významů** po jednotlivých slovech (ne po dávce — fronty jsou
  u každého hráče jiné). Klíč se staví ručně, nikdy z příchozího requestu:
  ten nese cookie a `clientId` a cache by se roztříštila. Příznak `mine` je
  na hráče, takže se dopočítává až po cache — ověřeno, že autor vidí `true`
  a cizí `false` i při zásahu z cache. Zápis slovo zneplatní.
- **Přezdívka má konečně kde bydlet.** Profil ji umí nastavit a změnit,
  promítne se do avataru i do formuláře u významů. `promptLogin()`, které jen
  ukázalo toast, je pryč.

→ No new memory entries.

## 2026-09-21

### Přesmyčky: hra uzná každé slovo, které sama zná
Když šlo ze stejných písmen složit jiné slovo z poolu, hra ho přesto označila
za chybu — `síla` nepřijala `lísa`, `vlas` nepřijal `sval`, `orkán` nepřijal
`nárok` ani `korán`. Generátor teď k ručně kurátorované mapě `ALTS` dopočítá
**přesmyčky uvnitř poolu**: 325 skupin, 677 slov, doplněno 132 chybějících
vazeb (34 z nich v denní výzvě). `ALTS` má 1348 klíčů místo 1234.

**Root cause / approach:** Chyběly, protože původní mapa vznikla nad starým
13 000slovním poolem a nikdy se nepřepočítala po tom, co se pool přefiltroval
na podstatná jména a doplnil na 15 000. Nešlo ji ale přegenerovat celou — nese
kuraci proti nějakému českému slovníku, kterou se nepodařilo zrekonstruovat
(uznává i tvary mimo pool, `otec` → `ocet`, `otce`; `efka` ano, `fake` ne).
Řešení je proto přírůstkové: ruční část se přebírá beze změny a jen se k ní
přidají vzájemné vazby uvnitř každé skupiny slov se stejnými písmeny.

Ověřeno, že `WORDS` ani `PRACTICE_WORDS` se nezměnily — rozdělení slov do dnů
tedy zůstalo stejné a hráčům se den nepřeskládal. Změnilo se jen `ALTS`.

→ No new memory entries.

## 2026-09-21

### Komunitní významy slov + mezihra po každém slově v tréninku
Trénink má po **každém** slově (uhodnutém i nestihnutém) stejnou mezihru: velké
slovo, nejlépe hodnocený význam od hráčů, odpočet na další slovo a tlačítko
k přidání vlastního. Klepnutím kamkoli se odpočet zastaví a zase rozjede, bez
tlačítka. Modal se všemi významy umí hlasovat, nahlásit a přidat vlastní; po
třech nahlášeních význam zmizí. Ve statistikách přibyla uhodnutá slova
z tréninku — opakované slovo se počítá znovu.

**Root cause / approach:** Zápisy měly podle plánu viset na účtech, jenže
přihlášení e-mailem je zablokované na doméně, která zatím není koupená
(Resend bez ověřené domény nedoručí). Autorství proto zatím drží anonymní
`client_id` — stejné, jaké používá `results` — a přezdívka je jen self-asserted
řetězec. Plán s tím počítá: `users.client_id` je právě na pozdější navázání účtu.
Brzdy proti zahlcení jdou i bez přihlášení: unikátní index `(client_id, word)`
= jeden význam na slovo a hráče, 20 významů/den, délka 10–200, regex na sprostá
slova přenesený z `tools/build_words.py`, zákaz odkazů a zákaz hlasovat si sám.

Dvě věci, které to formovaly:
- **Mezihra je překryv, ne `.screen`.** `.screen` je `100dvh` s `touch-action:none`
  a `showScreen()` by deaktivoval `#game`, do kterého `placeGameGrid()` fyzicky
  vkládá herní mřížku. Odpočet jede v `state.nextTimer`, který `startPracticeGame()`
  i `exitPractice()` už uklízejí, takže nevznikl další kill switch.
  Tím zanikl `countdownToNextWord()` a přepisování `#progress` — smazáno.
- **Cizí text jen přes `textContent`.** `game.js` na pár místech sype `innerHTML`
  a od téhle chvíle se v DOMu ocitá text od cizích lidí u každého slova. Ověřeno:
  význam s `<script>` i přezdívka s `<img onerror=...>` se vykreslí jako text,
  žádný uzel nevznikne.

Pozn.: schválený plán psal, že otevření seznamu významů má session **zabít** —
to si odporovalo s dřívějším rozhodnutím „pozastavit a pokračovat". Platí volba
uživatele: modal odpočet jen pozastaví, po zavření (i Escapem) jede dál.

→ No new memory entries.

## 2026-09-21

### Profil a trénink jako dva rohy úvodní obrazovky
Úvodní obrazovka dostala dvě kulatá tlačítka v horních rozích — vlevo Profil,
vpravo Trénink — a k nim novou obrazovku `#profile` se šipkou zpět, avatarem,
přihlášením, statistikami v mřížce 2×2 a sekcí „Moje významy". Statistiky jsou
skutečné, počítají se z `persist.results` (dní v řadě, odehraných dní, získaných
slov, úspěšnost). Přihlášení a významy zatím jen vysvětlují, že se chystají —
backend pro ně vznikne až v P2/P3 podle plánu.

**Root cause / approach:** Profil je záměrně `.screen`, ne modal: na telefonu se
„další stránka" se šipkou zpět chová jinak než překryv a uživatel to čeká.
Kvůli tomu musel dostat výjimku ze scrollování — `.screen` je zamčená na
`100dvh` s `touch-action:none` a scrollovat směl dosud jen `#result` přes
`:has()` pravidlo. Klávesnicová stráž řešit nemusela: `document.onkeydown`
propouští jen když je aktivní `#game`, takže nová obrazovka je bezpečná zadarmo.
Při kontrole na šířce telefonu se ukázalo, že `welcomeRules` mělo natvrdo `<br>`,
které text trhalo doprostřed slova — zrušeno, ať teče přirozeně.

Poznámka k ověřování: `Emulation.setEmulatedMedia` pro `prefers-color-scheme`
vykreslilo světlý režim rozbitě (světlý text na světlém pozadí), ale byl to
artefakt emulace — `--ink` je ve světlém režimu `#1c1c1e`. Spolehlivé je sáhnout
na `:root[data-theme="light"]`, který v CSS existuje.

### Úklid po přesunu: starý worker smazán, GitHub Pages vypnuté
`slov2000-api` zrušen, Pages odpojené. D1 zůstala nedotčená (1 odběratel,
8 výsledků) — smazání workeru databázi nebere.

**Root cause / approach:** Málem to shodilo push notifikace. **Secrety jsou
per-worker**, takže nový `slov2000` po nasazení neměl `VAPID_PRIVATE_JWK`
(`wrangler secret list` → `[]`) a cron by tiše nic neposlal, zatímco starý worker
ho pořád měl. Klíč se musel nejdřív přenést z `worker/.dev.vars` a ověřit, že
z jeho `x`/`y` sedí veřejný klíč zadrátovaný v `game.js` — jinak by existující
odběry přestaly platit. Teprve pak šlo mazat.
GitHub Pages: `DELETE /repos/:o/:r/pages` odstraní konfiguraci hned (GET vrací
404), ale obsah na `agilek.github.io` ještě chvíli dojíždí z CDN — teardown je
na straně GitHubu asynchronní a nejde uspíšit.

→ No new memory entries.

## 2026-09-21

### P0: hra i API jedou z jednoho Cloudflare Workeru (konec GitHub Pages a CORS)
Statika se přesunula do `public/`, `wrangler.toml` do kořene repa a jeden Worker
teď servíruje obojí — `[assets]` vydá soubory, `run_worker_first = ["/api/*"]`
pošle API do `worker/src/index.js`. Tím je všechno na jedné doméně, takže z workeru
zmizel celý CORS (`ALLOWED_ORIGINS`, `corsHeaders()`, větev `OPTIONS`, parametr
`cors` protažený všemi handlery) a `if` řetěz se zploštil na tabulku `ROUTES`.
GitHub Pages workflow nahradil `cloudflare/wrangler-action`.

**Root cause / approach:** Tohle není kosmetika, ale předpoklad pro účty. Přes dvě
domény (Pages + workers.dev) by session musela být bearer token v `localStorage`,
čitelný jakýmkoli skriptem na stránce — a chystaná funkce začne vykreslovat cizí
text (významy slov) u každého slova. Na jedné doméně je session `HttpOnly` cookie,
kterou JS nepřečte. Vlastní doména k tomu **není potřeba**: `workers.dev` dá stejný
origin hned, doména se navěsí později (nutná je až pro odesílání e-mailů).
CSRF místo CORS hlídá `sameOrigin()` + vyžadovaný `Content-Type: application/json`.

Dva chytáky, na které se dalo naletět:
- `API_BASE` se změnil na prázdný řetězec (relativní cesty), jenže
  `fetchRealPercentile()` začínala `if (!API_BASE) return null;` jako stráž
  „backend není nastavený" — percentily by se tiše vypnuly úplně. Stráž musela pryč.
- `tools/build_words.py` měl `--out` natvrdo `words.js`, takže by po přesunu
  generoval slovník do kořene, kde ho už nikdo neservíruje. Přepnuto na
  `public/words.js` a ověřeno, že výstup je bajt po bajtu stejný.

Ověřeno přes `wrangler dev`: `/` vydá hru, `/api/percentile` i `/api/result` jedou,
odpovědi nemají žádnou `Access-Control-*` hlavičku, zápis s cizím `Origin` dostane
403 a s vlastním 200. V prohlížeči prošla celá denní výzva (20 slov → výsledková
obrazovka, série, zápis do D1) i trénink.

→ No new memory entries.

## 2026-09-21

### Trénink je nekonečný — po nestihnutém slově se sám posune dál
Trénink byl na přežití: první nestihnuté slovo hru ukončilo a vyhodilo
výsledkovou obrazovku s „Trénovat znovu / Zpět". Teď neskončí vůbec — slovo se
odhalí, na místě časovače naskočí odpočet „Další slovo za 3 s" a další slovo
naběhne samo. Správně složené slovo se posouvá hned jako dřív. Jediný východ je
křížek vpravo nahoře. Trénink tím pádem výsledkovou obrazovku vůbec nepoužívá,
takže z ní šly pryč všechny `isPractice` větve i mrtvý DOM (`#failedWord`,
`#practiceAgainBtn`, `#backBtn`) a s nimi i řádek „Díky za hru".

**Root cause / approach:** Odpočet nejde pověsit na okamžik minutí — odhalování
slova po písmenech trvá `délka × 65 ms + 340`, takže odpočet startuje až po něm
a `hold` se zkrátí o 320 ms závěrečného prolnutí; jinak doběhne o sekundu dřív,
než se slovo doopravdy vymění. Druhá věc byla skrytá chyba: zavření tréninku
nezrušilo už naplánované `setTimeout`y, takže `loadWord()` doběhl na uvítací
obrazovce a rozjel časovač na pozadí — a kdyby si hráč mezitím pustil denní
výzvu, přepsal by jí rozehrané slovo. Řeší to `state.gen`: každé nové kolo
(`startGame`, `startPracticeGame`, `exitPractice`) číslo zvýší a naplánované
callbacky se podle něj poznají a zahodí.

Vedlejší nález: `index.html` a `game.js` na sobě teď závisí (skript sahá na
konkrétní prvky), takže prohlížeč, který servíruje novou stránku se starým
skriptem z cache, spadne v půlce vykreslování — stará `showResult` hledala už
smazaný `#failedWord`. Odkazy na `style.css`/`words.js`/`game.js` proto dostaly
`?v=3`; při další změně, která mění kontrakt mezi HTML a JS, se číslo zvýší.
(`sw.js` v tom nevinně — žádný `fetch` handler nemá, řeší jen push.)

→ No new memory entries.

## 2026-09-21

### Morfologický filtr: v seznamech zůstala jen podstatná jména
V poolu i v denní výzvě byla přídavná jména (`starý`, `denní`, `psí`,
`kuřecí`), tvary sloves (`měl`, `jedl`, `kopal`), zájmena (`naši`, `vaši`),
příslovce (`blízko`, `málo`) a vlastní jména (`milan`, `sara`). Doplněn krok
s MorphoDiTa (ÚFAL LINDAT REST API): projde jen slovo se jmenným čtením
v 1. pádě (nebo nesklonné), které pod vlastním lemmatem nemá čtení jako
přídavné jméno, zájmeno, číslovka, spojka, předložka, částice ani citoslovce.
Z původních 13 000 to vyřadilo 522 slov, pool se dorovnal na 15 000
z dalších kandidátů.

**Root cause / approach:** Kategorie Wikislovníku na tohle nestačí — heslo je
v Kategorii:Česká substantiva, i když je jmenný význam úplně okrajový, takže
křížová kontrola s kategoriemi jiných slovních druhů `starý` ani `měl`
nechytí. Dvě slepé uličky: „má jmenné čtení" je moc slabé (`psí` i `kuřecí`
jmenné čtení mají, čeština zpodstatňuje produktivně) a „má **jen** jmenné
čtení" je moc silné (vyhodí `stát`, `moc`, `peklo`, `brána`). Sedí až
kombinace: jmenné čtení v 1. pádě **a zároveň** žádné adjektivní/zájmenné
čtení pod vlastním lemmatem — slovesné a příslovečné homografy se nechávají,
protože `stát` a `ticho` podstatná jména jsou. Zbylých ~110 případů morfologie
rozhodnout neumí (`vedoucí` a `taneční` mají identické značky), ty jsou ručně
v `tools/pos_overrides.txt` s jasnou čárou: jména pro člověka podle role
a nesklonná přejatá ano, běžná přídavná jména ne.

Dva chytáky v datech: nesklonná substantiva (`madam`, `zoo`) mají v značce pád
`X`, ne `1` — první verze filtru je tiše vyhazovala. A tagger se musí volat
`input=vertical` s prázdným řádkem mezi slovy, jinak si ze seznamu udělá větu
a hádá z kontextu sousedů (`pes` → *peso*, `pravda` → částice).

→ *Memory saved: `czech_noun_filtering.md`*

## 2026-09-21

### Denní výzva: 2000 → 7300 slov (365 dní), slova určuje datum, pool 13k → 15k
Denní hra byla omezená na 2000 slov / 100 dní a slova se braly podle *postupu*
hráče, takže dva lidé ve stejný den hráli různá slova — „Top X % hráčů dneška"
tedy neporovnávalo nic. Teď je den odvozený z data (`dayIndex()`, `EPOCH`
2026-09-21, modulo 365), všichni mají v daný den stejných 20 slov, a den se
posune zítra bez ohledu na dnešní výsledek. Postupový model (`persist.level`,
„jedna chyba = den znovu") je pryč, nahradila ho `persist.results`
(index dne → skóre) a sbírka odehraných dní. Slovník: 7300 slov denní výzvy,
tréninkový pool doplněn na 15 000.

**Root cause / approach:** Slovník se nedal jen „natáhnout" — pořadí bylo čistě
podle OpenSubtitles, a to je korpus titulků: v prvních tisících sedí dabingový
slang a vokativy (`osle`, `lízo`, `ťopka`). Přeřadit to podle `wordfreq` `cs`
ale rozbije druhý konec — frekvenční korpusy počítají **tvary, ne lemmata**,
takže `měl` (tvar slovesa *mít*) vyskočí na 3. místo a `plzeň` na 145. Řešení
je průměr obou **pořadí**: slovo musí být běžné v mluveném i psaném jazyce.
Druhá věc: dny se nesmí řadit podle frekvence a pak rozbíjet tematické shluky
ručně (to se dělalo 2026-09-09 a při přegenerování se to celé ztratilo).
Slova jednoho tématu mají podobnou frekvenci, takže stačí rozdělit 7300 slov
do 20 frekvenčních pásem po 365 a dát každému dni právě jedno slovo z každého
pásma — stejné téma pak padne do stejného pásma a do jednoho dne se nedostane.
Z 365 dnů zbylo 6 kolizí (většinou stejný kmen), ty opraví prohození v pásmu.

Celý postup je nově skript `tools/build_words.py` + `tools/vetted_pool.txt`
(13 000 ručně prověřených substantiv — kurace, kterou z Wikislovníku
nezrekonstruuješ: `stát`/`moc`/`škoda` zůstávají, `měl` ne). Minule se pipeline
ztratila a musela se stavět znovu; teď je v repu a je deterministická.

→ *Memory saved: `czech_frequency_ranking.md`, `word_theme_clustering.md` (aktualizováno)*

## 2026-09-09

### Fixed same-day thematic word clustering in words.js
Pure-frequency ordering had grouped semantically related nouns into the same 20-word day (day 1: den/noc/večer/ráno all "time of day"; days 2–5: almost entirely family words). Wrote a one-off script defining 9 theme groups (čas dne, rodina, dny v týdnu, roční období, barvy, tělo, zbraně, emoce, domov/dům) and greedily swapped clustering words with nearby-day words of similar frequency rank until no day had 2+ words from the same theme.

**Root cause / approach:** Common nouns cluster by semantic field regardless of language, so a pure-frequency sort is guaranteed to produce same-theme runs among the most frequent words. Swaps cascaded through days 1–13 (family/time words are densest there) plus 7 isolated 2-word swaps elsewhere (days 9/10, 15–18, 24/25, 27/28, 33/34, 63/64, 72/73). Word count stayed 2000, no duplicates introduced.

→ *Memory saved: `word_theme_clustering.md`*

### Fast-forwarded main to latest branch, pushed to origin
Two remote branches (`claude/button-haptic-feedback-8kgxkn`, `claude/czech-word-game-f2hnia`) both pointed to the same latest commit `723fde7`, 30+ commits ahead of `main`. Fast-forward merged and pushed.

→ No new memory entries.

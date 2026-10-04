# Otevřené otázky

Věci, na které čekám odpověď, a co se nedá dodělat bez rozhodnutí.
Poslední aktualizace: 2026-09-25.

> Pravidlo: cokoli, co potřebuje rozhodnutí uživatele, patří sem — hned, jak to
> vyjde najevo. Ne až na konci, ne jen v odpovědi v chatu. Zodpovězené se
> přesouvá dolů do „Rozhodnuto", ať je vidět, proč je něco tak, jak je.

---

## 1. Blokuje to ostatní

### 1.2 Má `/api/result` vyžadovat přihlášení?
**Stav:** čeká na rozhodnutí.
Klient si dnes `clientId` tvrdí sám, takže percentily „Top X % hráčů dneška"
umí rozhodit kdokoli s curlem. Navázání na účet to spraví, ale nepřihlášení
(tedy většina hráčů) by percentil neviděli vůbec.

- *Nechat otevřené:* široké pokrytí, ale číslo není důvěryhodné.
- *Vyžadovat účet:* číslo sedí, ale většina lidí přijde o zpětnou vazbu.

Můj názor: nechat otevřené a přestat to prezentovat jako žebříček.

### 1.4 Kdo prochází nahlášené významy?
**Stav:** vyřešeno 2026-09-25, správa na `/admin` (viz `worker/README.md`).
Nahlášené a skryté významy jde vrátit, skrýt nebo smazat, hráče zablokovat,
přejmenovat nebo mu skrýt profil. Správce určuje secret `ADMIN_EMAILS`.

### 1.5 Mají se významy ukazovat i v denní výzvě?
**Stav:** čeká na rozhodnutí.
Teď je vidí jen ten, kdo hraje trénink. Kdo hraje jen denní výzvu, o funkci
nikdy nezjistí. Dřív jsi zvolil „jen trénink", ale to bylo předtím, než významy
vůbec existovaly — stojí za přehodnocení, aspoň pro výsledkovou obrazovku.

---

## 2. Chybí, ale rozhodnutí nepotřebuju

Můžu udělat, až řekneš.

- **Přepínač „Zvuky“ v profilu.** Zvuků přibývá (tap na tlačítka, převíjení
  času, hlas, sheety) a ztlumit je jde jen hlasitostí telefonu. Na iOS je
  ztiší i přepínač ticha, jinde nic. Stačí jedna položka v `persist` a stráž
  v `playTone`.
- **Přepínač „skrýt profil"** — poslední kus P5. Sloupec
  `users.hide_profile` v databázi je, UI k němu ne. Text o soukromí je hotový
  (`/soukromi`), po přidání přepínače v něm doplnit.
- **Souboj přes odkaz `?vyzva=<den>`** — v `GAME_DESIGN.md` od začátku, nikdy
  nepostavené.
- **Přepínač světlý/tmavý režim** — CSS háky `data-theme` existují, nic je
  nenastavuje.
- **Významy jdou upravit, ale ne smazat.**
- **Drobné chyby vzhledu v `style.css`**, na které narazil průzkum směrů:
  pobídka k sérii (`.streak-nudge`) sedí nalepená na tlačítku sdílení;
  „Sbírka slov" je vidět dřív, než na ni dojde postupné odhalení výsledku
  (`.btn-tertiary { opacity }` přebíjí `.reveal-item`).
- **Úprava přezdívky v profilu:** po doběhnutí `refreshAuth()` se znovu ukáže
  tlačítko „Změnit přezdívku" vedle rozepsaného formuláře — `renderProfile()`
  mu vrací `display`.
- **Úspěchy (běží, 2026-09-24):** 27 odznaků, seznam v `public/achievements.js`,
  náhled v `public/dev-uspechy.html`. Zbývá: seznam a prahy (přidat,
  škrtnout, přejmenovat?).
- **Dvě mrtvé větve** `claude/button-haptic-feedback-8kgxkn` a
  `claude/czech-word-game-f2hnia` na originu, dávno zmergované.

---

## 3. Rozhodnuto (ať se k tomu nevracíme)

| Otázka | Rozhodnutí | Proč |
|---|---|---|
| Velikost denní hry | 7300 slov / 365 dní | rok hraní |
| Co určuje dnešní slova | **datum**, ne postup hráče | aby šly výsledky porovnávat |
| Nestihnuté slovo | den se **neopakuje** | Wordle model |
| Série (2026-09-24) | **odehrané dny v kuse**, na skóre nezáleží; dřív jen dny 20/20 | jedna série pro hru, server i úspěchy; perfektní řadu nese úspěch Hattrick |
| Oznámení úspěchu (2026-09-24) | až po skončení aktivity (výsledek dne, konec tréninku, zavřený sheet), nikdy uprostřed; po zavření hráč zůstane, kam šel | nesmí vyrušit hráče, ale musí se ukázat |
| Pořadí dne „Den N“ (2026-09-24) | hráč ho nevidí nikde: sdílení a Sbírka ukazují datum, profil „N/7 300 slov“, výsledek sérii | číslo dne nic neřekne, podle data si hráči porovnají výsledky |
| „Má ho X % hráčů“ (2026-09-24) | počítá server z hlášení zařízení, od 15 zařízení | i bez účtu; klient si to tvrdí sám, jde jen o orientační číslo |
| Přihlášení | magic link + 6místný kód | odkaz z mailu neotevře PWA |
| Zásady soukromí (2026-09-25) | správce Michal Acler, kontakt `ahoj@20slov.cz`; smazání účtu nechá významy slov bez autora | text na `/soukromi`, odkaz u přihlášení a v profilu |
| Doména a pošta (2026-09-25) | `20slov.cz` u Wedosu, DNS v Cloudflare, odesílání přes Resend (eu-west-1), příjem přes Cloudflare Email Routing (`ahoj@`, `prihlaseni@` → `m@acler.cz`) | přihlášení je od 2026-09-25 zapnuté |
| Avatary | generované z přezdívky | žádný upload, žádná moderace obrázků |
| Hosting | vše z jednoho Workeru | jedna doména → žádné CORS, `HttpOnly` cookie |
| Otevření významů v tréninku | jen **pozastaví** odpočet | hráč se má vrátit do hry |
| Kdo smí psát významy | **jen přihlášený** | anonymní jméno si může vzít kdokoli |
| Přesmyčky | uznávají se **jen v tréninku** | denní výzva je soutěž |
| Úprava významu | smaže hlasy, pokud nějaké byly | jinak jde vyhlasovat jeden text a nahradit ho jiným |
| Ukládání e-mailu | jen `sha256(adresa + pepř)` | cena: hráčům nejde nic poslat mimo přihlášení |
| Veřejný profil | HTML z workeru, ne SPA | kvůli náhledu při sdílení |
| Název hry | **20 slov** (2026-09-21) | texty pro hráče 2026-09-21; identifikátory 2026-09-25 (worker, D1, localStorage `20slov`, cache, sůl slov, repo `agilek/20slov`). Zůstala jen subdoména účtu workers.dev `slov2000` — sdílí ji `barcelonacardfamily-com` |
| Body za aktivitu (2026-09-24) | váhy den 10 · slovo tréninku 1 · význam 5 · získaný hlas 2 · daný hlas 1; stropy 10 slov a 10 hlasů za den | strop je tichý: hráč ho nikde nevidí, další body se jen nezapočtou. Body i úspěchy jsou vidět i na veřejném profilu |
| Zvuk posledních sekund (2026-09-24) | **ano, tlukot srdce**: od 5 s „lub-dub“, zrychluje ze 72 na 160 tepů/min; v tréninku i v denní výzvě | vysoké tiky byly pisklavé, trojúhelníkové srdce plechové; teď sinus + tlumený šum pod 220 Hz podle fonokardiogramu, tišší než písmenka |
| Analytika (2026-10-04) | **PostHog EU, bez cookie banneru**, ID = `clientId`, vypínač v profilu | retence D1/D7/D30 potřebuje stálé ID; právně šedá zóna (§ 89 ZEK čte striktně opt-in), kdyby vadila, přejít na souhlas při prvním startu |
| Vizuální směr | **Kostky** (2026-09-24, větev `kostky-trenink`) | ze šesti průzkumných směrů (`design/genz-directions`, `/designs.html`); ostatní na téhle větvi smazané |

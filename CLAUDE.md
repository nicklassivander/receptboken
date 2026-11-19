# Sivander's Recept – projektbeskrivning för Claude

Familjens receptapp på **https://recept.sivander.com**. Ägare: Nicklas (superuser/admin). Läs den här filen först i varje ny chatt.

## Hur Nicklas vill jobba
- **Svenska**, kort och rakt, utan AI-ton. Inga onödiga sammanfattningar av stegen.
- Vid design- och UI-frågor: **visa förslag först** (skisser, gärna flera varianter, telefon OCH dator), vänta på hans val ("kör", "B", "C2-2" …), bygg sedan.
- Han testar mest på **telefonen** (iPhone, installerad som app) och på datorn. Allt ska fungera snyggt på båda.
- Bekräfta när något är ute och påminn om omladdning (Ctrl+Shift+R / stäng appen) – service workern håller kvar gammal version.
- Han kör SQL själv i Supabase SQL Editor. Ge färdig SQL-fil/text, kör inte DDL/DML själv.

## Arkitektur
- **Frontend:** statisk `index.html` (all CSS inline i `<style>`) + `app.js` (~4000 rader, vanilla JS, inget byggsteg). `sw.js` = service worker (offline, "Dela till", aviseringar). `config.js` = Supabase-URL/nyckel.
- **Publicering:** push till `main` → Vercel bygger automatiskt (30–60 s).
- **Serverfunktioner (Vercel, `api/`):**
  - `ai.js` – anropar Claude (Anthropic API, Nicklas nyckel). Stödjer `mode: "json"`, bilder, `web: true` (webbsökning, `web_search_20250305`) och `fetchUrl` (Claude hämtar en sida själv, `web_fetch_20250910` + beta-header). Kräver inloggning och roll ≥ contributor.
  - `fetch.js` – hämtar receptsidor/bilder server-side (`imageOnly`, `withImage`). Vissa sajter blockerar (t.ex. ICA → 403); då används `ai.js` med `fetchUrl` som reserv.
  - `images.js` – bildförslag från gratis bildbank: **Pixabay** (`PIXABAY_API_KEY`), Pexels som reserv. Claude gör engelska sökord. Svar cachas 24 h i minnet (Pixabays krav).
  - `push-due.js` – web push för timers och aviseringar, anropas av pg_cron var 15:e sekund.
- **Supabase** (projekt `vfjjmjureecvfzioxzhu`): tabellen `recipes(id, data jsonb)` – receptet ligger i `data`. Även inställningsrader (`_cook_<email>`, settings, taggrupper) i samma tabell. Övrigt: `recipe_users` (roller viewer/contributor/editor/admin, RLS via `recipe_role_at_least`/`recipe_my_role`), `recipe_log` (aktivitet), notify-tabeller, inköpslistor, timers. SQL-filer i `supabase/`. Bilder i Storage-bucketen `recipe-photos`.

## Miljövariabler i Vercel
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (valfri, standard `claude-sonnet-5-5`), `CLAUDE_FAST_MODEL` (valfri, standard `claude-haiku-5-5`), `PIXABAY_API_KEY`, (`PEXELS_API_KEY` – Pexels har pausat nya nycklar), VAPID-nycklar och cron-hemlighet för push.

## Viktiga regler när du ändrar koden
- **Kör alltid en syntaxkontroll av hela `app.js` innan push.** En enda trasig rad eller en dubbel `const` på toppnivå ger vit skärm för alla.
- **Inga namnkrockar:** nya globala variabler/funktioner sist i `app.js` – använd `var` eller `function`, och kolla med `git grep` att namnet inte redan finns (`ingKey`-krocken gav vit skärm en gång).
- `render()` växlar på `view.name`: `list`, `detail`, `edit`, `help`, `web` (recept från nätet, inte sparat). Historik/bakåt sköts av `syncHistory()`/`popstate`.
- Efter varje render körs `renderShopFab()` som också anropar `fitTitle()`, `hdrSlides()`, `imgSugKick()` – bra krok för saker som ska justeras efter render.
- Ny CSS läggs **sist** i `<style>` (före sista `</style>`), med en kort kommentar.
- Lokal test: kopiera `app.js`/`index.html` till en testkatalog, byt Supabase-skriptet mot en mock, kör `python3 -m http.server` och Playwright (telefon 390 px + dator 1300 px). Mocken saknar `.order`/`.in` – de felen kan ignoreras.
- I chattmiljön kan ett integritetsskydd stoppa shell-kommandon som läser `app.js` (filen innehåller ägarens e-post). Använd Read/Edit-verktygen och `git grep`/`git show :app.js` i stället. Skriv aldrig e-postadressen i URL:er eller externa anrop.

## Spara på API-krediter
- `ai(prompt, { fast: true })` → billigare modellen (Haiku) – används för sortering av inköpslistan, variantnamn, tider i steg, utläsning av recept från text och bildsökord. Fråga Pappa: snabbknapparna (vin, tillbehör) går till Haiku. Fritexten (`askOrEdit`) går först till Haiku, som svarar på rena frågor och svarar `{"typ":"ändring"}` vid ändringar – då tar Sonnet över med den fulla ändringsprompten. Sonnet för foton, webbsökning och eget recept.
- Under svar från Haiku (inte ändringar) finns knappen **Pappa, fundera lite till** för alla (`aiDeepHtml`, `data-a="aideep"`): samma fråga till Sonnet, svaret hamnar överst med rubriken *Pappa har funderat lite till*. En gång per svar.
- Anteckningar (E1, nov 2026): `r.noteItems = [{id, kind: pappa|own|log|old, q, text, date, by}]` visas som tidslinje med kompakta kort (fäll ut, Redigera/Ta bort, scrollruta vid fler än 3). `r.notes` hålls i synk som ren text för sökning och Pappa. Lägg till via `addNote(r, noteNew(kind, text, q))` eller `notesWith(r, post)` i en patch – skriv inte direkt i `notes`. Kod sist i `app.js` (`notesPanelHtml`).
- Testläge (`PAPPA_TEST` sist i `app.js`): admin ser etiketten Haiku/Sonnet under svaret. Sätt till `false` när Nicklas är nöjd.
- Webbsökning max 3 sökningar per tryck.
- `recipe_ai_cache` (supabase/ai_cache.sql): sparade svar för `web:<sökning>` (14 dagar) och `page:<url>` (60 dagar). Appen fungerar utan tabellen.
- Inget AI-anrop sker automatiskt – bara när någon trycker.

## Design
- Färger: guld/mässing `#9c7a3c` (var `--brass`), ljusare guld `#c9a55c`/`#e2c48a`, krämig bakgrund `#e8e6e1`/`#faf6ee`, mörk `#1f1712`/`#161818`.
- Typsnitt: **Cormorant Garamond** (serif, rubriker, kursiv för "Sivander's") och **Jost** (sans, text).
- Rubrik: telefon C2-2 (kursiv "Sivander's", guldlinje med antal recept, stort "RECEPT" som fyller bredden), dator D4/E4 med samma uppbyggnad. Mörk "dimma" bakom rubriken för läsbarhet.
- Sidhuvudet: bildspel med receptbilder (crossfade 3 s, långsam zoom), receptnamnet nere till vänster i linje med sökfältet. "Till sidhuvudet" på receptbilden väljer bilder.
- Modaler/sheets: guldkant, rundade hörn, bottom sheet på mobil med drag-för-att-stänga.

## Pappa – AI-rösten
All AI i appen presenteras som **Pappa**, inte Claude.
- Ikon: pappas huvud med kockmössa (tunn guldlinje). Frågetecken = fråga, kugghjul = tänker, glödlampa = klart.
- "Pappa tänker" växlar text med guldglimmer: Pappa tänker / smakar av / rör i grytan / kollar med mamma / kliar sig i huvudet / låter det puttra (+ "Sommeliern provsmakar" vid vinfrågor).
- I receptet: "Fråga kocken och sommelieren" med snabbknapparna *Vilket vin passar?* och *Vad serverar jag till?*, skrivfält + knappen **Fråga Pappa**.

## Sökning på startsidan
- **Gratis och automatiskt** medan man skriver: vanlig filtrering + "Närmast i receptboken" (ordtäckning, `nearRecipes`) med bricka *Bra träff / Delvis*.
- **Kostar och kräver ett tryck:** raden under sökfältet med **Sök AI-recept** – pappa letar på nätet (webbsökning), visar recept som kan öppnas i appen (`view: "web"`, *Visa receptet*) och sparas. Inget skickas automatiskt till Claude.
- Raden anpassas: bra träff → diskret länk, delvis → guldknapp, inget → stor knapp.

## Läge och öppna punkter (uppdatera när något blir klart)
- Senast gjort (nov 2026): ny rubrik (C2-2/E4), bildspel i sidhuvudet, Pappa-rösten (Fråga Pappa, glödlampa), sökningen med "Sök AI-recept", recept från nätet i appen (`view: "web"`), bildförslag via Pixabay, sparade AI-svar (`recipe_ai_cache` – SQL körd), Haiku för enkla uppgifter, uppdaterad hjälp + `hjalp.pdf`.
- Kolla: antalet recept gick från 48 till 44 – bekräfta med Nicklas att det var avsiktligt (borttagna/sammanslagna varianter).
- Rekommenderat men inte gjort av Nicklas än: månadsgräns i Anthropic Console (Settings → Limits).
- Pexels har pausat nya API-nycklar – Pixabay används.
- `hjalp.pdf` byggs från en egen A4-layout (Cormorant/Jost via npm `@fontsource`, Playwright `page.pdf`). Uppdatera den när hjälpen i appen ändras.
- Typ av rätt (nov 2026): = nyckelord i gruppen "Rätt" (`dishTypes()`). Konto → *Typ av rätt* listar recept utan typ, Haiku föreslår vid tryck, spara/ångra alla (`openTypeTool`). Spara utan typ i formuläret → frågan *Vilken typ av rätt?* (`askDishType`, välj / Låt Pappa välja / Spara utan typ). Inläsning och Pappas egna recept måste ge exakt en typ. Kod sist i `app.js`.
- Aviseringar (nov 2026): cron-jobbet `recept-timers` anropar nu `/api/push-due` även när `recipe_notify_queue` har oskickade rader (`supabase/notify-cron.sql`, körd). Påminnelsekortet *Vill du få aviseringar?* under sökfältet (`nfAskHtml`, sist i `app.js`): Slå på kör `ensurePush` direkt, iPhone utan hemskärm får tre steg, Inte nu döljer i 14 dagar (max 3 gånger, `localStorage.nfAsk`).
- `runAiSearch` (pappa letar smart i receptboken) finns kvar i koden men har ingen knapp längre – Nicklas valde bort "Fråga pappa" i sökningen.

## Parkerade idéer
- Spotify-musik vid matlagning (sparad, inte byggd).
- Fokuspunkt per bild i sidhuvudet.
- AI-genererade bilder när bildbanken inte hittar något.

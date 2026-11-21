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
- Inget AI-anrop sker automatiskt – bara när någon trycker. Undantag: Veckans drink (ett Haiku-anrop med webbsökning per vecka, från servern).

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
- Aviseringar (nov 2026): cron-jobbet `recept-timers` anropar nu `/api/push-due` även när `recipe_notify_queue` har oskickade rader (`supabase/notify-cron.sql`, körd). Påminnelsekortet *Vill du få aviseringar?* under sökfältet (`nfAskHtml`, sist i `app.js`): Slå på kör `ensurePush` direkt, iPhone utan hemskärm får tre steg, Visas också när någon händelse är av i Konto (*Vill du få alla aviseringar?*, Slå på allt). Slå på slår alltid på enheten och alla händelser. Inte nu döljer i 7 dagar (`localStorage.nfAsk`). Testläget `NF_ASK_TEST` är avstängt (`false`, nov 2026). I Konto → Aviseringar finns kortet *Slå på allt* (`nfAll`) som slår på enheten och alla händelser; det döljs när allt är på.
- Baren (nov 2026, design A2 smaragd/guld art deco; sortering på spritsort visas först vid fler än 25 drinkar (Lagt till av visas alltid), `BAR_BASE_FROM`): recept med typen *dryck* (`isDrink`) visas inte i vanliga listan (men syns vid sökning) utan i baren. Grönt BAREN-kort under sökfältet (`barCardHtml`) → `view: "bar"` (`#baren`, `renderBar`, rutnät med trappramar, radlista från `BAR_ROWS_FROM` = 12) → drinksidan (`renderDrink`, ritas när ett dryck-recept öppnas; *Alla funktioner* = vanliga receptsidan via `drinkFull`). Glas/metod/garnering/sprit/färg läses ur texten i `barInfo` (`r.bar` kan skriva över). Tecknat glas (`barGlassSvg`) när foto saknas. AI-rösten i baren är **Matilda** (inte Pappa): *Fråga Matilda bakom baren*, Haiku, egen ikon (kvinna med shaker) och väntetexter. Typsnitt Poiret One för BAREN/drinknamn. Kod sist i `app.js`, CSS sist i `index.html`. Bildförslag för drinkar: `api/images.js` med `drink: true` filtrerar på Pixabay-taggar (dryck ja, mat nej). Under förslagen finns kortet *Leta på nätet* (`webImgHtml`/`loadWebImgs`): Sonnet med webbsökning hittar receptsidor (sparas 30 dagar som `drinkimg:<namn>` i `recipe_ai_cache`), `api/fetch.js` med `imageUrl: true` ger sidans huvudbild. Drinkikoner i flödet: `EV_DRINK_MIX`/`EV_DRINK_ADD`, grön bricka `.evi-drink`. Drinksidan: knappen *Jag har blandat den · Skål!* under Så gör du (M1, `barMixedHtml`/`barMarkMixed`, `.dk-mix`; räknas som tillagning i `cookLog` + `logEvent("cook_done")`), skärmknapp `.dk-wake` (samma `wakeLock`), antal `− 1 glas +` (`.dk-step`, börjar alltid på 1), *Tips från bartendern* = `notesPanelHtml(r, {title…, cls: "dk-notes"})`. Symbol under "drinkar · Skål!" = två skålande coupeglas (`BAR_FAN`). Skyline (`barSkyOne`): husen skalas jämnt och fylls på åt sidorna, 40 % på telefon (`.bsky-tel`), 50 % på dator (`.bsky-dat`), blinkfyr på Empire (`.bsky-fyr`). Tipskorten överst (Veckans drink / Senast i baren / Mest blandad; Veckans drink = Matildas veckoval: pg_cron måndag 05 UTC → `api/week-drink.js` (Haiku + webbsökning på drinktrender, vägt med veckans blandat/gillat/frågor till Matilda, inte samma som de 4 senaste), sparas som `weekdrink:current`/`weekdrink:history` i `recipe_ai_cache` via `supabase/week-drink.sql`; motiveringen visas på kortet (`.bs-why`). Klienten: `WEEK_DRINK`/`weekDrinkLoad`/`barWeekPick`; reserv = flest frågor till Matilda (`r.matHits`, `matTrack`), annars veckorotation) har mörk sammet som bakgrund (F, `.bar .bslide`), utan strålar och färgglöd. `barShelfSvg` (barhylla, 2A) finns kvar men används inte. Drinksidans bildbakgrund: sammetsdraperi som tonar från drinkens färg i mitten till grönt (T3, `.dk-drape`, färg via `--dk-c`), inga strålar. Barens bakgrund och drinkramarna (`.bc-fr`, `.br-th`) är också mörk sammet (B).
- Sidhuvudet (nov 2026): nya recept (ej drinkar) får `hdr: true` i `saveRecipe`. Befintliga via `supabase/hdr-default.sql` (Nicklas kör). Storleks-/stående-filtret gäller nu alla bilder.
- Noir (nov 2026, design B1 Spotlight): startsidan (`list`) och receptsidan (`detail`, inte drinkar) är mörka fine dining – kolsvart `#0e0d0c`, mässing `#c9a55c`, spotlight/vinjett på bilderna. `noirTheme()` (sist i `app.js`, anropas i `render()`) sätter `body.noir`; all CSS ligger sist i `index.html` under `body.noir #app …` (modaler/sheets påverkas inte). **Bara färger och stil – Nicklas vill inte att storlekar, sidhuvudets höjd, layout eller avstånd ändras** (första versionen med större sidhuvud och centrerad rubrik backades). Sidhuvudet har samma uppbyggnad som förut med mörkare vinjett. Ingrediensernas mängd i mässing via `noirIng()`. Redigering och hjälp är fortfarande ljusa. Skisser: project-files `recept-design/noir/`.
- Ikon och startskärm (nov 2026, BC1): ljuskägla (brun → kolsvart) bakom loggan med bestick i mässing och dubbel mässingsram. `icon.svg`, `icon-192/512.png` (rundade hörn), `apple-touch-icon.png` (hel ruta), `icon-maskable-*.png` (samma rundade fyrkant med dubbel ram som iPhone, skalad 0,84 för Android/Samsung, nov 2026), `splash/iphone-*.png` (iOS-startskärmar, renderade med Playwright). Manifestet har `?v=6`, länkarna i index.html `?v=4` resp. `?v=2` – höj vid nästa byte. `#boot` i `index.html` = laddningsskärmen innan appen eller inloggningen visas (göms med `body:has(...)`, ingen JS). Android ritar själv startskärmen av `background_color` + ikon.
- Barkortet på startsidan (nov 2026, K4 rullband): `barCardHtml` lägger upp till 14 drinkar i `.bc-trk` (fylls till minst 9, dubblerad) som glider 12 px/s i `.bc-win` med mässingshylla och uttonade kanter. Telefon 85 % av fältet, dator fönster 330 px (sex drinkar). Kortets höjd oförändrad. På dator utgår strålarna (`.bc-rays`, 900 px) från mitten av *Välkommen in* (B), knappen har mörk botten; telefonen som förut. Skisser: project-files `baren/barkort-lockande/`.
- Senaste i köket (nov 2026, B): rullande raden visar namn + verb + receptnamnet kortat till 1–2 ord (`tickShort`, sist i `app.js`), inget datum. Varianter: "varierade".
- AI-nivå per användare (nov 2026): rollerna i Konto → Användare är *Läsa* (ingen AI, knapparna döljs), *Egna recept · Haiku* (all AI till Haiku, även webbsökning och foton, ingen *fundera lite till*), *Egna recept · full AI* (som förut) och *Superanvändare* (full AI). Lagras som `recipe_users.ai_level` (none/haiku/sonnet) via `supabase/ai-level.sql` (`recipe_my_ai`, `recipe_admin_list_ai`, `recipe_admin_set_ai`). `api/ai.js` tvingar Haiku/stoppar enligt `recipe_my_ai` och faller tillbaka på rollen om funktionen saknas. Frontend: `aiLevel()`/`aiOk()`, `UROLE_OPTS`, `uroleSave` sist i `app.js`. Nya användare får Haiku som standard. `api/images.js` (bildsökord) följer fortfarande bara rollen.
- Ta bort tillagningar (nov 2026): "Lagad N gånger …" på receptet och raden under Skål-knappen på drinken öppnar listan (`cookListOpen`), Ta bort → Säker? (`cookRemove`, loggar `cook_undo`). Egna rader, superanvändare allas. *Ångra* i toast efter Jag har lagat/Skål (`toastActions`).
- Lagningsläget i Noir (nov 2026, K2 Spotlight): mörk `.cooking-head`, aktivt steg `.steps li.nextstep` med varm ljuskägla, mässingsram och guldbricka NÄSTA; övriga steg tonas till 62 % bara under lagning (`.steps:has(li.nextstep)`).
- Någon börjar laga (nov 2026): `startCooking` anropar `notify("cooking", r, sluttid)` (inte drinkar). Aviseringen är av som standard (`nfKindOn`), *Slå på allt* slår på den, max en per recept och person inom 2 h. SQL: `supabase/notify-cooking.sql` (ersätter `recipe_notify` och `recipe_notify_due`). I Senaste i köket visas *X lagar nu* överst med NU-bricka (`.nowdot`), läst ur allas `_cook_`-rader (`COOKING_NOW`, `cookNowRow`, `cookNowEvents`), försvinner vid Klar!/Avbryt eller efter 6 h. Sluttid ur `r.time` (`cookNowFinish`). Kod sist i `app.js`.
- Börja blanda (C, nov 2026): på drinksidan ligger knappen under ingredienserna. *Börja blanda* (`barMixStart`, samma `cookSession` som matlagningen, ingen avisering) → stegen bockas av (`barstep`, `.dk-done`/`.dk-next`) → *Klar · Skål!* (`barMixFinish` = `endCooking` + `barMarkMixed`), guldlinje + Steg X av N + Avbryt (`barMixStop`). Ikonen i Senaste i köket pulserar när någon lagar/blandar nu, och 30 min efter Skål (`evLive`). Pastillen säger "Blandar nu" för drinkar.
- Sektioner under lagning (B, nov 2026): recept med rubriker (`# Såsen`) visas under lagning som kort per sektion (`secStepsHtml`, `ol.steps.secmode`, `.sec-card`). Sektionerna är parallella: varje har eget NU/NÄSTA-steg. Tryck på kortet fäller ihop/ut (`secfold`, `detailState.secOpen`); ihopfälld visar NU-raden med egen bockruta. Klar sektion fälls ihop och får ✓ KLAR (`secAfterTick`). Utan lagning eller utan rubriker: som förut.
- `runAiSearch` (pappa letar smart i receptboken) finns kvar i koden men har ingen knapp längre – Nicklas valde bort "Fråga pappa" i sökningen.

## Parkerade idéer
- Spotify-musik vid matlagning (sparad, inte byggd).
- Fokuspunkt per bild i sidhuvudet.
- AI-genererade bilder när bildbanken inte hittar något.

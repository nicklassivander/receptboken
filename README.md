# Receptboken

Nicklas och Ann-Sofies receptsamling: spara recept från nätet, Instagram, kokböcker och egna anteckningar, med egna ändringar och AI-stöd för import, vin och alternativ.

- **Frontend:** statisk HTML/JS (`index.html`, `app.js`), utan byggsteg
- **Databas, inloggning och bilder:** samma Supabase-projekt som Munkholmsvägen (`supabase/setup.sql`). Inloggningen delas, men Receptboken har en egen behörighetslista (`recipe_users`).
- **AI:** `api/ai.js` på Vercel, som anropar Claude med Nicklas API-nyckel. Bara inloggade med minst "Lägga till och ändra" får använda den.

## Miljövariabler i Vercel
| Namn | Värde |
|---|---|
| `SUPABASE_URL` | Project URL från Supabase (samma som Munkholmsvägen) |
| `SUPABASE_ANON_KEY` | Den publika nyckeln (anon/publishable) |
| `ANTHROPIC_API_KEY` | Nyckeln från console.anthropic.com |
| `CLAUDE_MODEL` | (valfritt) standard är `claude-sonnet-5-5` |

## Lägga till en person
Enklast i appen: ⚙️ → Hantera användare. Eller i Supabase SQL Editor:
```sql
insert into recipe_users (email, name, role) values ('namn@example.com', 'Namn', 'contributor');
```

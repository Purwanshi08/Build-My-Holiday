# CLAUDE.md — rules for working in this repo

Build My Holiday: a Node 20+ (ES modules) app (Express + better-sqlite3) that builds holiday packages
from the hackathon catalog. Read `problem-1-holiday-package.md`, `DATA_DICTIONARY.md` and `docs/CONTRACT.md` first.

## Hard rules

1. **The app must NEVER call an AI/LLM** (cloud or local). All logic is plain rule-based code. No SDKs, no HTTP calls to model APIs.
2. **Never modify `data/`, `images/`, `problem-1-holiday-package.md` or `DATA_DICTIONARY.md`.** They are the judges' read-only data pack. Our own state lives in our database.
3. **Every flight, hotel, transfer, attraction, price and time comes from `data/catalog/`.** Never invent IDs, prices or opening hours (the stub engine uses real catalog IDs and prices too).
4. **Times are local strings.** Never use JS `Date` for local times or time zones. Compare `"HH:MM"` / `"YYYY-MM-DDTHH:MM"` strings or minutes-since-midnight integers.
   Weekday of a date: `new Date(date + 'T00:00:00Z').getUTCDay()` (0 = SUN). Adding days to a date-only string may use the same UTC trick; nothing else may.
5. **Money is integer INR.** No floats for money; round only where the rules say so (e.g. vehicles = ceil).
6. **Every file starts with a 2-line comment saying what it does.** (JSON files cannot have comments — exempt; Markdown uses an HTML comment or a heading line.)
7. **Ownership:**
   - **Person A** owns `src/engine/` and `test/`.
   - **Person B** owns `src/server.js`, `src/db.js`, `public/` and the root `README.md`.
   - Never edit the other person's files. Talk through `docs/CONTRACT.md`; contract changes are agreed by both.
8. **Don't ask questions — decide, and record the decision in `docs/DECISIONS.md`** (date, decision, why).

## Commands

- `npm install` then `npm start` → http://localhost:3000
- `npm test` → `node --test`

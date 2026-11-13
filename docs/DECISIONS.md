<!-- Decision log: choices made without asking, with the reason, newest last. -->
<!-- Format: date — decision — why. -->

# Decisions

- **2026-11-13 — Stack: Node 20+ ES modules, Express 5, better-sqlite3 pinned to 11.10.0.** better-sqlite3 13.x
  (latest) installs but crashes natively on Windows 10 / Node 22.9 (segfault on `new Database()`); 11.10.0 works
  with in-memory and file databases, so the JSON-file fallback store is not needed.
- **2026-11-13 — Data window is not a validation error.** A valid start date outside 2027-04-01..2027-04-20, or a
  trip whose last night (after 2027-04-19) or return day (after 2027-04-20) leaves the window, returns `NO_PACKAGE`
  with the reason "Flights and rooms are only available from 1 to 20 April 2027 …" (DATA_DICTIONARY FAQ: "A request
  outside the window has no package: say so"). `INVALID_REQUEST` is only for malformed or out-of-range fields:
  missing field, nights not 3–10, child age not 0–17, adults < 1, budget ≤ 0, unknown departure city or country,
  unparseable date.
- **2026-11-13 — Ownership split of the engine.** Person B owns `src/engine/validate.js` (`validatePackage`),
  `src/engine/export.js` (`exportTrip`) and `test/validate.test.js`; Person A owns the rest of `src/engine/` and
  `test/`. `index.js` keeps taking those two functions from the stub until B's files exist. Contract signatures
  unchanged.
- **2026-11-13 — `npm run dev`** = `node --watch src/server.js` for auto-restart while developing.
- **2026-11-13 — No upper cap on travelers in validation.** Too many travelers simply yields `NO_PACKAGE`
  ("not enough seats/rooms"), which explains more than a form error.
- **2026-11-13 — `traveler.name` = `"Traveler"`.** The request has no name field; a string is safer than `null`
  for the judges' checker.
- **2026-11-13 — Return flight item `city` = home city** (e.g. `Bengaluru`), because DATA_DICTIONARY §4 says a
  flight's city is its arrival city.
- **2026-11-13 — `trip_id` = package `id`.** One id, no mapping table.
- **2026-11-13 — Stub status triggers** (until the real engine lands): invalid fields → `INVALID_REQUEST`;
  dates outside the window or country ≠ Japan → `NO_PACKAGE`; budget below the stub's Menon total (₹2,48,290)
  → `OVER_BUDGET`; otherwise `OK` with the Menon package (labelled cheapest / fastest / best_rated copies).

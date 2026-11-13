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
- **2026-11-13 — Server/db shape.** `app.db` in the repo root (override with `$DB_PATH`, used for tests), tables
  created on start. `booked_flights` keyed by `flight_id`, `booked_rooms` by `(room_id, date)`; confirming adds to
  the counts. Built packages are upserted by `id` (the stub reuses ids). Engine results are always HTTP 200
  (including `INVALID_REQUEST`, `OVER_BUDGET`, refused changes with `ok:false`); HTTP errors only for unknown ids
  (404 `{"error":"not found"}`), malformed bodies / missing `kind` (400) and the unimplemented confirm (501).
  Changes to a `BOOKED` package are refused with `ok:false`. `GET /api/reservations/:ref` returns
  `{ reference, package_id, created_at, package }`.
- **2026-11-13 — Request form (public/).** Plain HTML/JS/CSS, no build step. The client never blocks dates outside
  1–20 April; on `NO_PACKAGE` it shows the reasons in a red banner and marks the date field only when a reason
  starts with "Flights and rooms are only available" (the contract's window prefix), since other reasons (no
  flight, no rooms) are not fixed by changing the date alone. Child ages and budget must be whole numbers
  (contract types are integers). Form starts with sample values (10 Apr, 6 nights, 2 adults,
  ₹3,50,000), no children and both dropdowns unselected.
- **2026-11-13 — Our export example lives in `docs/trip_format_example.json`, not `data/`.**
  `data/trip_format_example.json` is the judges' original (CLAUDE.md rule 2: never modify `data/`). Ours is the
  booked Menon package as `exportTrip` writes it: `country` set, hotel items with `room_id`, `sources: []`,
  `status: "BOOKED"` and `booking.reference` as a 10-digit string. It passes `validatePackage`.
- **2026-11-13 — `index.js` now re-exports `validatePackage`/`exportTrip` from `validate.js`/`export.js`.**
  This is the one-line switch the contract (§0) planned for once Person B's files exist; nothing else in
  Person A's `index.js` changed.
- **2026-11-13 — `validatePackage` reads only `items`, `traveler`, `start_date`, `end_date`, `country`,
  `total_inr`, `status` and the catalog** (never `plan`/`metrics`), so it checks an exported JSON file the same way
  as a live package. Flight times come from the catalog. Item times must match the catalog. Each rule is its own
  named check in `CHECKS`. A check that throws becomes a violation, so `validatePackage` never throws.
- **2026-11-13 — Validation details.** Airport transfers: there must be exactly 2. Sorted by pickup, the first is
  the arrival transfer and the second the return transfer. "Reached the city" means the arrival transfer's pickup
  + duration on the arrival day (landing + 60 if there is no transfer), and the between-cities transfer's pickup +
  duration on a city-change day. City-change day = check-in date of every stay after the first. Optional city
  taxis must be in a city of that day and inside their service hours. Prices: each item must be within 1% of the
  catalog formula. `total_inr` must equal the sum of item prices exactly and be within 1% of the catalog total.
- **2026-11-13 — The "1–2 attractions on every full day" rule is checked on every package, not only the first.**
  The judges' tool cannot tell a first package from an edited one. So removing a day's last attraction, or adding
  a third, is refused (M6 allows "refuses the change with a reason").

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
- **2026-11-13 — Catalog indexes (A1).** Flights are indexed by local _arrival_ date (outbound: lands on the start
  date) and by local _departure_ date (return: leaves on the last day). `airportTransfers` always adds the
  `area: null` (all areas) records. A missing availability record counts as 0 rooms left. Intercity transfers come
  from `destinations.json` links, the dictionary's official list. Catalog records are deep-frozen, so engine code
  must copy before changing anything.
- **2026-11-13 — `validateRequest` and the window check moved to `src/engine/request.js`.** The stub and the
  real engine now share one copy.
- **2026-11-13 — Real `buildPackages` (`src/engine/build.js`) replaces the stub.** It tries every legal city plan ×
  every flight pair × 3 strategies, choosing layer by layer: _cheap_ (cheapest hotel + attached airport transfer, cheapest
  intercity), _quick_ (cheap hotels, shortest intercity), _rated_ (highest-star hotel per city). Labels:
  `cheapest` = lowest total; `fastest` = least travel minutes, ties broken by total; `best_rated` = highest
  average stars, ties broken by total. If a label's best package is the same trip as one already chosen, that label
  is left out, so we return 1–3 packages and never a pricier twin. Why: a full product of hotels and transfers is
  too large; per-layer choice is fast (≤ ~0.3 s per request) and every result is re-checked against all the rules.
- **2026-11-13 — Airport transfer timing.** Arrival: the first minute ≥ landing + 60 inside the service window,
  waiting at most 180 min. Departure: the latest minute with pickup + duration ≤ departure − 180, inside the window,
  looking back at most 180 min. Why: this keeps the pickup close to the flight and avoids planning a night at the
  airport just to use a cheaper bus. The minute scan handles past-midnight windows; we never write "24:00" (23:59 is
  the latest pickup).
- **2026-11-13 — Intercity departure** = the first slot at or after 10:00 on the `service_from + n × frequency`
  grid (any minute when there is no frequency); if none, the first slot of the day. Why: after breakfast and
  check-out, leaving the afternoon for the new city.
- **2026-11-13 — Attraction schedule.** Visits run 09:00–22:00, start ≥ 30 min after reaching a city, and keep
  30 min between visits. Every full day first gets one required visit (the cheapest that fits). Then free extras
  are added: a 2nd visit on full days, at most 1 on arrival and change days. Required visits are placed before
  extras so an extra never uses up the only attraction a later full day could have. Nara is excluded explicitly.
- **2026-11-13 — Package ids are random** (`pkg-<uuid>`). Rebuilding the same request never overwrites a saved or
  booked package in the db.
- **2026-11-13 — `validatePackage` hook.** `build.js` loads `./validate.js` with a dynamic import. While the file
  is missing, candidates are trusted as built (marked TODO). Once Person B's file is pulled, every chosen package
  must pass it (checked in rank order, so a failing one is skipped). Any other error inside `validate.js` is
  re-thrown, not hidden.

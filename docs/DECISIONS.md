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
  - duration on the arrival day (landing + 60 if there is no transfer), and the between-cities transfer's pickup +
    duration on a city-change day. City-change day = check-in date of every stay after the first. Optional city
    taxis must be in a city of that day and inside their service hours. Prices: each item must be within 1% of the
    catalog formula. `total_inr` must equal the sum of item prices exactly and be within 1% of the catalog total.
- **2026-11-13 — The "1–2 attractions on every full day" rule is checked on every package, not only the first.**
  The judges' tool cannot tell a first package from an edited one. So removing a day's last attraction, or adding
  a third, is refused (M6 allows "refuses the change with a reason").
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
- **2026-11-13 — Restored after merge `551b1f9`.** The merge of Person B's `validation file added` kept B's
  `index.js` and `DECISIONS.md`, which undid A3 (`buildPackages` was back on the stub) and dropped the entries
  above. `index.js` now exports `buildPackages` (`build.js`) and `validateRequest` (`request.js`) again, and keeps
  B's `validatePackage` (`validate.js`) and `exportTrip` (`export.js`). The `validate.js` hook in `build.js` is now
  live: all 108 Menon candidates pass it.
- **2026-11-13 — `buildPackages` flow (contract change: OVER_BUDGET now returns the cheapest package).**
  (1) `INVALID_REQUEST` with per-field messages; (2) a valid date outside the window → `NO_PACKAGE`; (3) build
  every candidate, none valid → `NO_PACKAGE` with the reasons from the furthest stage reached (arrival seats,
  return flight, hotel rooms, airport transfer, attractions); (4) the true cheapest total; (5) within budget →
  `OK` with cheapest, fastest and best rated (≤ budget, twins dropped); (6) over budget → `OVER_BUDGET` with
  `packages: [cheapest]` (label `cheapest`, negative `left_inr`), `cheapest_total`, `over_by` and suggestions.
  Why: the traveler can see what the money buys; `public/app.js` ignores `packages` on `OVER_BUDGET`, so nothing
  breaks. **Person B to confirm** (CONTRACT.md §4 updated).
- **2026-11-13 — Over-budget suggestions (`src/engine/suggest.js`).** Each suggestion re-runs the builder with one
  field changed: nights − 1 … 3, every other start date that keeps the trip in the window (nearest first), the
  other country, each other departure city. Up to 3 are returned. If any fit the budget, we return only those,
  one kind at a time (nights, date, country, departure) so they differ; within a kind the smallest change wins
  (nights: most nights; dates: nearest; country/departure: cheapest). If none fit, we return the 3 lowest totals
  and say how far over each one still is. "Raise the budget to at least ₹X" is used only when no variation can be
  built. Suggestions run only the _cheap_ strategy (it always holds the cheapest total). Menon at ₹1,50,000
  takes ~0.5 s.
- **2026-11-13 — `applyChange` / `getOptions` (`src/engine/change.js`, `src/engine/parts.js`).** A change turns
  the package back into the builder's pieces (`decompose`), edits them, fixes what depends on them, reassembles
  (`recompose`), and must pass `validatePackage`; any failed travel rule → `ok:false` with the reason and the
  *same* input object. The input is never mutated. Going over budget is not a refusal: `ok:true` plus a warning.
  Ids: the package keeps `id`/`trip_id`/`label`/`status`; each item keeps its `item_id` when the same catalog
  record (and room) is still in the package; new items get ids after the highest (`i18`, `i19`, …).
- **2026-11-13 — Knock-on fixes after a change.** Airport transfers: keep the current one when it still serves
  the airport and the hotel's area (re-timed if needed), otherwise switch to the cheapest one that fits; warn
  either way. Attractions: a visit keeps its time when it still fits, is pushed later on the same day (never
  earlier) when the traveler now arrives later, and is dropped when it cannot fit or the night's city changed;
  a full day left empty gets the cheapest visit that fits. Each fix is named in `warnings`.
- **2026-11-13 — Change rules.** `add_attraction`: the night's city, open that weekday and date, not already in
  the package, at most 2 on a full day; placed in the earliest free slot from 09:00 (or arrival + 30 min) inside
  its opening hours, keeping 30 min from other visits when possible (only no overlap otherwise).
  `remove_attraction`: refused for the last visit of a full day. `swap_flight`: same-day flight from/to home at an
  airport serving the first/last city with enough free seats. `set_city_plan`: must be one of `cityPlans`; it is
  rebuilt with the *cheap* strategy, keeping the current flights when they fit the plan, else the cheapest
  pair; hotels, transfers and attractions are chosen again (warned).
- **2026-11-13 — `getOptions` prices each option by applying it.** `price_delta_inr` = the real `delta_inr` of
  that change, so it includes knock-on costs (e.g. a cheaper hotel whose airport taxi costs more shows ₹0).
  Invalid options carry `price_delta_inr: null` and the refusal `reason`. Hotel: every room type of every hotel
  in the city. Flight: every same-day flight to/from airports serving the first/last city. Attraction: every
  attraction in that night's city. City plan: every legal plan (current one at ₹0). Valid first, then cheapest.
  `detail` has display data plus `current`, and for valid options `total_inr`, `over_budget` and `warnings`.
- **2026-11-13 — `checkRules` moved to `test/rules.js`.** Importing it from `build.test.js` re-ran that file's
  tests inside other test files.
- **2026-11-13 — Confirm (`POST /api/packages/:id/confirm`).** Everything runs in one `BEGIN IMMEDIATE`
  transaction (`store.transaction(fn).immediate`). It re-reads the package and builds a fresh ctx from `booked_*`.
  It picks a reference with `crypto.randomInt(1e9, 1e10)` as a string, picking again if a reservation already has
  it. Then it builds the BOOKED version (package and every item `BOOKED`, `booking: { reference }`) and runs
  `validatePackage` on that version, so the booking-status checks run as well. Any problem (e.g. "only 1 seat(s)
  left for 3 traveler(s)") refuses the confirm and writes nothing. Otherwise `recordBooking` saves the package,
  the reservation, the seats (flight item `quantity`) and the rooms (hotel `quantity` for each night from
  check-in to check-out − 1). Always HTTP 200 `{ ok, reference, package, reasons }`, like `/change`. Confirming a
  booked package is refused with its existing number.
- **2026-11-13 — Confirm and reservation UI.** "Confirm booking" sits in the sticky bar and is hidden once the
  package is booked. It first asks in a dialog (booking is final; shows the amount over budget if any). Then it
  shows the 10-digit number in a read-only field with Copy (Clipboard API; falls back to select +
  `execCommand('copy')`). Refusals show the reasons in the red notice above the bar. "Find my reservation" in the
  header opens `/?reservation=<ref>` (survives a refresh). It shows a read-only summary with the reference, booking
  time (SQLite UTC), header and timeline, no edit buttons, and Export JSON. A 404 shows "Reservation not found".
- **2026-11-13 — `set_city_plan` keeps the package's character.** A city change rebuilds with the strategy of the
  package's label: `best_rated` → highest-star hotel per city (best average stars wins), `fastest` → shortest
  travel (all flight pairs compared), otherwise cheapest. The current flights are kept when they fit the plan
  (except for `fastest`). Why: a "Best rated" 5★ package used to fall to 3–4★ after a city change while keeping
  its label. Every valid option's `detail` now also has `avg_stars` and `travel_minutes` of the resulting
  package. Note: the same average after a city change can be correct. The cheapest hotels in Tokyo (Ueno Garden
  Inn) and Osaka (Tennoji Park Hotel) are both 3★, so Tokyo/Osaka plans of the cheapest Menon package stay at 3★.
- **2026-11-13 — A city change keeps the traveler's hotels and reports the stars.** `set_city_plan` rebuilds as
  before. Then every city that stays in the plan gets its current hotel and room type back, when it still fits
  and has rooms on the new nights. Airport transfers and visit times are refitted for it; if that fails, the
  rebuilt hotels stay. Only new cities get a hotel by the package's rule. Every city change now reports the stars:
  "Average hotel stars 3.00 → 3.50.", or when unchanged "stay at 2.00: Barsha Budget Stay in Dubai (2★), …".
  Why: the rebuild applies one rule in every city, which lands on the same star class almost everywhere
  (cheapest UAE hotels are 2★ in both cities; every Japan city has a 5★). So the average looked frozen, and a
  hotel the traveler had chosen was silently replaced.
- **2026-11-13 — Fuzz test `test/fuzz.test.js` (300 seeded random requests).** It covers all four departure
  cities, both countries, 1–4 adults, 0–3 children aged 0–17 and log-uniform budgets from ₹20k to ₹30L. About 10%
  of requests use nights just outside 3–10, and about 20% use start dates from 29 Mar to 23 Apr. The other 80% fit
  inside 1–20 April. For each request: `buildPackages` must not throw, every package and its `exportTrip` output
  must pass `validatePackage`, the status must fit the budget (CONTRACT §4), and a NO_PACKAGE that blames flights
  is re-checked against flights.json. The PRNG is seeded (`FUZZ_SEED` env var, default 20270401) so failures can be
  replayed. Why: the hand-written tests cover a few requests; this one covers the request space. Without the bias,
  ~60% of random trips ran past 20 April and only tested the window check.
- **2026-11-13 — `parseRequest(text)` in `src/engine/parse.js` (rule-based, no AI), added to CONTRACT §4.** This is
  an additive contract change. No existing signature changed. Person B should acknowledge it before wiring it into
  the UI. Reading rules: "12/04/2027" is day/month (Indian convention). A date without a year is 2027 (the only data
  year). "N days" = N−1 nights. "a week" = 7 nights. early/mid/late month = the 5th/15th/25th. A vague date is moved
  earlier when the return would pass 20 April. "family of N" / "N of us" minus the children found = adults.
  "2 kids" without ages is reported as missing `childAges` and never guessed. When several departure cities are
  named, the one after "from" wins. Two countries named means `country` is missing. Lakh/crore/k amounts are scaled
  with integer arithmetic (money is integer INR). Why: a quick text box for the request form. The parser only
  fills fields; `buildPackages` still validates everything.
<<<<<<< HEAD
- **2026-11-13 — G1: changes fix or warn about the bookings they affect.** Hotel `check_in_from` /
  `check_out_until` are display-only in the spec, so they only ever produce warnings, never refusals. Every hotel
  item carries the current problems of its stay in `warnings`: arriving before check-in, arriving after midnight,
  or a pickup after check-out. `applyChange` adds one line per stay whose hotel, arrival or departure time changed:
  the problem, or that it fits, with "Fixed: " when a problem went away. So a flight change always reports the
  check-in (outbound) or check-out (return) it affects, and attraction-only changes add no hotel lines. Attraction
  conflicts: `refitVisits` drops an inherited second copy of an attraction ("booked twice"). It pushes an
  overlapping visit only as far as needed (30-min gap preferred, else back to back) and names the visit it avoids.
  `add_attraction` says which visit the new one goes after or before. Why: problem G1 ("a flight change should pop
  up about the accommodation check in times"). Before this, nothing mentioned the hotel times, and a visit pushed
  by another visit was wrongly reported as "to start after the traveler arrives". CONTRACT §4 `applyChange` notes
  the new warning lines and non-empty hotel item `warnings`. This is additive; Person B to acknowledge.
=======
- **2026-11-13 — Quick request wired up (Person B acknowledges `parseRequest`).** `POST /api/parse-request` takes
  `{ text }` and returns the engine's `{ fields, missing, notes }` unchanged. A text that is not a string, or is
  over 1000 characters, gets 400. The "Quick request" box above the form only fills the form; it never builds.
  Found fields are filled and flash. Fields the parser did not find are **emptied**, not left at the sample
  values, and marked red ("Not found in your request: …"). This means the form is never sent with a value the
  traveler did not give. A country or city the dropdown does not know counts as missing. `childAges` missing
  (kids without ages) keeps the child rows the user already has and marks the children box. Notes, plus "Filled
  in: …" / "Still needed: …", show in a banner under the box.
- **2026-11-13 — Invalid change options show "—" instead of a price.** `getOptions` now sends
  `price_delta_inr: null` for invalid options. City-plan options also show the travel time, next to the average
  stars.
- **2026-11-13 — Root `README.md`** has the start commands, architecture, our city rule, the feature status (M1–M8,
  G1–G4, S1–S2) and known limitations. `docs/README.md` stays the data pack's own guide.
>>>>>>> 77bd22167c41b60b5b605b8902ef8f6446b9f582

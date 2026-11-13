<!-- Build My Holiday: how to start the app, how it is built, our city rule, what is finished and known limitations. -->
<!-- Hackathon problem 1 (problem-1-holiday-package.md). The data pack's own guide is docs/README.md. -->

# Build My Holiday

Build a complete holiday package (flights, hotels, transfers and attractions) from the hackathon catalog, within
a budget. You can then change it, confirm it and look it up later with a 10-digit reservation number.

All logic is plain rule-based code. **The app never calls an AI or LLM.**

## Start

Needs **Node.js 20 or newer**.

```bash
npm install
npm start
```

Open **http://localhost:3000**.

- `npm test` runs the tests (`node --test`).
- `npm run dev` restarts the server when a file changes.
- `PORT` changes the port. `DB_PATH` changes the database file (default `app.db` in the repo root, created on
  first start).
- Delete `app.db` to start again with no saved packages or bookings.

## Architecture

```
public/            Browser UI: plain HTML/CSS/JS, no build step (index.html, app.js, styles.css)
   │  fetch JSON
   ▼
src/server.js      Express 5: serves public/ and /images plus the JSON API. No travel logic.
   │                                   │
   ▼                                   ▼
src/engine/        Pure, synchronous   src/db.js   SQLite (better-sqlite3): packages, reservations,
(index.js is the   rule engine         our booked seats and rooms → passed to the engine as ctx
 only entry point)
   │  reads once at start (read-only)
   ▼
data/catalog/*.json
```

**Engine** (`src/engine/`, contract in `docs/CONTRACT.md`):

| File | Does |
|---|---|
| `catalog.js` | Loads `data/catalog` once, freezes it, builds lookup indexes |
| `request.js` | `validateRequest` (field errors) and the data-window check |
| `plans.js` | Every legal city plan and every flight pair that fits it |
| `schedule.js` | Timing rules: airport pickups, intercity departures, attraction visits per day |
| `pricing.js` | Integer-INR price formulas and the room-fit rule |
| `build.js` | `buildPackages`: cheapest / fastest / best rated, or why not |
| `suggest.js` | Over-budget suggestions (re-runs the builder with one field changed) |
| `change.js`, `parts.js` | `getOptions` and `applyChange`: swap hotel or flight, add or remove attractions, change cities |
| `validate.js` | `validatePackage`: re-checks every rule of problem §4, the prices and the total |
| `export.js` | `exportTrip`: the shared trip format (DATA_DICTIONARY §4) |
| `parse.js` | `parseRequest`: quick request text → form fields (regexes and keyword lists) |
| `time.js` | Local-time helpers on `"HH:MM"` / `"YYYY-MM-DDTHH:MM"` strings (no JS `Date` for local times) |

**API** (all JSON):

| Method and path | Does |
|---|---|
| `GET /api/meta` | Departure cities, countries and their cities, rules (fills the form) |
| `POST /api/parse-request` | `{ text }` → `{ fields, missing, notes }` |
| `POST /api/packages/build` | Request → `OK` / `OVER_BUDGET` / `NO_PACKAGE` / `INVALID_REQUEST`; packages are saved |
| `GET /api/packages/:id` | A saved package |
| `GET /api/packages/:id/options?kind=hotel\|flight\|attraction\|city_plan` | Change options with the price difference |
| `POST /api/packages/:id/change` | Apply a change: `{ ok, package, delta_inr, warnings, reasons }` |
| `POST /api/packages/:id/confirm` | Book it: `{ ok, reference, package, reasons }` |
| `GET /api/reservations/:ref` | Reservation summary, or 404 `not found` |
| `GET /api/packages/:id/export` | Download the trip JSON |

**Design rules we keep:**

- Money is always integer INR.
- Times are local strings, compared as strings or minutes since midnight.
- Every ID, price and opening hour comes from `data/catalog`.
- The data pack (`data/`, `images/`) is never modified; our state lives in SQLite.
- Every package the engine returns passes `validatePackage`.

## Our city rule

The traveler picks only the country. The app chooses the cities, their order and the nights in each city.

1. **Legal plans.** A plan is legal when all of these are true:
   - every city is in the chosen country, and each city appears once;
   - each city has at least 2 nights in a row (`min_nights_per_city`);
   - the nights add up to the requested nights;
   - each pair of cities next to each other is linked in `destinations.json`, so there is an intercity transfer.

   A one-city plan is legal too.
2. **Flights must fit.** The arrival flight lands on the start date at an airport serving the **first** city. The
   return flight leaves on the last day from an airport serving the **last** city. Both need a seat for every
   traveler.
3. **Every plan is built.** The app tries every legal plan × every fitting flight pair with three strategies
   (cheap, quick and rated hotels/transfers). Then it shows up to three packages:
   - **Cheapest:** the lowest total.
   - **Fastest:** the least travel time, i.e. both flights plus the transfers between cities.
   - **Best rated:** the highest average hotel stars per night, within budget.

   If two labels would show the same trip, only one card is shown.
4. **Changing cities later.** "Change cities" offers every other legal plan with its price difference, average
   stars and travel time. When you pick one, hotels in cities you keep stay the same when they still fit.

Nara attractions are never planned: Nara is not one of the plan cities.

## What is finished

| | Feature | Status |
|---|---|---|
| M1 | Request form from `destinations.json`, clear field messages | Done |
| M2 | Build a package; when none is possible, say why | Done |
| M3 | All problem §4 rules (checked again by `validatePackage` on every package, change and confirm) | Done |
| M4 | Day-by-day timeline in time order, with attraction photos and a photo-credits link | Done |
| M5 | Total, budget, left/over in a sticky bar; Export JSON | Done |
| M6 | Change hotel, flight, add/remove attractions; refused changes give the reason | Done |
| M7 | Confirm → unique 10-digit number; summary also after a restart; wrong number → "not found" | Done |
| M8 | Over budget: cheapest total, amount over, up to 3 suggestions that fill the form, view the cheapest package | Done |
| G1 | Knock-on fixes after a change (transfers re-timed or replaced, attractions moved or dropped), shown as warnings | Done |
| G2 | Every option shows its price difference (+/− ₹) | Done |
| G3 | Change cities | Done |
| G4 | Cheapest, fastest and best rated packages | Done |
| S1 | Quick request: plain words fill the form, missing fields are marked, guesses explained | Done |
| S2 | Bookings use up seats and rooms in our database; a booking that needs the last seats/rooms is refused | Done |

**Small extras:**
- The package and reservation pages have their own URLs (`?package=` / `?reservation=`), so a refresh or a shared
  link restores them.
- The reservation number has a Copy button.
- Confirming asks first and warns when the package is over budget.

**Tests:** `npm test` runs unit tests for every engine module, contract tests and a fuzz test of ~300 seeded
random requests. In the fuzz test, every package and every export must pass `validatePackage`.

## Known limitations

- **Data window only.** Trips must fit 1–20 April 2027, the only dates with flights and rooms. Other dates give
  `NO_PACKAGE` with that reason.
- **Fastest / best rated are not an exhaustive search.** The cheapest package is the true cheapest. Fastest and best
  rated come from three per-layer strategies over every city plan and flight pair, not from every combination of
  hotels and transfers (that would be too slow).
- **Hotel times.** Hotel items carry dates only, so the timeline shows check-in after that day's last arrival
  and check-out first in the day, without a clock time.
- **Photos.** Only attraction photos are shown, not hotel photos.
- **Quick request.** It understands English keywords only. Dates like `12/04/2027` are read as day/month. Children
  without ages are never guessed: you must enter each age. It fills the form; it does not build by itself.
- **Over-budget suggestions** change one field at a time (nights, start date, country or departure city).
- **Bookings are final.** There is no cancel or edit after confirming, and no payment.
- **No accounts.** Anyone with a package link or reservation number can open it.
- **One server.** One SQLite file serves one server process. Seats and rooms are reduced only in our database;
  the catalog files never change.
- **Engine message format.** Suggestion buttons fill the form by reading the engine's suggestion text. A
  suggestion worded differently is shown as plain text instead of a button.

## More docs

| File | What |
|---|---|
| `problem-1-holiday-package.md` | The problem statement and judging |
| `DATA_DICTIONARY.md` | The catalog files and the shared trip format |
| `docs/CONTRACT.md` | Engine ↔ server/UI contract |
| `docs/DECISIONS.md` | Every choice we made and why |
| `docs/trip_format_example.json` | Our export of the booked Menon package |

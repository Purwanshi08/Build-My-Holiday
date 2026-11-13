<!-- Engine contract between Person A (src/engine) and Person B (server, db, UI). -->
<!-- Both sides code against this file; change it only by agreement and note the change in docs/DECISIONS.md. -->

# Engine contract

All engine functions are **synchronous, pure** (no I/O except reading `data/catalog` once at load), and exported
from `src/engine/index.js`. The server never reads `data/catalog` for business logic; it asks the engine.
Money is integer INR. Dates are `YYYY-MM-DD`, date-times are local `YYYY-MM-DDTHH:MM` (no seconds, no offset).

## 0. Ownership

| Person | Owns |
|---|---|
| A | `src/engine/` except `validate.js` and `export.js`; `test/` except `test/validate.test.js` |
| B | `src/engine/validate.js` (`validatePackage`), `src/engine/export.js` (`exportTrip`), `test/validate.test.js`, `src/server.js`, `src/db.js`, `public/`, root `README.md` |

`src/engine/index.js` (Person A) re-exports `validatePackage` from `./validate.js` and `exportTrip` from `./export.js`
once Person B creates them; until then it takes them from the stub. Signatures below are the same either way.

## 1. Request

```json
{
  "departureAirport": "BLR",
  "country": "Japan",
  "startDate": "2027-04-10",
  "nights": 6,
  "adults": 2,
  "childAges": [6],
  "budgetInr": 350000
}
```

All fields are required (a missing field is an error).

| Field | Type | Valid when |
|---|---|---|
| `departureAirport` | string | One of `destinations.json → departure_cities[].airport` |
| `country` | string | One of `destinations.json → countries[].name` |
| `startDate` | string | Parseable, real calendar date `YYYY-MM-DD` (holiday start = arrival day) |
| `nights` | integer | `rules.min_nights` ≤ n ≤ `rules.max_nights` (3–10) |
| `adults` | integer | ≥ 1 |
| `childAges` | integer[] | Each 0–17; may be empty |
| `budgetInr` | integer | ≥ 1 |

**`INVALID_REQUEST` is only for malformed or out-of-range field values** (the table above).

**Data window → `NO_PACKAGE`, never `INVALID_REQUEST`.** A valid date where the start date is outside
2027-04-01..2027-04-20, or the last night (`startDate + nights − 1`) is after 2027-04-19, or the return day
(`startDate + nights`) is after 2027-04-20, gives `NO_PACKAGE` with a reason starting
"Flights and rooms are only available from 1 to 20 April 2027".

## 2. Package

A package is the shared trip format (DATA_DICTIONARY.md §4) **plus** our own fields.

```json
{
  "id": "pkg-…",                       // ours: stable id used by server/db
  "label": "cheapest",                 // ours: 'cheapest' | 'fastest' | 'best_rated'
  "trip_id": "pkg-…",                  // same value as id
  "traveler": { "name": "Traveler", "home_airport": "BLR", "adults": 2, "children": 1, "child_ages": [6] },
  "start_date": "2027-04-10",
  "end_date": "2027-04-16",
  "country": "Japan",
  "budget_inr": 350000,
  "total_inr": 248290,                 // = sum(items[].price_inr), always recomputed
  "left_inr": 101710,                  // ours: budget_inr - total_inr (negative = over budget)
  "status": "PLANNED",                 // ours: 'PLANNED' | 'BOOKED'
  "metrics": { "travel_minutes": 1135, "avg_stars": 3.5 },
  "plan": [
    { "city": "Tokyo", "nights": 3, "check_in": "2027-04-10", "check_out": "2027-04-13",
      "hotel_id": "HTL-TYO-004", "room_id": "RM-TYO-004-B", "rooms": 1 }
  ],
  "items": [ /* trip items, sorted by start (time order) */ ]
}
```

- `metrics.travel_minutes` = both flights' `duration_minutes` + each between-city transfer's `duration_minutes` (G4 "fastest").
- `metrics.avg_stars` = hotel `stars` averaged per night, rounded to 2 decimals (G4 "best rated").
- `plan` is in visit order; `check_out` of one city = `check_in` of the next; last `check_out` = `end_date`.

### Trip item (exactly the DATA_DICTIONARY §4 fields)

```json
{ "item_id": "i1", "type": "flight", "name": "AV 520 BLR to NRT", "city": "Tokyo", "status": "PLANNED",
  "catalog_id": "FL-401", "room_id": null, "start": "2027-04-09T23:50", "end": "2027-04-10T10:30",
  "quantity": 3, "price_inr": 75600, "booking": null, "sources": [], "warnings": [] }
```

| type | city | start / end | quantity |
|---|---|---|---|
| `flight` | arrival city (return flight: home city, e.g. `Bengaluru`) | departure / arrival | seats (all travelers) |
| `hotel` | hotel city | check-in date / check-out date | rooms (`room_id` set) |
| `transfer` | airport: the hotel city it serves; between cities: `to_city` | pickup / arrival | vehicles (`PER_VEHICLE`) or tickets (`PER_PERSON`) |
| `attraction` | attraction city | visit start / visit end | tickets (all travelers) |

`item_id` values are unique inside a package and stable across changes (new items get new ids).
After confirm: package `status` and every item `status` = `BOOKED`, every item `booking` = `{ "reference": "<10 digits>" }`.

## 3. ctx

```json
{ "booked": { "flights": { "FL-401": 3 }, "rooms": { "RM-TYO-004-B|2027-04-10": 1 } } }
```

Our own confirmed bookings (S2). The engine subtracts them from catalog `seats_left` / `rooms_left`.
Person B builds it from the db. `{ booked: { flights: {}, rooms: {} } }` (or `undefined`) means nothing booked.

## 4. Functions

### `getMeta()`
```json
{ "departure_cities": [{ "airport": "BLR", "city": "Bengaluru" }],
  "countries": [{ "code": "JP", "name": "Japan", "cities": ["Tokyo", "Kyoto", "Osaka"] }],
  "rules": { "min_nights": 3, "max_nights": 10, "min_nights_per_city": 2,
             "data_window": { "first_night": "2027-04-01", "last_departure": "2027-04-20" } } }
```

### `validateRequest(req) -> { [field]: message }`
Empty object = valid. Keys are the request field names above. Messages are short, user-facing English.

### `buildPackages(req, ctx)`
```json
{ "status": "OK", "packages": [], "cheapest_total": 248290, "over_by": 0,
  "suggestions": [], "reasons": [], "errors": {} }
```

| status | packages | other fields |
|---|---|---|
| `OK` | 1–3 packages within budget, distinct labels (`cheapest` first) | `cheapest_total` set, `over_by` 0 |
| `OVER_BUDGET` | `[cheapest]`: the cheapest correct package, label `cheapest`, `left_inr` negative | `cheapest_total` = that package's total, `over_by` = cheapest_total − budget, `suggestions[]` = up to 3 human-readable one-field changes found by re-running the builder (fewer nights, another start date, the other country, another departure city), e.g. "Try 3 nights instead of 6: from ₹2,03,532 (within your budget)."; "Raise the budget to at least ₹X." only when no variation can be built |
| `NO_PACKAGE` | `[]` | `reasons[]` = why (e.g. "Flights and rooms are only available from 1 to 20 April 2027…", "No flight from BLR lands in Japan on 2027-04-12"), `cheapest_total` null |
| `INVALID_REQUEST` | `[]` | `errors` = output of `validateRequest` (malformed / out-of-range fields only) |

### `validatePackage(pkg, ctx) -> string[]`
Re-checks every rule of problem §4 (and totals). Empty array = correct.

### `getOptions(pkg, query, ctx) -> Option[]`
`query` = `{ kind: 'hotel'|'flight'|'attraction'|'city_plan', city?, date?, direction? }`
- `hotel`: needs `city`; one option per (hotel, room type).
- `flight`: needs `direction` = `'outbound'|'return'`.
- `attraction`: needs `date`; attractions in that night's city.
- `city_plan`: alternative `[{city, nights}]` plans for the same dates.

```json
{ "id": "HTL-KYO-002|RM-KYO-002-B", "label": "Kyoto Hills Hotel — Family Room ×1", "price_delta_inr": 7392,
  "valid": true, "reason": null, "detail": { } }
```
`id` is what goes into the matching change; `valid:false` options carry a `reason`. `detail` is free-form display data
(stars, area, times, image path…).

### `applyChange(pkg, change, ctx)`
```json
{ "ok": true, "package": { }, "delta_inr": 7392, "warnings": [], "reasons": [] }
```
`change` is one of:
```json
{ "type": "swap_hotel", "city": "Kyoto", "hotel_id": "HTL-KYO-002", "room_id": "RM-KYO-002-B" }
{ "type": "swap_flight", "direction": "outbound", "flight_id": "FL-403" }
{ "type": "add_attraction", "attraction_id": "ATT-KYO-008", "date": "2027-04-15" }
{ "type": "remove_attraction", "item_id": "i12" }
{ "type": "set_city_plan", "cities": [{ "city": "Osaka", "nights": 2 }, { "city": "Kyoto", "nights": 4 }] }
```
- `ok:false` → `package` is the **unchanged** input, `reasons[]` says why (refused change).
- `ok:true` → new package (input not mutated), fully valid; `warnings[]` lists other parts fixed automatically (G1),
  e.g. "Airport transfer re-timed to 14:10 after flight change".
- `delta_inr` = new total − old total.

### `parseRequest(text) -> { fields, missing, notes }`
Turns a short plain-words request into Request fields (§1) with regexes and keyword lists only (no AI).
Example: `"Me and my wife from Delhi to Dubai for a week starting April 12, ₹2,00,000"` →
```json
{ "fields": { "departureAirport": "DEL", "country": "United Arab Emirates", "startDate": "2027-04-12",
              "nights": 7, "adults": 2, "childAges": [], "budgetInr": 200000 },
  "missing": [],
  "notes": ["\"a week\" read as 7 nights.", "Dubai is in United Arab Emirates, so the country is United Arab Emirates.",
            "No year given for \"april 12\"; assumed 2027."] }
```
- `fields` holds only the fields that were found. `childAges` is `[]` when no children are mentioned.
- `missing` lists the Request field names that were not found, in §1 order. Children mentioned without every age
  (e.g. "2 kids") puts `childAges` in `missing`. Two countries mentioned puts `country` in `missing`.
- `notes` are short, user-facing English explaining guesses, e.g. a city implying the country, the assumed year 2027,
  "12/04/2027" read as day/month, "5 days" read as 4 nights, or "mid April" read as 15 April and moved earlier so the
  trip returns by 20 April. They also include `validateRequest` messages for found fields that are out of range.
- It never throws. The caller still sends the final Request through `buildPackages`, which validates it as usual.

### `exportTrip(pkg) -> object`
The judge-facing JSON: `{ trip_id, traveler, start_date, end_date, country, budget_inr, total_inr, status, items }`
(DATA_DICTIONARY §4 minimum fields + `status`). No `plan`/`metrics`/`label`.

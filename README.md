<div align="center">

# FitMyTrip

### A holiday that fits your dates, your family, and your budget.

**Plan smarter. Compare options. Customise your trip. Confirm with
confidence.**

[![Live
Demo](https://img.shields.io/badge/Live%20Demo-FitMyTrip-0f766e?style=for-the-badge)](https://fitmytrip.onrender.com/)

</div>

------------------------------------------------------------------------

## Overview

**FitMyTrip** is a rule-based holiday package planning application that
builds complete, multi-city trips around a traveller’s departure city,
destination country, travel dates, group size, and budget.

Instead of making travellers coordinate flights, accommodation,
transfers, and sightseeing separately, FitMyTrip combines these
components into a day-by-day itinerary. It can generate different
package options, explain when a request cannot be fulfilled, and let
travellers customise parts of a proposed trip while checking that the
overall itinerary remains valid.

A traveller can:

- Enter trip details through a guided form or describe the trip in plain
  English.
- Generate holiday packages using the application’s travel catalog.
- Compare cheapest, fastest, and best-rated options.
- Review a day-by-day itinerary, estimated cost, and budget balance.
- Change flights or hotels, add or remove attractions, and explore other
  city plans.
- Confirm a package and retrieve its reservation summary using a
  10-digit reference.
- Export a trip as JSON.

> **Important:** FitMyTrip uses a deterministic, rule-based planning
> engine. The application does not call an AI/LLM service or make live
> bookings with airlines or hotels. Confirming a package creates a
> reservation in the application’s own SQLite database; it does not
> process payment or book with an external travel provider.

## Live application

**[Open FitMyTrip](https://fitmytrip.onrender.com/)**

The deployed application is hosted on Render. The project can also be
run locally by following the setup instructions below.

## Key features

### 1. Guided trip request

Provide the information needed to plan a trip:

- Departure airport/city
- Destination country
- Arrival date
- Number of nights
- Number of adults
- Children’s ages
- Total budget in INR
- Whether a hotel stay should be included

The available departure cities and destination countries are loaded from
the project catalog rather than being hard-coded into the form.

### 2. Quick request in plain English

Travellers can describe a trip in a short sentence, for example:

> 2 adults and a 6 year old from Bengaluru to Japan on 10 April for 6
> nights, budget 3.5 lakh.

The rule-based parser extracts recognised details and fills the request
form. It also reports missing information or parsing notes so the
traveller can review the fields before building a package.

The parser uses regular expressions, number and date patterns, and known
city/country names and aliases. It does not use an AI model.

### 3. Automatic multi-city itinerary generation

The planning engine evaluates valid city combinations and flight pairs,
then assembles the trip using catalog data. A package can include:

- Outbound and return flights
- Airport transfers
- Transfers between cities
- Hotels and room types
- Daily attraction visits

The generated itinerary is displayed in chronological order as a
day-by-day plan.

### 4. Three package strategies

When suitable options are available, FitMyTrip can present up to three
distinct package choices:

| Option         | Selection basis                                            |
|----------------|------------------------------------------------------------|
| **Cheapest**   | Lowest total package price                                 |
| **Fastest**    | Lowest combined flight and inter-city transfer duration    |
| **Best rated** | Highest average hotel star rating per night, within budget |

If two strategies produce the same trip, duplicate options are not
shown. If no package fits the budget but a package can otherwise be
built, the application can show the cheapest option and provide
suggestions for adjusting the request.

### 5. Package customisation

Travellers can explore alternatives and customise a generated package:

- Change the hotel or room selection in a city.
- Change a flight.
- Add or remove attractions.
- Explore a different valid city plan.

The engine checks the effects of a change on dependent parts of the
itinerary. For example, a flight change can require an airport transfer
to be re-timed or replaced. Attraction visits may need to be moved or
removed if the schedule no longer works.

Each available option displays its price difference. A change is saved
only when the resulting package passes validation; otherwise, the
application explains why it was refused.

### 6. Budget and price breakdown

The application calculates the package total in Indian Rupees (INR),
shows the traveller’s budget, and displays the amount remaining or the
amount over budget.

Prices are calculated from the catalog using the relevant pricing rules
for flights, rooms, transfers, and attractions.

### 7. Booking confirmation and reservation lookup

When a package is confirmed, FitMyTrip:

1.  Revalidates the package against the current booking context.
2.  Checks that the required seats and rooms are still available in the
    application’s inventory.
3.  Creates a unique 10-digit reservation reference.
4.  Marks the package items as booked.
5.  Records the reservation and inventory usage in SQLite.

The reservation can later be retrieved using its reference number. Saved
packages and reservations persist across page refreshes and backend
restarts, as long as the SQLite database file is retained.

This is an application-level reservation flow, not a real-world supplier
booking or payment transaction.

### 8. JSON export

A package can be exported as a JSON file using the project’s shared trip
format. This makes the itinerary portable and allows it to be checked or
consumed by another tool that understands the format.

### 9. Optional no-hotel planning

The request form includes an **Include a hotel** option. When it is
turned off, the planner still builds flights, airport transfers,
inter-city transfers, and attraction visits, but does not add hotel
items or hotel costs.

This is an additional application mode. The original hackathon package
rules expect accommodation for every night, so a no-hotel package should
not be treated as satisfying that particular requirement.

------------------------------------------------------------------------

## How it works

At a high level, the application follows this flow:

``` text
Traveller enters trip details
          |
          v
Request validation / Quick-request parser
          |
          v
Express API receives the request
          |
          v
Rule-based planning engine
  - Generate valid city plans
  - Find suitable flight pairs
  - Select hotels and rooms
  - Schedule transfers
  - Plan attraction visits
  - Calculate package prices
          |
          v
Validate complete package
          |
          v
Return package options and save them in SQLite
          |
          v
Traveller reviews and customises the itinerary
          |
          v
Revalidate changes and update package
          |
          v
Confirm package
          |
          v
Create reservation reference and record
seat / room usage in SQLite
```

### Package-generation approach

The engine uses the destination and availability catalogs to explore
possible trip structures.

1.  **City planning:** It generates legal ordered city plans for the
    selected country. Cities cannot repeat, each city must satisfy the
    minimum-night rule, the total nights must match the request, and
    consecutive cities must have a catalog-defined inter-city
    connection.
2.  **Flight selection:** It finds outbound flights arriving on the
    requested start date at an airport serving the first city, and
    return flights departing on the trip’s final day from an airport
    serving the last city. Availability is checked against the
    application’s recorded bookings.
3.  **Accommodation selection:** It checks room capacity, the number of
    rooms required for the travelling group, and room availability for
    every night of the stay.
4.  **Transfer scheduling:** It selects suitable airport and inter-city
    transfers while respecting service windows and timing constraints.
5.  **Attraction scheduling:** It selects attractions in the relevant
    city, checks opening days and hours, avoids overlapping visits, and
    schedules visits within the available day.
6.  **Pricing:** It calculates the cost of each item and the total
    package price in INR.
7.  **Validation:** It checks the completed package against the travel
    rules before returning it.

The cheapest strategy selects the lowest total among the evaluated
candidates. The fastest and best-rated strategies use their respective
selection criteria over the engine’s candidate-building strategies; they
are not an exhaustive search of every possible combination of every
hotel and transfer.

------------------------------------------------------------------------

## Technology stack

| Layer            | Technology                   | Purpose                                              |
|------------------|------------------------------|------------------------------------------------------|
| Frontend         | HTML5                        | Application structure and forms                      |
| Styling          | CSS3                         | Responsive interface and visual presentation         |
| Frontend logic   | Vanilla JavaScript           | User interactions and API communication              |
| Backend          | Node.js                      | Server-side runtime                                  |
| Web framework    | Express 5                    | Static files and JSON API                            |
| Database         | SQLite                       | Packages, reservations, and recorded inventory usage |
| Database library | better-sqlite3               | Synchronous SQLite access and transactions           |
| Testing          | Node.js built-in test runner | Unit, integration/contract, and fuzz-style tests     |

The application uses ES modules and does not require a frontend build
step.

## Architecture

``` text
                  Browser
                     |
              HTML / CSS / JS
                     |
                JSON requests
                     |
                     v
              src/server.js
                Express API
                /        \
               /          \
              v            v
      src/engine/         src/db.js
      Planning logic      SQLite store
              |            |
              v            v
       data/catalog/     app.db
       JSON catalog      Packages
       (read-only)       Reservations
                         Booked seats
                         Booked rooms
```

### Main project directories

``` text
FitMyTrip/
├── data/
│   └── catalog/          # Destination, flight, hotel, room,
│                         # availability, transfer and attraction data
├── docs/                 # Engine/API contract and design decisions
├── images/               # Local attraction and hotel imagery
├── public/
│   ├── index.html        # Main application page
│   ├── styles.css        # Application styles
│   └── app.js            # Frontend behaviour
├── src/
│   ├── engine/           # Trip generation, scheduling, pricing,
│   │                     # validation, changes, parsing and export
│   ├── db.js             # SQLite persistence and transactions
│   └── server.js         # Express server and API routes
├── test/                 # Automated tests
├── DATA_DICTIONARY.md    # Catalog and trip-format documentation
├── package.json
└── README.md
```

### Important backend modules

| Module                   | Responsibility                                                      |
|--------------------------|---------------------------------------------------------------------|
| `src/server.js`          | Starts Express, serves the frontend and exposes the API             |
| `src/db.js`              | Persists packages, reservations, and booked seat/room counts        |
| `src/engine/catalog.js`  | Loads catalog JSON files and builds lookup indexes                  |
| `src/engine/request.js`  | Validates trip request fields and date-window constraints           |
| `src/engine/parse.js`    | Converts a plain-English request into form fields using rules       |
| `src/engine/plans.js`    | Generates valid city plans and flight pairs                         |
| `src/engine/build.js`    | Builds candidate packages using the planning strategies             |
| `src/engine/schedule.js` | Schedules transfers and attraction visits                           |
| `src/engine/pricing.js`  | Calculates prices and required room quantities                      |
| `src/engine/change.js`   | Provides change options and applies package modifications           |
| `src/engine/validate.js` | Validates package structure, travel rules, availability, and prices |
| `src/engine/export.js`   | Exports a package in the shared trip JSON format                    |

The engine’s public entry point is `src/engine/index.js`.

------------------------------------------------------------------------

## API overview

The backend exposes the following JSON endpoints:

| Method | Endpoint                    | Description                                                          |
|--------|-----------------------------|----------------------------------------------------------------------|
| `GET`  | `/api/health`               | Health check                                                         |
| `GET`  | `/api/meta`                 | Returns form metadata such as departure cities, countries, and rules |
| `POST` | `/api/parse-request`        | Parses a plain-English trip request                                  |
| `POST` | `/api/packages/build`       | Builds package options from a trip request                           |
| `GET`  | `/api/packages/:id`         | Retrieves a saved package                                            |
| `GET`  | `/api/packages/:id/options` | Returns available package changes                                    |
| `POST` | `/api/packages/:id/change`  | Applies a requested package change                                   |
| `POST` | `/api/packages/:id/confirm` | Validates and confirms a package                                     |
| `GET`  | `/api/reservations/:ref`    | Retrieves a reservation and its package                              |
| `GET`  | `/api/packages/:id/export`  | Downloads the package as JSON                                        |

### Example: build a package

`POST /api/packages/build`

The request body contains the trip details. A simplified example:

``` json
{
  "departureAirport": "BLR",
  "country": "Japan",
  "startDate": "2027-04-10",
  "nights": 6,
  "adults": 2,
  "childAges": [6],
  "budgetInr": 350000,
  "includeStay": true
}
```

The actual accepted values and validation rules are defined by the
project catalogs and request validator. The API can return a successful
build, an over-budget result, no possible package, or an invalid-request
response.

------------------------------------------------------------------------

## Data and planning rules

The planner uses the JSON files in `data/catalog/` as its source of
travel information. These include:

- `destinations.json`
- `airports.json`
- `flights.json`
- `hotels.json`
- `rooms.json`
- `availability.json`
- `transfers.json`
- `attractions.json`

The catalog is loaded by the backend and treated as read-only. Confirmed
bookings are tracked separately in SQLite; the source catalog files are
not modified.

Some important planning checks include:

- A valid city sequence and minimum stay in each city.
- Flights that match the trip dates and serve the first and last cities.
- Enough seats for all travellers.
- Sufficient room capacity and room availability for every hotel night.
- Airport pickup at least 60 minutes after landing.
- Arrival at the airport at least 180 minutes before a return flight.
- Transfers operating within their service hours.
- Attraction opening days, opening hours, and non-overlapping visit
  times.
- Correct item-level prices and package totals.

All catalog prices are in INR. The exact rules and data schema are
documented in `problem-1-holiday-package.md`, `DATA_DICTIONARY.md`, and
`docs/CONTRACT.md`.

------------------------------------------------------------------------

## Getting started

### Prerequisites

- **Node.js 20 or newer**
- npm (included with Node.js)

### 1. Clone the repository

``` bash
git clone https://github.com/Purwanshi08/FitMyTrip
cd FitMyTrip
```

### 2. Install dependencies

``` bash
npm install
```

### 3. Start the application

``` bash
npm start
```

Open the application at:

``` text
http://localhost:3000
```

The server uses port `3000` by default. Set the `PORT` environment
variable to use a different port.

### Development mode

To restart the server automatically when source files change:

``` bash
npm run dev
```

### Run the tests

``` bash
npm test
```

The project uses Node.js’s built-in test runner (`node --test`). The
test suite includes tests for the engine modules, package rules,
API/contract behaviour, and seeded fuzz-style request coverage.

### Database location

By default, SQLite creates `app.db` in the project root on first start.

You can provide a different database path using `DB_PATH`:

``` bash
DB_PATH=./data/local.db npm start
```

On Windows PowerShell:

``` powershell
$env:DB_PATH = ".\data\local.db"
npm start
```

To reset local application state, stop the server and remove the
database file. This deletes locally saved packages, reservations, and
recorded inventory usage. Do not delete it if you need to retain those
records.

------------------------------------------------------------------------

## Current scope and known limitations

- **Catalog date window:** The supplied flight and room data cover 1–20
  April 2027. Requests outside the available data window cannot be
  fulfilled using the current catalog.
- **Catalog-driven results:** The application can only plan with
  destinations, flights, hotels, rooms, transfers, attractions, prices,
  and availability present in its supplied data.
- **No external supplier integration:** Flights and accommodation are
  selected from the local catalog. Confirming a package does not create
  a booking with an airline, hotel, or travel provider.
- **No payment processing:** The reservation flow is internal to
  FitMyTrip; it does not collect payment.
- **No user accounts:** Access to a saved package or reservation is
  based on its URL or reservation reference. Do not treat these links as
  private account authentication.
- **Single SQLite store:** The current persistence design uses one
  SQLite database file for application state. It is intended for the
  project’s current deployment model, not a distributed multi-instance
  inventory system.
- **No cancellation or post-confirmation editing:** Confirmed packages
  cannot currently be cancelled or edited through the application.
- **Quick-request parsing:** The parser is rule-based and supports
  recognised English patterns and known city/country names. It may not
  understand every natural-language phrasing; users should review the
  fields it fills.
- **Search strategy trade-off:** The cheapest option is selected by
  total price among evaluated candidates. Fastest and best-rated options
  use a bounded set of candidate-building strategies rather than
  exhaustively evaluating every possible combination of all catalog
  items.
- **No-hotel mode:** This is an optional application feature; it does
  not satisfy the original requirement that a judged package include
  accommodation for every night.

------------------------------------------------------------------------

## Possible future improvements

Potential next steps include:

- Integrate trusted live travel inventory and supplier APIs.
- Add user accounts and secure reservation ownership.
- Support cancellation and modification workflows.
- Add payment integration with appropriate security and transaction
  handling.
- Expand destination, date, and travel catalog coverage.
- Improve quick-request parsing and support more languages.
- Add richer itinerary maps and additional accessibility options.
- Introduce deployment-ready database and concurrency architecture for
  multiple application instances.

These are possible enhancements, not claims about current functionality.

## Project documentation

For more detail, see:

| Document                                                       | Contents                                                      |
|----------------------------------------------------------------|---------------------------------------------------------------|
| [`problem-1-holiday-package.md`](problem-1-holiday-package.md) | Original hackathon problem statement and judging requirements |
| [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md)                     | Catalog structure, field definitions, and shared trip format  |
| [`docs/CONTRACT.md`](docs/CONTRACT.md)                         | Engine and API contract                                       |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                       | Engineering decisions and rationale                           |
| [`docs/README.md`](docs/README.md)                             | Guide to the supplied data pack                               |
| [`images/ATTRIBUTIONS.md`](images/ATTRIBUTIONS.md)             | Image credits and attributions                                |

------------------------------------------------------------------------

<div align="center">

**FitMyTrip — Plan a holiday that fits.**

[Live Demo](https://fitmytrip.onrender.com/)

</div>

// Fuzz test: ~300 seeded random requests (all departure cities, both countries, dates/nights around 1–20 April 2027,
// 1–4 adults, 0–3 children, random budgets) — build never throws, packages and exports validate, status fits budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackages, exportTrip, validatePackage, getMeta } from '../src/engine/index.js';
import { addDays } from '../src/engine/time.js';
import { flights, airportsServing, destinations } from '../src/engine/catalog.js';

const RUNS = 300;
const SEED = Number(process.env.FUZZ_SEED ?? 20270401);
const WINDOW_REASON = 'Flights and rooms are only available from 1 to 20 April 2027';

/** mulberry32: small seeded PRNG so a failing case can be replayed with the same FUZZ_SEED. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRequest(rand, meta) {
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (arr) => arr[int(0, arr.length - 1)];
  const { min_nights, max_nights } = meta.rules;
  const nights = rand() < 0.1 ? pick([min_nights - 1, max_nights + 1]) : int(min_nights, max_nights);
  // ~80% of trips fit inside 1–20 April; the rest start anywhere from 29 Mar to 23 Apr (often outside the window).
  const lastStart = 19 - Math.max(nights, 0); // days after 1 Apr: return day must be ≤ 20 Apr
  const startDate = rand() < 0.8 && lastStart >= 0 ? addDays('2027-04-01', int(0, lastStart)) : addDays('2027-03-29', int(0, 25));
  return {
    departureAirport: pick(meta.departure_cities).airport,
    country: pick(meta.countries).name,
    startDate,
    nights,
    adults: int(1, 4),
    childAges: Array.from({ length: int(0, 3) }, () => int(0, 17)),
    budgetInr: Math.round(Math.exp(Math.log(20000) + rand() * Math.log(3000000 / 20000))), // ₹20k..₹30L, log-uniform
  };
}

/**
 * Straight from flights.json: an arrival flight (home → country, lands on startDate) and a return flight
 * (country → home, leaves on the return day), both with enough seats, that some city plan could use —
 * the same city at both ends (one-city plan) or, with ≥ 4 nights, two different cities. Returns "FL-a + FL-b" or null.
 */
function feasibleFlightPair(req) {
  const pax = req.adults + req.childAges.length;
  const end = addDays(req.startDate, req.nights);
  const country = destinations.countries.find((c) => c.name === req.country);
  const citiesOf = (code) => country.cities.map((c) => c.name).filter((city) => airportsServing(city).includes(code));
  const outs = flights.filter((f) => f.from === req.departureAirport && f.arrival_local.startsWith(req.startDate) &&
    f.seats_left >= pax && citiesOf(f.to).length);
  const rets = flights.filter((f) => f.to === req.departureAirport && f.departure_local.startsWith(end) &&
    f.seats_left >= pax && citiesOf(f.from).length);
  for (const o of outs) {
    for (const t of rets) {
      const a = citiesOf(o.to);
      const b = citiesOf(t.from);
      if (a.some((c) => b.includes(c)) || req.nights >= 2 * destinations.rules.min_nights_per_city) {
        return `${o.flight_id} + ${t.flight_id}`;
      }
    }
  }
  return null;
}

/** Problems with the build result for this request (status vs budget, packages, exports). */
function checkResult(req, r, ctx) {
  const errs = [];
  const fail = (cond, msg) => { if (!cond) errs.push(msg); };
  const { min_nights, max_nights } = getMeta().rules;
  const nightsOk = req.nights >= min_nights && req.nights <= max_nights;

  if (!nightsOk) {
    fail(r.status === 'INVALID_REQUEST' && 'nights' in r.errors, `nights ${req.nights} should be INVALID_REQUEST`);
    return errs;
  }
  fail(r.status !== 'INVALID_REQUEST', `valid request gave INVALID_REQUEST ${JSON.stringify(r.errors)}`);

  const end = addDays(req.startDate, req.nights);
  const outside = req.startDate < '2027-04-01' || req.startDate > '2027-04-20' || end > '2027-04-20';
  if (outside) {
    fail(r.status === 'NO_PACKAGE', `outside the data window but status ${r.status}`);
    fail(r.reasons[0]?.startsWith(WINDOW_REASON), `window reason missing: ${r.reasons[0]}`);
  }

  for (const pkg of r.packages) {
    const v = validatePackage(pkg, ctx);
    fail(v.length === 0, `${pkg.label} invalid: ${v.join(' | ')}`);
    const ex = validatePackage(exportTrip(pkg), ctx);
    fail(ex.length === 0, `${pkg.label} export invalid: ${ex.join(' | ')}`);
    fail(pkg.total_inr === pkg.items.reduce((s, i) => s + i.price_inr, 0), `${pkg.label} total ≠ sum of items`);
    fail(pkg.left_inr === req.budgetInr - pkg.total_inr, `${pkg.label} left_inr wrong`);
  }

  if (r.status === 'NO_PACKAGE' && !outside && /free seats/.test(r.reasons[0] ?? '')) {
    const pair = feasibleFlightPair(req);
    fail(!pair, `NO_PACKAGE blames flights but ${pair} would work`);
  }

  switch (r.status) {
    case 'OK':
      fail(r.packages.length >= 1 && r.packages.length <= 3, `OK with ${r.packages.length} packages`);
      fail(r.packages[0]?.label === 'cheapest', 'OK: first package is not cheapest');
      fail(new Set(r.packages.map((p) => p.label)).size === r.packages.length, 'OK: duplicate labels');
      fail(r.packages.every((p) => p.total_inr <= req.budgetInr), 'OK: a package is over budget');
      fail(r.packages.every((p) => r.packages[0].total_inr <= p.total_inr), 'OK: cheapest is not the cheapest');
      fail(r.cheapest_total === r.packages[0]?.total_inr, 'OK: cheapest_total mismatch');
      fail(r.over_by === 0, 'OK: over_by not 0');
      break;
    case 'OVER_BUDGET': {
      const [p] = r.packages;
      fail(r.packages.length === 1 && p.label === 'cheapest', 'OVER_BUDGET: must be [cheapest]');
      fail(p && p.total_inr > req.budgetInr && p.left_inr < 0, 'OVER_BUDGET: package is within budget');
      fail(r.cheapest_total === p?.total_inr, 'OVER_BUDGET: cheapest_total mismatch');
      fail(r.over_by === r.cheapest_total - req.budgetInr, 'OVER_BUDGET: over_by wrong');
      fail(r.suggestions.length >= 1 && r.suggestions.length <= 3, `OVER_BUDGET: ${r.suggestions.length} suggestions`);
      break;
    }
    case 'NO_PACKAGE':
      fail(r.packages.length === 0, 'NO_PACKAGE with packages');
      fail(r.reasons.length >= 1, 'NO_PACKAGE without reasons');
      fail(r.cheapest_total === null, 'NO_PACKAGE: cheapest_total not null');
      break;
    case 'INVALID_REQUEST':
      break;
    default:
      errs.push(`unknown status ${r.status}`);
  }
  return errs;
}

test(`fuzz: ${RUNS} random requests build, validate, export and fit the budget (seed ${SEED})`, () => {
  const meta = getMeta();
  const rand = rng(SEED);
  const ctx = { booked: { flights: {}, rooms: {} } };
  const counts = {};
  const noPackage = {};
  const failures = [];
  const started = Date.now();

  for (let n = 0; n < RUNS; n++) {
    const req = randomRequest(rand, meta);
    let r;
    try {
      r = buildPackages(req, ctx);
    } catch (e) {
      counts.THREW = (counts.THREW ?? 0) + 1;
      failures.push({ n, req, errs: [`threw: ${e.stack}`] });
      continue;
    }
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === 'NO_PACKAGE') {
      const reason = r.reasons[0] ?? '(no reason)';
      const why = reason.startsWith(WINDOW_REASON) ? 'outside the data window'
        : reason.replace(/ on \d{4}-\d{2}-\d{2}/, '').replace(/ \([^)]*\)/, '').replace(/\d+ free seats/, 'enough free seats')
          .replace(/(from|to) [A-Z]{3}\b/, '$1 home');
      noPackage[why] = (noPackage[why] ?? 0) + 1;
    }
    const errs = checkResult(req, r, ctx);
    if (errs.length) failures.push({ n, req, status: r.status, errs });
  }

  const lines = [
    `\nFuzz summary (seed ${SEED}, ${RUNS} requests, ${((Date.now() - started) / 1000).toFixed(1)} s)`,
    ...Object.entries(counts).sort().map(([s, c]) => `  ${s.padEnd(16)} ${c}`),
    ...Object.entries(noPackage).sort((a, b) => b[1] - a[1]).map(([w, c]) => `    NO_PACKAGE ×${c}: ${w}`),
    `  failures         ${failures.length}`,
    ...failures.slice(0, 10).map((f) => `  #${f.n} ${JSON.stringify(f.req)} → ${f.status}\n    ${f.errs.join('\n    ')}`),
  ];
  console.log(lines.join('\n'));
  assert.equal(failures.length, 0, `${failures.length} fuzz failures (see summary above)`);
});

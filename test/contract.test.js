// Contract tests for the engine entry point: all four buildPackages statuses and the package shape.
// Also re-prices every item of the OK package from data/catalog so stub data can't drift from the catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as engine from '../src/engine/index.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/catalog/${f}.json`, import.meta.url), 'utf8'));
const byId = (arr, key) => new Map(arr.map((x) => [x[key], x]));
const flights = byId(load('flights'), 'flight_id');
const rooms = byId(load('rooms'), 'room_id');
const transfers = byId(load('transfers'), 'transfer_id');
const attractions = byId(load('attractions'), 'attraction_id');

const MENON = {
  departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10',
  nights: 6, adults: 2, childAges: [6], budgetInr: 350000,
};

test('getMeta lists departure cities and countries', () => {
  const m = engine.getMeta();
  assert.ok(m.departure_cities.some((d) => d.airport === 'BLR'));
  assert.deepEqual(m.countries.map((c) => c.name).sort(), ['Japan', 'United Arab Emirates']);
  assert.deepEqual(
    m.attractions.find((a) => a.attraction_id === 'ATT-KYO-001'),
    { attraction_id: 'ATT-KYO-001', open_from: '06:00', open_until: '18:00' },
  );
});

test('validateRequest flags bad fields', () => {
  assert.deepEqual(engine.validateRequest(MENON), {});
  const e = engine.validateRequest({ ...MENON, nights: 2, childAges: [18], startDate: '2027-02-30' });
  assert.deepEqual(Object.keys(e).sort(), ['childAges', 'nights', 'startDate']);
});

test('OK: Menon package is priced from the catalog and sums correctly', () => {
  const r = engine.buildPackages(MENON, { booked: { flights: {}, rooms: {} } });
  assert.equal(r.status, 'OK');
  const pkg = r.packages[0];
  assert.equal(pkg.label, 'cheapest');
  const adults = 2, children = 1, pax = 3;
  for (const it of pkg.items) {
    let expected;
    if (it.type === 'flight') expected = flights.get(it.catalog_id).price_per_seat.amount * pax;
    if (it.type === 'hotel') {
      const nights = (Date.parse(it.end) - Date.parse(it.start)) / 86400000;
      expected = rooms.get(it.room_id).price_per_night.amount * it.quantity * nights;
    }
    if (it.type === 'transfer') {
      const t = transfers.get(it.catalog_id);
      expected = t.pricing === 'PER_VEHICLE'
        ? t.price.amount * Math.ceil(pax / t.max_passengers)
        : adults * t.price.amount + children * (t.child_price ?? t.price).amount;
    }
    if (it.type === 'attraction') {
      const a = attractions.get(it.catalog_id);
      expected = adults * a.price_per_person.amount + children * (a.child_price ?? a.price_per_person).amount;
    }
    assert.equal(it.price_inr, expected, `${it.item_id} ${it.catalog_id}`);
  }
  assert.equal(pkg.total_inr, pkg.items.reduce((t, i) => t + i.price_inr, 0));
  assert.equal(pkg.left_inr, pkg.budget_inr - pkg.total_inr);
  const exported = engine.exportTrip(pkg);
  assert.equal(exported.plan, undefined);
  assert.equal(exported.items.length, pkg.items.length);
});

test('OVER_BUDGET, NO_PACKAGE and INVALID_REQUEST', () => {
  const over = engine.buildPackages({ ...MENON, budgetInr: 100000 });
  assert.equal(over.status, 'OVER_BUDGET');
  assert.equal(over.over_by, over.cheapest_total - 100000);
  assert.ok(over.suggestions.length > 0);

  const none = engine.buildPackages({ ...MENON, startDate: '2027-04-18' });
  assert.equal(none.status, 'NO_PACKAGE');
  assert.ok(none.reasons.length > 0);

  const bad = engine.buildPackages({ ...MENON, adults: 0 });
  assert.equal(bad.status, 'INVALID_REQUEST');
  assert.ok(bad.errors.adults);
});

test('dates outside the data window give NO_PACKAGE, not INVALID_REQUEST', () => {
  const cases = [
    { startDate: '2027-03-31' },            // starts before window
    { startDate: '2027-05-02' },            // starts after window
    { startDate: '2026-12-25' },            // valid date, wrong year
    { startDate: '2027-04-15', nights: 6 }, // return 2027-04-21
    { startDate: '2027-04-20', nights: 3 }, // starts on last day, no nights possible
  ];
  for (const c of cases) {
    const r = engine.buildPackages({ ...MENON, ...c });
    assert.equal(r.status, 'NO_PACKAGE', JSON.stringify(c));
    assert.match(r.reasons[0], /only available from 1 to 20 April 2027/);
    assert.deepEqual(r.errors, {});
  }
  // Edge: return exactly on 2027-04-20 is inside the window.
  assert.equal(engine.buildPackages({ ...MENON, startDate: '2027-04-14', nights: 6 }).status, 'OK');
  assert.equal(engine.buildPackages({ ...MENON, startDate: '2027-04-01', nights: 3 }).status, 'OK');
});

test('INVALID_REQUEST only for malformed or out-of-range fields', () => {
  const bad = {
    missing: (() => { const { budgetInr, ...rest } = MENON; return rest; })(),
    nights: { ...MENON, nights: 11 },
    childAges: { ...MENON, childAges: [-1] },
    adults: { ...MENON, adults: 0 },
    budget: { ...MENON, budgetInr: 0 },
    city: { ...MENON, departureAirport: 'XXX' },
    country: { ...MENON, country: 'France' },
    date: { ...MENON, startDate: 'next friday' },
  };
  for (const [name, req] of Object.entries(bad)) {
    const r = engine.buildPackages(req);
    assert.equal(r.status, 'INVALID_REQUEST', name);
    assert.equal(Object.keys(r.errors).length, 1, name);
  }
});

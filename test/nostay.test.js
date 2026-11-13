// Tests for no-stay packages (includeStay: false): flights, transfers and attractions only, no hotel items,
// a derived city route in validatePackage, and the hotel change/option guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackages } from '../src/engine/build.js';
import { validatePackage } from '../src/engine/validate.js';
import { exportTrip } from '../src/engine/export.js';
import { applyChange, getOptions } from '../src/engine/change.js';
import { transferById } from '../src/engine/catalog.js';

const MENON = {
  departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10',
  nights: 6, adults: 2, childAges: [6], budgetInr: 350000,
};
const NO_STAY = { ...MENON, includeStay: false };
const airportItems = (pkg) => pkg.items.filter((i) => i.type === 'transfer' && transferById.get(i.catalog_id)?.airport);
const moveItems = (pkg) => pkg.items.filter((i) => i.type === 'transfer' && transferById.get(i.catalog_id)?.from_city);

test('no-stay package: flights, transfers and attractions, no hotel, still valid', () => {
  const r = buildPackages(NO_STAY);
  assert.equal(r.status, 'OK', JSON.stringify(r.reasons));
  assert.ok(r.packages.length >= 1);
  for (const pkg of r.packages) {
    assert.equal(pkg.items.filter((i) => i.type === 'hotel').length, 0, 'no hotel items');
    assert.equal(pkg.items.filter((i) => i.type === 'flight').length, 2);
    assert.equal(airportItems(pkg).length, 2);
    assert.equal(moveItems(pkg).length, pkg.plan.length - 1);
    assert.ok(pkg.items.some((i) => i.type === 'attraction'));
    assert.equal(pkg.metrics.avg_stars, null);
    assert.ok(pkg.plan.every((p) => p.hotel_id === null && p.room_id === null && p.rooms === 0));
    assert.equal(pkg.total_inr, pkg.items.reduce((t, it) => t + it.price_inr, 0));
    assert.deepEqual(validatePackage(pkg), [], pkg.label);
    assert.deepEqual(validatePackage(exportTrip(pkg)), [], `${pkg.label} export`);
  }
});

test('no-stay works for a multi-city plan (UAE)', () => {
  const req = { ...NO_STAY, country: 'United Arab Emirates', startDate: '2027-04-05', nights: 6, childAges: [] };
  const r = buildPackages(req);
  assert.equal(r.status, 'OK', JSON.stringify(r.reasons));
  const pkg = r.packages[0];
  assert.equal(pkg.items.filter((i) => i.type === 'hotel').length, 0);
  assert.ok(pkg.plan.length >= 2, 'a 6-night UAE trip can use both cities');
  assert.equal(airportItems(pkg).length, 2);
  assert.equal(moveItems(pkg).length, pkg.plan.length - 1);
  assert.deepEqual(validatePackage(pkg), []);
  assert.deepEqual(validatePackage(exportTrip(pkg)), []);
});

test('includeStay defaults to true and a non-boolean is rejected', () => {
  assert.ok(buildPackages(MENON).packages.every((p) => p.items.some((i) => i.type === 'hotel')));
  const bad = buildPackages({ ...MENON, includeStay: 'no' });
  assert.equal(bad.status, 'INVALID_REQUEST');
  assert.ok(bad.errors.includeStay);
});

test('no-stay changes: hotel options empty, swap_hotel refused, flight change works and stays valid', () => {
  const pkg = buildPackages(NO_STAY).packages[0];
  const ctx = { booked: { flights: {}, rooms: {} } };
  assert.deepEqual(getOptions(pkg, { kind: 'hotel', city: pkg.plan[0].city }, ctx), []);
  const swap = applyChange(pkg, { type: 'swap_hotel', city: pkg.plan[0].city, hotel_id: 'HTL-TYO-004', room_id: 'RM-TYO-004-B' }, ctx);
  assert.equal(swap.ok, false);
  assert.match(swap.reasons[0], /does not include a hotel/);

  const outbound = pkg.items.find((i) => i.type === 'flight' && i.start < pkg.end_date);
  const same = applyChange(pkg, { type: 'swap_flight', direction: 'outbound', flight_id: outbound.catalog_id }, ctx);
  assert.equal(same.ok, true, JSON.stringify(same.reasons));
  assert.deepEqual(validatePackage(same.package), []);
});

test('no-stay set_city_plan rebuilds without hotels and stays valid', () => {
  const pkg = buildPackages(NO_STAY).packages[0];
  const ctx = { booked: { flights: {}, rooms: {} } };
  const plans = getOptions(pkg, { kind: 'city_plan' }, ctx);
  const other = plans.find((o) => !o.detail?.current);
  if (!other) return;
  const change = applyChange(pkg, { type: 'set_city_plan', cities: other.detail.cities }, ctx);
  assert.equal(change.ok, true, JSON.stringify(change.reasons));
  assert.equal(change.package.items.filter((i) => i.type === 'hotel').length, 0);
  assert.equal(change.package.metrics.avg_stars, null);
  assert.deepEqual(validatePackage(change.package), []);
});

test('no-stay add/remove attraction works', () => {
  const pkg = buildPackages(NO_STAY).packages[0];
  const ctx = { booked: { flights: {}, rooms: {} } };
  const date = pkg.start_date;
  const options = getOptions(pkg, { kind: 'attraction', date }, ctx).filter((o) => o.valid);
  if (options.length) {
    const added = applyChange(pkg, { type: 'add_attraction', attraction_id: options[0].id, date }, ctx);
    assert.equal(added.ok, true, JSON.stringify(added.reasons));
    assert.deepEqual(validatePackage(added.package), []);
  }
  const visit = pkg.items.find((i) => i.type === 'attraction');
  const removed = applyChange(pkg, { type: 'remove_attraction', item_id: visit.item_id }, ctx);
  if (removed.ok) assert.deepEqual(validatePackage(removed.package), []);
});

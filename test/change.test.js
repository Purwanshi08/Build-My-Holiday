// Tests for src/engine/change.js: each applyChange type (with refusals that leave the input untouched), knock-on
// fixes (transfers, attraction times), over-budget warnings, stable ids, and getOptions for every kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackages } from '../src/engine/build.js';
import { applyChange, getOptions } from '../src/engine/change.js';
import { validatePackage } from '../src/engine/validate.js';
import { transferById, roomsLeft } from '../src/engine/catalog.js';
import { checkRules } from './rules.js';
import { requestOf } from '../src/engine/parts.js';

const MENON = {
  departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10',
  nights: 6, adults: 2, childAges: [6], budgetInr: 350000,
};
const base = () => buildPackages(MENON).packages[0]; // Tokyo 6 nights, Ueno Garden Inn, FL-401 / FL-412
const visitsOn = (pkg, date) => pkg.items.filter((i) => i.type === 'attraction' && i.start.startsWith(date));
const airportItems = (pkg) => pkg.items.filter((i) => i.type === 'transfer' && transferById.get(i.catalog_id).airport);

/** Shared checks for every accepted change. */
function assertGood(before, r, snapshot) {
  assert.equal(r.ok, true, r.reasons.join(' '));
  assert.deepEqual(r.reasons, []);
  assert.equal(JSON.stringify(before), snapshot, 'input not mutated');
  const p = r.package;
  assert.notEqual(p, before);
  assert.equal(p.id, before.id);
  assert.equal(p.trip_id, before.trip_id);
  assert.equal(p.label, before.label);
  assert.equal(r.delta_inr, p.total_inr - before.total_inr);
  assert.equal(p.left_inr, p.budget_inr - p.total_inr);
  assert.equal(new Set(p.items.map((i) => i.item_id)).size, p.items.length, 'unique item ids');
  assert.deepEqual(validatePackage(p), []);
  assert.deepEqual(checkRules(p, requestOf(p)), []);
}

/** Shared checks for every refusal. */
function assertRefused(before, r, snapshot, pattern) {
  assert.equal(r.ok, false);
  assert.equal(r.package, before, 'the unchanged input is returned');
  assert.equal(JSON.stringify(before), snapshot, 'input not mutated');
  assert.equal(r.delta_inr, 0);
  assert.ok(r.reasons.length > 0);
  if (pattern) assert.match(r.reasons.join(' '), pattern);
}

// ---- swap_hotel ----

test('swap_hotel to another area re-picks both airport transfers and keeps flight ids', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const r = applyChange(pkg, { type: 'swap_hotel', city: 'Tokyo', hotel_id: 'HTL-TYO-003', room_id: 'RM-TYO-003-C' });
  assertGood(pkg, r, snap);
  assert.equal(r.package.plan[0].hotel_id, 'HTL-TYO-003');
  for (const it of airportItems(r.package)) assert.equal(transferById.get(it.catalog_id).area, 'Asakusa');
  assert.ok(r.warnings.some((w) => /^Arrival airport transfer changed/.test(w)));
  assert.ok(r.warnings.some((w) => /^Return airport transfer changed/.test(w)));
  const ids = (p) => p.items.filter((i) => i.type === 'flight').map((i) => `${i.item_id}:${i.catalog_id}`);
  assert.deepEqual(ids(r.package), ids(pkg), 'unchanged items keep their item_id');
});

test('swap_hotel refusals: no rooms left, room of another hotel, wrong city', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  assert.equal(roomsLeft('RM-TYO-001-B', '2027-04-12'), 0);
  assertRefused(pkg, applyChange(pkg, { type: 'swap_hotel', city: 'Tokyo', hotel_id: 'HTL-TYO-001', room_id: 'RM-TYO-001-B' }),
    snap, /0 room\(s\) left on 2027-04-12/);
  assertRefused(pkg, applyChange(pkg, { type: 'swap_hotel', city: 'Tokyo', hotel_id: 'HTL-TYO-003', room_id: 'RM-TYO-001-B' }),
    snap, /not a room type/);
  assertRefused(pkg, applyChange(pkg, { type: 'swap_hotel', city: 'Kyoto', hotel_id: 'HTL-KYO-004', room_id: 'RM-KYO-004-B' }),
    snap, /no stay in Kyoto/);
});

test('ctx bookings count: a room we already sold out is refused', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const ctx = { booked: { flights: {}, rooms: { 'RM-TYO-003-C|2027-04-11': roomsLeft('RM-TYO-003-C', '2027-04-11') } } };
  assertRefused(pkg, applyChange(pkg, { type: 'swap_hotel', city: 'Tokyo', hotel_id: 'HTL-TYO-003', room_id: 'RM-TYO-003-C' }, ctx),
    snap, /0 room\(s\) left on 2027-04-11/);
});

test('going over budget is not a refusal: ok with a warning', () => {
  const pkg = buildPackages({ ...MENON, budgetInr: 225000 }).packages[0]; // ₹2,19,324 of ₹2,25,000
  const snap = JSON.stringify(pkg);
  const r = applyChange(pkg, { type: 'swap_hotel', city: 'Tokyo', hotel_id: 'HTL-TYO-009', room_id: 'RM-TYO-009-B' });
  assertGood(pkg, r, snap);
  assert.ok(r.package.total_inr > r.package.budget_inr);
  assert.ok(r.package.left_inr < 0);
  assert.ok(r.warnings.some((w) => /over the budget of ₹2,25,000/.test(w)));
});

// ---- swap_flight ----

test('swap_flight outbound to a late arrival: transfer switches, arrival-day visit dropped', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  assert.equal(visitsOn(pkg, '2027-04-10').length, 1);
  const r = applyChange(pkg, { type: 'swap_flight', direction: 'outbound', flight_id: 'FL-405' }); // lands 21:30
  assertGood(pkg, r, snap);
  const arrive = airportItems(r.package)[0];
  assert.equal(arrive.start, '2027-04-10T22:30'); // landing + 60
  assert.ok(r.warnings.some((w) => /^Arrival airport transfer changed/.test(w)), 'bus stops at 22:00 → taxi');
  assert.deepEqual(visitsOn(r.package, '2027-04-10'), []);
  assert.ok(r.warnings.some((w) => /on 2027-04-10 was removed/.test(w)));
});

test('swap_flight return to another airport changes the return transfer', () => {
  const req = { ...MENON, country: 'United Arab Emirates', startDate: '2027-04-12', nights: 4, budgetInr: 900000 };
  const pkg = buildPackages(req).packages[0]; // Abu Dhabi, returns from DXB
  const snap = JSON.stringify(pkg);
  const r = applyChange(pkg, { type: 'swap_flight', direction: 'return', flight_id: 'FL-1284' }); // from AUH
  assertGood(pkg, r, snap);
  assert.equal(transferById.get(airportItems(r.package)[1].catalog_id).airport, 'AUH');
  assert.ok(r.warnings.some((w) => /^Return airport transfer changed/.test(w)));
});

test('swap_flight refusals: too few seats, wrong airport, wrong date, bad direction', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  assertRefused(pkg, applyChange(pkg, { type: 'swap_flight', direction: 'outbound', flight_id: 'FL-403' }),
    snap, /Only 2 seat\(s\) left on NS 805; 3 travelers/);
  assertRefused(pkg, applyChange(pkg, { type: 'swap_flight', direction: 'return', flight_id: 'FL-411' }),
    snap, /KIX does not serve Tokyo/);
  assertRefused(pkg, applyChange(pkg, { type: 'swap_flight', direction: 'outbound', flight_id: 'FL-711' }),
    snap, /lands on 2027-04-03, not on the start date 2027-04-10/);
  assertRefused(pkg, applyChange(pkg, { type: 'swap_flight', direction: 'sideways', flight_id: 'FL-401' }), snap);
});

// ---- add_attraction / remove_attraction ----

test('add_attraction finds a free slot inside opening hours without overlap', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const r = applyChange(pkg, { type: 'add_attraction', attraction_id: 'ATT-TYO-007', date: '2027-04-12' });
  assertGood(pkg, r, snap);
  const day = visitsOn(r.package, '2027-04-12');
  assert.equal(day.length, 2);
  const added = day.find((i) => i.catalog_id === 'ATT-TYO-007');
  assert.ok(added.start.slice(11) >= '10:00' && added.end.slice(11) <= '21:00', 'Tokyo Skytree is open 10:00–21:00');
  assert.ok(day[0].end <= day[1].start);
  assert.equal(r.delta_inr, added.price_inr);
  const maxId = Math.max(...pkg.items.map((i) => Number(i.item_id.slice(1))));
  assert.equal(added.item_id, `i${maxId + 1}`, 'new items get new ids');
});

test('add_attraction refusals: closed weekday, wrong city, last day, already in, third on a full day', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const add = (attraction_id, date) => applyChange(pkg, { type: 'add_attraction', attraction_id, date });
  assertRefused(pkg, add('ATT-TYO-005', '2027-04-12'), snap, /closed on MON/);
  assertRefused(pkg, add('ATT-KYO-001', '2027-04-12'), snap, /is in Kyoto, but the night of 2027-04-12 is in Tokyo/);
  assertRefused(pkg, add('ATT-NAR-001', '2027-04-12'), snap, /is in Nara/);
  assertRefused(pkg, add('ATT-TYO-007', '2027-04-16'), snap, /No attractions can be planned on 2027-04-16/);
  const existing = visitsOn(pkg, '2027-04-12')[0].catalog_id;
  assertRefused(pkg, add(existing, '2027-04-13'), snap, /already in the package/);
  const two = '2027-04-11';
  assert.equal(visitsOn(pkg, two).length, 2);
  assertRefused(pkg, add('ATT-TYO-007', two), snap, /already has 2 attractions/);
});

test('remove_attraction: allowed when the day keeps one, refused for the last one on a full day', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const [first] = visitsOn(pkg, '2027-04-11');
  const r = applyChange(pkg, { type: 'remove_attraction', item_id: first.item_id });
  assertGood(pkg, r, snap);
  assert.equal(visitsOn(r.package, '2027-04-11').length, 1);
  assert.equal(r.delta_inr + first.price_inr, 0);

  const only = visitsOn(pkg, '2027-04-12')[0];
  assertRefused(pkg, applyChange(pkg, { type: 'remove_attraction', item_id: only.item_id }),
    snap, /only attraction on 2027-04-12, and every full day needs at least one/);
  assertRefused(pkg, applyChange(pkg, { type: 'remove_attraction', item_id: 'i1' }), snap, /not an attraction/);
});

test('remove_attraction on the optional arrival day is allowed', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const [arrivalDay] = visitsOn(pkg, '2027-04-10');
  const r = applyChange(pkg, { type: 'remove_attraction', item_id: arrivalDay.item_id });
  assertGood(pkg, r, snap);
  assert.deepEqual(visitsOn(r.package, '2027-04-10'), []);
});

// ---- set_city_plan ----

test('set_city_plan rebuilds for the new plan, keeps id/label, changes the return flight if needed', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const r = applyChange(pkg, { type: 'set_city_plan', cities: [{ city: 'Tokyo', nights: 3 }, { city: 'Kyoto', nights: 3 }] });
  assertGood(pkg, r, snap);
  assert.deepEqual(r.package.plan.map((p) => [p.city, p.nights]), [['Tokyo', 3], ['Kyoto', 3]]);
  const move = r.package.items.find((i) => i.type === 'transfer' && transferById.get(i.catalog_id).from_city);
  assert.equal(move.start.slice(0, 10), '2027-04-13');
  assert.ok(r.warnings.some((w) => /^Rebuilt for Tokyo 3 nights → Kyoto 3 nights/.test(w)));
  assert.ok(r.warnings.some((w) => /^Return flight changed to FL-411/.test(w)), 'HND does not serve Kyoto');
});

test('set_city_plan refusals: one-night city, wrong total, unknown city', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  const plan = (cities) => applyChange(pkg, { type: 'set_city_plan', cities });
  assertRefused(pkg, plan([{ city: 'Tokyo', nights: 5 }, { city: 'Kyoto', nights: 1 }]), snap, /Not a valid city plan/);
  assertRefused(pkg, plan([{ city: 'Tokyo', nights: 3 }, { city: 'Kyoto', nights: 2 }]), snap, /must add up to 6 \(got 5\)/);
  assertRefused(pkg, plan([{ city: 'Nara', nights: 6 }]), snap, /Not a valid city plan/);
});

test('unknown change type and booked packages are refused', () => {
  const pkg = base();
  const snap = JSON.stringify(pkg);
  assertRefused(pkg, applyChange(pkg, { type: 'teleport' }), snap, /Unknown change type/);
  const booked = { ...pkg, status: 'BOOKED' };
  assertRefused(booked, applyChange(booked, { type: 'remove_attraction', item_id: 'i4' }), JSON.stringify(booked), /already booked/);
});

// ---- getOptions ----

/** Every valid option's delta must equal what applyChange really does. */
function assertOptionsMatch(pkg, options, toChange) {
  for (const o of options) {
    assert.equal(typeof o.label, 'string');
    if (o.valid) {
      const r = applyChange(pkg, toChange(o));
      assert.equal(r.ok, true, o.id);
      if (!o.detail.current) assert.equal(o.price_delta_inr, r.delta_inr, o.id);
      assert.equal(o.reason, null);
    } else {
      assert.equal(o.price_delta_inr, null);
      assert.ok(o.reason.length > 0, o.id);
    }
  }
}

test('getOptions hotel: every room type of every hotel in the city, current one at ₹0', () => {
  const pkg = base();
  const opts = getOptions(pkg, { kind: 'hotel', city: 'Tokyo' });
  assert.equal(opts.length, 34); // 13 Tokyo hotels' room types
  const current = opts.find((o) => o.detail.current);
  assert.equal(current.id, 'HTL-TYO-004|RM-TYO-004-B');
  assert.equal(current.price_delta_inr, 0);
  assert.ok(opts.some((o) => !o.valid && /0 room\(s\) left/.test(o.reason)));
  assertOptionsMatch(pkg, opts, (o) => {
    const [hotel_id, room_id] = o.id.split('|');
    return { type: 'swap_hotel', city: 'Tokyo', hotel_id, room_id };
  });
  assert.deepEqual(getOptions(pkg, { kind: 'hotel', city: 'Kyoto' }), []);
});

test('getOptions flight: same-day alternatives, seats shortage shown as invalid', () => {
  const pkg = base();
  const out = getOptions(pkg, { kind: 'flight', direction: 'outbound' });
  assert.deepEqual(out.map((o) => o.id).sort(), ['FL-401', 'FL-403', 'FL-405']);
  assert.match(out.find((o) => o.id === 'FL-403').reason, /Only 2 seat/);
  assert.equal(out.find((o) => o.id === 'FL-401').detail.current, true);
  assertOptionsMatch(pkg, out, (o) => ({ type: 'swap_flight', direction: 'outbound', flight_id: o.id }));
  assert.deepEqual(getOptions(pkg, { kind: 'flight', direction: 'return' }).map((o) => o.id), ['FL-412']);
  assert.deepEqual(getOptions(pkg, { kind: 'flight' }), []);
});

test('getOptions attraction: that night\'s city only; in-package and closed ones invalid', () => {
  const pkg = base();
  const opts = getOptions(pkg, { kind: 'attraction', date: '2027-04-13' });
  assert.ok(opts.length > 0 && opts.every((o) => o.detail.city === 'Tokyo'));
  assert.ok(opts.some((o) => /Already in the package/.test(o.reason ?? '')));
  assert.ok(opts.some((o) => /closed/.test(o.reason ?? '')));
  for (const o of opts.filter((x) => x.valid)) assert.ok(o.detail.start && o.detail.end);
  assertOptionsMatch(pkg, opts, (o) => ({ type: 'add_attraction', attraction_id: o.id, date: '2027-04-13' }));
  assert.deepEqual(getOptions(pkg, { kind: 'attraction', date: '2027-04-16' }), []);
});

test('getOptions city_plan: every legal plan, current at ₹0, deltas match a rebuild', () => {
  const pkg = base();
  const opts = getOptions(pkg, { kind: 'city_plan' });
  assert.equal(opts.length, 27);
  const current = opts.find((o) => o.detail.current);
  assert.equal(current.id, 'Tokyo:6');
  assert.equal(current.price_delta_inr, 0);
  assertOptionsMatch(pkg, opts.slice(0, 6), (o) => ({ type: 'set_city_plan', cities: o.detail.cities }));
  assert.deepEqual(getOptions(pkg, { kind: 'nope' }), []);
});

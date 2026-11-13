// Tests for src/engine/plans.js: city-plan enumeration (≥2 nights per city, each city once, linked neighbours)
// and flight pairs (arrival on the start date, return on the last day, serving airports, free seats after ctx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlans, flightPairs, seatsFree } from '../src/engine/plans.js';
import { airportsServing, intercityTransfers, flightById } from '../src/engine/catalog.js';

const MENON = { departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10', nights: 6, adults: 2, childAges: [6] };
const fmt = (plan) => plan.map((p) => `${p.city}${p.nights}`).join('-');

test('Japan, 6 nights: 27 plans, every one legal', () => {
  const plans = cityPlans('Japan', 6);
  assert.equal(plans.length, 27);
  assert.equal(new Set(plans.map(fmt)).size, 27);
  for (const plan of plans) {
    assert.equal(plan.reduce((t, p) => t + p.nights, 0), 6);
    assert.ok(plan.every((p) => p.nights >= 2));
    assert.equal(new Set(plan.map((p) => p.city)).size, plan.length);
    for (let i = 1; i < plan.length; i++) assert.ok(intercityTransfers(plan[i - 1].city, plan[i].city).length);
  }
  assert.ok(plans.some((p) => fmt(p) === 'Tokyo3-Kyoto3'));
  assert.ok(plans.some((p) => fmt(p) === 'Tokyo6'));
});

test('small trips: 3 nights allows one city only; UAE 4 nights allows the 2-2 splits', () => {
  assert.deepEqual(cityPlans('Japan', 3).map(fmt).sort(), ['Kyoto3', 'Osaka3', 'Tokyo3']);
  assert.deepEqual(cityPlans('United Arab Emirates', 4).map(fmt).sort(),
    ['Abu Dhabi2-Dubai2', 'Abu Dhabi4', 'Dubai2-Abu Dhabi2', 'Dubai4']);
});

test('never Nara, unknown country gives no plans', () => {
  assert.ok(cityPlans('Japan', 10).every((plan) => plan.every((p) => p.city !== 'Nara')));
  assert.deepEqual(cityPlans('France', 6), []);
});

test('flight pairs for Menon Tokyo3-Kyoto3: arrival day, return day, serving airports, seats', () => {
  const plan = [{ city: 'Tokyo', nights: 3 }, { city: 'Kyoto', nights: 3 }];
  const pairs = flightPairs(MENON, plan);
  assert.deepEqual(pairs.map((p) => `${p.out.flight_id}/${p.ret.flight_id}`).sort(), ['FL-401/FL-411', 'FL-405/FL-411']);
  for (const { out, ret } of pairs) {
    assert.equal(out.arrival_local.slice(0, 10), '2027-04-10');
    assert.equal(ret.departure_local.slice(0, 10), '2027-04-16');
    assert.ok(airportsServing('Tokyo').includes(out.to));
    assert.ok(airportsServing('Kyoto').includes(ret.from));
  }
  // FL-403 lands at HND on the start date but has only 2 seats for 3 travelers.
  assert.equal(flightById.get('FL-403').seats_left, 2);
  assert.ok(pairs.every((p) => p.out.flight_id !== 'FL-403'));
});

test('ctx.booked seats are subtracted', () => {
  const fl = flightById.get('FL-401'); // 9 seats
  assert.equal(seatsFree(fl, undefined), 9);
  assert.equal(seatsFree(fl, { booked: { flights: { 'FL-401': 7 }, rooms: {} } }), 2);
  const plan = [{ city: 'Tokyo', nights: 6 }];
  const ctx = { booked: { flights: { 'FL-401': 7 }, rooms: {} } };
  assert.ok(flightPairs(MENON, plan, ctx).every((p) => p.out.flight_id !== 'FL-401'));
});

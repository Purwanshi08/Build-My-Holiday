// Tests for src/engine/schedule.js: airport pickups (60/180-minute rules, waiting, past-midnight and 24:00
// windows), intercity departures on the frequency grid, opening days/hours and the attraction day planner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transferById, attractionById } from '../src/engine/catalog.js';
import {
  arrivalPickup, departurePickup, intercityDeparture, openOn, fitVisit, planAttractions,
} from '../src/engine/schedule.js';
import { toMinutes } from '../src/engine/time.js';

const T = (id) => transferById.get(id);
const A = (id) => attractionById.get(id);
const m = toMinutes;

test('arrivalPickup: 60 minutes after landing when inside the window', () => {
  assert.deepEqual(arrivalPickup(T('TR-NRT-UEN-BUS'), '2027-04-10T10:30'), // 06:30-22:00, 90 min
    { start: '2027-04-10T11:30', end: '2027-04-10T13:00' });
});

test('arrivalPickup: waits for the window to open (≤180 min), else null', () => {
  assert.equal(arrivalPickup(T('TR-NRT-UEN-BUS'), '2027-04-10T04:45').start, '2027-04-10T06:30');
  assert.equal(arrivalPickup(T('TR-NRT-UEN-BUS'), '2027-04-10T21:00').start, '2027-04-10T22:00'); // window end included
  assert.equal(arrivalPickup(T('TR-NRT-UEN-BUS'), '2027-04-10T21:30'), null); // 22:30 is past 22:00
});

test('arrivalPickup: past-midnight window 06:00-00:30', () => {
  const shuttle = T('TR-KIX-NMB-SHUTTLE');
  assert.equal(arrivalPickup(shuttle, '2027-04-10T23:20').start, '2027-04-11T00:20');
  assert.equal(arrivalPickup(shuttle, '2027-04-10T23:30').start, '2027-04-11T00:30');
  assert.equal(arrivalPickup(shuttle, '2027-04-10T23:31'), null);
});

test('arrivalPickup: 05:00-24:00 window accepts 23:59 but not 00:00 of the next day', () => {
  const taxi = T('TR-HND-UEN-TAXI');
  assert.equal(arrivalPickup(taxi, '2027-04-10T22:59').start, '2027-04-10T23:59');
  assert.equal(arrivalPickup(taxi, '2027-04-10T23:00'), null);
});

test('departurePickup: at the airport ≥180 min before departure, latest pickup inside the window', () => {
  const bus = T('TR-HND-UEN-BUS'); // 05:30-23:00, 55 min
  assert.deepEqual(departurePickup(bus, '2027-04-16T11:00'), { start: '2027-04-16T07:05', end: '2027-04-16T08:00' });
  assert.equal(departurePickup(bus, '2027-04-17T02:00').start, '2027-04-16T22:05');
  assert.equal(departurePickup(bus, '2027-04-17T03:00').start, '2027-04-16T23:00'); // falls back to window end
  assert.equal(departurePickup(bus, '2027-04-16T08:00'), null); // 04:05 and the 180 min before it are closed
});

test('intercityDeparture: first slot at or after 10:00 on the frequency grid', () => {
  assert.deepEqual(intercityDeparture(T('TR-TYO-KYO-01'), '2027-04-13'),
    { start: '2027-04-13T10:00', end: '2027-04-13T12:15' });
  const grid = { service_from: '06:10', service_until: '21:00', frequency_minutes: 45, duration_minutes: 60 };
  assert.equal(intercityDeparture(grid, '2027-04-13').start, '2027-04-13T10:40');
  const late = { service_from: '22:00', service_until: '23:30', frequency_minutes: 30, duration_minutes: 60 };
  assert.deepEqual(intercityDeparture(late, '2027-04-13'), { start: '2027-04-13T22:00', end: '2027-04-13T23:00' });
  const early = { service_from: '06:00', service_until: '09:00', frequency_minutes: 30, duration_minutes: 30 };
  assert.equal(intercityDeparture(early, '2027-04-13').start, '2027-04-13T06:00');
  assert.equal(intercityDeparture(T('TR-DXB-AUH-TAXI'), '2027-04-13').start, '2027-04-13T10:00'); // no frequency
});

test('openOn: weekdays and closed_dates', () => {
  assert.equal(openOn(A('ATT-TYO-005'), '2027-04-12'), false); // closed on Monday
  assert.equal(openOn(A('ATT-TYO-005'), '2027-04-13'), true);
  assert.equal(openOn(A('ATT-TYO-002'), '2027-04-12'), false); // closed date
  assert.equal(openOn(A('ATT-TYO-002'), '2027-04-11'), true);
});

test('fitVisit: inside opening hours, both ends included, honours the day limit', () => {
  const museum = A('ATT-TYO-005'); // 09:30-17:00, 120 min
  assert.deepEqual(fitVisit(museum, m('08:00'), m('22:00')), { start: m('09:30'), end: m('11:30') });
  assert.deepEqual(fitVisit(museum, m('15:00'), m('22:00')), { start: m('15:00'), end: m('17:00') });
  assert.equal(fitVisit(museum, m('15:01'), m('22:00')), null);
  assert.equal(fitVisit(museum, m('09:30'), m('11:00')), null);
  assert.deepEqual(fitVisit(A('ATT-TYO-011'), m('23:30'), 1440), { start: m('23:30'), end: 1440 }); // open to 24:00
});

test('planAttractions: full day 1 cheapest (+1 only if free), optional day only free, never twice', () => {
  const days = [
    { date: '2027-04-10', city: 'Tokyo', full: false, earliest: m('13:30') },
    { date: '2027-04-11', city: 'Tokyo', full: true },
    { date: '2027-04-12', city: 'Tokyo', full: true },
  ];
  const { visits, failedDate } = planAttractions(days, 2, 1);
  assert.equal(failedDate, null);
  const ids = visits.map((v) => v.attraction.attraction_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of days) {
    const today = visits.filter((v) => v.date === d.date);
    assert.ok(d.full ? today.length >= 1 && today.length <= 2 : today.length <= 1, d.date);
    if (!d.full) assert.ok(today.every((v) => v.price === 0));
    if (today.length === 2) assert.equal(today[1].price, 0);
    for (let i = 1; i < today.length; i++) assert.ok(today[i].start >= today[i - 1].end);
    for (const v of today) {
      assert.ok(openOn(v.attraction, d.date));
      assert.ok(v.start.slice(11) >= v.attraction.open_from && v.end.slice(11) <= v.attraction.open_until);
    }
  }
  assert.ok(visits.find((v) => v.date === '2027-04-10').start >= '2027-04-10T13:30');
});

test('planAttractions: a full day that cannot get a visit fails; Nara is never used', () => {
  assert.equal(planAttractions([{ date: '2027-04-11', city: 'Tokyo', full: true, latest: m('05:10') }], 2, 0)
    .failedDate, '2027-04-11');
  const nara = planAttractions([{ date: '2027-04-11', city: 'Nara', full: true }], 2, 0);
  assert.equal(nara.failedDate, '2027-04-11');
  assert.deepEqual(nara.visits, []);
});

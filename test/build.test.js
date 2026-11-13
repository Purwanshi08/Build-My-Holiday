// Tests for src/engine/build.js: Menon passes every problem §4 rule (re-checked here from the catalog) and is
// printed day by day; all four statuses (INVALID_REQUEST, NO_PACKAGE, OK, OVER_BUDGET at ₹1,50,000) behave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackages, cheapestTotal } from '../src/engine/build.js';
import { suggestVariations, describe } from '../src/engine/suggest.js';
import { validatePackage } from '../src/engine/validate.js';
import {
  flightById, hotelById, roomById, transferById, attractionById, airportsServing, roomsLeft, availability,
} from '../src/engine/catalog.js';
import { addDays, addMinutes, inWindow, weekday } from '../src/engine/time.js';

const MENON = {
  departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10',
  nights: 6, adults: 2, childAges: [6], budgetInr: 350000,
};
const inr = (n) => `₹${n.toLocaleString('en-IN')}`;

/** Every rule of problem §4, checked independently of the engine's own choices. Returns problems. */
export function checkRules(pkg, req) {
  const errs = [];
  const fail = (cond, msg) => { if (!cond) errs.push(msg); };
  const adults = req.adults;
  const children = req.childAges.length;
  const pax = adults + children;
  const end = addDays(req.startDate, req.nights);
  const of = (type) => pkg.items.filter((i) => i.type === type);

  // Dates and cities
  fail(pkg.end_date === end, 'end_date');
  const cities = pkg.plan.map((p) => p.city);
  fail(new Set(cities).size === cities.length, 'a city appears twice');
  fail(pkg.plan.every((p) => p.nights >= 2), 'a city has < 2 nights');
  fail(pkg.plan[0].check_in === req.startDate && pkg.plan.at(-1).check_out === end, 'plan dates');

  // Flights
  const [out, ret] = of('flight').map((i) => flightById.get(i.catalog_id));
  fail(of('flight').length === 2, 'two flights');
  fail(out.from === req.departureAirport && ret.to === req.departureAirport, 'flights to/from home');
  fail(out.arrival_local.slice(0, 10) === req.startDate, 'arrival flight lands on the start date');
  fail(ret.departure_local.slice(0, 10) === end, 'return flight leaves on the last day');
  fail(airportsServing(cities[0]).includes(out.to), 'arrival airport serves the first city');
  fail(airportsServing(cities.at(-1)).includes(ret.from), 'return airport serves the last city');
  fail(out.seats_left >= pax && ret.seats_left >= pax, 'seats');

  // Airport transfers
  const airportItems = of('transfer').filter((i) => transferById.get(i.catalog_id).airport);
  fail(airportItems.length === 2, 'two airport transfers');
  const [arrT, depT] = airportItems;
  const firstHotel = hotelById.get(pkg.plan[0].hotel_id);
  const lastHotel = hotelById.get(pkg.plan.at(-1).hotel_id);
  for (const [it, hotel, ap] of [[arrT, firstHotel, out.to], [depT, lastHotel, ret.from]]) {
    const t = transferById.get(it.catalog_id);
    fail(t.airport === ap && t.city === hotel.city && (t.area === null || t.area === hotel.area), `${t.transfer_id} serves hotel`);
    fail(inWindow(it.start.slice(11), t.service_from, t.service_until), `${t.transfer_id} pickup inside service hours`);
    fail(it.end === addMinutes(it.start, t.duration_minutes), `${t.transfer_id} end = pickup + duration`);
  }
  fail(arrT.start >= addMinutes(out.arrival_local, 60), 'pickup ≥ 60 min after landing');
  fail(depT.end <= addMinutes(ret.departure_local, -180), 'at the airport ≥ 180 min before departure');

  // Transfers between cities
  const moves = of('transfer').filter((i) => transferById.get(i.catalog_id).from_city);
  fail(moves.length === pkg.plan.length - 1, 'one intercity transfer per change day');
  for (const [i, mv] of moves.entries()) {
    const t = transferById.get(mv.catalog_id);
    fail(t.from_city === pkg.plan[i].city && t.to_city === pkg.plan[i + 1].city, 'intercity cities');
    fail(mv.start.slice(0, 10) === pkg.plan[i + 1].check_in, 'intercity on the change day');
    fail(inWindow(mv.start.slice(11), t.service_from, t.service_until), 'intercity inside service hours');
  }

  // Hotels
  for (const p of pkg.plan) {
    const room = roomById.get(p.room_id);
    const k = p.rooms;
    fail(room.hotel_id === p.hotel_id && hotelById.get(p.hotel_id).city === p.city, 'hotel in city');
    fail(adults <= k * room.max_adults && pax <= k * (room.max_adults + room.max_children) && adults >= k, 'rooms fit');
    for (let n = 0; n < p.nights; n++) fail(roomsLeft(p.room_id, addDays(p.check_in, n)) >= k, 'rooms left');
  }

  // Attractions
  const visits = of('attraction');
  const ids = visits.map((v) => v.catalog_id);
  fail(new Set(ids).size === ids.length, 'attraction twice');
  const changeDays = new Set(pkg.plan.slice(1).map((p) => p.check_in));
  for (let d = req.startDate; d < end; d = addDays(d, 1)) {
    const today = visits.filter((v) => v.start.slice(0, 10) === d).sort((a, b) => a.start.localeCompare(b.start));
    const full = d !== req.startDate && !changeDays.has(d);
    if (full) fail(today.length >= 1 && today.length <= 2, `1-2 attractions on full day ${d}`);
    for (let i = 1; i < today.length; i++) fail(today[i].start >= today[i - 1].end, `overlap on ${d}`);
  }
  for (const v of visits) {
    const a = attractionById.get(v.catalog_id);
    const d = v.start.slice(0, 10);
    const night = pkg.plan.find((p) => p.check_in <= d && d < p.check_out);
    fail(d !== end, 'no attraction on the last day');
    fail(a.city !== 'Nara' && night && a.city === night.city, `${a.attraction_id} in that night's city`);
    fail(a.open_days.includes(weekday(d)) && !(a.closed_dates ?? []).includes(d), `${a.attraction_id} open`);
    fail(v.start.slice(11) >= a.open_from && v.end.slice(11) <= a.open_until, `${a.attraction_id} hours`);
    fail(v.end === addMinutes(v.start, a.visit_minutes), `${a.attraction_id} visit length`);
  }
  if (arrT) {
    const firstDay = visits.filter((v) => v.start.slice(0, 10) === req.startDate);
    fail(firstDay.every((v) => v.start >= arrT.end), 'arrival-day visits after reaching the hotel');
  }
  for (const [i, mv] of moves.entries()) {
    const day = visits.filter((v) => v.start.slice(0, 10) === pkg.plan[i + 1].check_in);
    fail(day.every((v) => v.start >= mv.end), 'change-day visits after arriving');
  }

  // Totals and shape
  fail(pkg.total_inr === pkg.items.reduce((t, i) => t + i.price_inr, 0), 'total = sum of items');
  fail(pkg.left_inr === pkg.budget_inr - pkg.total_inr, 'left_inr');
  fail(new Set(pkg.items.map((i) => i.item_id)).size === pkg.items.length, 'unique item ids');
  return errs;
}

/** Day-by-day text of a package (one line per item, grouped by local date). */
function dayByDay(pkg) {
  const lines = [`${pkg.label}: ${pkg.plan.map((p) => `${p.city} ${p.nights}n`).join(' → ')}`];
  let day = null;
  for (const it of pkg.items) {
    const date = it.start.slice(0, 10);
    if (date !== day) {
      day = date;
      lines.push(`\n${date} (${weekday(date)})`);
    }
    const time = it.type === 'hotel' ? `check-in, ${it.end} out` : `${it.start.slice(11)}-${(it.end ?? '').slice(11)}`;
    lines.push(`  ${time.padEnd(22)} ${it.type.padEnd(10)} ${it.name} [${it.catalog_id}] ×${it.quantity}  ${inr(it.price_inr)}`);
  }
  lines.push(`\nTotal ${inr(pkg.total_inr)} · budget ${inr(pkg.budget_inr)} · left ${inr(pkg.left_inr)}`);
  return lines.join('\n');
}

test('Menon request returns a package that passes every rule, printed day by day', () => {
  const r = buildPackages(MENON, { booked: { flights: {}, rooms: {} } });
  assert.equal(r.status, 'OK', JSON.stringify(r.reasons));
  assert.ok(r.packages.length >= 1 && r.packages.length <= 3);
  assert.equal(r.packages[0].label, 'cheapest');
  assert.equal(r.cheapest_total, r.packages[0].total_inr);
  assert.equal(new Set(r.packages.map((p) => p.label)).size, r.packages.length);
  for (const pkg of r.packages) {
    assert.ok(pkg.total_inr <= MENON.budgetInr, pkg.label);
    assert.deepEqual(checkRules(pkg, MENON), [], pkg.label);
  }
  console.log(`\n${dayByDay(r.packages[0])}\n`);
});

test('cheapest really is the cheapest among the labels; metrics are consistent', () => {
  const { packages } = buildPackages(MENON);
  for (const p of packages) assert.ok(packages[0].total_inr <= p.total_inr);
  for (const p of packages) {
    const flights = p.items.filter((i) => i.type === 'flight').map((i) => flightById.get(i.catalog_id));
    const moves = p.items.filter((i) => i.type === 'transfer' && transferById.get(i.catalog_id).from_city);
    assert.equal(p.metrics.travel_minutes, flights.reduce((t, f) => t + f.duration_minutes, 0) +
      moves.reduce((t, i) => t + transferById.get(i.catalog_id).duration_minutes, 0));
  }
});

test('other requests: UAE builds, a bigger family fits, rules hold', () => {
  for (const req of [
    { ...MENON, country: 'United Arab Emirates' },
    { ...MENON, adults: 4, childAges: [2, 15], budgetInr: 900000 },
    // MAA lands only at NRT on 04-04 and returns only from KIX on 04-10: forces a Tokyo → Kansai plan.
    { ...MENON, departureAirport: 'MAA', startDate: '2027-04-04', nights: 6, budgetInr: 600000 },
  ]) {
    const r = buildPackages(req);
    assert.equal(r.status, 'OK', `${JSON.stringify(req)} ${JSON.stringify(r)}`.slice(0, 400));
    for (const pkg of r.packages) assert.deepEqual(checkRules(pkg, req), [], `${req.country} ${pkg.label}`);
    if (req.departureAirport === 'MAA') {
      assert.ok(r.packages.every((p) => p.plan[0].city === 'Tokyo' && p.plan.length >= 2));
    }
  }
});

test('ctx.booked rooms are respected', () => {
  const first = buildPackages(MENON).packages[0];
  const { room_id, check_in } = first.plan[0];
  const ctx = { booked: { flights: {}, rooms: { [`${room_id}|${check_in}`]: roomsLeft(room_id, check_in) } } };
  const again = buildPackages(MENON, ctx).packages[0];
  const usesSoldOutNight = again.plan.some((p) => p.room_id === room_id && p.check_in <= check_in && check_in < p.check_out);
  assert.equal(usesSoldOutNight, false);
});

// ---- the four statuses ----

test('INVALID_REQUEST: per-field messages, nothing built', () => {
  const r = buildPackages({
    departureAirport: 'XXX', country: 'France', startDate: '2027-02-30', nights: 2, adults: 0, childAges: [18],
    budgetInr: 0,
  });
  assert.equal(r.status, 'INVALID_REQUEST');
  assert.deepEqual(Object.keys(r.errors).sort(),
    ['adults', 'budgetInr', 'childAges', 'country', 'departureAirport', 'nights', 'startDate']);
  for (const msg of Object.values(r.errors)) assert.ok(typeof msg === 'string' && msg.length > 5);
  assert.deepEqual(r.packages, []);
  const { budgetInr, ...missing } = MENON;
  assert.deepEqual(Object.keys(buildPackages(missing).errors), ['budgetInr']);
});

test('NO_PACKAGE: valid date outside the data window, with the window reason', () => {
  for (const req of [{ ...MENON, startDate: '2027-04-18' }, { ...MENON, startDate: '2027-03-25' }]) {
    const r = buildPackages(req);
    assert.equal(r.status, 'NO_PACKAGE');
    assert.match(r.reasons[0], /^Flights and rooms are only available from 1 to 20 April 2027/);
    assert.deepEqual(r.errors, {});
    assert.equal(r.cheapest_total, null);
    assert.deepEqual(r.packages, []);
  }
});

test('NO_PACKAGE: specific reasons (arrival seats, return flight, hotel rooms)', () => {
  const crowd = buildPackages({ ...MENON, adults: 10, childAges: [] }); // no flight has more than 9 seats
  assert.equal(crowd.status, 'NO_PACKAGE');
  assert.ok(crowd.reasons.some((x) => /^No flight from BLR lands in Japan .* on 2027-04-10 with 10 free seats/.test(x)));

  // MAA → Japan 1–7 April: no plan has both an arrival and a return flight.
  const noReturn = buildPackages({ ...MENON, departureAirport: 'MAA', startDate: '2027-04-01', adults: 1, childAges: [] });
  assert.equal(noReturn.status, 'NO_PACKAGE');
  assert.ok(noReturn.reasons.some((x) => /^No return flight to MAA leaves Japan .* on 2027-04-07/.test(x)));

  // Our own bookings take every room of every type on every night → no hotel.
  const rooms = {};
  for (const a of availability) rooms[`${a.room_id}|${a.date}`] = a.rooms_left;
  const full = buildPackages(MENON, { booked: { flights: {}, rooms } });
  assert.equal(full.status, 'NO_PACKAGE');
  assert.ok(full.reasons.every((x) => /^No hotel room for 2 adult\(s\) \+ 1 child\(ren\) in /.test(x)));
});

test('OK: Menon within budget → cheapest + fastest/best rated, all ≤ budget, labels, metrics, left_inr', () => {
  const r = buildPackages(MENON);
  assert.equal(r.status, 'OK');
  assert.equal(r.over_by, 0);
  assert.equal(r.packages[0].label, 'cheapest');
  assert.equal(r.cheapest_total, r.packages[0].total_inr);
  const sigs = r.packages.map((p) => p.items.map((i) => `${i.catalog_id}|${i.start}`).join());
  assert.equal(new Set(sigs).size, sigs.length, 'no identical packages');
  for (const p of r.packages) {
    assert.ok(['cheapest', 'fastest', 'best_rated'].includes(p.label));
    assert.ok(p.total_inr <= MENON.budgetInr);
    assert.equal(p.left_inr, MENON.budgetInr - p.total_inr);
    assert.ok(Number.isInteger(p.metrics.travel_minutes) && typeof p.metrics.avg_stars === 'number');
    assert.deepEqual(validatePackage(p), [], p.label);
  }
});

test('OVER_BUDGET: Menon with budget 150000 → cheapest package, over_by, up to 3 checked suggestions', () => {
  const req = { ...MENON, budgetInr: 150000 };
  const r = buildPackages(req);
  assert.equal(r.status, 'OVER_BUDGET');
  assert.equal(r.packages.length, 1);
  const [pkg] = r.packages;
  assert.equal(pkg.label, 'cheapest');
  assert.equal(r.cheapest_total, pkg.total_inr);
  assert.equal(r.cheapest_total, buildPackages(MENON).cheapest_total, 'same true cheapest as with a big budget');
  assert.equal(r.over_by, pkg.total_inr - 150000);
  assert.ok(r.over_by > 0);
  assert.equal(pkg.left_inr, 150000 - pkg.total_inr);
  assert.ok(pkg.metrics.travel_minutes > 0 && pkg.metrics.avg_stars > 0);
  assert.deepEqual(checkRules(pkg, req), []);
  assert.deepEqual(validatePackage(pkg), []);

  assert.ok(r.suggestions.length >= 1 && r.suggestions.length <= 3);
  const found = suggestVariations(req, undefined, cheapestTotal);
  assert.deepEqual(r.suggestions, found.map((v) => describe(v, req)));
  for (const v of found) {
    const again = buildPackages(v.request);
    assert.equal(again.cheapest_total, v.total, `${v.kind} total re-checked`);
    assert.equal(v.fits, v.total <= 150000);
  }
  console.log(`\nMenon at ₹1,50,000: cheapest ${inr(r.cheapest_total)}, over by ${inr(r.over_by)}\n  ` +
    `${r.suggestions.join('\n  ')}\n`);
});

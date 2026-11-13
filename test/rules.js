// Rule checker shared by the tests: re-checks every problem §4 rule of a package straight from data/catalog,
// independent of the engine's own choices. A helper module (no tests), so importing it runs nothing.
import {
  flightById, hotelById, roomById, transferById, attractionById, airportsServing, roomsLeft,
} from '../src/engine/catalog.js';
import { addDays, addMinutes, inWindow, weekday } from '../src/engine/time.js';

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


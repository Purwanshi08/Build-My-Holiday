// Package ⇄ parts for change.js: turns a package back into the builder's pieces (request, flights, stays, transfer
// legs, visits) and reassembles them, keeping the package id, label, status and stable item ids (CONTRACT §2).
import { flightById, hotelById, roomById, transferById, attractionById } from './catalog.js';
import { hotelPrice, transferPrice, attractionPrice } from './pricing.js';
import { makeContext, assemble } from './build.js';

/** The build request a package was made from (same fields as CONTRACT §1). */
export function requestOf(pkg) {
  return {
    departureAirport: pkg.traveler.home_airport,
    country: pkg.country,
    startDate: pkg.start_date,
    nights: pkg.plan.reduce((t, p) => t + p.nights, 0),
    adults: pkg.traveler.adults,
    childAges: [...pkg.traveler.child_ages],
    budgetInr: pkg.budget_inr,
  };
}

/** A transfer item as a builder leg { t, start, end, id, duration, price } with the price recomputed. */
export function legOf(c, it) {
  const t = transferById.get(it.catalog_id);
  if (!t) throw new Error(`unknown transfer ${it.catalog_id}`);
  return {
    t, start: it.start, end: it.end, id: t.transfer_id, duration: t.duration_minutes,
    price: transferPrice(t, c.adults, c.children),
  };
}

/** Package → { c, plan, out, ret, stays, moves, visits }. Fresh objects: changing them never touches `pkg`. */
export function decompose(pkg, ctx) {
  const req = requestOf(pkg);
  const c = makeContext(req, ctx);
  const of = (type) => pkg.items.filter((i) => i.type === type).sort((a, b) => a.start.localeCompare(b.start));
  const flights = of('flight').map((i) => flightById.get(i.catalog_id));
  const out = flights.find((f) => f?.from === req.departureAirport);
  const ret = flights.find((f) => f?.to === req.departureAirport);
  if (!out || !ret) throw new Error('it needs an arrival and a return flight');

  const transfers = of('transfer');
  const airport = transfers.filter((i) => transferById.get(i.catalog_id)?.airport);
  if (airport.length !== 2) throw new Error('it needs exactly two airport transfers');
  const moves = transfers.filter((i) => transferById.get(i.catalog_id)?.from_city).map((i) => legOf(c, i));

  const stays = pkg.plan.map((p) => {
    const room = roomById.get(p.room_id);
    return {
      city: p.city, nights: p.nights, checkIn: p.check_in, checkOut: p.check_out,
      hotel: hotelById.get(p.hotel_id), room, k: p.rooms, price: hotelPrice(room, p.rooms, p.nights),
      arrive: null, depart: null,
    };
  });
  stays[0].arrive = legOf(c, airport[0]);
  stays.at(-1).depart = legOf(c, airport[1]);

  const visits = of('attraction').map((i) => {
    const attraction = attractionById.get(i.catalog_id);
    return {
      attraction, date: i.start.slice(0, 10), start: i.start, end: i.end,
      price: attractionPrice(attraction, c.adults, c.children),
    };
  });
  return { c, plan: pkg.plan.map(({ city, nights }) => ({ city, nights })), out, ret, stays, moves, visits };
}

const itemKey = (it) => `${it.type}|${it.catalog_id}|${it.room_id}`;

/**
 * Give a rebuilt package the old package's identity: same id/trip_id/label/status, and each item keeps the
 * item_id of the old item with the same type + catalog record (+ room); new items get ids after the highest.
 */
export function carryOver(old, pkg) {
  const pool = new Map();
  let next = 1;
  for (const it of old.items) {
    if (!pool.has(itemKey(it))) pool.set(itemKey(it), []);
    pool.get(itemKey(it)).push(it.item_id);
    const n = /^i(\d+)$/.exec(it.item_id);
    if (n) next = Math.max(next, Number(n[1]) + 1);
  }
  for (const it of pkg.items) it.item_id = pool.get(itemKey(it))?.shift() ?? `i${next++}`;
  return { ...pkg, id: old.id, trip_id: old.trip_id, label: old.label, status: old.status };
}

/** Parts → package carrying the old package's identity. */
export function recompose(old, { c, plan, out, ret, stays, moves, visits }) {
  return carryOver(old, assemble(c, plan, out, ret, stays, moves, visits));
}

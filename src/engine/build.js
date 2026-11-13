// Real buildPackages (docs/CONTRACT.md §4): enumerates city plans × flight pairs, picks hotels, transfers and
// attractions layer by layer (cheap / quick / rated), builds trip-format packages and returns the best ones.
import { randomUUID } from 'node:crypto';
import {
  destinations, hotelsInCity, roomsOfHotel, roomsLeft, airportTransfers, intercityTransfers,
} from './catalog.js';
import { addDays, toMinutes } from './time.js';
import {
  flightPrice, hotelPrice, minRooms, transferPrice, transferQuantity,
} from './pricing.js';
import { validateRequest, windowReason } from './request.js';
import { cityPlans, flightPairs, outboundFlights, returnFlights } from './plans.js';
import {
  arrivalPickup, departurePickup, intercityDeparture, planAttractions, GAP_MINUTES,
} from './schedule.js';

// TODO(Person B, validate.js): this hook wires validatePackage in automatically as soon as
// src/engine/validate.js is pulled. Until then candidates are trusted as built (no extra check).
let validatePackage = null;
try {
  ({ validatePackage } = await import('./validate.js'));
} catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND' || !String(e.message).includes('validate.js')) throw e;
}

const STRATEGIES = ['cheap', 'quick', 'rated'];
const TYPE_ORDER = { flight: 0, transfer: 1, hotel: 2, attraction: 3 };
const inr = (n) => `₹${n.toLocaleString('en-IN')}`;
const local = (catalogDateTime) => catalogDateTime.slice(0, 16);
const byPriceThen = (x, y) => x.price - y.price || x.duration - y.duration || x.id.localeCompare(y.id);

// ---- per-request context ---------------------------------------------------------------------------

function makeContext(req, ctx) {
  const adults = req.adults;
  const children = req.childAges.length;
  return {
    req, ctx, adults, children, travelers: adults + children,
    end: addDays(req.startDate, req.nights),
    homeCity: destinations.departure_cities.find((d) => d.airport === req.departureAirport).city,
    memo: new Map(),
  };
}

function memo(c, key, fn) {
  if (!c.memo.has(key)) c.memo.set(key, fn());
  return c.memo.get(key);
}

// ---- layers ----------------------------------------------------------------------------------------

/** Hotel + room type options in a city for nights checkIn … checkIn+nights−1 (k rooms, availability − ctx). */
function hotelOptions(c, city, checkIn, nights) {
  return memo(c, `H|${city}|${checkIn}|${nights}`, () => {
    const out = [];
    const nightDates = Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
    for (const hotel of hotelsInCity(city)) {
      for (const room of roomsOfHotel(hotel.hotel_id)) {
        const k = minRooms(room, c.adults, c.children);
        if (k === null) continue;
        const free = (d) => roomsLeft(room.room_id, d) - (c.ctx?.booked?.rooms?.[`${room.room_id}|${d}`] ?? 0);
        if (!nightDates.every((d) => free(d) >= k)) continue;
        out.push({ hotel, room, k, price: hotelPrice(room, k, nights) });
      }
    }
    return out;
  });
}

/** Cheapest airport transfer for a hotel ('arrive' after landing / 'depart' before departure), or null. */
function airportLeg(c, dir, airport, hotel, flightTime) {
  return memo(c, `A|${dir}|${airport}|${hotel.city}|${hotel.area}|${flightTime}`, () => {
    const legs = [];
    for (const t of airportTransfers(airport, hotel.city, hotel.area)) {
      const time = dir === 'arrive' ? arrivalPickup(t, flightTime) : departurePickup(t, flightTime);
      if (!time) continue;
      legs.push({ t, ...time, id: t.transfer_id, duration: t.duration_minutes,
        price: transferPrice(t, c.adults, c.children) });
    }
    return legs.sort(byPriceThen)[0] ?? null;
  });
}

/** Intercity transfer on a change day: cheapest (cheap/rated) or shortest (quick). */
function intercityLeg(c, from, to, date, strategy) {
  const legs = intercityTransfers(from, to).map((t) => ({
    t, ...intercityDeparture(t, date), id: t.transfer_id, duration: t.duration_minutes,
    price: transferPrice(t, c.adults, c.children),
  }));
  const quick = (x, y) => x.duration - y.duration || x.price - y.price || x.id.localeCompare(y.id);
  return legs.sort(strategy === 'quick' ? quick : byPriceThen)[0] ?? null;
}

// ---- one candidate ---------------------------------------------------------------------------------

/** Build one package for (plan, flight pair, strategy) or return { fail: { stage, reason } }. */
function buildCandidate(c, plan, { out, ret }, strategy) {
  const landing = local(out.arrival_local);
  const departure = local(ret.departure_local);
  const last = plan.length - 1;
  const stays = [];
  let checkIn = c.req.startDate;
  for (const [i, { city, nights }] of plan.entries()) {
    const options = hotelOptions(c, city, checkIn, nights);
    if (options.length === 0) {
      const who = `${c.adults} adult(s)${c.children ? ` + ${c.children} child(ren)` : ''}`;
      return { fail: { stage: 2, reason: `No hotel room for ${who} in ${city} on every night from ${checkIn}.` } };
    }
    let best = null;
    for (const o of options) {
      const arrive = i === 0 ? airportLeg(c, 'arrive', out.to, o.hotel, landing) : null;
      const depart = i === last ? airportLeg(c, 'depart', ret.from, o.hotel, departure) : null;
      if ((i === 0 && !arrive) || (i === last && !depart)) continue;
      const cost = o.price + (arrive?.price ?? 0) + (depart?.price ?? 0);
      const cand = { ...o, arrive, depart, cost };
      const better = !best ||
        (strategy === 'rated' && cand.hotel.stars !== best.hotel.stars
          ? cand.hotel.stars > best.hotel.stars
          : cost < best.cost || (cost === best.cost && o.room.room_id < best.room.room_id));
      if (better) best = cand;
    }
    if (!best) {
      return { fail: { stage: 3, reason: `No airport transfer in ${city} fits the flight times (pickup ≥ 60 min after ` +
        'landing, at the airport ≥ 180 min before departure, inside service hours).' } };
    }
    stays.push({ city, nights, checkIn, checkOut: addDays(checkIn, nights), ...best });
    checkIn = addDays(checkIn, nights);
  }

  const moves = [];
  for (let i = 1; i < stays.length; i++) {
    const leg = intercityLeg(c, stays[i - 1].city, stays[i].city, stays[i].checkIn, strategy);
    if (!leg) return { fail: { stage: 4, reason: `No transfer from ${stays[i - 1].city} to ${stays[i].city}.` } };
    moves.push(leg);
  }

  // Attraction days: arrival day and change days are optional (after reaching the city), last day none.
  const days = [];
  for (const [i, s] of stays.entries()) {
    const reached = i === 0 ? s.arrive.end : moves[i - 1].end;
    for (let n = 0; n < s.nights; n++) {
      const date = addDays(s.checkIn, n);
      if (n > 0) {
        days.push({ date, city: s.city, full: true });
      } else if (reached.slice(0, 10) === date) {
        days.push({ date, city: s.city, full: false, earliest: toMinutes(reached.slice(11, 16)) + GAP_MINUTES });
      }
    }
  }
  const { visits, failedDate } = planAttractions(days, c.adults, c.children);
  if (failedDate) {
    const city = days.find((d) => d.date === failedDate).city;
    return { fail: { stage: 5, reason: `No attraction left for the full day ${failedDate} in ${city} ` +
      '(each full day needs one, each attraction can be used once, and it must be open that day).' } };
  }
  return { pkg: assemble(c, plan, out, ret, stays, moves, visits) };
}

// ---- items and package -----------------------------------------------------------------------------

function item(type, fields, sortKey) {
  return {
    sortKey, item_id: null, type, status: 'PLANNED', room_id: null, booking: null, sources: [], warnings: [],
    ...fields,
  };
}

function transferItem(c, leg, city) {
  return item('transfer', {
    name: leg.t.name, city, catalog_id: leg.t.transfer_id, start: leg.start, end: leg.end,
    quantity: transferQuantity(leg.t, c.adults, c.children), price_inr: leg.price,
  }, leg.start);
}

function flightItem(c, f, city) {
  return item('flight', {
    name: `${f.flight_number} ${f.from} to ${f.to}`, city, catalog_id: f.flight_id,
    start: local(f.departure_local), end: local(f.arrival_local),
    quantity: c.travelers, price_inr: flightPrice(f, c.travelers),
  }, local(f.departure_local));
}

function assemble(c, plan, out, ret, stays, moves, visits) {
  const first = stays[0];
  const lastStay = stays.at(-1);
  const items = [
    flightItem(c, out, first.city),
    transferItem(c, first.arrive, first.city),
    ...stays.map((s, i) => item('hotel', {
      name: s.hotel.name, city: s.city, catalog_id: s.hotel.hotel_id, room_id: s.room.room_id,
      start: s.checkIn, end: s.checkOut, quantity: s.k, price_inr: s.price,
    }, i === 0 ? first.arrive.end : moves[i - 1].end)),
    ...moves.map((m) => transferItem(c, m, m.t.to_city)),
    ...visits.map((v) => item('attraction', {
      name: v.attraction.name, city: v.attraction.city, catalog_id: v.attraction.attraction_id,
      start: v.start, end: v.end, quantity: c.travelers, price_inr: v.price,
    }, v.start)),
    transferItem(c, lastStay.depart, lastStay.city),
    flightItem(c, ret, c.homeCity),
  ];
  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
  items.forEach((it, i) => {
    it.item_id = `i${i + 1}`;
    delete it.sortKey;
  });

  const total = items.reduce((t, it) => t + it.price_inr, 0);
  const starNights = stays.reduce((t, s) => t + s.hotel.stars * s.nights, 0);
  const id = `pkg-${randomUUID()}`;
  return {
    id, label: null, trip_id: id,
    traveler: {
      name: 'Traveler', home_airport: c.req.departureAirport, adults: c.adults, children: c.children,
      child_ages: [...c.req.childAges],
    },
    start_date: c.req.startDate, end_date: c.end, country: c.req.country, budget_inr: c.req.budgetInr,
    total_inr: total, left_inr: c.req.budgetInr - total, status: 'PLANNED',
    metrics: {
      travel_minutes: out.duration_minutes + ret.duration_minutes + moves.reduce((t, m) => t + m.duration, 0),
      avg_stars: Math.round((starNights / c.req.nights) * 100) / 100,
    },
    plan: stays.map((s) => ({
      city: s.city, nights: s.nights, check_in: s.checkIn, check_out: s.checkOut,
      hotel_id: s.hotel.hotel_id, room_id: s.room.room_id, rooms: s.k,
    })),
    items,
  };
}

// ---- search ----------------------------------------------------------------------------------------

/** Every candidate package for a (valid, in-window) request, plus the reasons of the furthest failures. */
export function searchCandidates(req, ctx) {
  const c = makeContext(req, ctx);
  const plans = cityPlans(req.country, req.nights);
  const packages = [];
  let furthest = { stage: 0, reasons: new Set() };
  const fail = ({ stage, reason }) => {
    if (stage > furthest.stage) furthest = { stage, reasons: new Set() };
    if (stage === furthest.stage) furthest.reasons.add(reason);
  };
  for (const plan of plans) {
    const pairs = flightPairs(req, plan, ctx);
    if (pairs.length === 0) {
      fail({ stage: 1, reason: flightReason(c, plan) });
      continue;
    }
    for (const pair of pairs) {
      for (const strategy of STRATEGIES) {
        const r = buildCandidate(c, plan, pair, strategy);
        if (r.pkg) packages.push(r.pkg);
        else fail(r.fail);
      }
    }
  }
  if (plans.length === 0) fail({ stage: 0, reason: `No city plan fits ${req.nights} nights in ${req.country}.` });
  return { packages, reasons: [...furthest.reasons] };
}

function flightReason(c, plan) {
  const { departureAirport: home, startDate, country } = c.req;
  if (outboundFlights(home, plan[0].city, startDate, c.travelers, c.ctx).length === 0) {
    return `No flight from ${home} lands in ${country} (${plan[0].city}) on ${startDate} with ` +
      `${c.travelers} free seats.`;
  }
  return `No return flight to ${home} leaves ${country} (${plan.at(-1).city}) on ${c.end} with ` +
    `${c.travelers} free seats.`;
}

const signature = (pkg) => pkg.items.map((i) => `${i.catalog_id}|${i.room_id}|${i.start}`).join(',');

/**
 * Best package in `ranked` that passes validatePackage (when present). If that best one is the same trip
 * as a package already chosen, the label adds nothing and null is returned (we never offer a worse twin).
 */
function pick(ranked, chosen, ctx, checked) {
  for (const pkg of ranked) {
    if (validatePackage) {
      if (!checked.has(pkg)) checked.set(pkg, validatePackage(pkg, ctx).length === 0);
      if (!checked.get(pkg)) continue;
    }
    return chosen.some((p) => signature(p) === signature(pkg)) ? null : pkg;
  }
  return null;
}

// ---- contract entry point --------------------------------------------------------------------------

const result = (o) => ({
  status: 'OK', packages: [], cheapest_total: null, over_by: 0, suggestions: [], reasons: [], errors: {}, ...o,
});

export function buildPackages(req, ctx) {
  const errors = validateRequest(req);
  if (Object.keys(errors).length) return result({ status: 'INVALID_REQUEST', errors });
  const outside = windowReason(req);
  if (outside) return result({ status: 'NO_PACKAGE', reasons: [outside] });

  const { packages, reasons } = searchCandidates(req, ctx);
  const checked = new Map();
  const byTotal = [...packages].sort((a, b) => a.total_inr - b.total_inr);
  const cheapest = pick(byTotal, [], ctx, checked);
  if (!cheapest) {
    return result({
      status: 'NO_PACKAGE',
      reasons: reasons.length ? reasons : ['No candidate package passed the rule check.'],
    });
  }
  if (cheapest.total_inr > req.budgetInr) {
    return result({
      status: 'OVER_BUDGET', cheapest_total: cheapest.total_inr, over_by: cheapest.total_inr - req.budgetInr,
      suggestions: overBudgetSuggestions(req, ctx, cheapest.total_inr),
    });
  }

  const inBudget = byTotal.filter((p) => p.total_inr <= req.budgetInr);
  const chosen = [{ ...cheapest, label: 'cheapest' }];
  const fastest = pick(
    [...inBudget].sort((a, b) => a.metrics.travel_minutes - b.metrics.travel_minutes || a.total_inr - b.total_inr),
    chosen, ctx, checked,
  );
  if (fastest) chosen.push({ ...fastest, label: 'fastest' });
  const rated = pick(
    [...inBudget].sort((a, b) => b.metrics.avg_stars - a.metrics.avg_stars || a.total_inr - b.total_inr),
    chosen, ctx, checked,
  );
  if (rated) chosen.push({ ...rated, label: 'best_rated' });
  return result({ packages: chosen, cheapest_total: cheapest.total_inr });
}

/** "Raise the budget" plus the longest shorter trip (same start) that fits the budget, if any. */
function overBudgetSuggestions(req, ctx, cheapestTotal) {
  const out = [`Raise the budget to at least ${inr(cheapestTotal)}.`];
  for (let n = req.nights - 1; n >= destinations.rules.min_nights; n--) {
    const totals = searchCandidates({ ...req, nights: n }, ctx).packages.map((p) => p.total_inr);
    const min = totals.length ? Math.min(...totals) : null;
    if (min !== null && min <= req.budgetInr) {
      out.push(`Try ${n} nights (from ${inr(min)}).`);
      break;
    }
  }
  return out;
}

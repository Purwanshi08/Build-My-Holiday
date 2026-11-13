// applyChange and getOptions (docs/CONTRACT.md §4): every change works on fresh parts of the package, re-picks the
// items it affects (airport transfers, attraction times), reprices, runs validatePackage, and refuses on any rule.
import {
  flightById, hotelById, roomById, attractionById, hotelsInCity, roomsOfHotel, roomsLeft, airportsServing,
  attractionsInCity, flightsArriving, flightsDeparting,
} from './catalog.js';
import { addDays, addMinutes, toMinutes, fromMinutes, weekday } from './time.js';
import { hotelPrice, minRooms } from './pricing.js';
import { airportLeg, attractionDays, buildCandidate, local } from './build.js';
import { cityPlans, flightPairs, seatsFree } from './plans.js';
import {
  arrivalPickup, departurePickup, fitVisit, openOn, optionsFor, DAY_START, DAY_END, GAP_MINUTES,
} from './schedule.js';
import { attractionPrice } from './pricing.js';
import { decompose, recompose, carryOver } from './parts.js';
import { validatePackage } from './validate.js';

const inr = (n) => `₹${Math.abs(n).toLocaleString('en-IN')}`;
const clock = (dt) => dt.slice(11, 16);
const at = (date, minutes) => addMinutes(`${date}T00:00`, minutes);
/** Minutes since midnight of `date` for a date-time on that date (or 24:00 + … on the next day). */
const minutesOn = (date, dt) => toMinutes(clock(dt)) + (dt.slice(0, 10) > date ? 1440 : 0);
const who = (c) => `${c.adults} adult(s)${c.children ? ` + ${c.children} child(ren)` : ''}`;
const planKey = (plan) => plan.map((p) => `${p.city}:${p.nights}`).join('|');
const planText = (plan) => plan.map((p) => `${p.city} ${p.nights} night${p.nights === 1 ? '' : 's'}`).join(' → ');

// ---- dependent items -------------------------------------------------------------------------------

/**
 * Keep the airport transfer if it still serves the airport and hotel (re-timed if needed); otherwise switch to
 * the cheapest one that fits. Returns a refusal reason or null; adds warnings for anything adjusted.
 */
function refitAirport(parts, dir, warnings) {
  const { c, out, ret, stays } = parts;
  const stay = dir === 'arrive' ? stays[0] : stays.at(-1);
  const airport = dir === 'arrive' ? out.to : ret.from;
  const flightTime = local(dir === 'arrive' ? out.arrival_local : ret.departure_local);
  const what = dir === 'arrive' ? 'Arrival airport transfer' : 'Return airport transfer';
  const cur = stay[dir];
  const t = cur.t;
  if (t.airport === airport && t.city === stay.hotel.city && (t.area === null || t.area === stay.hotel.area)) {
    const time = dir === 'arrive' ? arrivalPickup(t, flightTime) : departurePickup(t, flightTime);
    if (time) {
      if (time.start !== cur.start) {
        warnings.push(`${what} "${t.name}" re-timed: pickup ${time.start.replace('T', ' ')} (was ${cur.start.replace('T', ' ')}).`);
      }
      stay[dir] = { ...cur, ...time };
      return null;
    }
  }
  const best = airportLeg(c, dir, airport, stay.hotel, flightTime);
  if (!best) {
    return `No airport transfer between ${airport} and ${stay.hotel.name} (${stay.hotel.area}) fits the flight ` +
      'times (pickup ≥ 60 min after landing, at the airport ≥ 180 min before departure, inside service hours).';
  }
  warnings.push(`${what} changed from "${t.name}" to "${best.t.name}" (pickup ${best.start.replace('T', ' ')}).`);
  stay[dir] = best;
  return null;
}

/**
 * Re-check every visit against the (possibly new) arrival times: keep it, push it later on the same day, or drop
 * it; then give any full day left without a visit the cheapest one that fits. Returns a refusal reason or null.
 */
function refitVisits(parts, warnings) {
  const { c } = parts;
  const days = new Map(attractionDays(parts.stays, parts.moves).map((d) => [d.date, d]));
  const kept = [];
  for (const v of [...parts.visits].sort((x, y) => x.start.localeCompare(y.start))) {
    const a = v.attraction;
    const day = days.get(v.date);
    let why = null;
    if (!day) why = 'the traveler is not in the city with free time that day';
    else if (day.city !== a.city) why = `the night of ${v.date} is now in ${day.city}`;
    else if (!openOn(a, v.date)) why = `it is closed that day`;
    if (!why) {
      const prev = kept.filter((k) => k.date === v.date).at(-1);
      const lower = Math.max(minutesOn(v.date, v.start), day.earliest ?? 0, prev ? minutesOn(v.date, prev.end) : 0);
      const slot = fitVisit(a, lower, 1440);
      if (slot) {
        const start = at(v.date, slot.start);
        if (start !== v.start) {
          warnings.push(`"${a.name}" on ${v.date} moved to ${clock(start)} (was ${clock(v.start)}) to start after the traveler arrives.`);
        }
        kept.push({ ...v, start, end: at(v.date, slot.end) });
        continue;
      }
      why = 'it no longer fits inside its opening hours after the traveler arrives';
    }
    warnings.push(`"${a.name}" on ${v.date} was removed: ${why}.`);
  }
  const used = new Set(kept.map((v) => v.attraction.attraction_id));
  for (const day of days.values()) {
    if (!day.full || kept.some((v) => v.date === day.date)) continue;
    const cursor = day.earliest ?? toMinutes(DAY_START);
    const pick = optionsFor(day, c.adults, c.children)
      .map((o) => ({ ...o, slot: used.has(o.a.attraction_id) ? null : fitVisit(o.a, cursor, toMinutes(DAY_END)) }))
      .find((o) => o.slot);
    if (!pick) return `No attraction can be planned on the full day ${day.date} in ${day.city}.`;
    used.add(pick.a.attraction_id);
    kept.push({
      attraction: pick.a, date: day.date, price: pick.price,
      start: at(day.date, pick.slot.start), end: at(day.date, pick.slot.end),
    });
    warnings.push(`"${pick.a.name}" added on ${day.date} at ${fromMinutes(pick.slot.start)} so every full day keeps an attraction.`);
  }
  parts.visits = kept.sort((x, y) => x.start.localeCompare(y.start));
  return null;
}

/** Earliest slot for `a` on `day` that keeps clear of `dayVisits` (30-min gap preferred, else just no overlap). */
function freeSlot(a, day, dayVisits) {
  const busy = dayVisits.map((v) => [minutesOn(day.date, v.start), minutesOn(day.date, v.end)]);
  const lowers = [Math.max(day.earliest ?? 0, toMinutes(DAY_START)), day.earliest ?? 0];
  for (const gap of [GAP_MINUTES, 0]) {
    for (const lower of lowers) {
      const starts = [lower, ...busy.map(([, e]) => e + gap)].filter((s) => s >= lower).sort((x, y) => x - y);
      for (const s of starts) {
        const slot = fitVisit(a, s, 1440);
        if (slot && busy.every(([bs, be]) => slot.end + gap <= bs || slot.start >= be + gap)) return slot;
      }
    }
  }
  return null;
}

/** How set_city_plan rebuilds each kind of package (by its label), and which rebuilt package wins. */
const REBUILD = {
  cheapest: { strategy: 'cheap', how: 'the cheapest hotels', better: (a, b) => a.total_inr < b.total_inr },
  fastest: {
    strategy: 'quick', how: 'the shortest travel',
    better: (a, b) => a.metrics.travel_minutes - b.metrics.travel_minutes < 0 ||
      (a.metrics.travel_minutes === b.metrics.travel_minutes && a.total_inr < b.total_inr),
  },
  best_rated: {
    strategy: 'rated', how: 'the highest-star hotels',
    better: (a, b) => a.metrics.avg_stars > b.metrics.avg_stars ||
      (a.metrics.avg_stars === b.metrics.avg_stars && a.total_inr < b.total_inr),
  },
};

// ---- change handlers: return { refuse: [...] } or { touched: [...] } / { built } ---------------------------

const HANDLERS = {
  swap_hotel(parts, ch) {
    const { c } = parts;
    const i = parts.stays.findIndex((s) => s.city === ch.city);
    if (i < 0) return { refuse: [`This package has no stay in ${ch.city}.`] };
    const hotel = hotelById.get(ch.hotel_id);
    if (!hotel || hotel.city !== ch.city) return { refuse: [`${ch.hotel_id} is not a hotel in ${ch.city}.`] };
    const room = roomById.get(ch.room_id);
    if (!room || room.hotel_id !== hotel.hotel_id) return { refuse: [`${ch.room_id} is not a room type of ${hotel.name}.`] };
    const s = parts.stays[i];
    const k = minRooms(room, c.adults, c.children);
    if (k === null) {
      return { refuse: [`${room.name} at ${hotel.name} cannot fit ${who(c)} (every room needs an adult).`] };
    }
    for (let n = 0; n < s.nights; n++) {
      const d = addDays(s.checkIn, n);
      const free = roomsLeft(room.room_id, d) - (c.ctx?.booked?.rooms?.[`${room.room_id}|${d}`] ?? 0);
      if (free < k) {
        return { refuse: [`${hotel.name} — ${room.name}: ${Math.max(free, 0)} room(s) left on ${d}, ${k} needed.`] };
      }
    }
    parts.stays[i] = { ...s, hotel, room, k, price: hotelPrice(room, k, s.nights) };
    return { touched: ['airport', 'visits'] };
  },

  swap_flight(parts, ch) {
    const { c } = parts;
    const f = flightById.get(ch.flight_id);
    if (!f) return { refuse: [`Unknown flight ${ch.flight_id}.`] };
    const home = c.req.departureAirport;
    const first = parts.stays[0].city;
    const last = parts.stays.at(-1).city;
    const refuse = [];
    if (ch.direction === 'outbound') {
      if (f.from !== home) refuse.push(`${f.flight_number} does not leave from ${home}.`);
      if (!airportsServing(first).includes(f.to)) refuse.push(`${f.to} does not serve ${first}, the first city.`);
      if (f.arrival_local.slice(0, 10) !== c.req.startDate) {
        refuse.push(`${f.flight_number} lands on ${f.arrival_local.slice(0, 10)}, not on the start date ${c.req.startDate}.`);
      }
    } else if (ch.direction === 'return') {
      if (f.to !== home) refuse.push(`${f.flight_number} does not fly to ${home}.`);
      if (!airportsServing(last).includes(f.from)) refuse.push(`${f.from} does not serve ${last}, the last city.`);
      if (f.departure_local.slice(0, 10) !== c.end) {
        refuse.push(`${f.flight_number} leaves on ${f.departure_local.slice(0, 10)}, not on the last day ${c.end}.`);
      }
    } else {
      return { refuse: ['direction must be "outbound" or "return".'] };
    }
    const free = seatsFree(f, c.ctx);
    if (free < c.travelers) refuse.push(`Only ${Math.max(free, 0)} seat(s) left on ${f.flight_number}; ${c.travelers} travelers.`);
    if (refuse.length) return { refuse };
    if (ch.direction === 'outbound') parts.out = f;
    else parts.ret = f;
    return { touched: ['airport', 'visits'] };
  },

  add_attraction(parts, ch) {
    const { c } = parts;
    const a = attractionById.get(ch.attraction_id);
    if (!a) return { refuse: [`Unknown attraction ${ch.attraction_id}.`] };
    if (parts.visits.some((v) => v.attraction.attraction_id === a.attraction_id)) {
      return { refuse: [`${a.name} is already in the package.`] };
    }
    const day = attractionDays(parts.stays, parts.moves).find((d) => d.date === ch.date);
    if (!day) {
      return { refuse: [`No attractions can be planned on ${ch.date} (outside the stay, the last day, or before arriving).`] };
    }
    if (a.city !== day.city) return { refuse: [`${a.name} is in ${a.city}, but the night of ${ch.date} is in ${day.city}.`] };
    if (!a.open_days.includes(weekday(ch.date))) return { refuse: [`${a.name} is closed on ${weekday(ch.date)}.`] };
    if ((a.closed_dates ?? []).includes(ch.date)) return { refuse: [`${a.name} is closed on ${ch.date}.`] };
    const dayVisits = parts.visits.filter((v) => v.date === ch.date);
    if (day.full && dayVisits.length >= 2) {
      return { refuse: [`${ch.date} already has 2 attractions (the most for a full day).`] };
    }
    const slot = freeSlot(a, day, dayVisits);
    if (!slot) {
      return { refuse: [`No free time for ${a.name} on ${ch.date} inside its opening hours ` +
        `(${a.open_from}–${a.open_until}, ${a.visit_minutes} min) without overlapping other visits.`] };
    }
    parts.visits.push({
      attraction: a, date: ch.date, price: attractionPrice(a, c.adults, c.children),
      start: at(ch.date, slot.start), end: at(ch.date, slot.end),
    });
    return { touched: ['visits'] };
  },

  remove_attraction(parts, ch, pkg) {
    const it = pkg.items.find((i) => i.item_id === ch.item_id);
    if (!it || it.type !== 'attraction') return { refuse: [`${ch.item_id} is not an attraction in this package.`] };
    const date = it.start.slice(0, 10);
    const day = attractionDays(parts.stays, parts.moves).find((d) => d.date === date);
    const sameDay = parts.visits.filter((v) => v.date === date);
    if (day?.full && sameDay.length <= 1) {
      return { refuse: [`${it.name} is the only attraction on ${date}, and every full day needs at least one.`] };
    }
    parts.visits = parts.visits.filter((v) => v.attraction.attraction_id !== it.catalog_id);
    return { touched: [] };
  },

  set_city_plan(parts, ch, pkg) {
    const { c } = parts;
    const want = Array.isArray(ch.cities) ? ch.cities.map((x) => ({ city: x?.city, nights: x?.nights })) : [];
    const plan = cityPlans(c.req.country, c.req.nights).find((p) => planKey(p) === planKey(want));
    if (!plan) {
      const sum = want.reduce((t, x) => t + (Number.isInteger(x.nights) ? x.nights : 0), 0);
      return { refuse: [sum !== c.req.nights
        ? `The nights must add up to ${c.req.nights} (got ${sum}).`
        : `Not a valid city plan for ${c.req.country}: each city once, at least 2 nights each, and a ` +
          'transfer link between consecutive cities.'] };
    }
    const pairs = flightPairs(c.req, plan, c.ctx);
    if (pairs.length === 0) {
      return { refuse: [`No flights fit ${planText(plan)}: none lands on ${c.req.startDate} near ${plan[0].city} ` +
        `and returns on ${c.end} from near ${plan.at(-1).city} with ${c.travelers} free seats.`] };
    }
    // Rebuild in the package's own character: best rated keeps the highest-star hotels, fastest the shortest
    // travel, everything else the cheapest. Keep the current flights when they fit (unless fastest, where the
    // flights are part of what is being optimised).
    const { strategy, better, how } = REBUILD[pkg.label] ?? REBUILD.cheapest;
    const same = pairs.find((p) => p.out.flight_id === parts.out.flight_id && p.ret.flight_id === parts.ret.flight_id);
    const failures = new Set();
    const bestOf = (list) => {
      let built = null;
      for (const pair of list) {
        const r = buildCandidate(c, plan, pair, strategy);
        if (r.fail) failures.add(r.fail.reason);
        else if (!built || better(r.pkg, built)) built = r.pkg;
      }
      return built;
    };
    const built = (same && strategy !== 'quick' ? bestOf([same]) : null) ?? bestOf(pairs);
    if (!built) return { refuse: [...failures] };
    const warnings = [`Rebuilt for ${planText(plan)} with ${how}: hotels, transfers and attractions were chosen again.`];
    const flights = built.items.filter((i) => i.type === 'flight').map((i) => i.catalog_id);
    if (flights[0] !== parts.out.flight_id) warnings.push(`Arrival flight changed to ${flights[0]} to serve ${plan[0].city}.`);
    if (flights[1] !== parts.ret.flight_id) warnings.push(`Return flight changed to ${flights[1]} to serve ${plan.at(-1).city}.`);
    return { built, warnings };
  },
};

// ---- applyChange -----------------------------------------------------------------------------------

/** CONTRACT §4 applyChange: { ok, package, delta_inr, warnings, reasons }. The input is never mutated. */
export function applyChange(pkg, change, ctx) {
  const refuse = (reasons) => ({ ok: false, package: pkg, delta_inr: 0, warnings: [], reasons });
  if (pkg?.status === 'BOOKED') return refuse(['This package is already booked.']);
  const handler = HANDLERS[change?.type];
  if (!handler) return refuse([`Unknown change type "${change?.type}".`]);
  let parts;
  try {
    parts = decompose(pkg, ctx);
  } catch (e) {
    return refuse([`This package cannot be changed: ${e.message}.`]);
  }

  const r = handler(parts, change, pkg);
  if (r.refuse) return refuse(r.refuse);
  const warnings = [...(r.warnings ?? [])];
  let next;
  if (r.built) {
    next = carryOver(pkg, r.built);
  } else {
    if (r.touched.includes('airport')) {
      for (const dir of ['arrive', 'depart']) {
        const why = refitAirport(parts, dir, warnings);
        if (why) return refuse([why]);
      }
    }
    const why = refitVisits(parts, warnings);
    if (why) return refuse([why]);
    next = recompose(pkg, parts);
  }

  const problems = validatePackage(next, ctx);
  if (problems.length) return refuse(problems);
  if (next.total_inr > next.budget_inr) {
    warnings.push(`The new total ${inr(next.total_inr)} is ${inr(next.total_inr - next.budget_inr)} over the budget of ${inr(next.budget_inr)}.`);
  }
  return { ok: true, package: next, delta_inr: next.total_inr - pkg.total_inr, warnings, reasons: [] };
}

// ---- getOptions ------------------------------------------------------------------------------------

/** One Option from a simulated change: delta and validity come from applyChange itself. */
function option(id, label, r, detail) {
  return {
    id, label,
    price_delta_inr: r.ok ? r.delta_inr : null,
    valid: r.ok,
    reason: r.ok ? null : r.reasons.join(' '),
    detail: r.ok
      ? {
        ...detail, total_inr: r.package.total_inr, over_budget: r.package.total_inr > r.package.budget_inr,
        avg_stars: r.package.metrics.avg_stars, travel_minutes: r.package.metrics.travel_minutes, warnings: r.warnings,
      }
      : detail,
  };
}

const sortOptions = (list) => list.sort((x, y) =>
  Number(y.valid) - Number(x.valid) || (x.price_delta_inr ?? 0) - (y.price_delta_inr ?? 0) || x.id.localeCompare(y.id));

function hotelOptionsFor(pkg, city, ctx) {
  const stay = pkg.plan.find((p) => p.city === city);
  if (!stay) return [];
  const list = [];
  for (const hotel of hotelsInCity(city)) {
    for (const room of roomsOfHotel(hotel.hotel_id)) {
      const r = applyChange(pkg, { type: 'swap_hotel', city, hotel_id: hotel.hotel_id, room_id: room.room_id }, ctx);
      const k = r.ok ? r.package.plan.find((p) => p.city === city).rooms : null;
      list.push(option(`${hotel.hotel_id}|${room.room_id}`, `${hotel.name} — ${room.name}${k ? ` ×${k}` : ''}`, r, {
        hotel_id: hotel.hotel_id, room_id: room.room_id, hotel: hotel.name, room: room.name, room_type: room.room_type,
        stars: hotel.stars, rating: hotel.rating, area: hotel.area, family_friendly: hotel.family_friendly,
        image: hotel.image, rooms: k, price_per_night: room.price_per_night.amount,
        current: hotel.hotel_id === stay.hotel_id && room.room_id === stay.room_id,
      }));
    }
  }
  return sortOptions(list);
}

function flightOptionsFor(pkg, direction, ctx) {
  const home = pkg.traveler.home_airport;
  const current = pkg.items.filter((i) => i.type === 'flight').map((i) => flightById.get(i.catalog_id))
    .find((f) => (direction === 'outbound' ? f.from === home : f.to === home));
  let flights;
  if (direction === 'outbound') {
    flights = airportsServing(pkg.plan[0].city).flatMap((ap) => flightsArriving(home, ap, pkg.start_date));
  } else if (direction === 'return') {
    flights = airportsServing(pkg.plan.at(-1).city).flatMap((ap) => flightsDeparting(ap, home, pkg.end_date));
  } else {
    return [];
  }
  return sortOptions(flights.map((f) => {
    const r = applyChange(pkg, { type: 'swap_flight', direction, flight_id: f.flight_id }, ctx);
    const label = `${f.flight_number} ${f.from} ${clock(f.departure_local)} → ${f.to} ${clock(f.arrival_local)}` +
      (f.stops ? ` (${f.stops} stop)` : '');
    return option(f.flight_id, label, r, {
      airline: f.airline, flight_number: f.flight_number, from: f.from, to: f.to,
      departure: local(f.departure_local), arrival: local(f.arrival_local), stops: f.stops,
      duration_minutes: f.duration_minutes, seats_free: seatsFree(f, ctx), price_per_seat: f.price_per_seat.amount,
      current: f.flight_id === current?.flight_id,
    });
  }));
}

function attractionOptionsFor(pkg, date, ctx) {
  const stay = pkg.plan.find((p) => p.check_in <= date && date < p.check_out);
  if (!stay) return [];
  const inPackage = new Map(pkg.items.filter((i) => i.type === 'attraction').map((i) => [i.catalog_id, i]));
  return sortOptions(attractionsInCity(stay.city).map((a) => {
    const have = inPackage.get(a.attraction_id);
    const r = have
      ? { ok: false, reasons: [`Already in the package on ${have.start.slice(0, 10)}.`] }
      : applyChange(pkg, { type: 'add_attraction', attraction_id: a.attraction_id, date }, ctx);
    const added = r.ok ? r.package.items.find((i) => i.catalog_id === a.attraction_id) : null;
    return option(a.attraction_id, a.name, r, {
      city: a.city, category: a.category, open_from: a.open_from, open_until: a.open_until,
      visit_minutes: a.visit_minutes, child_friendly: a.child_friendly, accessible: a.accessible, image: a.image,
      price_inr: attractionPrice(a, pkg.traveler.adults, pkg.traveler.child_ages.length),
      date, start: added ? clock(added.start) : null, end: added ? clock(added.end) : null,
    });
  }));
}

function cityPlanOptionsFor(pkg, ctx) {
  const nights = pkg.plan.reduce((t, p) => t + p.nights, 0);
  const currentKey = planKey(pkg.plan);
  return sortOptions(cityPlans(pkg.country, nights).map((plan) => {
    const key = planKey(plan);
    const r = key === currentKey
      ? { ok: true, delta_inr: 0, package: pkg, warnings: [] }
      : applyChange(pkg, { type: 'set_city_plan', cities: plan }, ctx);
    return option(key, planText(plan), r, { cities: plan, current: key === currentKey });
  }));
}

/** CONTRACT §4 getOptions: every alternative of that kind, priced against the current package. */
export function getOptions(pkg, query, ctx) {
  switch (query?.kind) {
    case 'hotel': return query.city ? hotelOptionsFor(pkg, query.city, ctx) : [];
    case 'flight': return flightOptionsFor(pkg, query.direction, ctx);
    case 'attraction': return query.date ? attractionOptionsFor(pkg, query.date, ctx) : [];
    case 'city_plan': return cityPlanOptionsFor(pkg, ctx);
    default: return [];
  }
}

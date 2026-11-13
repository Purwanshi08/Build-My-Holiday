// validatePackage(pkg, ctx): re-checks every travel rule of problem-1 §4 plus prices and total, working only
// from pkg.items, the traveler/request fields and data/catalog (so it also checks exported JSON). [] = valid.
import * as cat from './catalog.js';
import { addDays, addMinutes, inWindow, toMinutes, weekday } from './time.js';
import { attractionPrice, flightPrice, hotelPrice, transferPrice, transferQuantity } from './pricing.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const TYPES = ['flight', 'hotel', 'transfer', 'attraction'];
const RULES = cat.destinations.rules;

// ---------- small helpers ----------
const isDate = (s) => typeof s === 'string' && DATE_RE.test(s) && addDays(s, 0) === s;
const isDateTime = (s) => typeof s === 'string' && DATETIME_RE.test(s) && isDate(s.slice(0, 10));
const dt = (s) => s.slice(0, 16); // drop catalog ":SS"
const dateOf = (s) => s.slice(0, 10);
const timeOf = (s) => s.slice(11, 16);
const tag = (it) => `${it.item_id} (${it.catalog_id})`;

/** Nights from a (inclusive) to b (exclusive) as date strings; [] if not a < b. Capped to stay finite. */
function datesBetween(a, b) {
  const out = [];
  if (!isDate(a) || !isDate(b)) return out;
  for (let d = a; d < b && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const bookedSeats = (ctx, id) => ctx?.booked?.flights?.[id] ?? 0;
const bookedRooms = (ctx, roomId, date) => ctx?.booked?.rooms?.[`${roomId}|${date}`] ?? 0;
const within1pct = (actual, expected) => Math.abs(actual - expected) * 100 <= expected;

const CATALOG_FOR = {
  flight: (id) => cat.flightById.get(id),
  hotel: (id) => cat.hotelById.get(id),
  transfer: (id) => cat.transferById.get(id),
  attraction: (id) => cat.attractionById.get(id),
};

// ---------- view: the package resolved against the catalog ----------
function buildView(pkg, ctx) {
  const items = Array.isArray(pkg?.items) ? pkg.items : [];
  const tr = pkg?.traveler ?? {};
  const adults = Number.isInteger(tr.adults) ? tr.adults : 0;
  const children = Array.isArray(tr.child_ages) ? tr.child_ages.length : Number.isInteger(tr.children) ? tr.children : 0;
  const start = pkg?.start_date;
  const end = pkg?.end_date;
  const country = cat.destinations.countries.find((c) => c.name === pkg?.country) ?? null;

  // Only items whose type, catalog record and time strings are usable; the rest is reported by checkItemFields.
  const resolved = [];
  for (const it of items) {
    if (!it || !TYPES.includes(it.type)) continue;
    const rec = CATALOG_FOR[it.type](it.catalog_id);
    if (!rec) continue;
    if (it.type === 'hotel') {
      const room = cat.roomById.get(it.room_id);
      if (!room || room.hotel_id !== rec.hotel_id || !isDate(it.start) || !isDate(it.end)) continue;
      resolved.push({ it, rec, room, nights: datesBetween(it.start, it.end) });
    } else if (isDateTime(it.start)) {
      resolved.push({ it, rec });
    }
  }
  const of = (type) => resolved.filter((r) => r.it.type === type);

  const flights = of('flight');
  const outbound = flights.filter((f) => f.rec.from === tr.home_airport);
  const inbound = flights.filter((f) => f.rec.to === tr.home_airport);

  const transfers = of('transfer');
  const airportTransfers = transfers.filter((t) => t.rec.airport).sort((a, b) => (a.it.start < b.it.start ? -1 : 1));
  const intercity = transfers.filter((t) => t.rec.from_city && t.rec.to_city)
    .sort((a, b) => (a.it.start < b.it.start ? -1 : a.it.start > b.it.start ? 1 : 0));
  const cityTransfers = transfers.filter((t) => !t.rec.airport && !(t.rec.from_city && t.rec.to_city));

  // Hotel stays: consecutive hotel items in the same city form one stay.
  const hotels = of('hotel').sort((a, b) => (a.it.start < b.it.start ? -1 : a.it.start > b.it.start ? 1 : 0));
  const stays = [];
  for (const h of hotels) {
    const last = stays.at(-1);
    if (last && last.city === h.rec.city) {
      last.hotels.push(h);
      last.end = h.it.end > last.end ? h.it.end : last.end;
      last.nights.push(...h.nights);
    } else {
      stays.push({ city: h.rec.city, start: h.it.start, end: h.it.end, hotels: [h], nights: [...h.nights] });
    }
  }

  // City route: from hotel stays, or from the airport/intercity transfers when the package has no hotel.
  let planStays;
  let changes;
  if (stays.length) {
    planStays = stays;
    changes = stays.slice(1).map((s, i) => ({ date: s.start, from: stays[i].city, to: s.city }));
  } else {
    changes = intercity.map((t) => ({ date: dateOf(t.it.start), from: t.rec.from_city, to: t.rec.to_city }));
    planStays = [];
    const firstCity = airportTransfers[0]?.rec.city ?? null;
    if (firstCity && isDate(start) && isDate(end)) {
      let city = firstCity;
      let from = start;
      for (const c of changes) {
        if (c.date <= from || c.date >= end) continue;
        planStays.push({ city, start: from, end: c.date, hotels: [], nights: datesBetween(from, c.date) });
        city = c.to;
        from = c.date;
      }
      planStays.push({ city, start: from, end, hotels: [], nights: datesBetween(from, end) });
    }
  }

  const nightCity = new Map(); // date -> city of that night
  for (const s of planStays) for (const n of s.nights) if (!nightCity.has(n)) nightCity.set(n, s.city);

  return {
    pkg, ctx, items, tr, adults, children, travelers: adults + children, start, end, country,
    flights, outbound, inbound, hotels, stays, planStays, nightCity, transfers, airportTransfers, intercity,
    cityTransfers, changes, firstCity: planStays[0]?.city ?? null, lastCity: planStays.at(-1)?.city ?? null,
    attractions: of('attraction'), resolved,
  };
}

// When the traveler reaches the city on the arrival day and on each city-change day ("YYYY-MM-DDTHH:MM").
function reachTimes(v) {
  const reach = new Map();
  const [arrT] = v.airportTransfers;
  if (arrT) reach.set(dateOf(arrT.it.start), addMinutes(dt(arrT.it.start), arrT.rec.duration_minutes));
  else if (v.outbound.length === 1) {
    const a = dt(v.outbound[0].rec.arrival_local);
    reach.set(dateOf(a), addMinutes(a, 60));
  }
  for (const c of v.changes) {
    const t = v.intercity.find((x) => dateOf(x.it.start) === c.date);
    if (t) reach.set(c.date, addMinutes(dt(t.it.start), t.rec.duration_minutes));
  }
  return reach;
}

// =====================================================================================
// Checks: each takes the view and returns violation strings.
// =====================================================================================

/** Shared trip format: every item has the §4 fields with sane values and a real catalog record. */
function checkItemFields(v) {
  const out = [];
  if (!Array.isArray(v.pkg?.items) || v.items.length === 0) return ['Package has no items.'];
  const seen = new Set();
  v.items.forEach((it, n) => {
    const id = it?.item_id ?? `#${n + 1}`;
    if (!it || typeof it !== 'object') return out.push(`Item ${id} is not an object.`);
    if (typeof it.item_id !== 'string' || !it.item_id) out.push(`Item ${id} has no item_id.`);
    else if (seen.has(it.item_id)) out.push(`item_id ${it.item_id} is used more than once.`);
    seen.add(it.item_id);
    if (!TYPES.includes(it.type)) return out.push(`Item ${id} has unknown type "${it.type}".`);
    if (typeof it.name !== 'string' || !it.name) out.push(`Item ${id} has no name.`);
    if (typeof it.city !== 'string' || !it.city) out.push(`Item ${id} has no city.`);
    if (!['PLANNED', 'BOOKED'].includes(it.status)) out.push(`Item ${id} has status "${it.status}".`);
    const rec = CATALOG_FOR[it.type](it.catalog_id);
    if (!rec) out.push(`Item ${id}: ${it.type} "${it.catalog_id}" is not in the catalog.`);
    if (it.type === 'hotel') {
      const room = cat.roomById.get(it.room_id);
      if (!room) out.push(`Item ${id}: room "${it.room_id}" is not in the catalog.`);
      else if (rec && room.hotel_id !== rec.hotel_id) out.push(`Item ${id}: room ${it.room_id} is not in ${it.catalog_id}.`);
      if (!isDate(it.start) || !isDate(it.end)) out.push(`Item ${id}: hotel start/end must be dates YYYY-MM-DD.`);
      else if (it.start >= it.end) out.push(`Item ${id}: check-out ${it.end} is not after check-in ${it.start}.`);
      if (rec && it.city !== rec.city) out.push(`Item ${id}: city "${it.city}" but the hotel is in ${rec.city}.`);
    } else {
      if (it.room_id != null) out.push(`Item ${id}: room_id must be null for a ${it.type}.`);
      if (!isDateTime(it.start)) out.push(`Item ${id}: start must be YYYY-MM-DDTHH:MM.`);
      const endOk = isDateTime(it.end) || (it.type === 'transfer' && it.end === null);
      if (!endOk) out.push(`Item ${id}: end must be YYYY-MM-DDTHH:MM.`);
    }
    if (it.type === 'attraction' && rec && it.city !== rec.city) {
      out.push(`Item ${id}: city "${it.city}" but the attraction is in ${rec.city}.`);
    }
    if (!Number.isInteger(it.quantity) || it.quantity < 1) out.push(`Item ${id}: quantity must be a whole number ≥ 1.`);
    if (!Number.isInteger(it.price_inr) || it.price_inr < 0) out.push(`Item ${id}: price_inr must be whole INR ≥ 0.`);
    if (!Array.isArray(it.sources) || it.sources.length) out.push(`Item ${id}: sources must be an empty list.`);
    if (it.warnings !== undefined && !Array.isArray(it.warnings)) out.push(`Item ${id}: warnings must be a list.`);
  });
  return out;
}

/** Item times agree with the catalog: flight times, transfer arrival, attraction visit length. */
function checkItemTimes(v) {
  const out = [];
  for (const { it, rec } of v.flights) {
    if (dt(it.start) !== dt(rec.departure_local) || !isDateTime(it.end) || dt(it.end) !== dt(rec.arrival_local)) {
      out.push(`${tag(it)}: times must be the catalog's ${dt(rec.departure_local)} → ${dt(rec.arrival_local)}.`);
    }
  }
  for (const { it, rec } of v.transfers) {
    if (it.end !== null && isDateTime(it.end) && dt(it.end) !== addMinutes(dt(it.start), rec.duration_minutes)) {
      out.push(`${tag(it)}: end must be pickup + ${rec.duration_minutes} min.`);
    }
  }
  for (const { it, rec } of v.attractions) {
    if (isDateTime(it.end) && dt(it.end) !== addMinutes(dt(it.start), rec.visit_minutes)) {
      out.push(`${tag(it)}: visit must last ${rec.visit_minutes} min (end ${addMinutes(dt(it.start), rec.visit_minutes)}).`);
    }
  }
  return out;
}

/** Traveler block: adults ≥ 1, each child 0–17, children = number of ages, home airport is a departure city. */
function checkTravelers(v) {
  const out = [];
  const t = v.tr;
  if (!Number.isInteger(t.adults) || t.adults < 1) out.push('Traveler needs at least 1 adult.');
  if (!Array.isArray(t.child_ages) || !t.child_ages.every((a) => Number.isInteger(a) && a >= 0 && a <= 17)) {
    out.push('Each child age must be a whole number from 0 to 17.');
  } else if (t.children !== undefined && t.children !== t.child_ages.length) {
    out.push(`traveler.children is ${t.children} but ${t.child_ages.length} child ages are given.`);
  }
  if (!cat.destinations.departure_cities.some((d) => d.airport === t.home_airport)) {
    out.push(`Home airport "${t.home_airport}" is not a departure city.`);
  }
  return out;
}

/** Trip is min_nights–max_nights (3–10) nights from start_date to end_date. */
function checkTripLength(v) {
  if (!isDate(v.start) || !isDate(v.end)) return ['start_date and end_date must be real dates YYYY-MM-DD.'];
  const n = datesBetween(v.start, v.end).length;
  if (n < RULES.min_nights || n > RULES.max_nights) {
    return [`Trip has ${n} nights; it must have ${RULES.min_nights} to ${RULES.max_nights}.`];
  }
  return [];
}

/** First night on/after 1 April 2027, return flight day on/before 20 April 2027. */
function checkDataWindow(v) {
  if (!isDate(v.start) || !isDate(v.end)) return [];
  const { first_night, last_departure } = RULES.data_window;
  const out = [];
  if (v.start < first_night) out.push(`First night ${v.start} is before ${first_night}.`);
  if (v.end > last_departure) out.push(`Return day ${v.end} is after ${last_departure}.`);
  return out;
}

/** Country is a catalog destination and every city in the route belongs to it. */
function checkCountry(v) {
  if (!v.country) return [`Country "${v.pkg?.country}" is not a destination country.`];
  const cities = new Set(v.country.cities.map((c) => c.name));
  return v.planStays.filter((s) => !cities.has(s.city)).map((s) => `City ${s.city} is not in ${v.country.name}.`);
}

/** Each city appears once in the plan, with at least min_nights_per_city nights in a row. */
function checkCityPlan(v) {
  const out = [];
  if (v.planStays.length === 0) return ['Package has no city plan.'];
  const seen = new Set();
  for (const s of v.planStays) {
    if (seen.has(s.city)) out.push(`City ${s.city} appears more than once in the plan.`);
    seen.add(s.city);
    if (s.nights.length < RULES.min_nights_per_city) {
      out.push(`${s.city} has ${s.nights.length} night(s); each city needs at least ${RULES.min_nights_per_city} in a row.`);
    }
  }
  return out;
}

/** One hotel for every night start_date..end_date−1, never two, none on the last day. */
function checkHotelNights(v) {
  if (v.hotels.length === 0) return []; // no-stay package: the traveler arranges their own accommodation
  if (!isDate(v.start) || !isDate(v.end)) return [];
  const out = [];
  const count = new Map();
  for (const h of v.hotels) for (const n of h.nights) count.set(n, (count.get(n) ?? 0) + 1);
  for (const n of datesBetween(v.start, v.end)) {
    const c = count.get(n) ?? 0;
    if (c === 0) out.push(`No hotel for the night of ${n}.`);
    if (c > 1) out.push(`${c} hotels booked for the night of ${n}.`);
  }
  for (const h of v.hotels) {
    if (h.it.end > v.end) out.push(`${tag(h.it)}: hotel night on/after the last day ${v.end}.`);
    if (h.it.start < v.start) out.push(`${tag(h.it)}: hotel night before the trip starts (${v.start}).`);
  }
  return out;
}

/** In each city: one hotel and one room type for all nights. */
function checkOneHotelPerCity(v) {
  const out = [];
  const byCity = new Map();
  for (const h of v.hotels) {
    const k = `${h.rec.hotel_id}|${h.room.room_id}`;
    const first = byCity.get(h.rec.city);
    if (!first) byCity.set(h.rec.city, k);
    else if (first !== k) out.push(`${h.rec.city} uses more than one hotel or room type (${first.replace('|', ' / ')} and ${k.replace('|', ' / ')}).`);
  }
  return out;
}

/** k rooms fit: adults ≤ k·max_adults, adults+children ≤ k·(max_adults+max_children), adults ≥ k. */
function checkRoomsFit(v) {
  const out = [];
  for (const { it, room } of v.hotels) {
    const k = it.quantity;
    if (!Number.isInteger(k) || k < 1) continue;
    const ok =
      v.adults <= k * room.max_adults &&
      v.travelers <= k * (room.max_adults + room.max_children) &&
      v.adults >= k;
    if (!ok) {
      out.push(`${tag(it)}: ${k} × ${room.room_id} does not fit ${v.adults} adult(s) + ${v.children} child(ren).`);
    }
  }
  return out;
}

/** rooms_left − our booked rooms ≥ k on every night of the stay. */
function checkRoomsLeft(v) {
  const out = [];
  for (const { it, room, nights } of v.hotels) {
    for (const n of nights) {
      const left = cat.roomsLeft(room.room_id, n) - bookedRooms(v.ctx, room.room_id, n);
      if (left < it.quantity) out.push(`${tag(it)}: only ${Math.max(left, 0)} ${room.room_id} left on ${n}, needs ${it.quantity}.`);
    }
  }
  return out;
}

/** Exactly one arrival flight (from home) and one return flight (to home), nothing else. */
function checkFlightCount(v) {
  const out = [];
  const flightItems = v.items.filter((it) => it?.type === 'flight');
  if (v.outbound.length !== 1) out.push(`Package needs exactly 1 arrival flight from ${v.tr.home_airport}; has ${v.outbound.length}.`);
  if (v.inbound.length !== 1) out.push(`Package needs exactly 1 return flight to ${v.tr.home_airport}; has ${v.inbound.length}.`);
  if (flightItems.length !== 2) out.push(`Package needs exactly 2 flights; has ${flightItems.length}.`);
  return out;
}

/** Arrival flight lands on start_date (local) at an airport that serves the first city. */
function checkArrivalFlight(v) {
  if (v.outbound.length !== 1) return [];
  const { it, rec } = v.outbound[0];
  const out = [];
  if (dateOf(rec.arrival_local) !== v.start) out.push(`${tag(it)}: lands on ${dateOf(rec.arrival_local)}, not the start date ${v.start}.`);
  const first = v.firstCity;
  if (first && !cat.airportsServing(first).includes(rec.to)) out.push(`${tag(it)}: lands at ${rec.to}, which does not serve ${first}.`);
  return out;
}

/** Return flight leaves on end_date (local) from an airport that serves the last city. */
function checkReturnFlight(v) {
  if (v.inbound.length !== 1) return [];
  const { it, rec } = v.inbound[0];
  const out = [];
  if (dateOf(rec.departure_local) !== v.end) out.push(`${tag(it)}: leaves on ${dateOf(rec.departure_local)}, not the last day ${v.end}.`);
  const last = v.lastCity;
  if (last && !cat.airportsServing(last).includes(rec.from)) out.push(`${tag(it)}: leaves from ${rec.from}, which does not serve ${last}.`);
  return out;
}

/** seats_left − our booked seats ≥ travelers on each flight. */
function checkFlightSeats(v) {
  const out = [];
  for (const { it, rec } of v.flights) {
    const left = rec.seats_left - bookedSeats(v.ctx, rec.flight_id);
    if (left < v.travelers) out.push(`${tag(it)}: only ${Math.max(left, 0)} seat(s) left for ${v.travelers} traveler(s).`);
  }
  return out;
}

/** Exactly two airport transfers: one after landing, one before the return flight. */
function checkAirportTransferCount(v) {
  const n = v.airportTransfers.length;
  return n === 2 ? [] : [`Package needs exactly 2 airport transfers (arrival and return); has ${n}.`];
}

/** Common airport-transfer rules: right airport, serves the city (and hotel area), pickup inside service hours. */
function airportTransferBasics(v, t, airport, city, hotel, label) {
  const out = [];
  const { it, rec } = t;
  if (airport && rec.airport !== airport) out.push(`${tag(it)}: ${label} transfer is from ${rec.airport}, flight uses ${airport}.`);
  if (city && rec.city !== city) out.push(`${tag(it)}: ${label} transfer serves ${rec.city}, the ${label === 'arrival' ? 'first' : 'last'} city is ${city}.`);
  else if (hotel && rec.area != null && rec.area !== hotel.area) {
    out.push(`${tag(it)}: ${label} transfer serves ${rec.area}, hotel is in ${hotel.area}.`);
  }
  if (!inWindow(timeOf(it.start), rec.service_from, rec.service_until)) {
    out.push(`${tag(it)}: pickup ${timeOf(it.start)} is outside service hours ${rec.service_from}–${rec.service_until}.`);
  }
  return out;
}

/** Arrival transfer: from the arrival airport to the first hotel (or city), pickup ≥ 60 min after landing. */
function checkArrivalTransfer(v) {
  if (v.airportTransfers.length !== 2) return [];
  const t = v.airportTransfers[0];
  const flight = v.outbound.length === 1 ? v.outbound[0].rec : null;
  const out = airportTransferBasics(v, t, flight?.to, v.firstCity, v.stays[0]?.hotels[0]?.rec, 'arrival');
  if (flight) {
    const earliest = addMinutes(dt(flight.arrival_local), 60);
    if (dt(t.it.start) < earliest) out.push(`${tag(t.it)}: pickup ${dt(t.it.start)} is less than 60 min after landing (earliest ${earliest}).`);
  }
  return out;
}

/** Return transfer: last hotel (or city) to the return airport, reaching it ≥ 180 min before departure. */
function checkReturnTransfer(v) {
  if (v.airportTransfers.length !== 2) return [];
  const t = v.airportTransfers[1];
  const flight = v.inbound.length === 1 ? v.inbound[0].rec : null;
  const out = airportTransferBasics(v, t, flight?.from, v.lastCity, v.stays.at(-1)?.hotels[0]?.rec, 'return');
  if (flight) {
    const reach = addMinutes(dt(t.it.start), t.rec.duration_minutes);
    const latest = addMinutes(dt(flight.departure_local), -180);
    if (reach > latest) out.push(`${tag(t.it)}: reaches the airport at ${reach}, must be by ${latest} (180 min before departure).`);
  }
  return out;
}

/** One transfer between cities on each city-change day, from the matching destinations link, in service hours. */
function checkIntercityTransfers(v) {
  const out = [];
  const used = new Set();
  for (const c of v.changes) {
    const onDay = v.intercity.filter((t) => dateOf(t.it.start) === c.date);
    onDay.forEach((t) => used.add(t));
    if (onDay.length === 0) { out.push(`No transfer from ${c.from} to ${c.to} on ${c.date}.`); continue; }
    if (onDay.length > 1) out.push(`${onDay.length} transfers between cities on ${c.date}; exactly 1 is needed.`);
    const link = v.country?.links.find((l) => l.from_city === c.from && l.to_city === c.to);
    for (const { it, rec } of onDay) {
      if (!link) out.push(`${tag(it)}: there is no link from ${c.from} to ${c.to}.`);
      else if (!link.transfer_ids.includes(rec.transfer_id)) out.push(`${tag(it)}: not a ${c.from} → ${c.to} transfer (use ${link.transfer_ids.join(', ')}).`);
      if (!inWindow(timeOf(it.start), rec.service_from, rec.service_until)) {
        out.push(`${tag(it)}: departure ${timeOf(it.start)} is outside service hours ${rec.service_from}–${rec.service_until}.`);
      }
    }
  }
  for (const t of v.intercity) {
    if (!used.has(t)) out.push(`${tag(t.it)}: transfer between cities on ${dateOf(t.it.start)}, which is not a city-change day.`);
  }
  return out;
}

/** Optional city taxis/buses: in a city of the plan that day, pickup in service hours. */
function checkCityTransfers(v) {
  const out = [];
  for (const { it, rec } of v.cityTransfers) {
    const d = dateOf(it.start);
    const cities = new Set([v.nightCity.get(d), v.nightCity.get(addDays(d, -1))].filter(Boolean));
    if (!cities.has(rec.city)) out.push(`${tag(it)}: ${rec.city} taxi on ${d}, but the traveler is not in ${rec.city}.`);
    if (!inWindow(timeOf(it.start), rec.service_from, rec.service_until)) {
      out.push(`${tag(it)}: pickup ${timeOf(it.start)} is outside service hours ${rec.service_from}–${rec.service_until}.`);
    }
  }
  return out;
}

/** Attraction is in the city of that night's hotel; none on the last day. */
function checkAttractionCity(v) {
  const out = [];
  for (const { it, rec } of v.attractions) {
    const d = dateOf(it.start);
    if (d === v.end) continue; // reported by checkAttractionLastDay
    const city = v.nightCity.get(d);
    if (!city) out.push(`${tag(it)}: no hotel night on ${d}.`);
    else if (rec.city !== city) out.push(`${tag(it)}: ${rec.name} is in ${rec.city}, but the night of ${d} is in ${city}.`);
  }
  return out;
}

/** Attraction is open that weekday and not on one of its closed_dates. */
function checkAttractionOpenDay(v) {
  const out = [];
  for (const { it, rec } of v.attractions) {
    const d = dateOf(it.start);
    const wd = weekday(d);
    if (!rec.open_days.includes(wd)) out.push(`${tag(it)}: ${rec.name} is closed on ${wd} (${d}).`);
    if ((rec.closed_dates ?? []).includes(d)) out.push(`${tag(it)}: ${rec.name} is closed on ${d}.`);
  }
  return out;
}

/** The whole visit (start .. start + visit_minutes) is inside the opening hours. */
function checkAttractionHours(v) {
  const out = [];
  for (const { it, rec } of v.attractions) {
    const s = toMinutes(timeOf(it.start));
    const e = s + rec.visit_minutes;
    const from = toMinutes(rec.open_from);
    let until = toMinutes(rec.open_until);
    if (until < from) until += 1440; // window past midnight
    if (s < from || e > until) {
      out.push(`${tag(it)}: visit ${timeOf(it.start)}+${rec.visit_minutes} min is outside ${rec.open_from}–${rec.open_until}.`);
    }
  }
  return out;
}

/** Visits on the same day do not overlap. */
function checkAttractionOverlap(v) {
  const out = [];
  const visits = v.attractions
    .map(({ it, rec }) => ({ it, s: dt(it.start), e: addMinutes(dt(it.start), rec.visit_minutes) }))
    .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  for (let i = 1; i < visits.length; i++) {
    const a = visits[i - 1];
    const b = visits[i];
    if (b.s < a.e) out.push(`${tag(b.it)} starts at ${b.s} before ${tag(a.it)} ends at ${a.e}.`);
  }
  return out;
}

/** Each attraction at most once in the package. */
function checkAttractionUnique(v) {
  const out = [];
  const seen = new Set();
  for (const { it } of v.attractions) {
    if (seen.has(it.catalog_id)) out.push(`${it.catalog_id} is in the package more than once.`);
    seen.add(it.catalog_id);
  }
  return out;
}

/** 1–2 attractions on every full day (not arrival, city-change or last day). */
function checkAttractionsPerFullDay(v) {
  if (!isDate(v.start) || !isDate(v.end)) return [];
  const out = [];
  const changeDays = new Set(v.changes.map((c) => c.date));
  for (const d of datesBetween(addDays(v.start, 1), v.end)) {
    if (changeDays.has(d)) continue;
    const n = v.attractions.filter((a) => dateOf(a.it.start) === d).length;
    if (n < 1 || n > 2) out.push(`Full day ${d} has ${n} attraction(s); it needs 1 or 2.`);
  }
  return out;
}

/** No attractions on the last day. */
function checkAttractionLastDay(v) {
  return v.attractions
    .filter(({ it }) => dateOf(it.start) === v.end)
    .map(({ it }) => `${tag(it)}: attraction on the last day ${v.end}.`);
}

/** On the arrival day and city-change days, attractions start after the traveler reaches the city. */
function checkAttractionAfterArrival(v) {
  const out = [];
  const reach = reachTimes(v);
  for (const { it } of v.attractions) {
    const r = reach.get(dateOf(it.start));
    if (r && dt(it.start) < r) out.push(`${tag(it)}: starts at ${dt(it.start)}, before the traveler reaches the city at ${r}.`);
  }
  return out;
}

/** Quantities: seats and tickets for every traveler, vehicles = ceil(travelers / max_passengers). */
function checkQuantities(v) {
  const out = [];
  for (const { it, rec } of v.resolved) {
    let q = null;
    if (it.type === 'flight' || it.type === 'attraction') q = v.travelers;
    if (it.type === 'transfer') q = transferQuantity(rec, v.adults, v.children);
    if (q !== null && it.quantity !== q) out.push(`${tag(it)}: quantity ${it.quantity}, expected ${q}.`);
  }
  return out;
}

/** Expected catalog price of a resolved item (integer INR). */
function expectedPrice(v, r) {
  const { it, rec } = r;
  switch (it.type) {
    case 'flight': return flightPrice(rec, v.travelers);
    case 'hotel': return hotelPrice(r.room, it.quantity, r.nights.length);
    case 'transfer': return transferPrice(rec, v.adults, v.children);
    case 'attraction': return attractionPrice(rec, v.adults, v.children);
    default: return null;
  }
}

/** Every item price matches the catalog formula (1% tolerance). */
function checkItemPrices(v) {
  const out = [];
  for (const r of v.resolved) {
    if (r.it.type === 'hotel' && !(Number.isInteger(r.it.quantity) && r.it.quantity > 0)) continue;
    const exp = expectedPrice(v, r);
    if (typeof r.it.price_inr !== 'number' || !within1pct(r.it.price_inr, exp)) {
      out.push(`${tag(r.it)}: price ₹${r.it.price_inr}, catalog price is ₹${exp}.`);
    }
  }
  return out;
}

/** total_inr = sum of item prices, and within 1% of the catalog total. */
function checkTotal(v) {
  const out = [];
  const total = v.pkg?.total_inr;
  const sum = v.items.reduce((t, it) => t + (Number.isInteger(it?.price_inr) ? it.price_inr : 0), 0);
  if (total !== sum) out.push(`total_inr ₹${total} is not the sum of item prices ₹${sum}.`);
  if (v.resolved.length === v.items.length) {
    const exp = v.resolved.reduce((t, r) => t + (expectedPrice(v, r) ?? 0), 0);
    if (typeof total !== 'number' || !within1pct(total, exp)) out.push(`total_inr ₹${total}, catalog total is ₹${exp}.`);
  }
  return out;
}

/** After confirm: package and every item BOOKED with booking.reference = the 10-digit number as a string. */
function checkBookingStatus(v) {
  const out = [];
  const status = v.pkg?.status;
  if (status === undefined) return out; // plain trip format without our status field
  if (!['PLANNED', 'BOOKED'].includes(status)) return [`Package status "${status}" must be PLANNED or BOOKED.`];
  const refs = new Set();
  for (const it of v.items) {
    if (!it) continue;
    if (status === 'BOOKED') {
      if (it.status !== 'BOOKED') out.push(`Item ${it.item_id} is not BOOKED in a booked package.`);
      const ref = it.booking?.reference;
      if (typeof ref !== 'string' || !/^\d{10}$/.test(ref)) out.push(`Item ${it.item_id}: booking.reference must be a 10-digit string.`);
      else refs.add(ref);
    } else if (it.status === 'BOOKED' || it.booking != null) {
      out.push(`Item ${it.item_id} is booked but the package is PLANNED.`);
    }
  }
  if (refs.size > 1) out.push('Items carry different booking references.');
  return out;
}

export const CHECKS = [
  checkItemFields, checkItemTimes, checkTravelers, checkTripLength, checkDataWindow, checkCountry, checkCityPlan,
  checkHotelNights, checkOneHotelPerCity, checkRoomsFit, checkRoomsLeft,
  checkFlightCount, checkArrivalFlight, checkReturnFlight, checkFlightSeats,
  checkAirportTransferCount, checkArrivalTransfer, checkReturnTransfer, checkIntercityTransfers, checkCityTransfers,
  checkAttractionCity, checkAttractionOpenDay, checkAttractionHours, checkAttractionOverlap, checkAttractionUnique,
  checkAttractionsPerFullDay, checkAttractionLastDay, checkAttractionAfterArrival,
  checkQuantities, checkItemPrices, checkTotal, checkBookingStatus,
];

/** All rule violations of a package (or exported trip JSON) as strings; [] when the package is correct. */
export function validatePackage(pkg, ctx) {
  if (!pkg || typeof pkg !== 'object') return ['Package is missing.'];
  let v;
  try {
    v = buildView(pkg, ctx);
  } catch (e) {
    return [`Package could not be read: ${e.message}`];
  }
  const out = [];
  for (const check of CHECKS) {
    try {
      out.push(...check(v));
    } catch (e) {
      out.push(`${check.name}: could not check (${e.message}).`);
    }
  }
  return out;
}

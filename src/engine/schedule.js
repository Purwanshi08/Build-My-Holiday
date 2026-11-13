// Timing rules (problem §4): airport pickups (≥60 min after landing, at the airport ≥180 min before departure,
// pickup inside service hours), intercity departures, attraction visits per day, and hotel check-in/out timing (G1).
import { attractionsInCity } from './catalog.js';
import { toMinutes, inWindow, addMinutes, weekday } from './time.js';
import { attractionPrice } from './pricing.js';

export const AIRPORT_PICKUP_AFTER_LANDING = 60;
export const AT_AIRPORT_BEFORE_DEPARTURE = 180;
export const MAX_WAIT = 180; // longest we shift a pickup to reach the service window (decision)
export const INTERCITY_PREFERRED_DEPARTURE = '10:00';
export const DAY_START = '09:00';
export const DAY_END = '22:00';
export const GAP_MINUTES = 30; // after reaching a city and between two visits

const clock = (dateTime) => dateTime.slice(11, 16);
const servesAt = (transfer, dateTime) => inWindow(clock(dateTime), transfer.service_from, transfer.service_until);

/**
 * Arrival pickup: the first minute ≥ landing + 60 inside the service window, waiting at most MAX_WAIT.
 * Returns { start, end } local date-times or null.
 */
export function arrivalPickup(transfer, landing) {
  const earliest = addMinutes(landing, AIRPORT_PICKUP_AFTER_LANDING);
  for (let w = 0; w <= MAX_WAIT; w++) {
    const start = addMinutes(earliest, w);
    if (servesAt(transfer, start)) return { start, end: addMinutes(start, transfer.duration_minutes) };
  }
  return null;
}

/**
 * Departure pickup: the latest minute with pickup + duration ≤ departure − 180 inside the service window,
 * going back at most MAX_WAIT. Returns { start, end } or null.
 */
export function departurePickup(transfer, departure) {
  const latest = addMinutes(departure, -AT_AIRPORT_BEFORE_DEPARTURE - transfer.duration_minutes);
  for (let w = 0; w <= MAX_WAIT; w++) {
    const start = addMinutes(latest, -w);
    if (servesAt(transfer, start)) return { start, end: addMinutes(start, transfer.duration_minutes) };
  }
  return null;
}

/**
 * Intercity departure on `date`: departures run service_from + n × frequency_minutes (every minute when
 * there is no frequency) up to service_until. Take the first at or after 10:00 that day, else the first one.
 */
export function intercityDeparture(transfer, date) {
  const from = toMinutes(transfer.service_from);
  let until = toMinutes(transfer.service_until);
  if (until < from) until += 1440;
  const step = transfer.frequency_minutes || 1;
  const pref = toMinutes(INTERCITY_PREFERRED_DEPARTURE);
  let m = from >= pref ? from : from + Math.ceil((pref - from) / step) * step;
  if (m > until || m >= 1440) m = from;
  const start = addMinutes(`${date}T00:00`, m);
  return { start, end: addMinutes(start, transfer.duration_minutes) };
}

/** Is the attraction open on that date (weekday and closed_dates)? */
export function openOn(attraction, date) {
  return attraction.open_days.includes(weekday(date)) && !(attraction.closed_dates ?? []).includes(date);
}

/** Earliest visit at or after `cursor` (minutes) that ends by `latest` and inside opening hours, or null. */
export function fitVisit(attraction, cursor, latest) {
  const open = toMinutes(attraction.open_from);
  let close = toMinutes(attraction.open_until);
  if (close < open) close += 1440;
  const start = Math.max(cursor, open);
  const end = start + attraction.visit_minutes;
  return end <= Math.min(close, latest) ? { start, end } : null;
}

/** Attractions open in the day's city that day, cheapest first (then shorter, then id). Never Nara. */
export function optionsFor(day, adults, children) {
  return attractionsInCity(day.city)
    .filter((a) => a.city !== 'Nara' && openOn(a, day.date))
    .map((a) => ({ a, price: attractionPrice(a, adults, children) }))
    .sort((x, y) => x.price - y.price || x.a.visit_minutes - y.a.visit_minutes ||
      x.a.attraction_id.localeCompare(y.a.attraction_id));
}

/**
 * Plan visits. `days` = [{ date, city, full, earliest?, latest? }] in date order (minutes since midnight;
 * defaults 09:00–22:00). Pass 1 gives every full day its required visit (the cheapest that fits); pass 2
 * then adds free extras: a 2nd visit on full days, at most 1 on other days. Extras come second so they
 * never use up an attraction a later full day needs. No attraction twice, never Nara.
 * Returns { visits: [{ attraction, date, start, end, price }] sorted by start, failedDate: null | date }.
 */
export function planAttractions(days, adults, children) {
  const used = new Set();
  const visits = [];
  const cursor = new Map(days.map((d) => [d.date, d.earliest ?? toMinutes(DAY_START)]));
  const latestOf = (d) => Math.min(d.latest ?? toMinutes(DAY_END), toMinutes(DAY_END));

  const place = (day, freeOnly) => {
    for (const { a, price } of optionsFor(day, adults, children)) {
      if (used.has(a.attraction_id) || (freeOnly && price > 0)) continue;
      const slot = fitVisit(a, cursor.get(day.date), latestOf(day));
      if (!slot) continue;
      used.add(a.attraction_id);
      visits.push({
        attraction: a, date: day.date, price,
        start: addMinutes(`${day.date}T00:00`, slot.start), end: addMinutes(`${day.date}T00:00`, slot.end),
      });
      cursor.set(day.date, slot.end + GAP_MINUTES);
      return true;
    }
    return false;
  };

  for (const day of days) {
    if (day.full && !place(day, false)) return { visits, failedDate: day.date };
  }
  for (const day of days) place(day, true);
  visits.sort((x, y) => x.start.localeCompare(y.start));
  return { visits, failedDate: null };
}

// ---- hotel check-in / check-out timing (G1; catalog times are display-only, so these are warnings) ----

const legEnd = (leg) => leg.end ?? addMinutes(leg.start, leg.duration ?? leg.t.duration_minutes);
const hm = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`);

/**
 * When the traveler reaches and leaves each hotel, against its check_in_from / check_out_until:
 * [{ city, hotel, dateIn, reach, dateOut, leave, leaveBy, early, overnight, late }] with reach/leave
 * "YYYY-MM-DDTHH:MM". early = before check-in time; overnight = after midnight (the day after check-in);
 * late = pickup after check-out time.
 */
export function stayTimes(stays, moves) {
  return stays.map((s, i) => {
    const reach = legEnd(i === 0 ? s.arrive : moves[i - 1]);
    const last = i === stays.length - 1;
    const leave = last ? s.depart.start : moves[i].start;
    return {
      city: s.city, hotel: s.hotel, dateIn: s.checkIn, reach, dateOut: s.checkOut, leave,
      leaveBy: last ? 'airport transfer' : `transfer to ${moves[i].t.to_city}`,
      early: reach < `${s.checkIn}T${s.hotel.check_in_from}`,
      overnight: reach.slice(0, 10) > s.checkIn,
      late: leave > `${s.checkOut}T${s.hotel.check_out_until}`,
    };
  });
}

/** Is the arrival ('in') or departure ('out') side of this stay a problem? */
export const stayProblem = (st, which) => (which === 'in' ? st.early || st.overnight : st.late);

/** Problem lines for one stay, for 'in', 'out' or both sides; [] when the times fit the hotel's. */
export function stayTimeText(st, which) {
  const out = [];
  const { name, check_in_from: inFrom, check_out_until: outBy } = st.hotel;
  const at = (dt) => `${clock(dt)} on ${dt.slice(0, 10)}`;
  if (which !== 'out' && st.early) {
    out.push(`Check-in at ${name} is from ${inFrom}; you arrive at ${at(st.reach)} ` +
      `(${hm(toMinutes(inFrom) - toMinutes(clock(st.reach)))} early). Ask for early check-in or leave your bags at the desk.`);
  }
  if (which !== 'out' && st.overnight) {
    out.push(`You reach ${name} at ${at(st.reach)}, after midnight on your check-in day ${st.dateIn}. ` +
      'Tell the hotel you will arrive late so the room is held.');
  }
  if (which !== 'in' && st.late) {
    out.push(`Check-out at ${name} is by ${outBy}; your ${st.leaveBy} pickup is at ${at(st.leave)}. ` +
      'Ask for late check-out or store your luggage.');
  }
  return out;
}

/** The "it fits" line: "You reach X at 16:10 on …, after its 15:00 check-in." / pickup before check-out. */
export function stayTimeOk(st, which) {
  const { name, check_in_from: inFrom, check_out_until: outBy } = st.hotel;
  return which === 'in'
    ? `You reach ${name} at ${clock(st.reach)} on ${st.reach.slice(0, 10)}, after its ${inFrom} check-in.`
    : `Pickup from ${name} at ${clock(st.leave)} on ${st.leave.slice(0, 10)}, before its ${outBy} check-out.`;
}

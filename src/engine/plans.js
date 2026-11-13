// City plans and flight pairs: every legal ordered city split for a country and night count (problem §4
// "Dates and cities"), and every outbound/return flight pair that fits the plan, the dates and the seats.
import {
  destinations, intercityTransfers, airportsServing, flightsArriving, flightsDeparting,
} from './catalog.js';
import { addDays } from './time.js';

/**
 * All plans [{ city, nights }, …]: distinct cities of the country, each ≥ min_nights_per_city nights,
 * nights summing to `nights`, and a destinations.json link between each pair of consecutive cities.
 */
export function cityPlans(countryName, nights) {
  const country = destinations.countries.find((c) => c.name === countryName);
  if (!country) return [];
  const min = destinations.rules.min_nights_per_city;
  const cities = country.cities.map((c) => c.name);
  const plans = [];
  const extend = (plan, left) => {
    if (left === 0) {
      plans.push(plan);
      return;
    }
    const last = plan.at(-1)?.city;
    for (const city of cities) {
      if (plan.some((p) => p.city === city)) continue;
      if (last && intercityTransfers(last, city).length === 0) continue;
      for (let n = min; n <= left; n++) {
        if (left - n !== 0 && left - n < min) continue; // the rest must fit another city
        extend([...plan, { city, nights: n }], left - n);
      }
    }
  };
  extend([], nights);
  return plans;
}

/** Seats still free on a flight after our own confirmed bookings. */
export function seatsFree(flight, ctx) {
  return flight.seats_left - (ctx?.booked?.flights?.[flight.flight_id] ?? 0);
}

/** Outbound flights home → first city landing on startDate, with enough free seats. */
export function outboundFlights(home, firstCity, startDate, travelers, ctx) {
  return airportsServing(firstCity)
    .flatMap((ap) => flightsArriving(home, ap, startDate))
    .filter((f) => seatsFree(f, ctx) >= travelers);
}

/** Return flights last city → home leaving on endDate, with enough free seats. */
export function returnFlights(home, lastCity, endDate, travelers, ctx) {
  return airportsServing(lastCity)
    .flatMap((ap) => flightsDeparting(ap, home, endDate))
    .filter((f) => seatsFree(f, ctx) >= travelers);
}

/** Every (outbound, return) pair for a plan; endDate = startDate + total nights. */
export function flightPairs(req, plan, ctx) {
  const travelers = req.adults + req.childAges.length;
  const end = addDays(req.startDate, req.nights);
  const outs = outboundFlights(req.departureAirport, plan[0].city, req.startDate, travelers, ctx);
  const rets = returnFlights(req.departureAirport, plan.at(-1).city, end, travelers, ctx);
  return outs.flatMap((out) => rets.map((ret) => ({ out, ret })));
}

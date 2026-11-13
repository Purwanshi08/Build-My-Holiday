// Request checks: validateRequest (field errors → INVALID_REQUEST) and windowReason (data window → NO_PACKAGE).
// Moved out of stub.js so the real engine and the stub share one implementation (docs/CONTRACT.md §1).
import { destinations } from './catalog.js';
import { addDays } from './time.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date "YYYY-MM-DD" (rejects 2027-02-30). */
export function isRealDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && addDays(s, 0) === s;
}

/** { field: message } for malformed or out-of-range fields; {} when the request is valid. */
export function validateRequest(req) {
  const errors = {};
  const r = req || {};
  const { rules } = destinations;
  if (!destinations.departure_cities.some((d) => d.airport === r.departureAirport)) {
    errors.departureAirport = 'Choose a departure city from the list.';
  }
  if (!destinations.countries.some((c) => c.name === r.country)) {
    errors.country = 'Choose a destination country from the list.';
  }
  if (!isRealDate(r.startDate)) errors.startDate = 'Enter a real date as YYYY-MM-DD.';
  if (!Number.isInteger(r.nights) || r.nights < rules.min_nights || r.nights > rules.max_nights) {
    errors.nights = `Nights must be a whole number from ${rules.min_nights} to ${rules.max_nights}.`;
  }
  if (!Number.isInteger(r.adults) || r.adults < 1) errors.adults = 'At least 1 adult is required.';
  if (!Array.isArray(r.childAges) || !r.childAges.every((a) => Number.isInteger(a) && a >= 0 && a <= 17)) {
    errors.childAges = 'Each child age must be a whole number from 0 to 17.';
  }
  if (!Number.isInteger(r.budgetInr) || r.budgetInr < 1) {
    errors.budgetInr = 'Budget must be a whole number of rupees above 0.';
  }
  if (r.includeStay !== undefined && typeof r.includeStay !== 'boolean') {
    errors.includeStay = 'includeStay must be true or false.';
  }
  return errors;
}

/** NO_PACKAGE reason when a valid request leaves 1–20 April 2027, else null. */
export function windowReason(req) {
  const { first_night, last_departure } = destinations.rules.data_window;
  const lastNight = addDays(req.startDate, req.nights - 1);
  const end = addDays(req.startDate, req.nights);
  if (req.startDate >= first_night && lastNight < last_departure && end <= last_departure) return null;
  return (
    `Flights and rooms are only available from 1 to 20 April 2027. This trip runs ${req.startDate} to ${end}; ` +
    'choose a start date and nights so the return is on or before 20 April 2027.'
  );
}

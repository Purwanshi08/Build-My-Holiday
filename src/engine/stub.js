// Stub engine: hardcoded but catalog-accurate responses for every contract function (docs/CONTRACT.md),
// so the server and UI can be built before the real engine exists. Uses real catalog IDs and prices.
import { readFileSync } from 'node:fs';

const destinations = JSON.parse(
  readFileSync(new URL('../../data/catalog/destinations.json', import.meta.url), 'utf8'),
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Date-only arithmetic via the UTC trick allowed by CLAUDE.md rule 4.
function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isRealDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && addDays(s, 0) === s;
}

const clone = (x) => structuredClone(x);
const sum = (items) => items.reduce((t, i) => t + i.price_inr, 0);

export function getMeta() {
  return {
    departure_cities: destinations.departure_cities.map(({ airport, city }) => ({ airport, city })),
    countries: destinations.countries.map((c) => ({
      code: c.code,
      name: c.name,
      cities: c.cities.map((x) => x.name),
    })),
    rules: clone(destinations.rules),
  };
}

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
  return errors;
}

// --- The Menon package (BLR -> Japan, 2027-04-10, 6 nights, 2 adults + child 6, budget 3,50,000) ---
// Prices: flights price_per_seat x 3; hotels price_per_night x rooms x nights;
// PER_PERSON transfers/attractions 2 x price + 1 x child_price.
const item = (o) => ({ status: 'PLANNED', room_id: null, booking: null, sources: [], warnings: [], ...o });

const MENON_ITEMS = [
  item({ item_id: 'i1', type: 'flight', name: 'AV 520 BLR to NRT', city: 'Tokyo', catalog_id: 'FL-401',
    start: '2027-04-09T23:50', end: '2027-04-10T10:30', quantity: 3, price_inr: 75600 }),
  item({ item_id: 'i2', type: 'transfer', name: 'Narita limousine bus to Ueno', city: 'Tokyo',
    catalog_id: 'TR-NRT-UEN-BUS', start: '2027-04-10T11:30', end: '2027-04-10T13:00', quantity: 3, price_inr: 4480 }),
  item({ item_id: 'i3', type: 'hotel', name: 'Ueno Garden Inn', city: 'Tokyo', catalog_id: 'HTL-TYO-004',
    room_id: 'RM-TYO-004-B', start: '2027-04-10', end: '2027-04-13', quantity: 1, price_inr: 28392 }),
  item({ item_id: 'i4', type: 'attraction', name: 'Ueno Park', city: 'Tokyo', catalog_id: 'ATT-TYO-008',
    start: '2027-04-10T15:00', end: '2027-04-10T16:30', quantity: 3, price_inr: 0 }),
  item({ item_id: 'i5', type: 'attraction', name: 'Senso-ji', city: 'Tokyo', catalog_id: 'ATT-TYO-004',
    start: '2027-04-11T09:00', end: '2027-04-11T10:00', quantity: 3, price_inr: 0 }),
  item({ item_id: 'i6', type: 'attraction', name: 'Tokyo Skytree', city: 'Tokyo', catalog_id: 'ATT-TYO-007',
    start: '2027-04-11T11:00', end: '2027-04-11T12:30', quantity: 3, price_inr: 2884 }),
  item({ item_id: 'i7', type: 'attraction', name: 'teamLab Planets TOKYO', city: 'Tokyo', catalog_id: 'ATT-TYO-001',
    start: '2027-04-12T10:00', end: '2027-04-12T12:00', quantity: 3, price_inr: 5096 }),
  item({ item_id: 'i8', type: 'attraction', name: 'Meiji Jingu', city: 'Tokyo', catalog_id: 'ATT-TYO-010',
    start: '2027-04-12T14:00', end: '2027-04-12T15:00', quantity: 3, price_inr: 0 }),
  item({ item_id: 'i9', type: 'transfer', name: 'Shinkansen Tokyo to Kyoto', city: 'Kyoto', catalog_id: 'TR-TYO-KYO-01',
    start: '2027-04-13T10:00', end: '2027-04-13T12:15', quantity: 3, price_inr: 19838 }),
  item({ item_id: 'i10', type: 'hotel', name: 'Sakura Garden Hotel', city: 'Kyoto', catalog_id: 'HTL-KYO-004',
    room_id: 'RM-KYO-004-B', start: '2027-04-13', end: '2027-04-16', quantity: 1, price_inr: 24360 }),
  item({ item_id: 'i11', type: 'attraction', name: 'Sanjusangen-do', city: 'Kyoto', catalog_id: 'ATT-KYO-010',
    start: '2027-04-13T15:00', end: '2027-04-13T15:45', quantity: 3, price_inr: 840 }),
  item({ item_id: 'i12', type: 'attraction', name: 'Kiyomizu-dera', city: 'Kyoto', catalog_id: 'ATT-KYO-001',
    start: '2027-04-14T09:00', end: '2027-04-14T10:30', quantity: 3, price_inr: 672 }),
  item({ item_id: 'i13', type: 'attraction', name: 'Fushimi Inari Taisha', city: 'Kyoto', catalog_id: 'ATT-KYO-002',
    start: '2027-04-14T12:00', end: '2027-04-14T14:00', quantity: 3, price_inr: 0 }),
  item({ item_id: 'i14', type: 'attraction', name: 'Kinkaku-ji', city: 'Kyoto', catalog_id: 'ATT-KYO-003',
    start: '2027-04-15T10:00', end: '2027-04-15T11:00', quantity: 3, price_inr: 728 }),
  item({ item_id: 'i15', type: 'attraction', name: 'Kyoto Aquarium', city: 'Kyoto', catalog_id: 'ATT-KYO-011',
    start: '2027-04-15T13:00', end: '2027-04-15T15:00', quantity: 3, price_inr: 3360 }),
  item({ item_id: 'i16', type: 'transfer', name: 'Kansai limousine bus to Kyoto', city: 'Kyoto',
    catalog_id: 'TR-KIX-KYO-BUS', start: '2027-04-16T07:00', end: '2027-04-16T08:40', quantity: 3, price_inr: 3920 }),
  item({ item_id: 'i17', type: 'flight', name: 'AV 515 KIX to BLR', city: 'Bengaluru', catalog_id: 'FL-411',
    start: '2027-04-16T12:00', end: '2027-04-16T18:00', quantity: 3, price_inr: 78120 }),
];

const MENON_TOTAL = sum(MENON_ITEMS); // 248290

function menonPackage(req, label) {
  const id = `pkg-stub-${label}`;
  const budget = req?.budgetInr ?? 350000;
  return {
    id,
    label,
    trip_id: id,
    traveler: { name: 'Traveler', home_airport: 'BLR', adults: 2, children: 1, child_ages: [6] },
    start_date: '2027-04-10',
    end_date: '2027-04-16',
    country: 'Japan',
    budget_inr: budget,
    total_inr: MENON_TOTAL,
    left_inr: budget - MENON_TOTAL,
    status: 'PLANNED',
    metrics: { travel_minutes: 430 + 135 + 570, avg_stars: 3.5 },
    plan: [
      { city: 'Tokyo', nights: 3, check_in: '2027-04-10', check_out: '2027-04-13',
        hotel_id: 'HTL-TYO-004', room_id: 'RM-TYO-004-B', rooms: 1 },
      { city: 'Kyoto', nights: 3, check_in: '2027-04-13', check_out: '2027-04-16',
        hotel_id: 'HTL-KYO-004', room_id: 'RM-KYO-004-B', rooms: 1 },
    ],
    items: clone(MENON_ITEMS),
  };
}

const result = (o) => ({
  status: 'OK', packages: [], cheapest_total: null, over_by: 0, suggestions: [], reasons: [], errors: {}, ...o,
});

export function buildPackages(req, _ctx) {
  const errors = validateRequest(req);
  if (Object.keys(errors).length) return result({ status: 'INVALID_REQUEST', errors });

  // Data window: start, last night and return day must all lie in 2027-04-01..2027-04-20 -> else NO_PACKAGE.
  const { first_night, last_departure } = destinations.rules.data_window;
  const lastNight = addDays(req.startDate, req.nights - 1);
  const end = addDays(req.startDate, req.nights);
  if (req.startDate < first_night || req.startDate > last_departure || lastNight >= last_departure || end > last_departure) {
    return result({
      status: 'NO_PACKAGE',
      reasons: [
        `Flights and rooms are only available from 1 to 20 April 2027. This trip runs ${req.startDate} to ${end}; ` +
          'choose a start date and nights so the return is on or before 20 April 2027.',
      ],
    });
  }
  if (req.country !== 'Japan') {
    return result({ status: 'NO_PACKAGE', reasons: [`Stub engine only knows a Japan package (asked: ${req.country}).`] });
  }
  if (req.budgetInr < MENON_TOTAL) {
    return result({
      status: 'OVER_BUDGET',
      cheapest_total: MENON_TOTAL,
      over_by: MENON_TOTAL - req.budgetInr,
      suggestions: [
        `Raise the budget to at least ₹${MENON_TOTAL.toLocaleString('en-IN')}.`,
        'Try fewer nights (for example 4).',
      ],
    });
  }
  return result({
    packages: ['cheapest', 'fastest', 'best_rated'].map((l) => menonPackage(req, l)),
    cheapest_total: MENON_TOTAL,
  });
}

export function validatePackage(_pkg, _ctx) {
  return [];
}

export function getOptions(_pkg, query, _ctx) {
  switch (query?.kind) {
    case 'hotel':
      if (query.city === 'Kyoto') {
        return [
          { id: 'HTL-KYO-004|RM-KYO-004-B', label: 'Sakura Garden Hotel — Family Room ×1', price_delta_inr: 0,
            valid: true, reason: null, detail: { stars: 4, area: 'Higashiyama', current: true } },
          { id: 'HTL-KYO-002|RM-KYO-002-B', label: 'Kyoto Hills Hotel — Family Room ×1', price_delta_inr: 7392,
            valid: true, reason: null, detail: { stars: 4, area: 'Higashiyama' } },
          { id: 'HTL-KYO-011|RM-KYO-011-C', label: 'Kyoto Tower View Hotel — Family Room ×1', price_delta_inr: 4032,
            valid: true, reason: null, detail: { stars: 3, area: 'Kyoto Station' } },
        ];
      }
      return [
        { id: 'HTL-TYO-004|RM-TYO-004-B', label: 'Ueno Garden Inn — Family Room ×1', price_delta_inr: 0,
          valid: true, reason: null, detail: { stars: 3, area: 'Ueno', current: true } },
        { id: 'HTL-TYO-001|RM-TYO-001-B', label: 'Ginza Pearl Hotel — Family Room ×1', price_delta_inr: 0,
          valid: false, reason: 'No Family Room left on 2027-04-12.', detail: { stars: 4, area: 'Ginza' } },
        { id: 'HTL-TYO-003|RM-TYO-003-C', label: 'Asakusa River Hotel — Family Room ×1', price_delta_inr: 2856,
          valid: true, reason: null, detail: { stars: 3, area: 'Asakusa' } },
      ];
    case 'flight':
      return query.direction === 'return'
        ? [{ id: 'FL-411', label: 'AV 515 KIX 12:00 → BLR 18:00', price_delta_inr: 0, valid: true, reason: null,
            detail: { current: true } }]
        : [
            { id: 'FL-401', label: 'AV 520 BLR 23:50 → NRT 10:30', price_delta_inr: 0, valid: true, reason: null,
              detail: { current: true } },
            { id: 'FL-403', label: 'HND arrival 08:30', price_delta_inr: 0, valid: false,
              reason: 'Only 2 seats left; 3 travelers.', detail: {} },
          ];
    case 'attraction':
      return [
        { id: 'ATT-KYO-008', label: 'Kyoto Railway Museum', price_delta_inr: 1960, valid: true, reason: null,
          detail: { date: '2027-04-15', start: '15:00', end: '17:00' } },
      ];
    case 'city_plan':
      return [
        { id: 'Tokyo:3|Kyoto:3', label: 'Tokyo 3 nights → Kyoto 3 nights', price_delta_inr: 0, valid: true,
          reason: null, detail: { cities: [{ city: 'Tokyo', nights: 3 }, { city: 'Kyoto', nights: 3 }], current: true } },
      ];
    default:
      return [];
  }
}

export function applyChange(pkg, change, _ctx) {
  if (change?.type === 'remove_attraction') {
    const target = pkg.items.find((i) => i.item_id === change.item_id && i.type === 'attraction');
    if (!target) return { ok: false, package: pkg, delta_inr: 0, warnings: [], reasons: ['No such attraction in the package.'] };
    const next = clone(pkg);
    next.items = next.items.filter((i) => i.item_id !== change.item_id);
    next.total_inr = sum(next.items);
    next.left_inr = next.budget_inr - next.total_inr;
    return { ok: true, package: next, delta_inr: next.total_inr - pkg.total_inr, warnings: [], reasons: [] };
  }
  return {
    ok: false, package: pkg, delta_inr: 0, warnings: [],
    reasons: [`Stub engine cannot apply "${change?.type}" yet.`],
  };
}

export function exportTrip(pkg) {
  const { trip_id, traveler, start_date, end_date, country, budget_inr, total_inr, status, items } = pkg;
  return clone({ trip_id, traveler, start_date, end_date, country, budget_inr, total_inr, status, items });
}

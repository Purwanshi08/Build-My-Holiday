// Tests for validatePackage (one hand-built valid Menon package, then one broken copy per rule) and for
// exportTrip (shared trip format, booked status/reference, and an exported valid package still validates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePackage } from '../src/engine/validate.js';
import { exportTrip } from '../src/engine/export.js';
import * as engine from '../src/engine/index.js';
import * as cat from '../src/engine/catalog.js';

// ---------- the valid Menon package: BLR → Tokyo 3 nights → Kyoto 3 nights, 2027-04-10..16 ----------
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
const sum = (items) => items.reduce((t, i) => t + i.price_inr, 0);

function menon() {
  return structuredClone({
    id: 'pkg-test', trip_id: 'pkg-test', label: 'cheapest',
    traveler: { name: 'Menon family', home_airport: 'BLR', adults: 2, children: 1, child_ages: [6] },
    start_date: '2027-04-10', end_date: '2027-04-16', country: 'Japan',
    budget_inr: 350000, total_inr: sum(MENON_ITEMS), left_inr: 350000 - sum(MENON_ITEMS), status: 'PLANNED',
    plan: [], metrics: {}, items: MENON_ITEMS,
  });
}
const NO_CTX = { booked: { flights: {}, rooms: {} } };

/** Menon package changed by fn (item edits by id), total re-summed unless keepTotal. */
function broken(fn, { keepTotal = false } = {}) {
  const p = menon();
  const at = (id) => p.items.find((i) => i.item_id === id);
  fn(p, at);
  if (!keepTotal) p.total_inr = sum(p.items);
  return p;
}
const drop = (p, ...ids) => { p.items = p.items.filter((i) => !ids.includes(i.item_id)); };

function assertBreaks(pkg, re, ctx = NO_CTX) {
  const v = validatePackage(pkg, ctx);
  assert.ok(v.some((m) => re.test(m)), `expected a violation matching ${re}, got:\n${v.join('\n') || '(none)'}`);
}

const flightWhere = (fn) => {
  const f = cat.flights.find(fn);
  assert.ok(f, 'catalog flight for test not found');
  return f;
};
const asFlightItem = (it, f) => {
  it.catalog_id = f.flight_id;
  it.start = f.departure_local.slice(0, 16);
  it.end = f.arrival_local.slice(0, 16);
  it.price_inr = f.price_per_seat.amount * 3;
};

// ---------- valid ----------
test('hand-built Menon package is valid', () => {
  assert.deepEqual(validatePackage(menon(), NO_CTX), []);
  assert.deepEqual(validatePackage(menon(), undefined), []);
});

test('prices within 1% are accepted', () => {
  const p = broken((_, at) => { at('i3').price_inr += 200; }); // 28592 vs 28392 = 0.7%
  assert.deepEqual(validatePackage(p, NO_CTX), []);
});

// ---------- dates and cities ----------
test('trip length must be 3–10 nights', () => {
  assertBreaks(broken((p) => { p.end_date = '2027-04-12'; }), /must have 3 to 10/);
  assertBreaks(broken((p) => { p.end_date = '2027-04-21'; }), /must have 3 to 10/);
});

test('trip must stay inside 1–20 April 2027', () => {
  assertBreaks(broken((p) => { p.start_date = '2027-03-31'; }), /before 2027-04-01/);
  assertBreaks(broken((p) => { p.end_date = '2027-04-21'; }), /after 2027-04-20/);
});

test('cities must be in the chosen country', () => {
  assertBreaks(broken((p) => { p.country = 'United Arab Emirates'; }), /City Tokyo is not in United Arab Emirates/);
});

test('each city appears once in the plan', () => {
  const p = broken((p, at) => {
    at('i3').end = '2027-04-12'; at('i3').price_inr = 9464 * 2;
    at('i10').start = '2027-04-12'; at('i10').end = '2027-04-14'; at('i10').price_inr = 8120 * 2;
    p.items.push(item({ item_id: 'i30', type: 'hotel', name: 'Ueno Garden Inn', city: 'Tokyo', catalog_id: 'HTL-TYO-004',
      room_id: 'RM-TYO-004-B', start: '2027-04-14', end: '2027-04-16', quantity: 1, price_inr: 9464 * 2 }));
  });
  assertBreaks(p, /Tokyo appears more than once/);
});

test('each city has at least 2 nights in a row', () => {
  const p = broken((_, at) => {
    at('i3').end = '2027-04-15'; at('i3').price_inr = 9464 * 5;
    at('i10').start = '2027-04-15'; at('i10').price_inr = 8120;
  });
  assertBreaks(p, /Kyoto has 1 night/);
});

// ---------- flights ----------
test('exactly one arrival and one return flight', () => {
  assertBreaks(broken((p) => { p.items.push({ ...structuredClone(p.items[0]), item_id: 'i40' }); }), /exactly 1 arrival flight/);
  assertBreaks(broken((p) => drop(p, 'i17')), /exactly 1 return flight/);
});

test('arrival flight lands on the start date', () => {
  const f = flightWhere((x) => x.from === 'BLR' && x.to === 'NRT' && x.arrival_local.startsWith('2027-04-11'));
  assertBreaks(broken((_, at) => asFlightItem(at('i1'), f)), /lands on 2027-04-11, not the start date/);
});

test('arrival airport serves the first city', () => {
  const f = flightWhere((x) => x.from === 'BLR' && x.to === 'KIX' && x.arrival_local.startsWith('2027-04-10'));
  assertBreaks(broken((_, at) => asFlightItem(at('i1'), f)), /lands at KIX, which does not serve Tokyo/);
});

test('return flight leaves on the last day', () => {
  const f = flightWhere((x) => x.from === 'KIX' && x.to === 'BLR' && x.departure_local.startsWith('2027-04-15'));
  assertBreaks(broken((_, at) => asFlightItem(at('i17'), f)), /not the last day 2027-04-16/);
});

test('return airport serves the last city', () => {
  const kyoto = cat.airportsServing('Kyoto');
  const f = flightWhere((x) => x.to === 'BLR' && !kyoto.includes(x.from) && x.departure_local.startsWith('2027-04-16'));
  assertBreaks(broken((_, at) => asFlightItem(at('i17'), f)), new RegExp(`leaves from ${f.from}, which does not serve Kyoto`));
});

test('seats_left minus our bookings covers every traveler', () => {
  assertBreaks(menon(), /FL-401.*only 2 seat\(s\) left for 3/, { booked: { flights: { 'FL-401': 7 }, rooms: {} } });
});

// ---------- airport transfers ----------
test('two airport transfers are needed', () => {
  assertBreaks(broken((p) => drop(p, 'i16')), /exactly 2 airport transfers/);
});

test('airport transfer serves the hotel area', () => {
  const p = broken((_, at) => { at('i2').catalog_id = 'TR-NRT-ASA-TAXI'; at('i2').end = '2027-04-10T12:45'; at('i2').quantity = 1; at('i2').price_inr = 13440; });
  assertBreaks(p, /serves Asakusa, hotel is in Ueno/);
});

test('arrival pickup is at least 60 min after landing', () => {
  const p = broken((_, at) => { at('i2').start = '2027-04-10T11:00'; at('i2').end = '2027-04-10T12:30'; });
  assertBreaks(p, /less than 60 min after landing/);
});

test('traveler reaches the return airport 180 min before departure', () => {
  const p = broken((_, at) => { at('i16').start = '2027-04-16T07:30'; at('i16').end = '2027-04-16T09:10'; });
  assertBreaks(p, /must be by 2027-04-16T09:00/);
});

test('airport pickup is inside service hours', () => {
  const p = broken((_, at) => { at('i16').start = '2027-04-16T06:00'; at('i16').end = '2027-04-16T07:40'; });
  assertBreaks(p, /pickup 06:00 is outside service hours 06:30–22:30/);
});

// ---------- transfers between cities ----------
test('a city-change day needs a transfer between cities', () => {
  assertBreaks(broken((p) => drop(p, 'i9')), /No transfer from Tokyo to Kyoto on 2027-04-13/);
});

test('the transfer between cities comes from the matching link', () => {
  assertBreaks(broken((_, at) => { at('i9').catalog_id = 'TR-KYO-TYO-01'; }), /not a Tokyo → Kyoto transfer/);
});

test('the transfer between cities is inside service hours', () => {
  const p = broken((_, at) => { at('i9').start = '2027-04-13T22:00'; at('i9').end = '2027-04-14T00:15'; });
  assertBreaks(p, /departure 22:00 is outside service hours 06:00–21:30/);
});

// ---------- hotels ----------
test('one hotel and one room type per city', () => {
  const p = broken((p, at) => {
    at('i10').end = '2027-04-15'; at('i10').price_inr = 8120 * 2;
    p.items.push(item({ item_id: 'i31', type: 'hotel', name: 'Kyoto Hills Hotel', city: 'Kyoto', catalog_id: 'HTL-KYO-002',
      room_id: 'RM-KYO-002-B', start: '2027-04-15', end: '2027-04-16', quantity: 1, price_inr: 10584 }));
  });
  assertBreaks(p, /Kyoto uses more than one hotel or room type/);
});

test('k rooms fit the travelers', () => {
  assertBreaks(broken((_, at) => { at('i3').quantity = 3; at('i3').price_inr = 9464 * 9; }), /3 × RM-TYO-004-B does not fit/);
});

test('rooms_left minus our bookings covers k on every night', () => {
  const ctx = { booked: { flights: {}, rooms: { 'RM-KYO-004-B|2027-04-14': 7 } } };
  assertBreaks(menon(), /only 0 RM-KYO-004-B left on 2027-04-14/, ctx);
});

test('a hotel for every night, none on the last day', () => {
  assertBreaks(broken((_, at) => { at('i3').end = '2027-04-12'; at('i3').price_inr = 9464 * 2; }), /No hotel for the night of 2027-04-12/);
  assertBreaks(broken((_, at) => { at('i10').end = '2027-04-17'; at('i10').price_inr = 8120 * 4; }), /hotel night on\/after the last day/);
});

// ---------- attractions ----------
test("attraction is in the city of that night's hotel", () => {
  const p = broken((_, at) => Object.assign(at('i14'), { catalog_id: 'ATT-TYO-004', name: 'Senso-ji', city: 'Tokyo', price_inr: 0 }));
  assertBreaks(p, /Senso-ji is in Tokyo, but the night of 2027-04-15 is in Kyoto/);
});

test('attraction is open that weekday', () => {
  // ATT-TYO-005 is closed on Mondays; 2027-04-12 is a Monday.
  const a = cat.attractionById.get('ATT-TYO-005');
  const p = broken((_, at) => Object.assign(at('i8'), { catalog_id: a.attraction_id, name: a.name,
    start: '2027-04-12T14:00', end: '2027-04-12T16:00', price_inr: 2 * a.price_per_person.amount + (a.child_price ?? a.price_per_person).amount }));
  assertBreaks(p, /closed on MON \(2027-04-12\)/);
});

test('attraction is not visited on a closed date', () => {
  const a = cat.attractionById.get('ATT-TYO-006'); // closed_dates include 2027-04-11
  const p = broken((_, at) => Object.assign(at('i6'), { catalog_id: a.attraction_id, name: a.name,
    start: '2027-04-11T11:00', end: '2027-04-11T12:00', price_inr: 2 * a.price_per_person.amount + (a.child_price ?? a.price_per_person).amount }));
  assertBreaks(p, /is closed on 2027-04-11/);
});

test('the visit fits inside opening hours', () => {
  const p = broken((_, at) => { at('i14').start = '2027-04-15T16:30'; at('i14').end = '2027-04-15T17:30'; });
  assertBreaks(p, /visit 16:30\+60 min is outside 09:00–17:00/);
});

test('visits on the same day do not overlap', () => {
  const p = broken((_, at) => { at('i13').start = '2027-04-14T10:00'; at('i13').end = '2027-04-14T12:00'; });
  assertBreaks(p, /i13 \(ATT-KYO-002\) starts at 2027-04-14T10:00 before i12/);
});

test('each attraction at most once', () => {
  const p = broken((_, at) => Object.assign(at('i15'), { catalog_id: 'ATT-KYO-003', name: 'Kinkaku-ji',
    start: '2027-04-15T13:00', end: '2027-04-15T14:00', price_inr: 728 }));
  assertBreaks(p, /ATT-KYO-003 is in the package more than once/);
});

test('1–2 attractions on every full day', () => {
  assertBreaks(broken((p) => drop(p, 'i5', 'i6')), /Full day 2027-04-11 has 0 attraction/);
  const three = broken((p) => p.items.push(item({ item_id: 'i50', type: 'attraction', name: 'Ueno Park', city: 'Tokyo',
    catalog_id: 'ATT-TYO-008', start: '2027-04-11T15:00', end: '2027-04-11T16:30', quantity: 3, price_inr: 0 })));
  drop(three, 'i4');
  assertBreaks(three, /Full day 2027-04-11 has 3 attraction/);
});

test('no attractions on the last day', () => {
  const p = broken((p) => p.items.push(item({ item_id: 'i51', type: 'attraction', name: 'Kyoto Railway Museum', city: 'Kyoto',
    catalog_id: 'ATT-KYO-008', start: '2027-04-16T10:00', end: '2027-04-16T12:00', quantity: 3, price_inr: 0 })));
  assertBreaks(p, /attraction on the last day 2027-04-16/);
});

test('arrival-day and city-change-day attractions start after reaching the city', () => {
  const arrival = broken((_, at) => { at('i4').start = '2027-04-10T12:30'; at('i4').end = '2027-04-10T14:00'; });
  assertBreaks(arrival, /before the traveler reaches the city at 2027-04-10T13:00/);
  const change = broken((_, at) => { at('i11').start = '2027-04-13T12:00'; at('i11').end = '2027-04-13T12:45'; });
  assertBreaks(change, /before the traveler reaches the city at 2027-04-13T12:15/);
});

// ---------- prices, quantities, format ----------
test('item price matches the catalog formula', () => {
  assertBreaks(broken((_, at) => { at('i3').price_inr = 30000; }), /i3 \(HTL-TYO-004\): price ₹30000, catalog price is ₹28392/);
});

test('total is the sum of item prices', () => {
  assertBreaks(broken((p) => { p.total_inr += 1; }, { keepTotal: true }), /not the sum of item prices/);
});

test('quantities are seats, tickets or vehicles for every traveler', () => {
  assertBreaks(broken((_, at) => { at('i5').quantity = 2; }), /i5 \(ATT-TYO-004\): quantity 2, expected 3/);
});

test('item fields follow the shared trip format', () => {
  assertBreaks(broken((_, at) => { at('i5').catalog_id = 'ATT-XXX-999'; }), /"ATT-XXX-999" is not in the catalog/);
  assertBreaks(broken((_, at) => { at('i5').sources = ['web']; }), /sources must be an empty list/);
  assertBreaks(broken((_, at) => { at('i6').item_id = 'i5'; }), /item_id i5 is used more than once/);
  assertBreaks(broken((_, at) => { at('i1').start = '2027-04-09T22:00'; }), /times must be the catalog's/);
});

test('booked package: every item BOOKED with a 10-digit string reference', () => {
  assertBreaks(broken((p) => { p.status = 'BOOKED'; }), /booking.reference must be a 10-digit string/);
});

test('garbage input does not throw', () => {
  assert.ok(validatePackage(null).length > 0);
  assert.ok(validatePackage({ items: [null, 5, {}] }).length > 0);
});

// ---------- export ----------
test('exportTrip gives the shared trip format', () => {
  const ex = exportTrip(menon());
  assert.deepEqual(Object.keys(ex).sort(),
    ['budget_inr', 'country', 'end_date', 'items', 'start_date', 'status', 'total_inr', 'traveler', 'trip_id'].sort());
  assert.equal(ex.country, 'Japan');
  assert.equal(ex.status, 'PLANNED');
  assert.equal(ex.total_inr, sum(MENON_ITEMS));
  for (const it of ex.items) {
    assert.deepEqual(it.sources, []);
    assert.equal(it.booking, null);
    if (it.type === 'hotel') assert.match(it.room_id, /^RM-/);
    else assert.equal(it.room_id, null);
  }
});

test('an exported valid package passes validatePackage', () => {
  assert.deepEqual(validatePackage(exportTrip(menon()), NO_CTX), []);
  const pkg = engine.buildPackages({ departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10',
    nights: 6, adults: 2, childAges: [6], budgetInr: 350000 }, NO_CTX).packages[0];
  assert.deepEqual(engine.validatePackage(engine.exportTrip(pkg), NO_CTX), []);
});

test('exported booked package carries the reference as a string on every item and still validates', () => {
  const p = menon();
  p.status = 'BOOKED';
  p.items.forEach((it) => { it.status = 'BOOKED'; it.booking = { reference: 4821930576 }; });
  const ex = exportTrip(p);
  assert.equal(ex.status, 'BOOKED');
  for (const it of ex.items) {
    assert.equal(it.status, 'BOOKED');
    assert.deepEqual(it.booking, { reference: '4821930576' });
  }
  assert.deepEqual(validatePackage(ex, NO_CTX), []);
});

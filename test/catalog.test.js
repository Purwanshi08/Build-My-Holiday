// Tests for src/engine/catalog.js: every catalog file loads once and is frozen, and each index
// (flights, hotels, rooms, availability, airport/intercity transfers, attractions) returns the right records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as cat from '../src/engine/catalog.js';

test('loads every JSON file in data/catalog with the documented record counts', () => {
  const names = readdirSync(cat.CATALOG_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  assert.deepEqual(Object.keys(cat.files).sort(), names.sort());
  assert.equal(cat.airports.length, 10);
  assert.equal(cat.flights.length, 469);
  assert.equal(cat.hotels.length, 49);
  assert.equal(cat.rooms.length, 125);
  assert.equal(cat.availability.length, 2500);
  assert.equal(cat.transfers.length, 66);
  assert.equal(cat.attractions.length, 56);
  assert.ok(cat.destinations.rules);
});

test('records are deep-frozen and lookups return frozen or fresh arrays', () => {
  assert.ok(Object.isFrozen(cat.flights));
  assert.ok(Object.isFrozen(cat.flights[0].price_per_seat));
  assert.throws(() => { cat.hotelsInCity('Kyoto').push({}); });
});

test('id maps find records', () => {
  assert.equal(cat.flightById.get('FL-711').to, 'KIX');
  assert.equal(cat.hotelById.get('HTL-TYO-001').area, 'Ginza');
  assert.equal(cat.roomById.get('RM-TYO-001-A').hotel_id, 'HTL-TYO-001');
  assert.equal(cat.transferById.get('TR-NRT-ASA-TAXI').max_passengers, 4);
  assert.equal(cat.attractionById.get('ATT-KYO-001').city, 'Kyoto');
  assert.equal(cat.airportByCode.get('KIX').city, 'Osaka');
});

test('flights by from/to/date: arrival date (outbound) and departure date (return)', () => {
  const out = cat.flightsArriving('BLR', 'KIX', '2027-04-03').map((f) => f.flight_id);
  assert.ok(out.includes('FL-711'));
  for (const id of out) assert.equal(cat.flightById.get(id).arrival_local.slice(0, 10), '2027-04-03');
  const ret = cat.flightsDeparting('KIX', 'BLR', '2027-04-10');
  assert.ok(ret.length > 0);
  for (const f of ret) assert.equal(f.departure_local.slice(0, 10), '2027-04-10');
  // Overnight flight: departs 31 March, arrives 1 April.
  assert.ok(cat.flightsArriving('DEL', 'HND', '2027-04-01').some((f) => f.flight_id === 'FL-1001'));
  assert.ok(cat.flightsDeparting('DEL', 'HND', '2027-03-31').some((f) => f.flight_id === 'FL-1001'));
  assert.deepEqual(cat.flightsArriving('BLR', 'KIX', '2027-05-01'), []);
});

test('hotels by city and rooms by hotel', () => {
  assert.equal(cat.hotelsInCity('Tokyo').length, 13);
  assert.equal(cat.hotelsInCity('Kyoto').length, 12);
  assert.equal(cat.hotelsInCity('Nara').length, 0);
  assert.deepEqual(cat.roomsOfHotel('HTL-TYO-001').map((r) => r.room_id), ['RM-TYO-001-A', 'RM-TYO-001-B']);
  assert.deepEqual(cat.roomsOfHotel('HTL-NOPE'), []);
});

test('availability by room + night; missing record = 0', () => {
  assert.equal(cat.roomsLeft('RM-TYO-001-A', '2027-04-01'), 7);
  assert.equal(cat.roomsLeft('RM-TYO-001-A', '2027-04-02'), 6);
  assert.equal(cat.roomsLeft('RM-TYO-001-A', '2027-04-21'), 0);
  assert.equal(cat.roomsLeft('RM-NOPE', '2027-04-02'), 0);
});

test('airport transfers by airport + city + area include all-areas (area null) records', () => {
  const asa = cat.airportTransfers('NRT', 'Tokyo', 'Asakusa').map((t) => t.transfer_id).sort();
  assert.deepEqual(asa, ['TR-NRT-ASA-BUS', 'TR-NRT-ASA-TAXI']);
  const kyoto = cat.airportTransfers('KIX', 'Kyoto', 'Gion').map((t) => t.transfer_id).sort();
  assert.deepEqual(kyoto, ['TR-KIX-KYO-BUS', 'TR-KIX-KYO-TAXI']);
  const corniche = cat.airportTransfers('AUH', 'Abu Dhabi', 'Corniche').map((t) => t.transfer_id).sort();
  assert.deepEqual(corniche, ['TR-AUH-ALL-BUS', 'TR-AUH-COR-TAXI']);
  assert.deepEqual(cat.airportTransfers('HND', 'Kyoto', 'Gion'), []);
  for (const t of cat.airportTransfers('NRT', 'Tokyo', 'Ginza')) assert.ok(t.airport && t.type.startsWith('AIRPORT'));
});

test('intercity transfers by from/to city follow destinations.json links (one-way)', () => {
  assert.deepEqual(cat.intercityTransfers('Tokyo', 'Kyoto').map((t) => t.transfer_id), ['TR-TYO-KYO-01']);
  assert.deepEqual(cat.intercityTransfers('Dubai', 'Abu Dhabi').map((t) => t.transfer_id),
    ['TR-DXB-AUH-BUS', 'TR-DXB-AUH-TAXI']);
  assert.deepEqual(cat.intercityTransfers('Tokyo', 'Dubai'), []);
  for (const c of cat.destinations.countries) {
    for (const l of c.links) {
      for (const t of cat.intercityTransfers(l.from_city, l.to_city)) {
        assert.equal(t.from_city, l.from_city);
        assert.equal(t.to_city, l.to_city);
      }
    }
  }
});

test('attractions by city', () => {
  const kyoto = cat.attractionsInCity('Kyoto');
  assert.ok(kyoto.some((a) => a.attraction_id === 'ATT-KYO-001'));
  for (const a of kyoto) assert.equal(a.city, 'Kyoto');
  assert.equal(cat.attractionsInCity('Nara').length, 2);
  assert.deepEqual(cat.attractionsInCity('Paris'), []);
});

test('airportsServing reads serves_cities', () => {
  assert.deepEqual(cat.airportsServing('Kyoto'), ['KIX']);
  assert.deepEqual(cat.airportsServing('Abu Dhabi').sort(), ['AUH', 'DXB']);
  assert.deepEqual(cat.airportsServing('Bengaluru'), []);
});

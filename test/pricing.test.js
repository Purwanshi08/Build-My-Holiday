// Tests for src/engine/pricing.js using real catalog records (plus a synthetic one where the catalog lacks the case):
// flight, hotel, PER_VEHICLE ceil, PER_PERSON child_price fallback, attractions and the minRooms fit rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightById, roomById, transferById, attractionById } from '../src/engine/catalog.js';
import {
  flightPrice, hotelPrice, perPersonPrice, vehiclesNeeded, transferQuantity,
  transferPrice, attractionPrice, minRooms,
} from '../src/engine/pricing.js';

const room = (max_adults, max_children) => ({ max_adults, max_children });

test('flightPrice = price_per_seat × all travelers', () => {
  const fl = flightById.get('FL-711'); // 25200 per seat
  assert.equal(flightPrice(fl, 1), 25200);
  assert.equal(flightPrice(fl, 3), 75600);
});

test('hotelPrice = price_per_night × rooms × nights', () => {
  const rm = roomById.get('RM-TYO-001-A'); // 6440 per night
  assert.equal(hotelPrice(rm, 1, 1), 6440);
  assert.equal(hotelPrice(rm, 2, 3), 38640);
});

test('perPersonPrice falls back to price when childPrice is null/undefined, keeps 0', () => {
  assert.equal(perPersonPrice(2, 1, 100, 40), 240);
  assert.equal(perPersonPrice(2, 1, 100, undefined), 300);
  assert.equal(perPersonPrice(2, 1, 100, null), 300);
  assert.equal(perPersonPrice(2, 1, 100, 0), 200);
  assert.equal(perPersonPrice(1, 0, 100, 40), 100);
});

test('vehiclesNeeded rounds up', () => {
  const taxi = transferById.get('TR-NRT-ASA-TAXI'); // 4 seats
  assert.equal(vehiclesNeeded(taxi, 1), 1);
  assert.equal(vehiclesNeeded(taxi, 4), 1);
  assert.equal(vehiclesNeeded(taxi, 5), 2);
  assert.equal(vehiclesNeeded(taxi, 9), 3);
  assert.equal(vehiclesNeeded(transferById.get('TR-NRT-SJK-VAN'), 8), 1);
});

test('transferPrice PER_VEHICLE = price × ceil(travelers / max_passengers); children count as passengers', () => {
  const taxi = transferById.get('TR-NRT-ASA-TAXI'); // 13440, 4 seats
  assert.equal(transferPrice(taxi, 2, 1), 13440);
  assert.equal(transferPrice(taxi, 4, 0), 13440);
  assert.equal(transferPrice(taxi, 3, 2), 26880);
  assert.equal(transferPrice(transferById.get('TR-NRT-SJK-VAN'), 6, 3), 42560); // 21280 × 2
});

test('transferPrice PER_PERSON uses child_price when present', () => {
  const train = transferById.get('TR-TYO-KYO-01'); // 7935 / child 3968
  assert.equal(transferPrice(train, 2, 1), 2 * 7935 + 3968);
  assert.equal(transferPrice(train, 1, 0), 7935);
});

test('transferPrice PER_PERSON without child_price charges price for children', () => {
  const synthetic = { transfer_id: 'X', pricing: 'PER_PERSON', max_passengers: 99, price: { amount: 500 } };
  assert.equal(transferPrice(synthetic, 2, 2), 2000);
});

test('transferPrice rejects unknown pricing', () => {
  assert.throws(() => transferPrice({ transfer_id: 'X', pricing: 'FLAT', price: { amount: 1 } }, 1, 0));
});

test('transferQuantity = vehicles or tickets', () => {
  assert.equal(transferQuantity(transferById.get('TR-NRT-ASA-TAXI'), 3, 2), 2);
  assert.equal(transferQuantity(transferById.get('TR-TYO-KYO-01'), 3, 2), 5);
});

test('attractionPrice uses child_price, or price_per_person when absent', () => {
  assert.equal(attractionPrice(attractionById.get('ATT-KYO-001'), 2, 1), 2 * 280 + 112);
  assert.equal(attractionPrice(attractionById.get('ATT-DXB-004'), 2, 1), 3 * 3412); // no child_price
  assert.equal(attractionPrice(attractionById.get('ATT-KYO-002'), 2, 2), 0); // free
});

test('minRooms: DATA_DICTIONARY example, 2 adults + 1 child', () => {
  assert.equal(minRooms(roomById.get('RM-TYO-001-A'), 2, 1), 2); // TWIN 2/0
  assert.equal(minRooms(roomById.get('RM-TYO-001-B'), 2, 1), 1); // FAMILY 2/2
});

test('minRooms: adults ≤ k·max_adults drives k', () => {
  assert.equal(minRooms(room(2, 0), 1, 0), 1);
  assert.equal(minRooms(room(2, 0), 2, 0), 1);
  assert.equal(minRooms(room(2, 0), 3, 0), 2);
  assert.equal(minRooms(room(1, 0), 3, 0), 3);
  assert.equal(minRooms(room(4, 2), 5, 0), 2);
});

test('minRooms: total capacity drives k', () => {
  assert.equal(minRooms(room(2, 2), 2, 2), 1);
  assert.equal(minRooms(room(2, 2), 2, 3), 2);
  assert.equal(minRooms(room(3, 0), 3, 3), 2);
  assert.equal(minRooms(room(4, 2), 4, 4), 2);
});

test('minRooms: null when adults ≥ k cannot hold (too many children per adult)', () => {
  assert.equal(minRooms(room(2, 0), 1, 1), 1); // control: 2 people fit one TWIN by total capacity
  assert.equal(minRooms(room(2, 0), 1, 2), null); // capacity needs 2 rooms but only 1 adult
  assert.equal(minRooms(room(1, 0), 1, 1), null);
  assert.equal(minRooms(room(2, 2), 1, 4), null);
  assert.equal(minRooms(room(2, 2), 2, 6), 2);
});

test('minRooms: null for zero adults or a room with no adult places', () => {
  assert.equal(minRooms(room(2, 2), 0, 1), null);
  assert.equal(minRooms(room(0, 2), 1, 0), null);
});

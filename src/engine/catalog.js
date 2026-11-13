// Catalog loader: reads every file in data/catalog once at import (path resolved from the repo root),
// deep-freezes the records and builds lookup indexes (flights, hotels, rooms, availability, transfers, attractions).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CATALOG_DIR = join(REPO_ROOT, 'data', 'catalog');

function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

// Every *.json in data/catalog, keyed by file name without extension (e.g. files.flights).
const raw = {};
for (const file of readdirSync(CATALOG_DIR).sort()) {
  if (file.endsWith('.json')) {
    raw[file.slice(0, -5)] = deepFreeze(JSON.parse(readFileSync(join(CATALOG_DIR, file), 'utf8')));
  }
}
export const files = Object.freeze(raw);

export const { destinations, airports, flights, hotels, rooms, availability, transfers, attractions } = raw;

const EMPTY = Object.freeze([]);
const key = (...parts) => parts.join('|');

function byId(arr, idField) {
  const m = new Map();
  for (const x of arr) {
    if (m.has(x[idField])) throw new Error(`Duplicate ${idField} in catalog: ${x[idField]}`);
    m.set(x[idField], x);
  }
  return m;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  for (const list of m.values()) Object.freeze(list);
  return m;
}

// ---- id maps ----
export const airportByCode = byId(airports, 'code');
export const flightById = byId(flights, 'flight_id');
export const hotelById = byId(hotels, 'hotel_id');
export const roomById = byId(rooms, 'room_id');
export const transferById = byId(transfers, 'transfer_id');
export const attractionById = byId(attractions, 'attraction_id');

// ---- indexes ----
// Flights by "from|to|date", on the local departure date and on the local arrival date.
// Outbound flights are picked by arrival date (= holiday start), return flights by departure date (= last day).
const flightsByDeparture = groupBy(flights, (f) => key(f.from, f.to, f.departure_local.slice(0, 10)));
const flightsByArrival = groupBy(flights, (f) => key(f.from, f.to, f.arrival_local.slice(0, 10)));
const hotelsByCity = groupBy(hotels, (h) => h.city);
const roomsByHotel = groupBy(rooms, (r) => r.hotel_id);
const attractionsByCity = groupBy(attractions, (a) => a.city);
const roomsLeftByRoomNight = new Map(availability.map((a) => [key(a.room_id, a.date), a.rooms_left]));
// Airport transfers by "airport|city|area"; area null (serves all areas of the city) is stored as "*".
const airportTransfersByKey = groupBy(
  transfers.filter((t) => t.airport),
  (t) => key(t.airport, t.city, t.area ?? '*'),
);
// Transfers between cities by "from_city|to_city", resolved from destinations.json links.
const intercityByCities = new Map();
for (const country of destinations.countries) {
  for (const link of country.links) {
    const list = link.transfer_ids.map((id) => {
      const t = transferById.get(id);
      if (!t) throw new Error(`Link ${link.from_city}→${link.to_city} names unknown transfer ${id}`);
      return t;
    });
    intercityByCities.set(key(link.from_city, link.to_city), Object.freeze(list));
  }
}

// ---- lookups (always return arrays, never undefined) ----
export const flightsDeparting = (from, to, date) => flightsByDeparture.get(key(from, to, date)) ?? EMPTY;
export const flightsArriving = (from, to, date) => flightsByArrival.get(key(from, to, date)) ?? EMPTY;
export const hotelsInCity = (city) => hotelsByCity.get(city) ?? EMPTY;
export const roomsOfHotel = (hotelId) => roomsByHotel.get(hotelId) ?? EMPTY;
export const attractionsInCity = (city) => attractionsByCity.get(city) ?? EMPTY;
export const intercityTransfers = (fromCity, toCity) => intercityByCities.get(key(fromCity, toCity)) ?? EMPTY;

/** Catalog rooms_left for a room type on a night; 0 when there is no record (outside the data window). */
export const roomsLeft = (roomId, date) => roomsLeftByRoomNight.get(key(roomId, date)) ?? 0;

/** Airport transfers for a hotel in city/area: the area-specific ones plus the all-areas (area null) ones. */
export function airportTransfers(airport, city, area) {
  const specific = area == null ? EMPTY : airportTransfersByKey.get(key(airport, city, area)) ?? EMPTY;
  return [...specific, ...(airportTransfersByKey.get(key(airport, city, '*')) ?? EMPTY)];
}

/** Airport codes whose serves_cities contains the city. */
export const airportsServing = (city) =>
  airports.filter((a) => (a.serves_cities ?? EMPTY).includes(city)).map((a) => a.code);

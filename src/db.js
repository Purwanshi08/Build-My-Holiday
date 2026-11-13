import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../app.db', import.meta.url));

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS packages (
    id           TEXT PRIMARY KEY,
    request_json TEXT,
    package_json TEXT NOT NULL,
    status       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reservations (
    reference  TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES packages(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS booked_flights (
    flight_id TEXT PRIMARY KEY,
    seats     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS booked_rooms (
    room_id TEXT NOT NULL,
    date    TEXT NOT NULL,
    rooms   INTEGER NOT NULL,
    PRIMARY KEY (room_id, date)
  );
`);

const stmts = {
  insertPackage: db.prepare(
    `INSERT INTO packages (id, request_json, package_json, status) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET request_json = excluded.request_json,
       package_json = excluded.package_json, status = excluded.status`,
  ),
  updatePackage: db.prepare('UPDATE packages SET package_json = ?, status = ? WHERE id = ?'),
  getPackage: db.prepare('SELECT package_json FROM packages WHERE id = ?'),
  getRequest: db.prepare('SELECT request_json FROM packages WHERE id = ?'),
  getReservation: db.prepare('SELECT reference, package_id, created_at FROM reservations WHERE reference = ?'),
  insertReservation: db.prepare('INSERT INTO reservations (reference, package_id) VALUES (?, ?)'),
  bookedFlights: db.prepare('SELECT flight_id, seats FROM booked_flights'),
  bookedRooms: db.prepare('SELECT room_id, date, rooms FROM booked_rooms'),
  addFlight: db.prepare(
    `INSERT INTO booked_flights (flight_id, seats) VALUES (?, ?)
     ON CONFLICT(flight_id) DO UPDATE SET seats = seats + excluded.seats`,
  ),
  addRoom: db.prepare(
    `INSERT INTO booked_rooms (room_id, date, rooms) VALUES (?, ?, ?)
     ON CONFLICT(room_id, date) DO UPDATE SET rooms = rooms + excluded.rooms`,
  ),
};

/** Save a freshly built package with the request it came from (insert or replace by id). */
export function savePackage(pkg, request) {
  stmts.insertPackage.run(pkg.id, JSON.stringify(request ?? null), JSON.stringify(pkg), pkg.status);
}

/** Overwrite the stored package (after a change or confirm); keeps request_json and created_at. */
export function updatePackage(pkg) {
  stmts.updatePackage.run(JSON.stringify(pkg), pkg.status, pkg.id);
}

/** Saved package by id, or null. */
export function getPackage(id) {
  const row = stmts.getPackage.get(id);
  return row ? JSON.parse(row.package_json) : null;
}

/** Original build request of a saved package, or null. */
export function getRequest(id) {
  const row = stmts.getRequest.get(id);
  return row ? JSON.parse(row.request_json) : null;
}

/** Reservation row { reference, package_id, created_at } or null. */
export function getReservation(reference) {
  return stmts.getReservation.get(reference) ?? null;
}

/** Engine ctx (docs/CONTRACT.md §3) built from our booked_* tables. */
export function getCtx() {
  const flights = {};
  for (const r of stmts.bookedFlights.all()) flights[r.flight_id] = r.seats;
  const rooms = {};
  for (const r of stmts.bookedRooms.all()) rooms[`${r.room_id}|${r.date}`] = r.rooms;
  return { booked: { flights, rooms } };
}

/**
 * Record a confirmed booking atomically: updated package, reservation row and the seats/rooms it takes.
 * `flights` = [{ flight_id, seats }], `rooms` = [{ room_id, date, rooms }].
 */
export const recordBooking = db.transaction((pkg, reference, flights, rooms) => {
  updatePackage(pkg);
  stmts.insertReservation.run(reference, pkg.id);
  for (const f of flights) stmts.addFlight.run(f.flight_id, f.seats);
  for (const r of rooms) stmts.addRoom.run(r.room_id, r.date, r.rooms);
});

export default db;

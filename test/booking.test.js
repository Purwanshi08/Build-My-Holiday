// End-to-end test of S2 (bookings use up seats and rooms): runs the real server on a temp SQLite file, leaves
// exactly the last seats/rooms free, and checks the first confirm takes them and a second confirm is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { flightById, roomsLeft } from '../src/engine/catalog.js';

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));
const MENON = {
  departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10', nights: 6, adults: 2, childAges: [6],
  budgetInr: 350000,
};
let nextPort = 3900 + Math.floor(Math.random() * 500);

/** Starts the server on a fresh temp db; returns { api, db path, stop }. */
async function startServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bmh-'));
  const dbPath = join(dir, 'test.db');
  const port = nextPort++;
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(() => {
    child.kill();
    return new Promise((done) => child.once('exit', done)).then(() => rmSync(dir, { recursive: true, force: true }));
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      if (i > 100) throw new Error('server did not start');
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const api = async (path, body) => {
    const res = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.json();
  };
  return { api, dbPath };
}

/** Two separate packages for the same request (same flights and hotels, different ids). */
async function buildTwo(api) {
  const a = (await api('/api/packages/build', MENON)).packages[0];
  const b = (await api('/api/packages/build', MENON)).packages[0];
  assert.notEqual(a.id, b.id);
  const sig = (p) => JSON.stringify(p.items.filter((i) => i.type !== 'attraction').map((i) => [i.catalog_id, i.room_id]));
  assert.equal(sig(a), sig(b), 'both builds should pick the same flights and rooms');
  return [a, b];
}

/** Runs fn on a direct connection to the server's db. */
function withDb(dbPath, fn) {
  const db = new Database(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

test('the last seats on a flight go to the first confirm; the second is refused', async (t) => {
  const { api, dbPath } = await startServer(t);
  const [a, b] = await buildTwo(api);
  const travelers = MENON.adults + MENON.childAges.length;
  const flightItem = a.items.find((i) => i.type === 'flight');
  const seatsLeft = flightById.get(flightItem.catalog_id).seats_left;

  // Someone else already holds all but our travelers' seats.
  withDb(dbPath, (db) =>
    db.prepare('INSERT INTO booked_flights (flight_id, seats) VALUES (?, ?)').run(flightItem.catalog_id, seatsLeft - travelers));

  const first = await api(`/api/packages/${a.id}/confirm`, {});
  assert.equal(first.ok, true, first.reasons?.join('\n'));
  assert.match(first.reference, /^\d{10}$/);
  assert.equal(first.package.status, 'BOOKED');

  const second = await api(`/api/packages/${b.id}/confirm`, {});
  assert.equal(second.ok, false);
  assert.ok(second.reasons.some((r) => /only 0 seat\(s\) left/.test(r)), second.reasons.join('\n'));
  assert.equal((await api(`/api/packages/${b.id}`)).status, 'PLANNED');

  withDb(dbPath, (db) => {
    const row = db.prepare('SELECT seats FROM booked_flights WHERE flight_id = ?').get(flightItem.catalog_id);
    assert.equal(row.seats, seatsLeft, 'the flight is now full in our store');
    const reservations = db.prepare('SELECT package_id FROM reservations').all();
    assert.deepEqual(reservations, [{ package_id: a.id }], 'only the first confirm made a reservation');
    // Every hotel night of A is recorded.
    const nights = a.plan.reduce((n, s) => n + s.nights, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM booked_rooms').get().n, nights);
  });

  // Confirming A again is refused; a new build avoids the full flight.
  assert.match((await api(`/api/packages/${a.id}/confirm`, {})).reasons[0], /already booked/);
  const rebuilt = await api('/api/packages/build', MENON);
  for (const p of rebuilt.packages) {
    assert.ok(!p.items.some((i) => i.catalog_id === flightItem.catalog_id), `${p.label} still uses the full flight`);
  }
});

test('the last rooms of a night go to the first confirm; the second is refused', async (t) => {
  const { api, dbPath } = await startServer(t);
  const [a, b] = await buildTwo(api);
  const hotel = a.items.find((i) => i.type === 'hotel');
  const night = hotel.start.slice(0, 10);
  const left = roomsLeft(hotel.room_id, night);

  withDb(dbPath, (db) =>
    db.prepare('INSERT INTO booked_rooms (room_id, date, rooms) VALUES (?, ?, ?)').run(hotel.room_id, night, left - hotel.quantity));

  const first = await api(`/api/packages/${a.id}/confirm`, {});
  assert.equal(first.ok, true, first.reasons?.join('\n'));

  const second = await api(`/api/packages/${b.id}/confirm`, {});
  assert.equal(second.ok, false);
  const want = new RegExp(`only 0 ${hotel.room_id} left on ${night}`);
  assert.ok(second.reasons.some((r) => want.test(r)), second.reasons.join('\n'));

  withDb(dbPath, (db) => {
    const row = db.prepare('SELECT rooms FROM booked_rooms WHERE room_id = ? AND date = ?').get(hotel.room_id, night);
    assert.equal(row.rooms, left, 'the room type is now sold out that night in our store');
  });
});

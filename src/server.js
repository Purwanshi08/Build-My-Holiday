// HTTP server: Express app on port 3000 (or $PORT) serving public/, /images and the JSON API over the engine.
// No travel logic here: every answer comes from src/engine/index.js, with ctx built from our db (src/db.js).
import express from 'express';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  getMeta,
  buildPackages,
  getOptions,
  applyChange,
  validatePackage,
  exportTrip,
  parseRequest,
} from './engine/index.js';
import * as store from './db.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use('/images', express.static(fileURLToPath(new URL('../images', import.meta.url))));

const notFound = (res) => res.status(404).json({ error: 'not found' });

/** Loads the saved package for :id into req.pkg, or answers 404. */
function loadPackage(req, res, next) {
  const pkg = store.getPackage(req.params.id);
  if (!pkg) return notFound(res);
  req.pkg = pkg;
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/meta', (_req, res) => res.json(getMeta()));

// Quick request (S1): plain words → { fields, missing, notes } via the engine's rule-based parser (no AI).
app.post('/api/parse-request', (req, res) => {
  const text = req.body?.text;
  if (typeof text !== 'string') return res.status(400).json({ error: 'text must be a string' });
  if (text.length > 1000) return res.status(400).json({ error: 'text is too long (max 1000 characters)' });
  res.json(parseRequest(text));
});

app.post('/api/packages/build', (req, res) => {
  const request = req.body ?? {};
  const result = buildPackages(request, store.getCtx());
  // OK: up to 3 packages; OVER_BUDGET: [cheapest] (for "View cheapest package").
  for (const pkg of result.packages) store.savePackage(pkg, request);
  res.json(result);
});

app.get('/api/packages/:id', loadPackage, (req, res) => res.json(req.pkg));

app.get('/api/packages/:id/options', loadPackage, (req, res) => {
  const query = {};
  for (const key of ['kind', 'city', 'date', 'direction']) {
    if (typeof req.query[key] === 'string' && req.query[key] !== '') query[key] = req.query[key];
  }
  if (!query.kind) return res.status(400).json({ error: 'kind is required' });
  res.json(getOptions(req.pkg, query, store.getCtx()));
});

app.post('/api/packages/:id/change', loadPackage, (req, res) => {
  const change = req.body;
  if (!change || typeof change !== 'object' || typeof change.type !== 'string') {
    return res.status(400).json({ error: 'change must be an object with a type' });
  }
  if (req.pkg.status === 'BOOKED') {
    return res.json({ ok: false, package: req.pkg, delta_inr: 0, warnings: [], reasons: ['This package is already booked.'] });
  }
  const result = applyChange(req.pkg, change, store.getCtx());
  if (result.ok) store.updatePackage(result.package);
  res.json(result);
});

/** Date-only + n days via the UTC trick (CLAUDE.md rule 4). */
const addDays = (d, n) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Seats per flight and rooms per (room, night) that a package takes. Hotel item: start = check-in, end = check-out. */
function usage(pkg) {
  const flights = pkg.items
    .filter((it) => it.type === 'flight')
    .map((it) => ({ flight_id: it.catalog_id, seats: it.quantity }));
  const rooms = [];
  for (const it of pkg.items.filter((i) => i.type === 'hotel')) {
    for (let d = it.start.slice(0, 10); d < it.end.slice(0, 10); d = addDays(d, 1)) {
      rooms.push({ room_id: it.room_id, date: d, rooms: it.quantity });
    }
  }
  return { flights, rooms };
}

/** Unused 10-digit reference; retries on a clash with an existing reservation. */
function newReference() {
  for (;;) {
    const ref = String(randomInt(1e9, 1e10));
    if (!store.getReservation(ref)) return ref;
  }
}

/**
 * The whole confirm in one IMMEDIATE transaction: re-read the package, build ctx fresh from booked_*, validate the
 * BOOKED version, then write package + reservation + seats/rooms. Any validation problem (e.g. the last seats or
 * rooms were just booked by someone else) refuses the confirm and writes nothing.
 */
const confirmPackage = store.transaction((id) => {
  const pkg = store.getPackage(id);
  if (pkg.status === 'BOOKED') {
    const reference = pkg.items.find((it) => it.booking?.reference)?.booking.reference ?? null;
    return { ok: false, reference, package: pkg, reasons: [`This package is already booked (reservation ${reference}).`] };
  }
  const reference = newReference();
  const booked = {
    ...pkg,
    status: 'BOOKED',
    items: pkg.items.map((it) => ({ ...it, status: 'BOOKED', booking: { reference } })),
  };
  const problems = validatePackage(booked, store.getCtx());
  if (problems.length) return { ok: false, reference: null, package: pkg, reasons: problems };
  const { flights, rooms } = usage(booked);
  store.recordBooking(booked, reference, flights, rooms);
  return { ok: true, reference, package: booked, reasons: [] };
});

// Always 200 with { ok, reference, package, reasons } (like /change); ok:false = refused, nothing written.
app.post('/api/packages/:id/confirm', loadPackage, (req, res) => {
  res.json(confirmPackage.immediate(req.params.id));
});

app.get('/api/reservations/:ref', (req, res) => {
  const reservation = store.getReservation(req.params.ref);
  if (!reservation) return notFound(res);
  const pkg = store.getPackage(reservation.package_id);
  res.json({ ...reservation, package: pkg });
});

app.get('/api/packages/:id/export', loadPackage, (req, res) => {
  res.attachment(`${req.pkg.id}.json`);
  res.type('application/json').send(JSON.stringify(exportTrip(req.pkg), null, 2));
});

app.use('/api', (_req, res) => notFound(res));

// JSON errors (e.g. malformed request body) instead of Express's HTML page.
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
});

app.listen(PORT, () => console.log(`Build My Holiday running at http://localhost:${PORT}`));
// HTTP server: Express app on port 3000 (or $PORT) serving public/, /images and the JSON API over the engine.
// No travel logic here: every answer comes from src/engine/index.js, with ctx built from our db (src/db.js).
import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  getMeta,
  buildPackages,
  getOptions,
  applyChange,
  exportTrip,
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

app.post('/api/packages/build', (req, res) => {
  const request = req.body ?? {};
  const result = buildPackages(request, store.getCtx());
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

// Stub until the booking flow is built: will validate, write reservations + booked_* and mark items BOOKED.
app.post('/api/packages/:id/confirm', loadPackage, (_req, res) => {
  res.status(501).json({ error: 'confirm is not implemented yet' });
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

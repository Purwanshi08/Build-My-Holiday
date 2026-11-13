// HTTP server: Express app on port 3000 (or $PORT) that serves public/ and the JSON API over the engine.
// Minimal bootstrap version: health and meta endpoints only; the full API is built on docs/CONTRACT.md.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { getMeta } from './engine/index.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/meta', (_req, res) => res.json(getMeta()));

app.listen(PORT, () => console.log(`Build My Holiday running at http://localhost:${PORT}`));

// Local-time helpers on plain strings and minutes-since-midnight (no JS Date for local times, CLAUDE.md rule 4).
// "24:00" = 1440; a window whose end is before its start (06:00-00:30) runs past midnight; both ends included.

const HHMM_RE = /^(\d{2}):(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/;
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** "HH:MM" → minutes since midnight. "24:00" → 1440. Throws on anything else. */
export function toMinutes(hhmm) {
  const m = HHMM_RE.exec(hhmm);
  if (!m) throw new Error(`Bad time "${hhmm}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) throw new Error(`Bad time "${hhmm}"`);
  return h * 60 + min;
}

/** Minutes since midnight (0–1440) → "HH:MM". */
export function fromMinutes(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error(`Bad minutes ${minutes}`);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const asMinutes = (t) => (typeof t === 'number' ? t : toMinutes(t));

/**
 * Is time t inside [from, until], both ends included? Accepts "HH:MM" strings or minutes.
 * If until < from the window runs past midnight: t ≥ from or t ≤ until.
 */
export function inWindow(t, from, until) {
  const x = asMinutes(t);
  const a = asMinutes(from);
  const b = asMinutes(until);
  return b >= a ? x >= a && x <= b : x >= a || x <= b;
}

/** Date-only arithmetic via the UTC trick (allowed by CLAUDE.md rule 4). */
export function addDays(date, n) {
  if (!DATE_RE.test(date)) throw new Error(`Bad date "${date}"`);
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Weekday of a date string: 'SUN' … 'SAT'. */
export function weekday(date) {
  if (!DATE_RE.test(date)) throw new Error(`Bad date "${date}"`);
  return WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
}

/**
 * Add n minutes (may be negative) to a local "YYYY-MM-DDTHH:MM" (catalog ":SS" accepted).
 * Returns "YYYY-MM-DDTHH:MM", rolling the date over midnight as needed.
 */
export function addMinutes(dateTime, n) {
  const m = DATETIME_RE.exec(dateTime);
  if (!m || !Number.isInteger(n)) throw new Error(`Bad addMinutes("${dateTime}", ${n})`);
  const total = toMinutes(m[2]) + n;
  const days = Math.floor(total / 1440);
  return `${addDays(m[1], days)}T${fromMinutes(total - days * 1440)}`;
}

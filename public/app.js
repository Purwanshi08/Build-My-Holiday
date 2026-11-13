// Front end: request form (GET /api/meta, client checks, POST /api/packages/build), result cards / over-budget
// suggestions / NO_PACKAGE reasons, and the day-by-day package view (?package=<id>) with a sticky budget bar.

const form = document.getElementById('request-form');
const submitBtn = document.getElementById('submit');
const resultEl = document.getElementById('result');
const childList = document.getElementById('child-list');
const childTpl = document.getElementById('child-row');

const FIELDS = ['departureAirport', 'country', 'startDate', 'nights', 'adults', 'childAges', 'budgetInr'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WINDOW_PREFIX = 'Flights and rooms are only available';

let rules = { min_nights: 3, max_nights: 10 };

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const labelName = { cheapest: 'Cheapest', fastest: 'Fastest', best_rated: 'Best rated' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

// ---------- meta / dropdowns ----------

async function loadMeta() {
  const depSel = form.departureAirport;
  const countrySel = form.country;
  try {
    const res = await fetch('/api/meta');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = await res.json();
    rules = { ...rules, ...meta.rules };

    depSel.replaceChildren(el('option', { value: '' }, 'Choose a city…'));
    for (const d of meta.departure_cities) {
      depSel.append(el('option', { value: d.airport }, `${d.city} (${d.airport})`));
    }
    countrySel.replaceChildren(el('option', { value: '' }, 'Choose a country…'));
    for (const c of meta.countries) {
      const opt = el('option', { value: c.name }, c.name);
      opt.dataset.cities = c.cities.join(', ');
      countrySel.append(opt);
    }
    form.nights.min = rules.min_nights;
    form.nights.max = rules.max_nights;
    document.getElementById('nights-hint').textContent = `${rules.min_nights} to ${rules.max_nights} nights.`;
  } catch (err) {
    const banner = document.getElementById('meta-error');
    banner.textContent = `Could not load cities and countries (${err.message}). Reload the page to try again.`;
    banner.hidden = false;
    depSel.replaceChildren(el('option', { value: '' }, 'Unavailable'));
    countrySel.replaceChildren(el('option', { value: '' }, 'Unavailable'));
  }
}

form.country.addEventListener('change', () => {
  const opt = form.country.selectedOptions[0];
  document.getElementById('country-cities').textContent = opt?.dataset.cities ? `Cities: ${opt.dataset.cities}` : '';
});

form.budgetInr.addEventListener('input', () => {
  const n = Number(form.budgetInr.value);
  document.getElementById('budget-hint').textContent =
    form.budgetInr.value !== '' && Number.isInteger(n) && n > 0 ? inr(n) : '';
});

// ---------- children ----------

function renumberChildren() {
  [...childList.children].forEach((li, i) => {
    const input = li.querySelector('input');
    const label = li.querySelector('label');
    input.id = `child-age-${i}`;
    label.htmlFor = input.id;
    label.textContent = `Child ${i + 1} age`;
  });
}

function addChild(age = '') {
  const li = childTpl.content.firstElementChild.cloneNode(true);
  li.querySelector('input').value = age;
  li.querySelector('.remove-child').addEventListener('click', () => {
    li.remove();
    renumberChildren();
    clearError('childAges');
  });
  childList.append(li);
  renumberChildren();
  return li.querySelector('input');
}

document.getElementById('add-child').addEventListener('click', () => addChild().focus());

// ---------- errors ----------

function fieldBox(name) {
  return form.querySelector(`[data-field="${name}"]`);
}

function setError(name, message, badInputs) {
  const box = fieldBox(name);
  if (!box) return false;
  box.classList.add('invalid');
  box.querySelector('.field-error').textContent = message;
  const inputs = badInputs ?? [...box.querySelectorAll('input, select')];
  for (const i of inputs) {
    i.classList.add('invalid');
    i.setAttribute('aria-invalid', 'true');
  }
  return true;
}

function clearError(name) {
  const box = fieldBox(name);
  if (!box) return;
  box.classList.remove('invalid');
  box.querySelector('.field-error').textContent = '';
  for (const i of box.querySelectorAll('input, select')) {
    i.classList.remove('invalid');
    i.removeAttribute('aria-invalid');
  }
}

function clearAllErrors() {
  FIELDS.forEach(clearError);
}

// Clear a field's error as soon as the user edits it.
form.addEventListener('input', (e) => {
  const box = e.target.closest('[data-field]');
  if (box) clearError(box.dataset.field);
});

// ---------- read + validate ----------

const isWholeString = (s) => /^\s*-?\d+\s*$/.test(s);

// Date-only check via the UTC trick allowed by CLAUDE.md rule 4.
function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  return new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}

function readForm() {
  const childInputs = [...childList.querySelectorAll('input')];
  return {
    raw: {
      nights: form.nights.value,
      adults: form.adults.value,
      budgetInr: form.budgetInr.value,
      childAges: childInputs.map((i) => i.value),
      dateInvalid: form.startDate.validity.badInput,
    },
    childInputs,
    request: {
      departureAirport: form.departureAirport.value,
      country: form.country.value,
      startDate: form.startDate.value,
      nights: Number(form.nights.value),
      adults: Number(form.adults.value),
      childAges: childInputs.map((i) => Number(i.value)),
      budgetInr: Number(form.budgetInr.value),
    },
  };
}

// Returns { field: message }. Dates outside 1–20 April are deliberately NOT an error here (backend says NO_PACKAGE).
function validate({ raw, request, childInputs }) {
  const errors = {};
  const bad = {};
  if (!request.departureAirport) errors.departureAirport = 'Choose a departure city.';
  if (!request.country) errors.country = 'Choose a destination country.';
  if (raw.dateInvalid || !request.startDate) errors.startDate = 'Enter a start date.';
  else if (!isRealDate(request.startDate)) errors.startDate = 'Enter a real date (YYYY-MM-DD).';

  const { min_nights: lo, max_nights: hi } = rules;
  if (!isWholeString(raw.nights) || request.nights < lo || request.nights > hi) {
    errors.nights = `Nights must be a whole number from ${lo} to ${hi}.`;
  }
  if (!isWholeString(raw.adults) || request.adults < 1) errors.adults = 'At least 1 adult is required.';

  const badChildren = childInputs.filter((_, i) => {
    const s = raw.childAges[i];
    const n = request.childAges[i];
    return !isWholeString(s) || n < 0 || n > 17;
  });
  if (badChildren.length) {
    errors.childAges = 'Each child age must be a whole number from 0 to 17.';
    bad.childAges = badChildren;
  }
  if (!isWholeString(raw.budgetInr) || request.budgetInr < 1) {
    errors.budgetInr = 'Budget must be a whole number of rupees above 0.';
  }
  return { errors, bad };
}

function showErrors(errors, bad = {}) {
  const unknown = [];
  for (const [field, msg] of Object.entries(errors)) {
    if (!setError(field, msg, bad[field])) unknown.push(msg);
  }
  const first = form.querySelector('.field.invalid input.invalid, .field.invalid select.invalid');
  first?.focus();
  return unknown;
}

// ---------- results ----------

function showResult(...nodes) {
  resultEl.replaceChildren(...nodes);
  resultEl.hidden = false;
}

function banner(kind, title, lines = []) {
  return el(
    'div',
    { class: `banner banner-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    el('strong', { class: 'banner-title' }, title),
    lines.length ? el('ul', {}, ...lines.map((l) => el('li', {}, l))) : null,
  );
}

const hm = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
/** Average hotel stars as "3.00 ★" (metrics.avg_stars is a number rounded to 2 decimals). */
const stars = (n) => `${Number(n).toFixed(2)} ★`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function button(label, cls, onClick) {
  const b = el('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

function packageCard(pkg) {
  const cities = pkg.plan.map((p) => `${p.city} ${plural(p.nights, 'night')}`).join(' → ');
  return el(
    'article',
    { class: 'pkg-card' },
    el('span', { class: `pkg-label pkg-${pkg.label}` }, labelName[pkg.label] ?? pkg.label),
    el('h3', {}, pkg.country),
    el('p', { class: 'pkg-cities' }, cities),
    el('p', { class: 'muted' }, `${fmtDateShort(pkg.start_date)} to ${fmtDateShort(pkg.end_date)}`),
    el(
      'dl',
      { class: 'pkg-stats' },
      el('div', {}, el('dt', {}, 'Total'), el('dd', { class: 'pkg-total' }, inr(pkg.total_inr))),
      el('div', {}, el('dt', {}, 'Budget left'), el('dd', { class: 'money-ok' }, inr(pkg.left_inr))),
      el('div', {}, el('dt', {}, 'Travel time'), el('dd', {}, hm(pkg.metrics.travel_minutes))),
      el('div', {}, el('dt', {}, 'Average hotel stars'), el('dd', {}, stars(pkg.metrics.avg_stars))),
    ),
    button('View package', 'btn btn-primary btn-view', () => openPackage(pkg.id)),
  );
}

// Over-budget suggestions are human-readable engine strings (src/engine/suggest.js, e.g. "Try 3 nights instead of
// 6: from ₹2,03,532 …", "Start on 2027-04-12 instead of …", "Go to Japan instead of …", "Fly from Mumbai (BOM)
// instead of …", "Raise the budget to at least ₹2,48,290."); these patterns turn them into form values.
const SUGGESTION_PATTERNS = [
  { re: /^Start on (\d{4}-\d{2}-\d{2})/i, apply: (m) => ({ startDate: m[1] }) },
  { re: /^Go to (.+?) instead of/i, apply: (m) => ({ country: m[1] }) },
  { re: /^Fly from .*?\(([A-Z]{3})\) instead of/, apply: (m) => ({ departureAirport: m[1] }) },
  { re: /budget to (?:at least )?₹\s?([\d,]+)/i, apply: (m) => ({ budgetInr: Number(m[1].replace(/,/g, '')) }) },
  { re: /(\d+)\s+nights?/i, apply: (m) => ({ nights: Number(m[1]) }) },
  { re: /nights\D*?(\d+)/i, apply: (m) => ({ nights: Number(m[1]) }) },
];

function suggestionChanges(text) {
  for (const p of SUGGESTION_PATTERNS) {
    const m = text.match(p.re);
    if (m) return p.apply(m);
  }
  return null;
}

function refillForm(changes) {
  clearAllErrors();
  for (const [name, value] of Object.entries(changes)) {
    form[name].value = value;
    form[name].dispatchEvent(new Event('input', { bubbles: true }));
    form[name].dispatchEvent(new Event('change', { bubbles: true }));
    form[name].classList.add('flash');
    setTimeout(() => form[name].classList.remove('flash'), 1600);
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  submitBtn.focus({ preventScroll: true });
}

function overBudgetView(data) {
  const box = el(
    'div',
    { class: 'banner banner-warn over-budget', role: 'status' },
    el('strong', { class: 'banner-title' }, 'No package fits this budget'),
    el(
      'dl',
      { class: 'pkg-stats' },
      el('div', {}, el('dt', {}, 'Cheapest package'), el('dd', {}, inr(data.cheapest_total))),
      el('div', {}, el('dt', {}, 'Over your budget by'), el('dd', { class: 'money-over' }, inr(data.over_by))),
    ),
  );
  const suggestions = data.suggestions.slice(0, 3);
  if (suggestions.length) {
    const row = el('div', { class: 'suggestions' });
    for (const s of suggestions) {
      const changes = suggestionChanges(s);
      row.append(changes
        ? button(s, 'btn btn-secondary btn-suggest', () => refillForm(changes))
        : el('span', { class: 'suggest-text' }, s));
    }
    box.append(el('p', { class: 'suggest-title' }, 'Try one of these (fills in the form):'), row);
  }
  // Contract: OVER_BUDGET returns [cheapest] (saved by the server, left_inr negative).
  const cheapestId = data.packages?.[0]?.id;
  if (cheapestId) {
    box.append(button('View cheapest package', 'btn btn-warn', () => openPackage(cheapestId)));
  }
  return box;
}

function noPackageView(reasons) {
  return el(
    'div',
    { class: 'banner banner-error no-package', role: 'alert' },
    el('strong', { class: 'banner-title' }, 'No package for these choices'),
    el('p', {}, 'We could not build a valid trip because:'),
    el('ul', { class: 'reasons' }, ...reasons.map((r) => el('li', {}, r))),
  );
}

function renderBuild(data) {
  switch (data.status) {
    case 'OK': {
      const pkgs = data.packages.slice(0, 3);
      showResult(
        el('h2', {}, `${plural(pkgs.length, 'package')} within your budget`),
        el('div', { class: 'pkg-grid' }, ...pkgs.map(packageCard)),
      );
      break;
    }
    case 'OVER_BUDGET':
      showResult(overBudgetView(data));
      break;
    case 'NO_PACKAGE': {
      const windowReason = data.reasons.find((r) => r.startsWith(WINDOW_PREFIX));
      if (windowReason) setError('startDate', 'Pick dates between 1 and 20 April 2027.');
      showResult(noPackageView(data.reasons));
      break;
    }
    case 'INVALID_REQUEST': {
      const unknown = showErrors(data.errors);
      showResult(banner('error', 'Please fix the highlighted fields.', unknown));
      break;
    }
    default:
      showResult(banner('error', 'Unexpected answer from the server.', [String(data.status)]));
  }
  if (data.status !== 'INVALID_REQUEST') resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- dates (strings only; weekday and day number via the UTC trick, CLAUDE.md rule 4) ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const utcDay = (d) => new Date(d + 'T00:00:00Z');
const fmtDateShort = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const fmtDateLong = (d) => `${WEEKDAYS[utcDay(d).getUTCDay()]} ${fmtDateShort(d)} ${d.slice(0, 4)}`;
const dateOf = (dt) => dt.slice(0, 10);
const timeOf = (dt) => (dt.length >= 16 ? dt.slice(11, 16) : null);
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ---------- package view ----------

const pkgView = document.getElementById('package-view');
const bar = document.getElementById('budget-bar');
const TYPE_LABEL = { flight: 'Flight', transfer: 'Transfer', hotel: 'Hotel', attraction: 'Attraction' };

/** Bottom bar: total, budget and left/over. Call it with every package the backend sends back. */
function updateBar(pkg) {
  const left = pkg.budget_inr - pkg.total_inr;
  document.getElementById('bar-total').textContent = inr(pkg.total_inr);
  document.getElementById('bar-budget').textContent = inr(pkg.budget_inr);
  document.getElementById('bar-left-label').textContent = left >= 0 ? 'Left' : 'Over budget';
  document.getElementById('bar-left').textContent = inr(Math.abs(left));
  const box = document.getElementById('bar-left-box');
  box.classList.toggle('money-ok', left >= 0);
  box.classList.toggle('money-over', left < 0);
  document.getElementById('export-btn').href = `/api/packages/${encodeURIComponent(pkg.id)}/export`;
  document.getElementById('confirm-btn').hidden = pkg.status === 'BOOKED';
  bar.hidden = false;
}

/** The booking reference of a booked package (every item carries the same one), or null. */
const referenceOf = (pkg) => pkg.items.find((it) => it.booking?.reference)?.booking.reference ?? null;

/**
 * Timeline days from package.items, keyed by local date. One event per item on its start date, except hotels,
 * which give a check-in (start date) and a check-out (end date). Hotel items carry dates only, so check-out sorts
 * first in its day and check-in right after the last flight/transfer that arrives that day.
 */
function timelineDays(pkg) {
  const events = [];
  for (const item of pkg.items) {
    if (item.type === 'hotel') {
      events.push({ item, kind: 'check-in', date: dateOf(item.start), time: null });
      events.push({ item, kind: 'check-out', date: dateOf(item.end), time: null });
    } else {
      events.push({ item, kind: item.type, date: dateOf(item.start), time: timeOf(item.start) });
    }
  }
  const lastArrival = {};
  for (const item of pkg.items) {
    if ((item.type === 'flight' || item.type === 'transfer') && timeOf(item.end)) {
      const d = dateOf(item.end);
      lastArrival[d] = Math.max(lastArrival[d] ?? -1, toMin(timeOf(item.end)));
    }
  }
  for (const ev of events) {
    if (ev.kind === 'check-out') ev.key = -1;
    else if (ev.kind === 'check-in') ev.key = (lastArrival[ev.date] ?? -1) + 0.5;
    else ev.key = ev.time ? toMin(ev.time) : 0;
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.key - b.key);
  const days = new Map();
  for (const ev of events) {
    if (!days.has(ev.date)) days.set(ev.date, []);
    days.get(ev.date).push(ev);
  }
  return days;
}

function cityOn(pkg, date) {
  if (date < pkg.start_date) return 'Departure';
  if (date >= pkg.end_date) return 'Return home';
  return pkg.plan.find((p) => p.check_in <= date && date < p.check_out)?.city ?? '';
}

/** Change / remove buttons for one timeline row (none once the package is booked). */
function eventActions(ev, pkg) {
  if (pkg.status === 'BOOKED') return null;
  const { item } = ev;
  const acts = [];
  if (item.type === 'flight') {
    // The outbound flight leaves on or before start_date; the return flight leaves on end_date.
    const direction = item.start < pkg.end_date ? 'outbound' : 'return';
    acts.push(button('Change flight', 'btn btn-small', () => openOptions(
      { kind: 'flight', direction },
      direction === 'outbound' ? 'Change outbound flight' : 'Change return flight',
      (o) => ({ type: 'swap_flight', direction, flight_id: o.id }),
    )));
  } else if (ev.kind === 'check-in') {
    acts.push(button('Change hotel', 'btn btn-small', () => openOptions(
      { kind: 'hotel', city: item.city },
      `Change hotel in ${item.city}`,
      (o) => {
        const [hotel_id, room_id] = o.id.split('|');
        return { type: 'swap_hotel', city: item.city, hotel_id, room_id };
      },
    )));
  } else if (item.type === 'attraction') {
    acts.push(button('Remove', 'btn btn-small btn-danger', () => sendChange(
      { type: 'remove_attraction', item_id: item.item_id },
      `${item.name} removed`,
    )));
  }
  return acts.length ? el('div', { class: 'tl-actions' }, ...acts) : null;
}

function eventNode(ev, pkg) {
  const { item } = ev;
  let title = item.name;
  let when = ev.time ?? '';
  const details = [];

  if (ev.kind === 'check-in') {
    title = `Check in: ${item.name}`;
    when = 'Check-in';
    details.push(`${plural(item.quantity, 'room')} · until ${fmtDateShort(dateOf(item.end))}`);
  } else if (ev.kind === 'check-out') {
    title = `Check out: ${item.name}`;
    when = 'Check-out';
  } else {
    const end = timeOf(item.end ?? '');
    if (end) {
      const nextDay = dateOf(item.end) !== dateOf(item.start);
      details.push(`${ev.time} – ${end}${nextDay ? ` (${fmtDateShort(dateOf(item.end))})` : ''}`);
    }
    if (item.type === 'flight') details.push(plural(item.quantity, 'seat'));
    if (item.type === 'attraction') details.push(plural(item.quantity, 'ticket'));
    if (item.type === 'transfer') details.push(`× ${item.quantity}`);
  }

  const body = el(
    'div',
    { class: 'tl-body' },
    el(
      'div',
      { class: 'tl-head' },
      el('span', { class: `tl-type tl-${item.type}` }, TYPE_LABEL[item.type] ?? item.type),
      el('strong', { class: 'tl-title' }, title),
      ev.kind === 'check-out' ? null : el('span', { class: 'tl-price' }, inr(item.price_inr)),
    ),
    details.length ? el('p', { class: 'tl-detail muted' }, details.join(' · ')) : null,
    ...(item.warnings ?? []).map((w) => el('p', { class: 'tl-warning' }, w)),
    eventActions(ev, pkg),
  );
  if (item.type === 'attraction' && item.catalog_id) {
    // Catalog images are images/attractions/<attraction_id>.jpg; hide the frame if one is missing.
    const img = el('img', {
      class: 'tl-photo',
      src: `/images/attractions/${encodeURIComponent(item.catalog_id)}.jpg`,
      alt: item.name,
      loading: 'lazy',
    });
    img.addEventListener('error', () => img.remove());
    body.prepend(img);
  }
  return el('li', { class: `tl-item tl-item-${ev.kind}` }, el('span', { class: 'tl-time' }, when), body);
}

/** `reservation` (optional) = { reference, created_at } from GET /api/reservations/:ref: read-only summary mode. */
function renderPackage(pkg, reservation = null) {
  const cities = pkg.plan.map((p) => `${p.city} ${p.nights}n`).join(' → ');
  const ref = reservation?.reference ?? referenceOf(pkg);
  const t = pkg.traveler ?? {};
  const people = plural(t.adults, 'adult') + (t.children ? `, ${plural(t.children, 'child', 'children')}` : '');
  const header = el(
    'div',
    { class: 'card pkg-header' },
    button('← New search', 'btn btn-link', closePackage),
    el(
      'div',
      { class: 'pkg-badges' },
      pkg.label ? el('span', { class: `pkg-label pkg-${pkg.label}` }, labelName[pkg.label] ?? pkg.label) : null,
      el('span', { class: `pkg-label pkg-status-${String(pkg.status).toLowerCase()}` },
        pkg.status === 'BOOKED' ? 'Booked' : 'Planned'),
    ),
    reservation ? el('p', { class: 'res-kicker' }, 'Reservation summary') : null,
    el('h2', {}, `${pkg.country}: ${cities}`),
    el('p', { class: 'muted' }, `${fmtDateLong(pkg.start_date)} to ${fmtDateLong(pkg.end_date)} · ${people}`),
    ref ? el(
      'p',
      { class: 'res-line' },
      'Reservation number ',
      el('strong', { class: 'res-number' }, ref),
      // created_at is SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC.
      reservation?.created_at ? el('span', { class: 'muted' }, ` · booked ${reservation.created_at.slice(0, 16)} UTC`) : null,
    ) : null,
    el(
      'dl',
      { class: 'pkg-stats' },
      el('div', {}, el('dt', {}, 'Travel time'), el('dd', {}, hm(pkg.metrics.travel_minutes))),
      el('div', {}, el('dt', {}, 'Average hotel stars'), el('dd', {}, stars(pkg.metrics.avg_stars))),
    ),
  );

  const editable = pkg.status !== 'BOOKED';
  if (editable) {
    header.append(el('div', { class: 'pkg-header-actions' }, button('Change cities', 'btn btn-secondary', () =>
      openOptions({ kind: 'city_plan' }, 'Change cities and nights', (o) => ({
        type: 'set_city_plan', cities: o.detail?.cities ?? parsePlanId(o.id),
      })))));
  }

  const timeline = el('ol', { class: 'timeline' });
  const start = utcDay(pkg.start_date).getTime();
  for (const [date, evs] of timelineDays(pkg)) {
    const n = Math.round((utcDay(date).getTime() - start) / 86400000) + 1;
    // Attractions can be added on any night of the stay (start_date .. end_date − 1).
    const city = cityOn(pkg, date);
    const canAdd = editable && date >= pkg.start_date && date < pkg.end_date;
    timeline.append(el(
      'li',
      { class: 'tl-day' },
      el('h3', { class: 'tl-date' }, fmtDateLong(date),
        el('span', { class: 'muted' }, ` · ${n >= 1 ? `Day ${n}` : 'Before day 1'} · ${city}`)),
      el('ul', { class: 'tl-list' }, ...evs.map((ev) => eventNode(ev, pkg))),
      canAdd ? button('+ Add attraction', 'btn btn-small btn-add', () => openOptions(
        { kind: 'attraction', date },
        `Add an attraction on ${fmtDateLong(date)} (${city})`,
        (o) => ({ type: 'add_attraction', attraction_id: o.id, date }),
      )) : null,
    ));
  }

  pkgView.replaceChildren(
    header,
    el(
      'section',
      { class: 'card' },
      el('h2', {}, 'Day by day'),
      timeline,
      el('p', { class: 'credits' }, 'Attraction photos from Wikimedia Commons. ',
        el('a', { href: '/images/ATTRIBUTIONS.md', target: '_blank', rel: 'noopener' }, 'Photo credits')),
    ),
  );
  currentPkg = pkg;
  updateBar(pkg);
}

// ---------- changes: options modal + POST /change ----------

let currentPkg = null;
let changing = false;
const noticeEl = document.getElementById('change-notice');
const dialog = document.getElementById('options-dialog');

// Backdrop click closes the modal (clicks inside land on child elements, not the dialog itself).
dialog.addEventListener('click', (e) => { if (e.target === dialog && !changing) dialog.close(); });
dialog.addEventListener('cancel', (e) => { if (changing) e.preventDefault(); });

const fmtDelta = (n) => (n > 0 ? `+${inr(n)}` : n < 0 ? `−${inr(-n)}` : `±${inr(0)}`);

/** city_plan option id fallback: "Tokyo:3|Kyoto:3" → [{ city, nights }]. */
function parsePlanId(id) {
  return String(id).split('|').map((part) => {
    const i = part.lastIndexOf(':');
    return { city: part.slice(0, i), nights: Number(part.slice(i + 1)) };
  });
}

/** One display line from the free-form option detail (only fields we recognise). */
function optionInfo(d = {}) {
  const bits = [];
  if (d.stars != null) bits.push(`${d.stars} ★`);
  if (d.cities && d.avg_stars != null) bits.push(`avg ${stars(d.avg_stars)}`);
  if (d.cities && d.travel_minutes != null) bits.push(`travel ${hm(d.travel_minutes)}`);
  if (d.area) bits.push(d.area);
  if (d.date) bits.push(fmtDateShort(d.date));
  if (d.start && d.end) bits.push(`${timeOf(d.start) ?? d.start} – ${timeOf(d.end) ?? d.end}`);
  if (d.duration_minutes != null) bits.push(hm(d.duration_minutes));
  return bits.join(' · ');
}

function optionNode(o, makeChange, successText) {
  const current = o.detail?.current === true;
  const delta = o.price_delta_inr == null ? null : Number(o.price_delta_inr); // null on invalid options
  const info = optionInfo(o.detail);
  const b = el(
    'button',
    { type: 'button', class: `opt${o.valid ? '' : ' opt-invalid'}${current ? ' opt-current' : ''}` },
    el(
      'span',
      { class: 'opt-main' },
      el('strong', { class: 'opt-label' }, o.label),
      info ? el('span', { class: 'opt-info muted' }, info) : null,
      !o.valid && o.reason ? el('span', { class: 'opt-reason' }, o.reason) : null,
    ),
    el(
      'span',
      { class: `opt-delta ${delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : ''}` },
      current ? 'Current' : delta == null ? '—' : fmtDelta(delta),
    ),
  );
  b.disabled = !o.valid || current;
  if (!o.valid) b.setAttribute('aria-label', `${o.label}. Not available: ${o.reason ?? 'not valid'}`);
  b.addEventListener('click', () => sendChange(makeChange(o), `${successText}: ${o.label}`));
  return b;
}

/** Opens the modal and fills it from GET /api/packages/:id/options?<query>. */
async function openOptions(query, title, makeChange) {
  const pkg = currentPkg;
  if (!pkg || changing) return;
  const list = el('div', { class: 'opt-list' }, el('p', { class: 'muted' }, 'Loading options…'));
  dialog.replaceChildren(
    el(
      'div',
      { class: 'modal-head' },
      el('h2', { id: 'modal-title' }, title),
      button('✕', 'btn btn-icon modal-close', () => dialog.close()),
    ),
    el('p', { class: 'muted modal-sub' }, 'Prices are the change to your package total.'),
    list,
  );
  dialog.showModal();
  try {
    const res = await fetch(`/api/packages/${encodeURIComponent(pkg.id)}/options?${new URLSearchParams(query)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!dialog.open || currentPkg !== pkg) return;
    const shortTitle = title.split(' (')[0];
    list.replaceChildren(...(data.length
      ? data.map((o) => optionNode(o, makeChange, shortTitle))
      : [el('p', { class: 'muted' }, 'No options available.')]));
  } catch (err) {
    if (dialog.open) list.replaceChildren(banner('error', 'Could not load the options.', [err.message]));
  }
}

function showNotice(node) {
  noticeEl.replaceChildren();
  if (!node) return;
  node.append(button('✕', 'btn btn-icon notice-close', () => showNotice(null)));
  noticeEl.append(node);
}

/** POST a change; ok → re-render package + bar and show warnings; refused → reasons, old package kept. */
async function sendChange(change, successText) {
  const pkg = currentPkg;
  if (!pkg || changing) return;
  changing = true;
  dialog.setAttribute('aria-busy', 'true');
  pkgView.classList.add('busy');
  for (const b of dialog.querySelectorAll('button')) b.disabled = true;
  try {
    const res = await fetch(`/api/packages/${encodeURIComponent(pkg.id)}/change`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(change),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.package) throw new Error(data?.error || `HTTP ${res.status}`);
    if (currentPkg !== pkg) return; // user left this package meanwhile
    dialog.close();
    renderPackage(data.package); // refused → the unchanged package, so the view and bar stay as they were
    if (data.ok) {
      const p = data.package;
      const over = p.total_inr - p.budget_inr;
      const lines = [...(data.warnings ?? [])];
      if (over > 0) lines.push(`Your package is now ${inr(over)} over budget.`);
      showNotice(banner(over > 0 ? 'warn' : 'ok', `${successText} (${fmtDelta(data.delta_inr ?? 0)})`, lines));
    } else {
      showNotice(banner('error', 'Change not made. Your package is unchanged.',
        data.reasons?.length ? data.reasons : ['The change was refused.']));
    }
  } catch (err) {
    if (currentPkg !== pkg) return;
    dialog.close();
    showNotice(banner('error', 'Could not apply the change. Your package is unchanged.', [err.message]));
  } finally {
    changing = false;
    dialog.removeAttribute('aria-busy');
    pkgView.classList.remove('busy');
  }
}

// ---------- views + URL (?package=<id> restores the package view after a refresh) ----------

/** Forget the package being edited: close the modal, drop the change notice. */
function leavePackage() {
  currentPkg = null;
  if (dialog.open) dialog.close();
  showNotice(null);
}

function showFormView() {
  leavePackage();
  pkgView.hidden = true;
  bar.hidden = true;
  form.hidden = false;
  quickForm.hidden = false;
  resultEl.hidden = resultEl.childElementCount === 0;
}

let loadSeq = 0;

async function loadPackageView(id) {
  const seq = ++loadSeq;
  leavePackage();
  form.hidden = true;
  quickForm.hidden = true;
  resultEl.hidden = true;
  bar.hidden = true;
  pkgView.hidden = false;
  pkgView.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Loading package…')));
  window.scrollTo({ top: 0 });
  try {
    const res = await fetch(`/api/packages/${encodeURIComponent(id)}`);
    const pkg = await res.json().catch(() => null);
    if (res.status === 404) throw new Error('This package does not exist (any more). Build a new one.');
    if (!res.ok || !pkg) throw new Error(pkg?.error || `HTTP ${res.status}`);
    if (seq === loadSeq) renderPackage(pkg);
  } catch (err) {
    if (seq !== loadSeq) return;
    pkgView.replaceChildren(
      banner('error', 'Could not load the package.', [err.message]),
      button('← New search', 'btn btn-secondary', closePackage),
    );
  }
}

function openPackage(id) {
  history.pushState({ package: id }, '', `?package=${encodeURIComponent(id)}`);
  loadPackageView(id);
}

function closePackage() {
  loadSeq++;
  history.pushState({}, '', location.pathname);
  showFormView();
  window.scrollTo({ top: 0 });
}

// ---------- confirm booking ----------

const confirmBtn = document.getElementById('confirm-btn');

/** Step 1: ask (booking is final). Step 2: POST /confirm. Step 3: show the 10-digit number with a copy button. */
confirmBtn.addEventListener('click', () => {
  const pkg = currentPkg;
  if (!pkg || changing || pkg.status === 'BOOKED') return;
  const over = pkg.total_inr - pkg.budget_inr;
  const go = button('Confirm booking', 'btn btn-primary', () => confirmBooking(pkg));
  dialog.replaceChildren(
    el('div', { class: 'modal-head' }, el('h2', { id: 'modal-title' }, 'Confirm this package?'),
      button('✕', 'btn btn-icon modal-close', () => dialog.close())),
    el('p', {}, `${pkg.country}, ${fmtDateShort(pkg.start_date)} to ${fmtDateShort(pkg.end_date)}. `,
      'Total ', el('strong', {}, inr(pkg.total_inr)), '. After confirming, the package can no longer be changed.'),
    over > 0 ? el('p', { class: 'opt-reason' }, `This is ${inr(over)} over your budget.`) : null,
    el('div', { class: 'modal-actions' }, button('Cancel', 'btn btn-secondary', () => dialog.close()), go),
  );
  dialog.showModal();
  go.focus();
});

async function confirmBooking(pkg) {
  if (changing) return;
  changing = true;
  dialog.setAttribute('aria-busy', 'true');
  for (const b of dialog.querySelectorAll('button')) b.disabled = true;
  confirmBtn.disabled = true;
  try {
    const res = await fetch(`/api/packages/${encodeURIComponent(pkg.id)}/confirm`, { method: 'POST' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.package) throw new Error(data?.error || `HTTP ${res.status}`);
    if (currentPkg !== pkg) return;
    renderPackage(data.package);
    if (data.ok) {
      showNotice(null);
      showReference(data.reference);
    } else {
      dialog.close();
      showNotice(banner('error', 'Booking not confirmed. Nothing was booked.',
        data.reasons?.length ? data.reasons : ['The booking was refused.']));
    }
  } catch (err) {
    if (currentPkg !== pkg) return;
    dialog.close();
    showNotice(banner('error', 'Could not confirm the booking. Nothing was booked.', [err.message]));
  } finally {
    changing = false;
    dialog.removeAttribute('aria-busy');
    confirmBtn.disabled = false;
  }
}

function showReference(ref) {
  const field = el('input', { class: 'ref-field', type: 'text', readonly: '', value: ref, 'aria-label': 'Reservation number' });
  const copy = button('Copy', 'btn btn-secondary btn-copy', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(ref);
      ok = true;
    } catch {
      field.select();
      ok = document.execCommand?.('copy') ?? false;
    }
    copy.textContent = ok ? 'Copied ✓' : 'Select and copy';
    setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
  });
  dialog.replaceChildren(
    el('div', { class: 'modal-head' }, el('h2', { id: 'modal-title' }, 'Booking confirmed'),
      button('✕', 'btn btn-icon modal-close', () => dialog.close())),
    el('p', {}, 'Your reservation number. Keep it to open your booking later with "Find my reservation".'),
    el('div', { class: 'ref-row' }, field, copy),
    el('div', { class: 'modal-actions' },
      button('View reservation summary', 'btn btn-secondary', () => { dialog.close(); openReservation(ref); }),
      button('Done', 'btn btn-primary', () => dialog.close())),
  );
  if (!dialog.open) dialog.showModal();
  copy.focus();
}

// ---------- find my reservation (GET /api/reservations/:ref, ?reservation=<ref>) ----------

const findForm = document.getElementById('find-form');
findForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const ref = findForm.ref.value.trim();
  if (!ref) return findForm.ref.focus();
  openReservation(ref);
});

async function loadReservationView(ref) {
  const seq = ++loadSeq;
  leavePackage();
  form.hidden = true;
  quickForm.hidden = true;
  resultEl.hidden = true;
  bar.hidden = true;
  pkgView.hidden = false;
  pkgView.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Looking up reservation…')));
  window.scrollTo({ top: 0 });
  try {
    const res = await fetch(`/api/reservations/${encodeURIComponent(ref)}`);
    const data = await res.json().catch(() => null);
    if (seq !== loadSeq) return;
    if (res.status === 404 || (res.ok && !data?.package)) {
      pkgView.replaceChildren(
        el('div', { class: 'banner banner-error', role: 'alert' },
          el('strong', { class: 'banner-title' }, 'Reservation not found'),
          el('p', {}, `No reservation has the number ${ref}. Check the 10 digits and try again.`)),
        button('← New search', 'btn btn-secondary', closePackage),
      );
      return;
    }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    renderPackage(data.package, data);
  } catch (err) {
    if (seq !== loadSeq) return;
    pkgView.replaceChildren(
      banner('error', 'Could not look up the reservation.', [err.message]),
      button('← New search', 'btn btn-secondary', closePackage),
    );
  }
}

function openReservation(ref) {
  history.pushState({ reservation: ref }, '', `?reservation=${encodeURIComponent(ref)}`);
  loadReservationView(ref);
}

// ---------- quick request (S1): POST /api/parse-request → fill the form, mark what is missing ----------

const quickForm = document.getElementById('quick-form');
const quickResult = document.getElementById('quick-result');
const quickBtn = document.getElementById('quick-submit');

const MISSING_MSG = {
  departureAirport: 'Not found in your request: choose a departure city.',
  country: 'Not found in your request: choose a country.',
  startDate: 'Not found in your request: pick a start date.',
  nights: 'Not found in your request: enter the number of nights.',
  adults: 'Not found in your request: enter the number of adults.',
  childAges: 'Add each child\'s age (0–17).',
  budgetInr: 'Not found in your request: enter your budget.',
};
const FIELD_NAME = {
  departureAirport: 'departure city', country: 'country', startDate: 'start date', nights: 'nights',
  adults: 'adults', childAges: 'children\'s ages', budgetInr: 'budget',
};

function flash(input) {
  input.classList.add('flash');
  setTimeout(() => input.classList.remove('flash'), 1600);
}

/**
 * Put the parsed fields into the form. Fields the parser did not find are emptied (not left at the sample values),
 * so the form cannot be sent with a guess the traveler never made. childAges missing = kids without ages: keep the
 * child rows the user already has.
 */
function applyParsed({ fields, missing }) {
  clearAllErrors();
  for (const name of ['departureAirport', 'country', 'startDate', 'nights', 'adults', 'budgetInr']) {
    const input = form[name];
    if (name in fields) {
      input.value = String(fields[name]);
      // A select ignores values it has no option for; treat that as missing.
      if (input.value !== String(fields[name])) {
        input.value = '';
        if (!missing.includes(name)) missing = [...missing, name];
      } else flash(input);
    } else if (missing.includes(name)) {
      input.value = '';
    }
    input.dispatchEvent(new Event('change', { bubbles: true })); // updates the country cities / budget hints
  }
  form.budgetInr.dispatchEvent(new Event('input', { bubbles: true }));
  if (Array.isArray(fields.childAges)) {
    childList.replaceChildren();
    for (const age of fields.childAges) flash(addChild(age));
  }
  // dispatching input events above clears errors, so mark missing fields last
  clearAllErrors();
  for (const name of missing) setError(name, MISSING_MSG[name] ?? 'Please fill this in.');
  return missing;
}

quickForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = quickForm.text.value.trim();
  if (!text) {
    quickResult.replaceChildren(el('p', { class: 'field-error' }, 'Type your trip first, e.g. "2 adults from Delhi to Dubai for 5 nights from 12 April, ₹2 lakh".'));
    quickForm.text.focus();
    return;
  }
  quickBtn.disabled = true;
  quickBtn.textContent = 'Reading…';
  try {
    const res = await fetch('/api/parse-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.fields) throw new Error(data?.error || `HTTP ${res.status}`);
    const missing = applyParsed({ fields: data.fields, missing: data.missing ?? [] });
    const filled = Object.keys(data.fields).filter((f) => !missing.includes(f) && FIELD_NAME[f]);
    const lines = [];
    if (filled.length) lines.push(`Filled in: ${filled.map((f) => FIELD_NAME[f]).join(', ')}.`);
    if (missing.length) lines.push(`Still needed (marked in red below): ${missing.map((f) => FIELD_NAME[f] ?? f).join(', ')}.`);
    lines.push(...(data.notes ?? []));
    quickResult.replaceChildren(banner(missing.length ? 'warn' : 'ok',
      missing.length ? 'Form partly filled. Please complete it' : 'Form filled. Check it and build', lines));
    resultEl.hidden = true;
    const firstMissing = form.querySelector('.field.invalid input, .field.invalid select');
    (firstMissing ?? (missing.includes('childAges') ? document.getElementById('add-child') : submitBtn)).focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    quickResult.replaceChildren(banner('error', 'Could not read the request.', [err.message]));
  } finally {
    quickBtn.disabled = false;
    quickBtn.textContent = 'Fill the form';
  }
});

// Ctrl/Cmd+Enter in the text box = "Fill the form".
quickForm.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) quickForm.requestSubmit();
});

function route() {
  const params = new URLSearchParams(location.search);
  if (params.get('reservation')) loadReservationView(params.get('reservation'));
  else if (params.get('package')) loadPackageView(params.get('package'));
  else showFormView();
}

window.addEventListener('popstate', route);

// ---------- submit ----------

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle('loading', on);
  submitBtn.querySelector('.btn-label').textContent = on ? 'Building your holiday…' : 'Build my holiday';
  form.setAttribute('aria-busy', String(on));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAllErrors();
  const read = readForm();
  const { errors, bad } = validate(read);
  if (Object.keys(errors).length) {
    showErrors(errors, bad);
    resultEl.hidden = true;
    return;
  }

  setLoading(true);
  try {
    const res = await fetch('/api/packages/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(read.request),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(data?.error || `HTTP ${res.status}`);
    renderBuild(data);
  } catch (err) {
    showResult(banner('error', 'Could not build packages. Please try again.', [err.message]));
  } finally {
    setLoading(false);
  }
});


loadMeta();
route();

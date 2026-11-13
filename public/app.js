// FitMyTrip front end: request form (GET /api/meta, client checks, POST /api/packages/build), result cards / over-budget
// suggestions / NO_PACKAGE reasons, and the day-by-day package view (?package=<id>) with a sticky budget fit bar.

const form = document.getElementById('request-form');
const submitBtn = document.getElementById('submit');
const resultEl = document.getElementById('result');
const childList = document.getElementById('child-list');
const childTpl = document.getElementById('child-row');
const requestCard = document.getElementById('request-card');

const FIELDS = ['departureAirport', 'country', 'startDate', 'nights', 'adults', 'childAges', 'budgetInr', 'includeStay'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WINDOW_PREFIX = 'Flights and rooms are only available';

let rules = { min_nights: 3, max_nights: 10 };
let attractionHours = new Map(); // attraction_id -> { open_from, open_until }

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const labelName = { cheapest: 'Cheapest', fastest: 'Fastest', best_rated: 'Best rated' };
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollMode = () => (reducedMotion() ? 'auto' : 'smooth');

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
}

// ---------- inline SVG icons (no icon font, works offline) ----------

const ICONS = {
  plane: '<path d="M2.5 20h19"/><path d="M3.6 12.9l2.3-.9 2.7 1.5 3.4-1.4-3.6-5.6 2.2-.9 6.2 4.5 3-1.2a1.7 1.7 0 0 1 1.3 3.1L8 17.4z"/>',
  bed: '<path d="M3 18.5V6.5M3 14h18v4.5M21 14v-1.5a3 3 0 0 0-3-3h-7V14"/><circle cx="7" cy="11.5" r="1.8"/>',
  car: '<path d="M5 17v-4.6L7.1 7.5h9.8L19 12.4V17"/><path d="M3.5 17h17M3.5 12.5h17"/><path d="M7 17v2.5M17 17v2.5"/><path d="M7.5 15h.01M16.5 15h.01"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v2M14 11.5v1M14 15v2"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4L2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17.2v.01"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  plus: '<path d="M6 12h12M12 6v12"/>',
  swap: '<path d="M6 8h12l-3.5-3.5M18 16H6l3.5 3.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  copy: '<rect x="9" y="9" width="10.5" height="11" rx="2"/><path d="M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H9"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3.4 2.8-5.3 5.5-5.3s4.9 1.9 5.5 5.3"/><circle cx="17" cy="10" r="2.4"/><path d="M15.8 14.6c2.5-.4 4.3 1.2 4.7 4.4"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  bolt: '<path d="M13 3L5 13.5h6l-1 7.5 8-10.5h-6z"/>',
  tag: '<path d="M3.5 12.3V4h8.3l8.7 8.7-8.3 8.3z"/><circle cx="8" cy="8.5" r="1.4"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  searchX: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8.8 8.8l4.4 4.4M13.2 8.8l-4.4 4.4"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="12.5" rx="2.5"/><path d="M3.5 10h17M15.5 14.5h2"/>',
  map: '<path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>',
};

function icon(name, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

const LABEL_ICON = { cheapest: 'tag', fastest: 'bolt', best_rated: 'star' };
const TYPE_ICON = { flight: 'plane', hotel: 'bed', transfer: 'car', attraction: 'ticket' };

// ---------- meta / dropdowns ----------

async function loadMeta() {
  const depSel = form.departureAirport;
  const countrySel = form.country;
  try {
    const res = await fetch('/api/meta');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = await res.json();
    rules = { ...rules, ...meta.rules };
    attractionHours = new Map((meta.attractions ?? []).map((a) => [a.attraction_id, a]));

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

// ---------- steppers (nights, adults): only change the input value; validation is unchanged ----------

form.addEventListener('click', (e) => {
  const btn = e.target.closest('.step');
  if (!btn) return;
  const input = form[btn.dataset.step];
  const dir = Number(btn.dataset.dir);
  const min = Number(input.min || 1);
  const max = input.max === '' ? Infinity : Number(input.max);
  const cur = Number(input.value);
  let next;
  if (input.value === '' || !Number.isFinite(cur)) next = min;
  else next = Math.min(max, Math.max(min, Math.round(cur) + dir));
  input.value = String(next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

// ---------- children ----------

function renumberChildren() {
  [...childList.children].forEach((li, i) => {
    const input = li.querySelector('input');
    const label = li.querySelector('label');
    input.id = `child-age-${i}`;
    label.htmlFor = input.id;
    label.replaceChildren(`Child ${i + 1}`, el('span', { class: 'sr-only' }, ' age'));
    li.querySelector('.remove-child').setAttribute('aria-label', `Remove child ${i + 1}`);
  });
}

function addChild(age = '') {
  const li = childTpl.content.firstElementChild.cloneNode(true);
  li.querySelector('input').value = age;
  li.querySelector('.remove-child').addEventListener('click', () => {
    const next = li.nextElementSibling ?? li.previousElementSibling;
    li.remove();
    renumberChildren();
    clearError('childAges');
    (next?.querySelector('input') ?? document.getElementById('add-child')).focus();
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
      includeStay: form.includeStay.checked,
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

// ---------- shared display pieces ----------

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
/** Average hotel stars as "3.00 ★" (null when the package has no hotel). */
const stars = (n) => (n == null ? 'No hotel' : `${Number(n).toFixed(2)} ★`);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function button(label, cls, onClick, attrs = {}) {
  const b = el('button', { type: 'button', class: cls, ...attrs }, ...(Array.isArray(label) ? label : [label]));
  b.addEventListener('click', onClick);
  return b;
}

function labelBadge(label) {
  if (!label) return null;
  return el('span', { class: `pkg-label pkg-${label}` }, icon(LABEL_ICON[label] ?? 'check'), labelName[label] ?? label);
}

/** Route as city chips with nights: Tokyo 3 → Kyoto 3. */
function routeChips(plan) {
  const list = el('ol', { class: 'route', 'aria-label': 'Route' });
  plan.forEach((p, i) => {
    const li = el('li', {});
    if (i > 0) li.append(el('span', { class: 'route-arrow', 'aria-hidden': 'true' }, icon('arrowRight')));
    li.append(el('span', { class: 'city-chip' }, p.city,
      el('b', {}, String(p.nights), el('span', { class: 'sr-only' }, p.nights === 1 ? ' night' : ' nights'))));
    list.append(li);
  });
  return list;
}

/**
 * Fit meter: the track stands for max(total, budget). Within budget the teal fill ends at total / budget; over budget
 * the fill (red) stops at the budget mark and a hatched overflow segment shows the excess.
 */
function setMeter(track, total, budget) {
  const max = Math.max(total, budget, 1);
  const over = total > budget;
  track.classList.toggle('is-over', over);
  const fill = track.querySelector('.fit-fill');
  const extra = track.querySelector('.fit-over');
  const mark = track.querySelector('.fit-mark');
  fill.style.width = `${(Math.min(total, budget) / max) * 100}%`;
  extra.style.left = `${(budget / max) * 100}%`;
  extra.style.width = over ? `${((total - budget) / max) * 100}%` : '0%';
  mark.style.left = `${(budget / max) * 100}%`;
  const left = budget - total;
  track.setAttribute('aria-label', left >= 0
    ? `Fits: ${inr(total)} of ${inr(budget)} budget, ${inr(left)} left`
    : `Over budget: ${inr(total)} against ${inr(budget)}, ${inr(-left)} over`);
}

function fitMeter(total, budget) {
  const left = budget - total;
  const track = el('div', { class: 'fit-track', role: 'img' },
    el('span', { class: 'fit-fill' }), el('span', { class: 'fit-over' }), el('span', { class: 'fit-mark' }));
  setMeter(track, total, budget);
  return el(
    'div',
    { class: 'meter' },
    el('div', { class: 'meter-label' },
      el('span', { class: 'muted' }, `of ${inr(budget)}`),
      el('strong', { class: left >= 0 ? 'money-ok' : 'money-over' },
        left >= 0 ? `${inr(left)} left` : `${inr(-left)} over`)),
    track,
  );
}

// ---------- results ----------

/**
 * One value on a package card. When `win` is true this is the value that earned the card its badge: it gets the
 * badge's icon, teal + bold styling, and a screen-reader note naming the badge.
 */
function cardValue(content, label, win) {
  if (!win) return [content];
  return [
    el('span', { class: 'win-value' }, icon(LABEL_ICON[label] ?? 'check'), content),
    el('span', { class: 'sr-only' }, ` (${labelName[label] ?? label})`),
  ];
}

function packageCard(pkg) {
  const nights = pkg.plan.reduce((t, p) => t + p.nights, 0);
  const win = (label) => pkg.label === label;
  const hasStars = pkg.metrics.avg_stars != null;
  return el(
    'article',
    { class: 'pkg-card', 'aria-label': `${labelName[pkg.label] ?? 'Package'}: ${pkg.country}, ${inr(pkg.total_inr)}` },
    el('div', { class: 'pkg-card-top' }, labelBadge(pkg.label),
      el('h3', { class: 'pkg-country' }, `${pkg.country} · ${plural(nights, 'night')}`)),
    el('div', { class: 'metric' },
      el('span', { class: 'metric-value' }, ...cardValue(inr(pkg.total_inr), 'cheapest', win('cheapest'))),
      el('span', { class: 'metric-caption' }, 'Total for everyone')),
    routeChips(pkg.plan),
    el('p', { class: 'pkg-dates' }, `${fmtDay(pkg.start_date)} → ${fmtDay(pkg.end_date)}`),
    el('dl', { class: 'pkg-stats' },
      el('div', {},
        el('dt', {}, 'Travel time'),
        el('dd', {}, ...cardValue(hm(pkg.metrics.travel_minutes), 'fastest', win('fastest')))),
      el('div', {},
        el('dt', {}, 'Average hotel stars'),
        el('dd', {}, ...(hasStars
          ? cardValue(stars(pkg.metrics.avg_stars), 'best_rated', win('best_rated'))
          : ['Own stay'])))),
    fitMeter(pkg.total_inr, pkg.budget_inr),
    button(['View trip', icon('arrowRight')], 'btn btn-primary btn-view', () => openPackage(pkg.id)),
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
  form.scrollIntoView({ behavior: scrollMode(), block: 'start' });
  submitBtn.focus({ preventScroll: true });
}

/** Scroll to one form field and put the cursor in it (no-package suggestions). */
function focusField(name) {
  const input = form[name];
  if (!input) return;
  input.scrollIntoView({ behavior: scrollMode(), block: 'center' });
  input.focus({ preventScroll: true });
}

function stateCard(kind, iconName, ...body) {
  return el('div', { class: `card state-card ${kind}` },
    el('div', { class: 'state-icon', 'aria-hidden': 'true' }, icon(iconName)),
    el('div', { class: 'state-body' }, ...body));
}

function overBudgetView(data) {
  const cheapest = data.packages?.[0];
  const budget = cheapest?.budget_inr ?? (data.cheapest_total - data.over_by);
  const body = [
    el('h2', {}, `No trip fits this budget yet`),
    el('dl', { class: 'state-figures' },
      el('div', {}, el('dt', {}, 'Cheapest trip'), el('dd', {}, inr(data.cheapest_total))),
      el('div', {}, el('dt', {}, 'Your budget'), el('dd', {}, inr(budget))),
      el('div', { class: 'money-over' }, el('dt', {}, 'Over by'), el('dd', {}, inr(data.over_by)))),
    fitMeter(data.cheapest_total, budget),
    cheapest ? routeChips(cheapest.plan) : null,
  ];
  const suggestions = data.suggestions.slice(0, 3);
  if (suggestions.length) {
    const list = el('ul', { class: 'suggestions' });
    for (const s of suggestions) {
      const changes = suggestionChanges(s);
      list.append(el('li', {}, changes
        ? button([el('span', {}, s), icon('arrowRight')], 'btn btn-suggest', () => refillForm(changes))
        : el('span', { class: 'suggest-text' }, s)));
    }
    body.push(el('p', { class: 'suggest-title' }, 'Make it fit (fills in the form):'), list);
  }
  // Contract: OVER_BUDGET returns [cheapest] (saved by the server, left_inr negative).
  if (cheapest?.id) {
    body.push(el('div', { class: 'state-actions' },
      button('View the cheapest trip anyway', 'btn btn-secondary', () => openPackage(cheapest.id))));
  }
  return el('div', { role: 'status' }, stateCard('over-budget', 'wallet', ...body));
}

function noPackageView(reasons) {
  const windowReason = reasons.some((r) => r.startsWith(WINDOW_PREFIX));
  const actions = [
    button([icon('calendar'), windowReason ? 'Pick dates from 1 to 20 April' : 'Try another start date'],
      'btn btn-secondary', () => focusField('startDate')),
    button([icon('pin'), 'Try another country'], 'btn btn-secondary', () => focusField('country')),
    button([icon('plane'), 'Fly from another city'], 'btn btn-secondary', () => focusField('departureAirport')),
  ];
  return el('div', { role: 'alert' }, stateCard(
    'no-package', 'ban',
    el('h2', {}, 'No trip for these choices'),
    el('p', {}, 'We could not build a valid trip because:'),
    el('ul', { class: 'reasons' }, ...reasons.map((r) => el('li', {}, r))),
    el('p', { class: 'suggest-title' }, 'What you can change:'),
    el('div', { class: 'state-actions' }, ...actions),
  ));
}

function skeletonCards() {
  const card = () => el('div', { class: 'pkg-card skeleton', 'aria-hidden': 'true' },
    el('span', { class: 'sk sk-badge' }), el('span', { class: 'sk sk-big' }),
    el('span', { class: 'sk sk-line' }), el('span', { class: 'sk sk-line short' }),
    el('span', { class: 'sk sk-line' }), el('span', { class: 'sk sk-btn' }));
  return [
    el('div', { class: 'result-head' }, el('h2', {}, 'Finding trips that fit…')),
    el('div', { class: 'pkg-grid' }, card(), card(), card()),
  ];
}

function renderBuild(data) {
  switch (data.status) {
    case 'OK': {
      const pkgs = data.packages.slice(0, 3);
      const p = pkgs[0];
      showResult(
        el('div', { class: 'result-head' },
          el('h2', {}, `${plural(pkgs.length, 'trip')} ${pkgs.length === 1 ? 'fits' : 'fit'} your budget`),
          p ? el('p', { class: 'muted' }, `${p.country} · ${fmtDay(p.start_date)} → ${fmtDay(p.end_date)} · budget ${inr(p.budget_inr)}`) : null),
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
  if (data.status !== 'INVALID_REQUEST') resultEl.scrollIntoView({ behavior: scrollMode(), block: 'start' });
}

// ---------- dates (strings only; weekday and day number via the UTC trick, CLAUDE.md rule 4) ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const utcDay = (d) => new Date(d + 'T00:00:00Z');
const fmtDateShort = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const fmtDay = (d) => `${WEEKDAYS[utcDay(d).getUTCDay()]} ${fmtDateShort(d)}`;
const fmtDateLong = (d) => `${fmtDay(d)} ${d.slice(0, 4)}`;
const dateOf = (dt) => dt.slice(0, 10);
const timeOf = (dt) => (dt.length >= 16 ? dt.slice(11, 16) : null);
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ---------- package view ----------

const pkgView = document.getElementById('package-view');
const bar = document.getElementById('budget-bar');
const fitTrack = document.getElementById('fit-track');
const fitDelta = document.getElementById('fit-delta');
const TYPE_LABEL = { flight: 'Flight', transfer: 'Transfer', hotel: 'Hotel', attraction: 'Attraction' };
let deltaTimer = 0;

/** Bottom bar: total, budget, left/over and the fit meter. `delta` (optional) shows the +₹/−₹ chip after a change. */
function updateBar(pkg, delta = null) {
  const left = pkg.budget_inr - pkg.total_inr;
  document.getElementById('bar-total').textContent = inr(pkg.total_inr);
  document.getElementById('bar-budget').textContent = inr(pkg.budget_inr);
  document.getElementById('bar-left-label').textContent = left >= 0 ? 'left' : 'over';
  document.getElementById('bar-left').textContent = inr(Math.abs(left));
  const box = document.getElementById('bar-left-box');
  box.classList.toggle('money-ok', left >= 0);
  box.classList.toggle('money-over', left < 0);
  setMeter(fitTrack, pkg.total_inr, pkg.budget_inr);
  document.getElementById('export-btn').href = `/api/packages/${encodeURIComponent(pkg.id)}/export`;
  const booked = pkg.status === 'BOOKED';
  document.getElementById('confirm-btn').hidden = booked;
  let bookedTag = bar.querySelector('.bar-booked');
  if (booked && !bookedTag) {
    bookedTag = el('span', { class: 'bar-booked' }, icon('check'), 'Booked');
    bar.querySelector('.bar-actions').append(bookedTag);
  }
  if (bookedTag) bookedTag.hidden = !booked;

  clearTimeout(deltaTimer);
  fitDelta.classList.remove('show', 'up', 'down');
  if (delta != null) {
    void fitDelta.offsetWidth; // restart the pop animation
    fitDelta.textContent = fmtDelta(delta);
    fitDelta.classList.add('show', delta > 0 ? 'up' : delta < 0 ? 'down' : 'same');
    fitTrack.classList.remove('pulse');
    void fitTrack.offsetWidth;
    fitTrack.classList.add('pulse');
    deltaTimer = setTimeout(() => fitDelta.classList.remove('show'), 5000);
  }
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
    acts.push(button([icon('swap'), 'Change flight'], 'btn btn-small btn-secondary', () => openOptions(
      { kind: 'flight', direction },
      direction === 'outbound' ? 'Change outbound flight' : 'Change return flight',
      (o) => ({ type: 'swap_flight', direction, flight_id: o.id }),
    ), { 'aria-label': `Change ${direction} flight ${item.name}` }));
  } else if (ev.kind === 'check-in') {
    acts.push(button([icon('swap'), 'Change hotel'], 'btn btn-small btn-secondary', () => openOptions(
      { kind: 'hotel', city: item.city },
      `Change hotel in ${item.city}`,
      (o) => {
        const [hotel_id, room_id] = o.id.split('|');
        return { type: 'swap_hotel', city: item.city, hotel_id, room_id };
      },
    ), { 'aria-label': `Change hotel in ${item.city}` }));
  } else if (item.type === 'attraction') {
    acts.push(button([icon('trash'), 'Remove'], 'btn btn-small btn-danger', () => sendChange(
      { type: 'remove_attraction', item_id: item.item_id },
      `${item.name} removed`,
    ), { 'aria-label': `Remove ${item.name}` }));
  }
  return acts.length ? el('div', { class: 'tl-actions' }, ...acts) : null;
}

/** A hotel item's warnings cover both ends of the stay; show each one only on the row it is about. */
function warningsFor(ev) {
  const all = ev.item.warnings ?? [];
  if (ev.kind === 'check-in') return all.filter((w) => /check-in|arrive|after midnight/i.test(w));
  if (ev.kind === 'check-out') {
    return all.filter((w) => /check[ -]out|pickup/i.test(w) && !/check-in|arrive|after midnight/i.test(w));
  }
  return all;
}

/** Left column of a row: time range (flights, transfers), opening hours (attractions) or check-in/out. */
function eventTime(ev) {
  const { item } = ev;
  if (ev.kind === 'check-in') return el('span', { class: 'tl-time' }, 'Check-in');
  if (ev.kind === 'check-out') return el('span', { class: 'tl-time' }, 'Check-out');
  if (item.type === 'attraction') {
    // Show when the attraction is open, not the planned visit slot.
    const hours = attractionHours.get(item.catalog_id);
    return el('span', { class: 'tl-time' }, hours ? `${hours.open_from} – ${hours.open_until}` : '', hours ? el('small', {}, 'open') : null);
  }
  const end = timeOf(item.end ?? '');
  const nextDay = end && dateOf(item.end) !== dateOf(item.start);
  return el('span', { class: 'tl-time' }, end ? `${ev.time} – ${end}` : (ev.time ?? ''),
    nextDay ? el('small', {}, `arrives ${fmtDateShort(dateOf(item.end))}`) : null);
}

function eventNode(ev, pkg) {
  const { item } = ev;
  let title = item.name;
  const details = [];

  if (ev.kind === 'check-in') {
    title = `Check in: ${item.name}`;
    details.push(`${plural(item.quantity, 'room')} · until ${fmtDateShort(dateOf(item.end))}`);
  } else if (ev.kind === 'check-out') {
    title = `Check out: ${item.name}`;
  } else if (item.type === 'attraction') {
    details.push(plural(item.quantity, 'ticket'));
  } else {
    if (item.type === 'flight') details.push(plural(item.quantity, 'seat'));
    if (item.type === 'transfer') details.push(`× ${item.quantity}`);
  }

  const body = el(
    'div',
    { class: 'tl-body' },
    el('div', { class: 'tl-head' },
      el('span', { class: 'tl-type' }, TYPE_LABEL[item.type] ?? item.type),
      el('strong', { class: 'tl-title' }, title)),
    details.length ? el('p', { class: 'tl-detail' }, details.join(' · ')) : null,
  );
  if (item.type === 'attraction' && item.catalog_id) {
    // Catalog images are images/attractions/<attraction_id>.jpg; hide the frame if one is missing.
    const img = el('img', {
      class: 'tl-photo',
      src: `/images/attractions/${encodeURIComponent(item.catalog_id)}.jpg`,
      alt: item.name,
      loading: 'lazy',
      width: '280',
      height: '158',
    });
    img.addEventListener('error', () => img.remove());
    body.append(img);
  }
  for (const w of warningsFor(ev)) body.append(el('p', { class: 'tl-warning' }, icon('alert'), el('span', {}, w)));
  const acts = eventActions(ev, pkg);
  if (acts) body.append(acts);

  return el(
    'li',
    { class: `tl-item tl-item-${ev.kind} tl-${item.type}` },
    eventTime(ev),
    el('span', { class: 'tl-icon', 'aria-hidden': 'true' }, icon(TYPE_ICON[item.type] ?? 'check')),
    body,
    el('span', { class: 'tl-price' }, ev.kind === 'check-out' ? '' : inr(item.price_inr)),
  );
}

let ticketSeq = 0;

/** Boarding-pass ticket for a booked package: route, dates, travellers, the 10-digit number with Copy, BOOKED stamp. */
function ticketNode(pkg, ref, { createdAt = null, animate = false } = {}) {
  const id = `ref-field-${++ticketSeq}`;
  const t = pkg.traveler ?? {};
  const people = plural(t.adults, 'adult') + (t.children ? `, ${plural(t.children, 'child', 'children')}` : '');
  const field = el('input', { id, class: 'ref-field', type: 'text', readonly: '', value: ref, spellcheck: 'false' });
  const copy = button([icon('copy'), 'Copy'], 'btn btn-secondary btn-copy', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(ref);
      ok = true;
    } catch {
      field.select();
      ok = document.execCommand?.('copy') ?? false;
    }
    copy.replaceChildren(icon(ok ? 'check' : 'copy'), ok ? 'Copied' : 'Select and copy');
    setTimeout(() => copy.replaceChildren(icon('copy'), 'Copy'), 2000);
  }, { 'aria-label': 'Copy reservation number' });
  return el(
    'div',
    { class: `ticket${animate ? ' stamp-in' : ''}` },
    el('span', { class: 'stamp', 'aria-hidden': 'true' }, 'BOOKED'),
    el('div', { class: 'ticket-main' },
      el('p', { class: 'ticket-kicker' }, icon('plane'), 'FitMyTrip · Reservation'),
      el('p', { class: 'ticket-route' }, t.home_airport ?? '', icon('arrowRight'), pkg.country),
      routeChips(pkg.plan),
      el('dl', { class: 'ticket-facts' },
        el('div', {}, el('dt', {}, 'Dates'), el('dd', {}, `${fmtDay(pkg.start_date)} → ${fmtDay(pkg.end_date)}`)),
        el('div', {}, el('dt', {}, 'Travellers'), el('dd', {}, people)),
        el('div', {}, el('dt', {}, 'Total paid'), el('dd', {}, inr(pkg.total_inr))),
        // created_at is SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC.
        createdAt ? el('div', {}, el('dt', {}, 'Booked'), el('dd', {}, `${createdAt.slice(0, 16)} UTC`)) : null)),
    el('div', { class: 'ticket-stub' },
      el('label', { for: id }, 'Reservation number'),
      el('div', { class: 'ref-row' }, field, copy),
      el('p', { class: 'ticket-note' }, 'Use it with “Find my reservation” to open this trip later.')),
  );
}

/** `reservation` (optional) = { reference, created_at } from GET /api/reservations/:ref: read-only summary mode. */
function renderPackage(pkg, reservation = null, delta = null) {
  const ref = reservation?.reference ?? referenceOf(pkg);
  const t = pkg.traveler ?? {};
  const nights = pkg.plan.reduce((n, p) => n + p.nights, 0);
  const people = plural(t.adults, 'adult') + (t.children ? `, ${plural(t.children, 'child', 'children')}` : '');
  const ages = t.child_ages?.length ? ` (age ${t.child_ages.join(', ')})` : '';
  const editable = pkg.status !== 'BOOKED';

  const fact = (iconName, term, value) => el('div', {}, icon(iconName), el('dt', {}, term), el('dd', {}, value));
  const summary = el(
    'section',
    { class: 'card summary', 'aria-labelledby': 'summary-title' },
    el('div', { class: 'summary-badges' },
      labelBadge(pkg.label),
      el('span', { class: `pkg-label pkg-status-${String(pkg.status).toLowerCase()}` },
        pkg.status === 'BOOKED' ? 'Booked' : 'Planned')),
    reservation ? el('p', { class: 'res-kicker', style: 'margin-top:8px' }, 'Reservation summary') : null,
    el('h2', { id: 'summary-title' }, `${pkg.country} · ${plural(nights, 'night')}`),
    routeChips(pkg.plan),
    el('dl', { class: 'facts' },
      fact('calendar', 'Dates', `${fmtDateLong(pkg.start_date)} → ${fmtDateLong(pkg.end_date)}`),
      fact('users', 'Travellers', people + ages),
      t.home_airport ? fact('plane', 'Flying from', t.home_airport) : null,
      fact('clock', 'Travel time', hm(pkg.metrics.travel_minutes)),
      pkg.metrics.avg_stars == null ? null : fact('star', 'Average hotel stars', stars(pkg.metrics.avg_stars))),
    pkg.metrics.avg_stars == null
      ? el('p', { class: 'muted own-stay' }, 'No hotel included — you arrange your own stay.')
      : null,
    editable ? el('div', { class: 'summary-actions' }, button([icon('map'), 'Change cities and nights'], 'btn btn-secondary', () =>
      openOptions({ kind: 'city_plan' }, 'Change cities and nights', (o) => ({
        type: 'set_city_plan', cities: o.detail?.cities ?? parsePlanId(o.id),
      })))) : null,
  );

  const timeline = el('ol', { class: 'timeline' });
  const start = utcDay(pkg.start_date).getTime();
  for (const [date, evs] of timelineDays(pkg)) {
    const n = Math.round((utcDay(date).getTime() - start) / 86400000) + 1;
    // Attractions can be added on any night of the stay (start_date .. end_date − 1).
    const city = cityOn(pkg, date);
    const canAdd = editable && date >= pkg.start_date && date < pkg.end_date;
    const list = el('ul', { class: 'tl-list' }, ...evs.map((ev) => eventNode(ev, pkg)));
    if (canAdd) {
      list.append(el('li', { class: 'tl-add-row' },
        el('span', { class: 'tl-add-dot', 'aria-hidden': 'true' }, icon('plus')),
        button([icon('plus'), `Add attraction in ${city}`], 'btn btn-small btn-ghost btn-add', () => openOptions(
          { kind: 'attraction', date },
          `Add an attraction on ${fmtDateLong(date)} (${city})`,
          (o) => ({ type: 'add_attraction', attraction_id: o.id, date }),
        ), { 'aria-label': `Add an attraction on ${fmtDay(date)} in ${city}` })));
    }
    timeline.append(el(
      'li',
      { class: 'tl-day' },
      el('h3', { class: 'tl-date' },
        el('span', { class: 'tl-daynum' }, n >= 1 ? `Day ${n}` : 'Travel day'),
        el('span', { class: 'tl-dot', 'aria-hidden': 'true' }, '·'),
        el('span', {}, fmtDay(date)),
        el('span', { class: 'tl-dot', 'aria-hidden': 'true' }, '·'),
        el('span', { class: 'tl-city' }, city)),
      list,
    ));
  }

  const aside = el('aside', { class: 'pkg-aside', 'aria-label': 'Trip summary' },
    ref ? ticketNode(pkg, ref, { createdAt: reservation?.created_at }) : null,
    summary);

  pkgView.replaceChildren(
    el('div', { class: 'pkg-topline' },
      button([icon('arrowLeft'), 'New search'], 'btn-link', closePackage)),
    el('div', { class: 'pkg-layout' },
      el('div', { class: 'pkg-main' },
        el('section', { class: 'card timeline-card', 'aria-labelledby': 'tl-title' },
          el('div', { class: 'timeline-head' },
            el('h2', { id: 'tl-title' }, 'Day by day'),
            el('p', { class: 'muted' }, editable ? 'Change, remove or add anything; the fit bar updates.' : 'Read-only: this trip is booked.')),
          timeline,
          el('p', { class: 'credits' }, 'Attraction photos from Wikimedia Commons. ',
            el('a', { href: '/images/ATTRIBUTIONS.md', target: '_blank', rel: 'noopener' }, 'Photo credits')))),
      aside),
  );
  currentPkg = pkg;
  updateBar(pkg, delta);
}

function packageSkeleton(text) {
  return el('div', { class: 'pkg-layout skeleton', 'aria-busy': 'true' },
    el('div', { class: 'card' },
      el('p', { class: 'sr-only' }, text),
      el('span', { class: 'sk sk-big', 'aria-hidden': 'true' }),
      ...Array.from({ length: 6 }, (_, i) => el('span', { class: `sk sk-line${i % 2 ? ' short' : ''}`, style: 'margin-top:16px', 'aria-hidden': 'true' }))),
    el('div', { class: 'card', 'aria-hidden': 'true' },
      el('span', { class: 'sk sk-badge' }),
      el('span', { class: 'sk sk-line', style: 'margin-top:16px' }),
      el('span', { class: 'sk sk-line short', style: 'margin-top:12px' })));
}

// ---------- changes: options modal + POST /change ----------

let currentPkg = null;
let changing = false;
let returnFocus = null;
const noticeEl = document.getElementById('change-notice');
const dialog = document.getElementById('options-dialog');

// Backdrop click closes the modal (clicks inside land on child elements, not the dialog itself).
dialog.addEventListener('click', (e) => { if (e.target === dialog && !changing) dialog.close(); });
dialog.addEventListener('cancel', (e) => { if (changing) e.preventDefault(); });

// Keep Tab inside the open dialog (showModal makes the page inert; this also stops Tab escaping to browser chrome).
dialog.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const focusables = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter((n) => n.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// Give focus back to the button that opened the dialog; if a re-render removed it, to the change toast or the page.
dialog.addEventListener('close', () => {
  const target = returnFocus;
  returnFocus = null;
  if (noticeEl.contains(document.activeElement)) return; // sendChange already moved focus to its toast
  if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
  else document.getElementById('main').focus({ preventScroll: true });
});

function openDialog() {
  if (!dialog.open) {
    returnFocus = document.activeElement;
    dialog.showModal();
  }
}

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
  if (d.open_from && d.open_until) bits.push(`Open ${d.open_from} – ${d.open_until}`);
  else if (d.start && d.end) bits.push(`${timeOf(d.start) ?? d.start} – ${timeOf(d.end) ?? d.end}`);
  if (d.duration_minutes != null) bits.push(hm(d.duration_minutes));
  return bits.join(' · ');
}

const KIND_ICON = { hotel: 'bed', flight: 'plane', attraction: 'ticket', city_plan: 'map' };

/** Catalog photo (detail.image = "images/…") or a type icon when there is none or it fails to load. */
function optionMedia(o, kind) {
  const box = el('div', { class: 'opt-media' });
  const fallback = () => box.replaceChildren(icon(KIND_ICON[kind] ?? 'check'));
  const path = o.detail?.image;
  if (typeof path === 'string' && /^images\/[\w./-]+$/.test(path)) {
    const img = el('img', { src: `/${path}`, alt: '', loading: 'lazy', width: '88', height: '66' });
    img.addEventListener('error', fallback);
    box.append(img);
  } else {
    fallback();
  }
  return box;
}

function optionNode(o, makeChange, successText, kind) {
  const current = o.detail?.current === true;
  const delta = o.price_delta_inr == null ? null : Number(o.price_delta_inr); // null on invalid options
  const info = optionInfo(o.detail);
  const chipCls = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : '';
  const chipText = current ? 'Current' : delta == null ? '—' : fmtDelta(delta);
  const side = el('div', { class: 'opt-side' },
    el('span', { class: `opt-delta ${current ? '' : chipCls}`, 'aria-label': current ? 'Current choice'
      : delta == null ? 'No price' : `${delta > 0 ? 'Costs' : delta < 0 ? 'Saves' : 'Same price'} ${delta === 0 ? '' : inr(Math.abs(delta))}`.trim() },
    chipText));
  if (o.valid && !current) {
    side.append(button('Select', 'btn btn-primary btn-small opt-select',
      () => sendChange(makeChange(o), `${successText}: ${o.label}`), { 'aria-label': `Select ${o.label}, ${chipText}` }));
  } else if (!o.valid) {
    side.append(el('span', { class: 'opt-info' }, 'Not available'));
  }
  return el(
    'div',
    { class: `opt${o.valid ? '' : ' opt-invalid'}${current ? ' opt-current' : ''}`, role: 'listitem' },
    optionMedia(o, kind),
    el('div', { class: 'opt-main' },
      el('strong', { class: 'opt-label' }, o.label),
      info ? el('span', { class: 'opt-info' }, info) : null,
      !o.valid && o.reason ? el('span', { class: 'opt-reason' }, o.reason) : null),
    side,
  );
}

function modalHead(title) {
  return el('div', { class: 'modal-head' },
    el('h2', { id: 'modal-title' }, title),
    button(icon('x'), 'btn btn-icon modal-close', () => dialog.close(), { 'aria-label': 'Close' }));
}

/** Opens the modal and fills it from GET /api/packages/:id/options?<query>. */
async function openOptions(query, title, makeChange) {
  const pkg = currentPkg;
  if (!pkg || changing) return;
  const list = el('div', { class: 'opt-list', role: 'list', 'aria-busy': 'true' },
    ...Array.from({ length: 3 }, () => el('div', { class: 'opt skeleton', 'aria-hidden': 'true' },
      el('span', { class: 'sk', style: 'width:88px;height:66px' }),
      el('div', { class: 'opt-main' }, el('span', { class: 'sk sk-line' }), el('span', { class: 'sk sk-line short', style: 'margin-top:8px' })))),
    el('p', { class: 'sr-only' }, 'Loading options…'));
  const credits = el('p', { class: 'credits', hidden: '' }, 'Photos from Wikimedia Commons. ',
    el('a', { href: '/images/ATTRIBUTIONS.md', target: '_blank', rel: 'noopener' }, 'Photo credits'));
  dialog.replaceChildren(
    modalHead(title),
    el('p', { class: 'muted modal-sub' }, 'Prices are the change to your package total.'),
    list,
    credits,
  );
  openDialog();
  try {
    const res = await fetch(`/api/packages/${encodeURIComponent(pkg.id)}/options?${new URLSearchParams(query)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!dialog.open || currentPkg !== pkg) return;
    const shortTitle = title.split(' (')[0];
    list.removeAttribute('aria-busy');
    list.replaceChildren(...(data.length
      ? data.map((o) => optionNode(o, makeChange, shortTitle, query.kind))
      : [el('p', { class: 'muted' }, 'No options available.')]));
    credits.hidden = !data.some((o) => o.detail?.image);
  } catch (err) {
    if (dialog.open) list.replaceChildren(banner('error', 'Could not load the options.', [err.message]));
  }
}

/** Toast above the fit bar: ok (teal), warn (saffron, e.g. over budget or auto-fixes), error (refused / failed). */
function toast(kind, title, lines = [], sub = null) {
  const iconName = kind === 'error' ? 'ban' : kind === 'warn' ? 'alert' : 'check';
  return el(
    'div',
    { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', tabindex: '-1' },
    el('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon(iconName)),
    el('strong', { class: 'toast-title' }, ...(Array.isArray(title) ? title : [title])),
    sub ? el('p', { class: 'toast-sub' }, sub) : null,
    lines.length ? el('ul', {}, ...lines.map((l) => el('li', {}, l))) : null,
  );
}

let noticeTimer = 0;

function showNotice(node, { autoHide = false } = {}) {
  clearTimeout(noticeTimer);
  noticeEl.replaceChildren();
  if (!node) return;
  node.append(button(icon('x'), 'btn btn-icon notice-close', () => showNotice(null), { 'aria-label': 'Dismiss message' }));
  noticeEl.append(node);
  if (autoHide) noticeTimer = setTimeout(() => { if (noticeEl.contains(node)) showNotice(null); }, 6000);
}

/** POST a change; ok → re-render package + bar and show warnings; refused → reasons, old package kept. */
async function sendChange(change, successText) {
  const pkg = currentPkg;
  if (!pkg || changing) return;
  // The re-render removes the button that started the change (row action or dialog opener): move focus to the toast.
  const focusToast = () => noticeEl.querySelector('.toast')?.focus({ preventScroll: true });
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
    // refused → the unchanged package, so the view and bar stay as they were
    renderPackage(data.package, null, data.ok ? (data.delta_inr ?? 0) : null);
    if (data.ok) {
      const p = data.package;
      const over = p.total_inr - p.budget_inr;
      const lines = [...(data.warnings ?? [])];
      if (over > 0) lines.push(`Your package is now ${inr(over)} over budget.`);
      const hotelIssue = (data.warnings ?? []).some((w) => !/^Fixed:/i.test(w) && /check-in|check-out|check out|after midnight/i.test(w));
      const kind = over > 0 || hotelIssue ? 'warn' : 'ok';
      showNotice(toast(kind,
        [`${successText} `, el('span', { class: 'money' }, `(${fmtDelta(data.delta_inr ?? 0)})`)],
        lines,
        lines.length ? 'We adjusted the rest of the trip to match:' : null),
      { autoHide: !lines.length });
    } else {
      showNotice(toast('error', 'Change refused',
        data.reasons?.length ? data.reasons : ['The change was refused.'],
        'Your package is unchanged.'));
    }
    focusToast();
  } catch (err) {
    if (currentPkg !== pkg) return;
    dialog.close();
    showNotice(toast('error', 'Could not apply the change', [err.message], 'Your package is unchanged.'));
    focusToast();
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
  requestCard.hidden = false;
  form.hidden = false;
  quickForm.hidden = false;
  resultEl.hidden = resultEl.childElementCount === 0;
}

function hideFormView() {
  requestCard.hidden = true;
  form.hidden = true;
  quickForm.hidden = true;
  resultEl.hidden = true;
  bar.hidden = true;
  pkgView.hidden = false;
}

let loadSeq = 0;

async function loadPackageView(id) {
  const seq = ++loadSeq;
  leavePackage();
  hideFormView();
  pkgView.replaceChildren(packageSkeleton('Loading package…'));
  window.scrollTo({ top: 0 });
  try {
    const res = await fetch(`/api/packages/${encodeURIComponent(id)}`);
    const pkg = await res.json().catch(() => null);
    if (res.status === 404) throw new Error('This package does not exist (any more). Build a new one.');
    if (!res.ok || !pkg) throw new Error(pkg?.error || `HTTP ${res.status}`);
    if (seq === loadSeq) renderPackage(pkg);
  } catch (err) {
    if (seq !== loadSeq) return;
    pkgView.replaceChildren(emptyState('alert', 'Could not load the package', err.message, [
      button([icon('arrowLeft'), 'New search'], 'btn btn-primary', closePackage),
    ]));
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

document.querySelector('.brand').addEventListener('click', (e) => {
  e.preventDefault();
  closePackage();
});

function emptyState(iconName, title, text, actions = []) {
  return el('div', { class: 'card empty-state', role: 'alert' },
    el('div', { class: 'empty-art', 'aria-hidden': 'true' }, icon(iconName)),
    el('h2', {}, title),
    typeof text === 'string' ? el('p', {}, text) : text,
    actions.length ? el('div', { class: 'state-actions' }, ...actions) : null);
}

// ---------- confirm booking ----------

const confirmBtn = document.getElementById('confirm-btn');

/** Step 1: ask (booking is final). Step 2: POST /confirm. Step 3: show the 10-digit number with a copy button. */
confirmBtn.addEventListener('click', () => {
  const pkg = currentPkg;
  if (!pkg || changing || pkg.status === 'BOOKED') return;
  const over = pkg.total_inr - pkg.budget_inr;
  const go = button([icon('check'), 'Confirm booking'], 'btn btn-primary', () => confirmBooking(pkg));
  dialog.replaceChildren(
    modalHead('Confirm this trip?'),
    el('div', { class: 'modal-body' },
      el('p', {}, `${pkg.country}, ${fmtDay(pkg.start_date)} to ${fmtDay(pkg.end_date)}. `,
        'Total ', el('strong', { class: 'money' }, inr(pkg.total_inr)), '.'),
      el('p', { class: 'muted' }, 'After confirming, the trip can no longer be changed.'),
      over > 0 ? el('p', { class: 'banner banner-error' }, `This is ${inr(over)} over your budget.`) : null,
      el('div', { class: 'modal-actions' }, button('Cancel', 'btn btn-secondary', () => dialog.close()), go)),
  );
  openDialog();
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
      showNotice(toast('error', 'Booking not confirmed',
        data.reasons?.length ? data.reasons : ['The booking was refused.'], 'Nothing was booked.'));
    }
  } catch (err) {
    if (currentPkg !== pkg) return;
    dialog.close();
    showNotice(toast('error', 'Could not confirm the booking', [err.message], 'Nothing was booked.'));
  } finally {
    changing = false;
    dialog.removeAttribute('aria-busy');
    confirmBtn.disabled = false;
  }
}

function showReference(ref) {
  const ticket = ticketNode(currentPkg, ref, { animate: true });
  dialog.replaceChildren(
    modalHead('Booking confirmed'),
    el('div', { class: 'modal-body' },
      el('p', {}, 'Your trip is booked. Keep this number to open it later with “Find my reservation”.'),
      ticket,
      el('div', { class: 'modal-actions' },
        button('View reservation summary', 'btn btn-secondary', () => { dialog.close(); openReservation(ref); }),
        button('Done', 'btn btn-primary', () => dialog.close()))),
  );
  openDialog();
  ticket.querySelector('.btn-copy').focus();
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
  hideFormView();
  pkgView.replaceChildren(packageSkeleton('Looking up reservation…'));
  window.scrollTo({ top: 0 });
  try {
    const res = await fetch(`/api/reservations/${encodeURIComponent(ref)}`);
    const data = await res.json().catch(() => null);
    if (seq !== loadSeq) return;
    if (res.status === 404 || (res.ok && !data?.package)) {
      pkgView.replaceChildren(emptyState('searchX', 'We couldn’t find that reservation',
        el('p', {}, 'No reservation has the number ', el('span', { class: 'ref-echo' }, ref),
          '. Check the 10 digits on your ticket and try again.'),
        [
          button([icon('search'), 'Try another number'], 'btn btn-primary', () => { findForm.ref.focus(); findForm.ref.select(); }),
          button('Plan a new trip', 'btn btn-secondary', closePackage),
        ]));
      return;
    }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    renderPackage(data.package, data);
  } catch (err) {
    if (seq !== loadSeq) return;
    pkgView.replaceChildren(emptyState('alert', 'Could not look up the reservation', err.message, [
      button([icon('arrowLeft'), 'New search'], 'btn btn-primary', closePackage),
    ]));
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
      missing.length ? 'Form partly filled. Please complete it' : 'Form filled. Check it and search', lines));
    resultEl.hidden = true;
    const firstMissing = form.querySelector('.field.invalid input, .field.invalid select');
    (firstMissing ?? (missing.includes('childAges') ? document.getElementById('add-child') : submitBtn)).focus();
    form.scrollIntoView({ behavior: scrollMode(), block: 'start' });
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

// "Use sample trip": the Menon family request from the problem statement. Fills the form only; never builds.
const SAMPLE_TRIP = {
  departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10', nights: 6, adults: 2, budgetInr: 350000,
};
document.getElementById('sample-trip').addEventListener('click', () => {
  clearAllErrors();
  quickResult.replaceChildren();
  for (const [name, value] of Object.entries(SAMPLE_TRIP)) {
    form[name].value = String(value);
    form[name].dispatchEvent(new Event('input', { bubbles: true }));
    form[name].dispatchEvent(new Event('change', { bubbles: true }));
    flash(form[name]);
  }
  form.includeStay.checked = true;
  childList.replaceChildren();
  flash(addChild(6));
  submitBtn.focus({ preventScroll: true });
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
  submitBtn.querySelector('.btn-label').textContent = on ? 'Finding trips that fit…' : 'Find trips that fit';
  form.setAttribute('aria-busy', String(on));
  resultEl.setAttribute('aria-busy', String(on));
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
  showResult(...skeletonCards());
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


loadMeta().finally(route);

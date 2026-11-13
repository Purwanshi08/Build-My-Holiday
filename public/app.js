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
      el('div', {}, el('dt', {}, 'Average hotel stars'), el('dd', {}, `${pkg.metrics.avg_stars} ★`)),
    ),
    button('View package', 'btn btn-primary btn-view', () => openPackage(pkg.id)),
  );
}

// Over-budget suggestions are human-readable engine strings ("Raise the budget to at least ₹2,48,290.",
// "Try 4 nights (from ₹1,90,000)."); these patterns turn them into form values.
const SUGGESTION_PATTERNS = [
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
  if (data.cheapest_package_id) {
    box.append(button('View cheapest package', 'btn btn-warn', () => openPackage(data.cheapest_package_id)));
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
  bar.hidden = false;
}

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

function eventNode(ev) {
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

function renderPackage(pkg) {
  const cities = pkg.plan.map((p) => `${p.city} ${p.nights}n`).join(' → ');
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
    el('h2', {}, `${pkg.country}: ${cities}`),
    el('p', { class: 'muted' }, `${fmtDateLong(pkg.start_date)} to ${fmtDateLong(pkg.end_date)} · ${people}`),
    el(
      'dl',
      { class: 'pkg-stats' },
      el('div', {}, el('dt', {}, 'Travel time'), el('dd', {}, hm(pkg.metrics.travel_minutes))),
      el('div', {}, el('dt', {}, 'Average hotel stars'), el('dd', {}, `${pkg.metrics.avg_stars} ★`)),
    ),
  );

  const timeline = el('ol', { class: 'timeline' });
  const start = utcDay(pkg.start_date).getTime();
  for (const [date, evs] of timelineDays(pkg)) {
    const n = Math.round((utcDay(date).getTime() - start) / 86400000) + 1;
    timeline.append(el(
      'li',
      { class: 'tl-day' },
      el('h3', { class: 'tl-date' }, fmtDateLong(date),
        el('span', { class: 'muted' }, ` · ${n >= 1 ? `Day ${n}` : 'Before day 1'} · ${cityOn(pkg, date)}`)),
      el('ul', { class: 'tl-list' }, ...evs.map(eventNode)),
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
  updateBar(pkg);
}

// ---------- views + URL (?package=<id> restores the package view after a refresh) ----------

function showFormView() {
  pkgView.hidden = true;
  bar.hidden = true;
  form.hidden = false;
  resultEl.hidden = resultEl.childElementCount === 0;
}

let loadSeq = 0;

async function loadPackageView(id) {
  const seq = ++loadSeq;
  form.hidden = true;
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

function route() {
  const id = new URLSearchParams(location.search).get('package');
  if (id) loadPackageView(id);
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

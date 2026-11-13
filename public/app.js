// Request form logic: loads dropdowns from GET /api/meta, validates fields on the client and calls
// POST /api/packages/build, then shows packages, over-budget suggestions, NO_PACKAGE reasons or field errors.

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

function packageCard(pkg) {
  const cities = pkg.plan.map((p) => `${p.city} ${p.nights}n`).join(' → ');
  const hours = Math.floor(pkg.metrics.travel_minutes / 60);
  const mins = pkg.metrics.travel_minutes % 60;
  return el(
    'article',
    { class: 'pkg-card' },
    el('span', { class: `pkg-label pkg-${pkg.label}` }, labelName[pkg.label] ?? pkg.label),
    el('h3', {}, `${pkg.country}: ${cities}`),
    el('p', { class: 'muted' }, `${pkg.start_date} to ${pkg.end_date}`),
    el(
      'dl',
      { class: 'pkg-stats' },
      el('div', {}, el('dt', {}, 'Total'), el('dd', { class: 'pkg-total' }, inr(pkg.total_inr))),
      el('div', {}, el('dt', {}, 'Left in budget'), el('dd', {}, inr(pkg.left_inr))),
      el('div', {}, el('dt', {}, 'Travel time'), el('dd', {}, `${hours}h ${String(mins).padStart(2, '0')}m`)),
      el('div', {}, el('dt', {}, 'Hotel stars'), el('dd', {}, `${pkg.metrics.avg_stars} ★`)),
    ),
  );
}

function renderBuild(data) {
  switch (data.status) {
    case 'OK':
      showResult(
        el('h2', {}, `${data.packages.length} package${data.packages.length === 1 ? '' : 's'} found`),
        el('div', { class: 'pkg-grid' }, ...data.packages.map(packageCard)),
      );
      break;
    case 'OVER_BUDGET':
      showResult(
        banner('warn', `Over budget by ${inr(data.over_by)}: the cheapest package costs ${inr(data.cheapest_total)}.`,
          data.suggestions),
      );
      break;
    case 'NO_PACKAGE': {
      const windowReason = data.reasons.find((r) => r.startsWith(WINDOW_PREFIX));
      if (windowReason) setError('startDate', 'Pick dates between 1 and 20 April 2027.');
      showResult(banner('error', 'No package for these choices', data.reasons));
      if (windowReason) form.startDate.focus();
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

// parseRequest(text): turns a short plain-words holiday request into contract Request fields (docs/CONTRACT.md §1)
// using only regexes and keyword lists built from destinations.json — no AI. Returns { fields, missing, notes }.
import { destinations } from './catalog.js';
import { isRealDate, validateRequest } from './request.js';
import { addDays } from './time.js';

const FIELDS = ['departureAirport', 'country', 'startDate', 'nights', 'adults', 'childAges', 'budgetInr'];
const { first_night: FIRST_NIGHT, last_departure: LAST_DEPARTURE } = destinations.rules.data_window;
const DEFAULT_YEAR = FIRST_NIGHT.slice(0, 4);

// ---------- keyword lists ----------
// Extra spellings people use for the departure cities (keyed by the catalog city name).
const CITY_ALIASES = { Bengaluru: ['bangalore'], Delhi: ['new delhi'], Mumbai: ['bombay'], Chennai: ['madras'] };
// Extra names for the countries (keyed by catalog country name).
const COUNTRY_ALIASES = { 'United Arab Emirates': ['uae', 'u.a.e.', 'u.a.e', 'emirates'] };

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
// A number right after a month name that is really a head count, not a day ("April 2 adults").
const NOT_PEOPLE = '(?!\\s*(?:adults?|kids?|child(?:ren)?|nights?|days?|people|persons?|pax|of us)\\b)';
const PARTNER = '(?:wife|husband|partner|spouse|fianc[eé]e?|girlfriend|boyfriend|mom|mother|dad|father|friend|sister|brother)';
const KID = '(?:kids?|child(?:ren)?|sons?|daughters?|boys?|girls?)';
// One age: not part of a bigger/decimal number and not followed by a money unit or a count word ("…7, 2.5L").
const AGE = '\\d{1,2}(?![\\d.]|\\s*(?:lakhs?|lacs?|l|k|thousand|crores?|cr|nights?|days?|weeks?|adults?|people|pax)\\b)';
const AGES = `(${AGE}(?:\\s*(?:,|and|&)\\s*${AGE})*)`;

const pad2 = (n) => String(n).padStart(2, '0');
const monthNumber = (name) => MONTHS.indexOf(name.slice(0, 3)) + 1;
const listNumbers = (s) => (s.match(/\d+/g) ?? []).map(Number);

/** Lower-case, number words → digits ("two lakh" → "2 lakh"), collapse spaces. */
function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g'), (w) => String(NUMBER_WORDS[w]))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every [index, value] where one of `words` appears as a whole word/phrase in `s`. */
function mentions(s, words, value) {
  const out = [];
  for (const w of words) {
    const re = new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'g');
    for (const m of s.matchAll(re)) out.push({ index: m.index, value, word: w });
  }
  return out;
}

// ---------- departure city ----------
function parseDeparture(s, original, notes) {
  const found = [];
  for (const { airport, city } of destinations.departure_cities) {
    found.push(...mentions(s, [city.toLowerCase(), ...(CITY_ALIASES[city] ?? [])], airport));
    for (const m of original.matchAll(new RegExp(`\\b${airport}\\b`, 'g'))) found.push({ index: m.index, value: airport });
  }
  const distinct = [...new Set(found.map((f) => f.value))];
  if (distinct.length === 0) return undefined;
  if (distinct.length === 1) return distinct[0];
  const fromWord = found.find((f) => /\bfrom\s+$/.test(s.slice(Math.max(0, f.index - 8), f.index)));
  const pick = fromWord ?? found.sort((a, b) => a.index - b.index)[0];
  notes.push(`Several departure cities mentioned (${distinct.join(', ')}); used ${pick.value}.`);
  return pick.value;
}

// ---------- country ----------
function parseCountry(s, notes) {
  const found = [];
  for (const c of destinations.countries) {
    found.push(...mentions(s, [c.name.toLowerCase(), ...(COUNTRY_ALIASES[c.name] ?? [])], c.name));
    for (const city of c.cities) {
      for (const m of mentions(s, [city.name.toLowerCase()], c.name)) found.push({ ...m, city: city.name });
    }
  }
  const distinct = [...new Set(found.map((f) => f.value))];
  if (distinct.length === 0) return undefined;
  if (distinct.length > 1) {
    notes.push(`Both ${distinct.join(' and ')} are mentioned; choose one country.`);
    return undefined;
  }
  if (found.every((f) => f.city)) {
    const cities = [...new Set(found.map((f) => f.city))];
    notes.push(`${cities.join(' and ')} ${cities.length > 1 ? 'are' : 'is'} in ${distinct[0]}, so the country is ${distinct[0]}.`);
  }
  return distinct[0];
}

// ---------- nights ----------
function parseNights(s, notes) {
  let m = s.match(/\b(\d{1,2})\s*-?\s*nights?\b/);
  if (m) return Number(m[1]);
  if (/\b(?:a|1)\s+fortnight\b/.test(s)) return 14;
  m = s.match(/\b(a|1|\d{1,2})\s+weeks?\b/);
  if (m) {
    const n = (m[1] === 'a' ? 1 : Number(m[1])) * 7;
    notes.push(`"${m[0]}" read as ${n} nights.`);
    return n;
  }
  m = s.match(/\b(\d{1,2})\s*-?\s*days?\b/);
  if (m) {
    const n = Number(m[1]) - 1;
    notes.push(`${m[1]} days read as ${n} nights.`);
    return n;
  }
  return undefined;
}

// ---------- start date ----------
function makeDate(y, mo, d, notes, raw) {
  let year = y;
  if (year === undefined) {
    year = DEFAULT_YEAR;
    notes.push(`No year given for "${raw}"; assumed ${DEFAULT_YEAR}.`);
  } else if (year.length === 2) year = `20${year}`;
  const date = `${year}-${pad2(mo)}-${pad2(d)}`;
  if (!isRealDate(date)) {
    notes.push(`"${raw}" is not a real date.`);
    return null;
  }
  return date;
}

function parseStartDate(s, nights, notes) {
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return makeDate(m[1], Number(m[2]), Number(m[3]), notes, m[0]);
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/) ?? s.match(/\b(\d{1,2})\/(\d{1,2})\b(?![/.-]\d)/);
  if (m) {
    const date = makeDate(m[3], Number(m[2]), Number(m[1]), notes, m[0]);
    if (date) notes.push(`"${m[0]}" read as day/month: ${date}.`);
    return date;
  }
  m = s.match(new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`));
  if (m) return makeDate(m[3], monthNumber(m[2]), Number(m[1]), notes, m[0]);
  m = s.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}\\b${NOT_PEOPLE}(?:,?\\s+(\\d{4}))?`));
  if (m) return makeDate(m[3], monthNumber(m[1]), Number(m[2]), notes, m[0]);

  // Vague: early / mid / end of a month.
  m = s.match(new RegExp(`\\b(early|beginning of|start of|mid|middle of|late|end of)[- ]?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`));
  if (!m) return undefined;
  const day = /early|beginning|start/.test(m[1]) ? 5 : /mid|middle/.test(m[1]) ? 15 : 25;
  const year = m[3] ?? DEFAULT_YEAR;
  let date = `${year}-${pad2(monthNumber(m[2]))}-${pad2(day)}`;
  let msg = `"${m[0]}" read as ${date}`;
  // Keep the trip inside the data window when only a rough date was given.
  if (Number.isInteger(nights) && nights > 0 && date >= FIRST_NIGHT && date <= LAST_DEPARTURE &&
      addDays(date, nights) > LAST_DEPARTURE) {
    const latest = addDays(LAST_DEPARTURE, -nights);
    if (latest >= FIRST_NIGHT) {
      date = latest;
      msg += `, moved to ${date} so the ${nights}-night trip returns by ${LAST_DEPARTURE}`;
    }
  }
  notes.push(`${msg}.`);
  return date;
}

// ---------- travelers ----------
function parseChildren(s, notes) {
  if (/\b(?:no|without|zero|0)\s+(?:kids?|child(?:ren)?)\b/.test(s)) return { ages: [], count: 0 };
  const ages = [];
  const taken = []; // [start, end) of text already used for ages
  const free = (m) => !taken.some(([a, b]) => m.index < b && m.index + m[0].length > a);
  const take = (m, list) => { taken.push([m.index, m.index + m[0].length]); ages.push(...list); };

  for (const m of s.matchAll(new RegExp(`\\b${KID}\\b[ ,(]*(?:who are\\s+)?(?:aged?|ages?)\\s*(?:of\\s+)?${AGES}`, 'g'))) {
    if (free(m)) take(m, listNumbers(m[1]));
  }
  for (const m of s.matchAll(new RegExp(`\\b${AGES}\\s*-?\\s*(?:years?|yrs?|y/?o)(?:[- ]olds?)?\\b`, 'g'))) {
    const tail = s.slice(m.index + m[0].length - 6, m.index + m[0].length + 4);
    if (!/old|y\/?o/.test(m[0]) && !/old/.test(tail)) continue; // "3 years" alone is not an age
    if (free(m)) take(m, listNumbers(m[1]));
  }
  for (const m of s.matchAll(/\b(\d{1,2})\s*-?\s*months?[- ]old\b/g)) {
    if (free(m)) { take(m, [0]); notes.push(`A ${m[1]}-month-old counts as age 0.`); }
  }
  for (const m of s.matchAll(/\b(?:a|an|1|our|my)\s+(?:baby|infant|newborn)\b/g)) {
    if (free(m)) { take(m, [0]); notes.push('A baby counts as a child aged 0.'); }
  }

  // How many children are mentioned, with or without ages ("2 kids", "a son"); -1 = some, number unknown.
  let count = 0;
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(?:little\\s+|young\\s+)?${KID}\\b`, 'g'))) count += Number(m[1]);
  for (const m of s.matchAll(/\b(?:a|an|our|my)\s+(?:little\s+|young\s+)?(?:son|daughter|kid|child|boy|girl)\b/g)) {
    if (free(m)) count += 1;
  }
  if (count === 0 && ages.length === 0 && /\b(?:kids|children)\b/.test(s)) return { ages, count: -1 };
  return { ages, count: Math.max(count, ages.length) };
}

function parseAdults(s, children, notes) {
  let m = s.match(/\b(\d{1,2})\s+(?:adults?|grown[- ]ups?)\b/);
  if (m) return Number(m[1]);
  const twoRes = [
    new RegExp(`\\b(?:me|i)\\s+(?:and|&|with)\\s+my\\s+${PARTNER}\\b`),
    new RegExp(`\\bmy\\s+${PARTNER}\\s+(?:and|&)\\s+(?:i|me|myself)\\b`),
    new RegExp(`\\bwith\\s+my\\s+${PARTNER}\\b`),
    /\b(?:a\s+)?couple\b(?!\s+of)/,
    /\bhoneymoon/,
  ];
  if (twoRes.some((re) => re.test(s))) return 2;
  if (/\b(?:solo|just me|only me|by myself|alone|on my own)\b/.test(s)) return 1;

  m = s.match(/\b(?:family|group|party) of (\d{1,2})\b|\b(\d{1,2}) of us\b|\bwe are (\d{1,2})\b|\b(\d{1,2})\s+(?:people|persons|pax|travell?ers)\b/);
  if (m) {
    const total = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
    const kids = Math.max(children.count, 0);
    if (kids >= total) return undefined;
    if (kids) notes.push(`${total} people with ${kids} child(ren) read as ${total - kids} adult(s).`);
    else notes.push(`${total} people and no children mentioned: assumed ${total} adults.`);
    return total - kids;
  }
  return undefined;
}

// ---------- budget ----------
const UNIT = { k: 1000, thousand: 1000, l: 100000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, cr: 10000000, crore: 10000000, crores: 10000000 };

/** "2.5" × 100000 → 250000 with integer arithmetic only (money is integer INR). */
function toInr(num, mult) {
  const [whole, frac = ''] = num.replace(/,/g, '').split('.');
  const digits = String(mult).length - 1;
  return Number(whole) * mult + Number(frac.padEnd(digits, '0').slice(0, digits) || 0);
}

function parseBudget(s) {
  let m = s.match(/(?:₹|\brs\.?|\binr)?\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l|k|thousand|crores?|cr)\b/);
  if (m) return toInr(m[1], UNIT[m[2]]);
  const NUM = '(\\d{1,3}(?:,\\d{2,3})+|\\d+)(?:\\.\\d+)?';
  m = s.match(new RegExp(`(?:₹|\\brs\\.?|\\binr)\\s*${NUM}`)) ??
      s.match(new RegExp(`\\b${NUM}\\s*(?:rupees|inr|rs)\\b`)) ??
      s.match(/\bbudget\b[^\d₹]{0,15}(\d{1,3}(?:,\d{2,3})+|\d{4,})/);
  return m ? toInr(m[1], 1) : undefined;
}

// ---------- entry point ----------
/** Plain-words request → { fields, missing, notes }. `fields` holds only what was found (childAges defaults to []). */
export function parseRequest(text) {
  const original = String(text ?? '');
  const s = normalise(original);
  const notes = [];
  const missing = [];
  const fields = {};

  const nights = parseNights(s, notes);
  const children = parseChildren(s, notes);
  const found = {
    departureAirport: parseDeparture(s, original, notes),
    country: parseCountry(s, notes),
    startDate: parseStartDate(s, nights, notes),
    nights,
    adults: parseAdults(s, children, notes),
    budgetInr: parseBudget(s),
  };

  if (children.count === -1 || children.count > children.ages.length) {
    const n = children.count === -1 ? 'Some' : String(children.count);
    notes.push(children.ages.length
      ? `${n} children mentioned but only ${children.ages.length} age(s) given; give every child's age.`
      : `${n} children mentioned without ages; give each child's age (0–17).`);
    found.childAges = undefined;
  } else {
    found.childAges = children.ages;
  }
  if (children.ages.some((a) => a > 17)) notes.push('Children must be 0–17; anyone 18 or older counts as an adult.');

  for (const f of FIELDS) {
    if (found[f] === undefined || found[f] === null) missing.push(f);
    else fields[f] = found[f];
  }
  // Range problems in the fields we did find (e.g. 14 nights), in the validator's own words.
  const errors = validateRequest(fields);
  for (const f of FIELDS) if (f in fields && errors[f]) notes.push(errors[f]);
  return { fields, missing, notes };
}

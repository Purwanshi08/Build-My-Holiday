// Tests for src/engine/parse.js: parseRequest turns plain-words sentences into Request fields, reports what is
// missing (e.g. kids without ages) and explains guesses in notes; a full sentence feeds straight into buildPackages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, buildPackages } from '../src/engine/index.js';

/** [sentence, expected fields (subset), expected missing (exact)] */
const CASES = [
  ['2 adults and a 6 year old from Bengaluru to Japan, 10 April 2027, 6 nights, budget 3.5 lakh',
    { departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10', nights: 6, adults: 2, childAges: [6], budgetInr: 350000 }, []],
  ['Me and my wife from Delhi to Dubai for a week starting April 12, ₹2,00,000',
    { departureAirport: 'DEL', country: 'United Arab Emirates', startDate: '2027-04-12', nights: 7, adults: 2, childAges: [], budgetInr: 200000 }, []],
  ['Couple flying out of Mumbai to the UAE, 5 nights from 2027-04-03, 200k',
    { departureAirport: 'BOM', country: 'United Arab Emirates', startDate: '2027-04-03', nights: 5, adults: 2, budgetInr: 200000 }, []],
  ['Chennai to Tokyo and Kyoto, 12/04/2027, 4 nights, 2 adults, kids aged 3 and 7, 2.5L',
    { departureAirport: 'MAA', country: 'Japan', startDate: '2027-04-12', nights: 4, adults: 2, childAges: [3, 7], budgetInr: 250000 }, []],
  ['Family trip from Bangalore to Osaka in mid April, 6 nights, 2 adults with 2 kids, 4 lakh',
    { departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-14', nights: 6, adults: 2, budgetInr: 400000 }, ['childAges']],
  ['Solo trip from Bombay to Abu Dhabi, 3 nights on 8th April, budget Rs 90,000',
    { departureAirport: 'BOM', country: 'United Arab Emirates', startDate: '2027-04-08', nights: 3, adults: 1, childAges: [], budgetInr: 90000 }, []],
  ['family of 4 with kids aged 5 and 9, Delhi to Japan, 15 April, 5 nights, two lakh rupees',
    { departureAirport: 'DEL', country: 'Japan', startDate: '2027-04-15', nights: 5, adults: 2, childAges: [5, 9], budgetInr: 200000 }, []],
  ['Japan please, 3 adults, a 4 year old and a 10-year-old, from New Delhi, April 2, 8 nights, ₹6 lakh',
    { departureAirport: 'DEL', country: 'Japan', startDate: '2027-04-02', nights: 8, adults: 3, childAges: [4, 10], budgetInr: 600000 }, []],
  ['We want to see Dubai with our 8 month old baby, me and my husband, from Madras, 6 days from 03-04-2027, 1.75 lakh',
    { departureAirport: 'MAA', country: 'United Arab Emirates', startDate: '2027-04-03', nights: 5, adults: 2, childAges: [0], budgetInr: 175000 }, []],
  ['Honeymoon in Japan from BLR, 7 nights, 2027-04-05, budget ₹3,50,000',
    { departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-05', nights: 7, adults: 2, childAges: [], budgetInr: 350000 }, []],
  ['2 adults and 3 kids aged 2, 6 and 11 from Chennai to United Arab Emirates, 4 nights, 10 April, 500k',
    { departureAirport: 'MAA', country: 'United Arab Emirates', startDate: '2027-04-10', nights: 4, adults: 2, childAges: [2, 6, 11], budgetInr: 500000 }, []],
  ['Something in Japan for a couple, early April',
    { country: 'Japan', startDate: '2027-04-05', adults: 2, childAges: [] }, ['departureAirport', 'nights', 'budgetInr']],
  ['me and my friend, from Mumbai, Kyoto, 6 nights, April 20th, 3 lakh',
    { departureAirport: 'BOM', country: 'Japan', startDate: '2027-04-20', nights: 6, adults: 2, budgetInr: 300000 }, []],
  ['Delhi to Japan or Dubai, 2 adults, 5 nights, 12 April, 2 lakh',
    { departureAirport: 'DEL', startDate: '2027-04-12', nights: 5, adults: 2, budgetInr: 200000 }, ['country']],
  ['two adults, one child aged 12, Bengaluru to Abu Dhabi, five nights starting 6 April, INR 180000',
    { departureAirport: 'BLR', country: 'United Arab Emirates', startDate: '2027-04-06', nights: 5, adults: 2, childAges: [12], budgetInr: 180000 }, []],
  ['3 of us with a 7 year old, from Chennai to Osaka, 9 nights, 1st April, 4.2 lakh',
    { departureAirport: 'MAA', country: 'Japan', startDate: '2027-04-01', nights: 9, adults: 2, childAges: [7], budgetInr: 420000 }, []],
  ['From Delhi to Tokyo with children, 31/04/2027, 5 nights, 2 adults, 3 lakh',
    { departureAirport: 'DEL', country: 'Japan', nights: 5, adults: 2, budgetInr: 300000 }, ['startDate', 'childAges']],
  ['', {}, ['departureAirport', 'country', 'startDate', 'nights', 'adults', 'budgetInr']],
];

for (const [text, fields, missing] of CASES) {
  test(`parseRequest: ${text || '(empty)'}`, () => {
    const r = parseRequest(text);
    for (const [k, v] of Object.entries(fields)) assert.deepEqual(r.fields[k], v, `${k} — notes: ${r.notes.join(' | ')}`);
    assert.deepEqual(r.missing, missing, `missing — notes: ${r.notes.join(' | ')}`);
    for (const k of missing) assert.ok(!(k in r.fields), `${k} is missing but present in fields`);
  });
}

test('notes explain guesses: inferred country, assumed year, day/month, days → nights, mid-month shift', () => {
  const a = parseRequest('Chennai to Kyoto, 12/04/2027, 5 days, 2 adults, 3 lakh');
  assert.ok(a.notes.some((n) => n.includes('Kyoto is in Japan')), a.notes.join(' | '));
  assert.ok(a.notes.some((n) => n.includes('day/month')), a.notes.join(' | '));
  assert.ok(a.notes.some((n) => n.includes('5 days read as 4 nights')), a.notes.join(' | '));
  const b = parseRequest('Delhi to Japan, 2 adults, 6 nights from mid April, 3 lakh');
  assert.ok(b.notes.some((n) => n.includes('No year') || n.includes('moved to 2027-04-14')), b.notes.join(' | '));
  assert.equal(b.fields.startDate, '2027-04-14');
  const c = parseRequest('2 kids from Delhi');
  assert.ok(c.notes.some((n) => n.includes('without ages')), c.notes.join(' | '));
  const d = parseRequest('Japan from Delhi, 2 weeks, 2 adults');
  assert.equal(d.fields.nights, 14);
  assert.ok(d.notes.some((n) => /Nights must be/.test(n)), 'out-of-range nights is flagged in notes');
});

test('budgets are integer INR without float drift', () => {
  assert.equal(parseRequest('2.3 lakh').fields.budgetInr, 230000);
  assert.equal(parseRequest('1.05L').fields.budgetInr, 105000);
  assert.equal(parseRequest('₹2,50,000').fields.budgetInr, 250000);
  assert.equal(parseRequest('250000 rupees').fields.budgetInr, 250000);
  assert.equal(parseRequest('1.2 crore').fields.budgetInr, 12000000);
  for (const t of ['2.3 lakh', '1.05L', '0.7 lakh']) assert.ok(Number.isInteger(parseRequest(t).fields.budgetInr), t);
});

test('a complete sentence feeds straight into buildPackages', () => {
  const { fields, missing } = parseRequest('2 adults and a 6 year old from Bengaluru to Japan, 10 April, 6 nights, 3.5 lakh');
  assert.deepEqual(missing, []);
  const r = buildPackages(fields);
  assert.equal(r.status, 'OK', JSON.stringify(r.reasons));
});

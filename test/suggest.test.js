// Tests for src/engine/suggest.js with a fake cheapestTotal: which one-field variations are tried, how up to 3
// are chosen (fitting ones, one kind at a time; else the closest), and the wording of each suggestion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variations, suggestVariations, describe, overBudgetSuggestions } from '../src/engine/suggest.js';

const MENON = {
  departureAirport: 'BLR', country: 'Japan', startDate: '2027-04-10',
  nights: 6, adults: 2, childAges: [6], budgetInr: 150000,
};
const key = (v) => `${v.kind}:${v.request.nights}|${v.request.startDate}|${v.request.country}|${v.request.departureAirport}`;
/** Fake builder: a price table keyed by the changed field, null (no package) for anything else. */
const fake = (table) => (req) => table[`${req.nights}|${req.startDate}|${req.country}|${req.departureAirport}`] ?? null;
const k = (o) => `${o.nights ?? 6}|${o.startDate ?? '2027-04-10'}|${o.country ?? 'Japan'}|${o.dep ?? 'BLR'}`;

test('variations: fewer nights down to 3, in-window dates nearest first, other country, other departures', () => {
  const vs = variations(MENON);
  const of = (kind) => vs.filter((v) => v.kind === kind).map((v) => v.request);
  assert.deepEqual(of('nights').map((r) => r.nights), [5, 4, 3]);
  const dates = of('date').map((r) => r.startDate);
  assert.deepEqual(dates.slice(0, 4), ['2027-04-09', '2027-04-11', '2027-04-08', '2027-04-12']);
  assert.ok(!dates.includes('2027-04-10'));
  assert.equal(dates.at(-1), '2027-04-01');
  assert.ok(dates.every((d) => d >= '2027-04-01' && d <= '2027-04-14'), 'return must stay ≤ 20 April');
  assert.deepEqual(of('country').map((r) => r.country), ['United Arab Emirates']);
  assert.deepEqual(of('departure').map((r) => r.departureAirport).sort(), ['BOM', 'DEL', 'MAA']);
  for (const v of vs) {
    const changed = Object.keys(MENON).filter((f) => JSON.stringify(v.request[f]) !== JSON.stringify(MENON[f]));
    assert.equal(changed.length, 1, key(v));
  }
  assert.equal(variations({ ...MENON, nights: 3 }).filter((v) => v.kind === 'nights').length, 0);
});

test('fitting variations: only those ≤ budget, one kind at a time, smallest change first, max 3', () => {
  const cheapest = fake({
    [k({ nights: 5 })]: 140000, [k({ nights: 3 })]: 90000,
    [k({ startDate: '2027-04-12' })]: 145000, [k({ startDate: '2027-04-09' })]: 149000,
    [k({ country: 'United Arab Emirates' })]: 120000,
    [k({ dep: 'DEL' })]: 160000, // over budget: must not appear
  });
  const got = suggestVariations(MENON, undefined, cheapest);
  assert.deepEqual(got.map((v) => [v.kind, v.total, v.fits]), [
    ['nights', 140000, true], // 5 nights: smallest change beats the cheaper 3 nights
    ['date', 149000, true], // 04-09 is nearer than 04-12
    ['country', 120000, true],
  ]);
});

test('fewer fitting than 3 → only those; none fitting → the 3 closest totals', () => {
  const one = suggestVariations(MENON, undefined, fake({ [k({ nights: 4 })]: 150000, [k({ dep: 'DEL' })]: 151000 }));
  assert.deepEqual(one.map((v) => [v.kind, v.total, v.fits]), [['nights', 150000, true]]);

  const none = suggestVariations(MENON, undefined, fake({
    [k({ nights: 5 })]: 200000, [k({ country: 'United Arab Emirates' })]: 160000,
    [k({ startDate: '2027-04-03' })]: 170000, [k({ dep: 'DEL' })]: 300000,
  }));
  assert.deepEqual(none.map((v) => [v.kind, v.total, v.fits]),
    [['country', 160000, false], ['date', 170000, false], ['nights', 200000, false]]);
});

test('describe and overBudgetSuggestions wording; nothing buildable → raise the budget', () => {
  const v = { kind: 'departure', total: 160000, fits: false, request: { ...MENON, departureAirport: 'DEL' } };
  assert.equal(describe(v, MENON), 'Fly from Delhi (DEL) instead of Bengaluru (BLR): from ₹1,60,000 (still ₹10,000 over budget).');
  const n = { kind: 'nights', total: 120000, fits: true, request: { ...MENON, nights: 4 } };
  assert.equal(describe(n, MENON), 'Try 4 nights instead of 6: from ₹1,20,000 (within your budget).');
  assert.deepEqual(overBudgetSuggestions(MENON, undefined, 219324, () => null),
    ['Raise the budget to at least ₹2,19,324.']);
});

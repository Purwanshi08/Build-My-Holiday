// Over-budget suggestions: re-run the builder with one thing changed (fewer nights, another start date, the other
// country, another departure city) and suggest up to 3 variations that fit the budget, or the closest ones.
import { destinations } from './catalog.js';
import { addDays } from './time.js';
import { windowReason } from './request.js';

export const MAX_SUGGESTIONS = 3;
const KIND_ORDER = ['nights', 'date', 'country', 'departure'];
const inr = (n) => `₹${n.toLocaleString('en-IN')}`;
const cityOf = (airport) => destinations.departure_cities.find((d) => d.airport === airport)?.city ?? airport;

/** One-field variations of a request, each kind in "smallest change first" order. */
export function variations(req) {
  const out = [];
  for (let n = req.nights - 1; n >= destinations.rules.min_nights; n--) {
    out.push({ kind: 'nights', request: { ...req, nights: n } });
  }
  const { first_night, last_departure } = destinations.rules.data_window;
  for (let step = 1; step <= 20; step++) {
    for (const date of [addDays(req.startDate, -step), addDays(req.startDate, step)]) {
      if (date < first_night || date > last_departure) continue;
      const request = { ...req, startDate: date };
      if (!windowReason(request)) out.push({ kind: 'date', request });
    }
  }
  for (const c of destinations.countries) {
    if (c.name !== req.country) out.push({ kind: 'country', request: { ...req, country: c.name } });
  }
  for (const d of destinations.departure_cities) {
    if (d.airport !== req.departureAirport) {
      out.push({ kind: 'departure', request: { ...req, departureAirport: d.airport } });
    }
  }
  return out;
}

/**
 * Build every variation with `cheapestTotal(request, ctx)` (null = no package). If any fit the budget, return up
 * to 3 of those, one kind at a time (nights, date, country, departure) so the traveler sees different options;
 * within a kind the smallest change wins (dates: nearest; country/departure: cheapest). If none fit, return the
 * 3 variations with the lowest totals. Each result: { kind, request, total, fits }.
 */
export function suggestVariations(req, ctx, cheapestTotal) {
  const built = variations(req)
    .map((v) => ({ ...v, total: cheapestTotal(v.request, ctx) }))
    .filter((v) => v.total !== null)
    .map((v) => ({ ...v, fits: v.total <= req.budgetInr }));
  const fits = built.filter((v) => v.fits);
  if (fits.length === 0) {
    return built.sort((a, b) => a.total - b.total).slice(0, MAX_SUGGESTIONS);
  }
  const queues = KIND_ORDER.map((kind) => {
    const list = fits.filter((v) => v.kind === kind);
    return kind === 'country' || kind === 'departure' ? list.sort((a, b) => a.total - b.total) : list;
  });
  const out = [];
  while (out.length < MAX_SUGGESTIONS && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < MAX_SUGGESTIONS) out.push(q.shift());
  }
  return out;
}

/** Human-readable line for one variation. */
export function describe(v, req) {
  const r = v.request;
  const change = {
    nights: `Try ${r.nights} nights instead of ${req.nights}`,
    date: `Start on ${r.startDate} instead of ${req.startDate}`,
    country: `Go to ${r.country} instead of ${req.country}`,
    departure: `Fly from ${cityOf(r.departureAirport)} (${r.departureAirport}) instead of ` +
      `${cityOf(req.departureAirport)} (${req.departureAirport})`,
  }[v.kind];
  const tail = v.fits ? 'within your budget' : `still ${inr(v.total - req.budgetInr)} over budget`;
  return `${change}: from ${inr(v.total)} (${tail}).`;
}

/** Suggestion strings for OVER_BUDGET; "Raise the budget" only when no variation can be built at all. */
export function overBudgetSuggestions(req, ctx, cheapestNow, cheapestTotal) {
  const found = suggestVariations(req, ctx, cheapestTotal);
  if (found.length === 0) return [`Raise the budget to at least ${inr(cheapestNow)}.`];
  return found.map((v) => describe(v, req));
}

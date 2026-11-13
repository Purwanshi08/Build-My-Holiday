// exportTrip(pkg): the judge-facing JSON in the shared trip format (DATA_DICTIONARY.md §4) plus country and status.
// Drops our own fields (plan, metrics, label, left_inr); after confirm every item is BOOKED with a string reference.

/** Reservation number of a booked package, as a string, or null. */
function referenceOf(pkg) {
  const ref = pkg.booking?.reference ?? pkg.reference ?? pkg.items?.find((it) => it?.booking?.reference)?.booking.reference;
  return ref == null ? null : String(ref);
}

function exportItem(it, booked, reference) {
  const ref = booked ? reference : it.booking?.reference != null ? String(it.booking.reference) : null;
  return {
    item_id: String(it.item_id),
    type: it.type,
    name: it.name,
    city: it.city,
    status: booked ? 'BOOKED' : it.status ?? 'PLANNED',
    catalog_id: it.catalog_id,
    room_id: it.type === 'hotel' ? it.room_id ?? null : null,
    start: it.start,
    end: it.end ?? null,
    quantity: it.quantity,
    price_inr: it.price_inr,
    booking: ref == null ? null : { reference: ref },
    sources: [],
    warnings: Array.isArray(it.warnings) ? [...it.warnings] : [],
  };
}

/** Package → exported trip object (a fresh copy; the input is not changed). */
export function exportTrip(pkg) {
  const status = pkg.status === 'BOOKED' ? 'BOOKED' : 'PLANNED';
  const reference = referenceOf(pkg);
  const booked = status === 'BOOKED';
  const items = (pkg.items ?? []).map((it) => exportItem(it, booked, reference));
  const t = pkg.traveler ?? {};
  const childAges = Array.isArray(t.child_ages) ? [...t.child_ages] : [];
  return {
    trip_id: String(pkg.trip_id ?? pkg.id),
    traveler: {
      name: t.name ?? 'Traveler',
      home_airport: t.home_airport,
      adults: t.adults,
      children: childAges.length,
      child_ages: childAges,
    },
    start_date: pkg.start_date,
    end_date: pkg.end_date,
    country: pkg.country,
    budget_inr: pkg.budget_inr,
    total_inr: items.reduce((sum, it) => sum + it.price_inr, 0),
    status,
    items,
  };
}

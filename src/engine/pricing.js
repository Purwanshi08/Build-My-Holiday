// Price formulas (integer INR) for flights, hotels, transfers and attractions, plus the room-fit rule
// minRooms(). All inputs are catalog records; formulas follow DATA_DICTIONARY.md §3.

/** Flight: price_per_seat × all travelers (children pay the same). */
export function flightPrice(flight, travelers) {
  return flight.price_per_seat.amount * travelers;
}

/** Hotel: price_per_night × rooms × nights. */
export function hotelPrice(room, rooms, nights) {
  return room.price_per_night.amount * rooms * nights;
}

/** adults × price + children × (childPrice ?? price). */
export function perPersonPrice(adults, children, price, childPrice) {
  return adults * price + children * (childPrice ?? price);
}

/** Vehicles needed for a PER_VEHICLE transfer: ceil(travelers / max_passengers). */
export function vehiclesNeeded(transfer, travelers) {
  return Math.ceil(travelers / transfer.max_passengers);
}

/** Transfer item quantity: vehicles (PER_VEHICLE) or tickets (PER_PERSON). */
export function transferQuantity(transfer, adults, children) {
  return transfer.pricing === 'PER_VEHICLE' ? vehiclesNeeded(transfer, adults + children) : adults + children;
}

/** Transfer: PER_VEHICLE = price × vehicles; PER_PERSON = adults × price + children × (child_price ?? price). */
export function transferPrice(transfer, adults, children) {
  if (transfer.pricing === 'PER_VEHICLE') {
    return transfer.price.amount * vehiclesNeeded(transfer, adults + children);
  }
  if (transfer.pricing === 'PER_PERSON') {
    return perPersonPrice(adults, children, transfer.price.amount, transfer.child_price?.amount);
  }
  throw new Error(`Unknown pricing "${transfer.pricing}" on ${transfer.transfer_id}`);
}

/** Attraction: adults × price_per_person + children × (child_price ?? price_per_person). */
export function attractionPrice(attraction, adults, children) {
  return perPersonPrice(adults, children, attraction.price_per_person.amount, attraction.child_price?.amount);
}

/**
 * Smallest k rooms with adults ≤ k·max_adults, adults + children ≤ k·(max_adults + max_children)
 * and adults ≥ k (every room has an adult); null if no k fits.
 */
export function minRooms(room, adults, children) {
  const { max_adults: ma, max_children: mc } = room;
  if (adults < 1 || ma < 1) return null;
  const k = Math.max(1, Math.ceil(adults / ma), Math.ceil((adults + children) / (ma + mc)));
  return k <= adults ? k : null;
}

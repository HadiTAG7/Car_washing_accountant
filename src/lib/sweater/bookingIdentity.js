// SSP can display the same booking number with a different letter prefix.
// Preserve the original ID in source records; the number keys the booking and its claim.
export function ownerBookingIdentity(value) {
  const id = String(value ?? '').trim();
  return /^(?:[A-Za-z]+-)?(\d+)$/.exec(id)?.[1] || id;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * One person's share of the priced registration, from the latest pricing
 * snapshot (an amendment's, else the submission's): the line items carrying
 * their attendee index. Null when the registration has no per-person pricing
 * (entered by staff, or a single-person form). Adjustments are not included.
 */
export function attendeePriceCents(
  registration: { publicFormSubmission: { pricingSnapshot: unknown } | null; operations: Array<{ afterSnapshot: unknown }> },
  attendeeIndex: number,
) {
  const amended = record(record(registration.operations[0]?.afterSnapshot).pricingSnapshot);
  const snapshot = Object.keys(amended).length > 0 ? amended : record(registration.publicFormSubmission?.pricingSnapshot);
  const lines = Array.isArray(snapshot.lineItems) ? snapshot.lineItems.map(record) : [];
  const own = lines.filter((line) => line.attendeeIndex === attendeeIndex && typeof line.amountCents === "number");
  if (own.length === 0) return null;
  return own.reduce((total, line) => total + (line.amountCents as number), 0);
}

/**
 * What one person currently owes for themselves (#1509): their priced lines plus every adjustment line, and reversal,
 * that names them, except meal and item lines (the caller leaves those out of the sum it passes). Null when there is no per-person price to start from.
 */
export function attendeeShareCentsFrom(
  registration: Parameters<typeof attendeePriceCents>[0],
  attendeeIndex: number,
  attendeeAdjustmentCents: number,
) {
  const priced = attendeePriceCents(registration, attendeeIndex);
  return priced === null ? null : priced + attendeeAdjustmentCents;
}

/**
 * A test double for `modules/communications/effective-delivery.ts` (#1043), for the many tests of send paths that fake
 * Prisma with a settings row such as `{ deliveryMode: "EXTERNAL_EMAIL", senderEmail: "..." }`.
 *
 * Those tests are about what a send path does GIVEN an effective mode, so the double hands the fake row through
 * unchanged: its `deliveryMode` is the effective mode the test wants. How the effective mode is decided (paused,
 * configured or not, central sender) is tested against the real module in `tests/effective-delivery-1043.test.ts`.
 *
 * Use it with:
 *   vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);
 */

type Row = Record<string, unknown> & { deliveryMode?: string };
type Client = { eventMessageSettings: Record<string, (args: unknown) => Promise<Row | null>> };

const withDefaults = (row: Row | null) => (row
  ? { deliveryReason: row.deliveryMode === "EXTERNAL_EMAIL" ? "ON" : "NOT_CONFIGURED", replyToOverride: row.replyToEmail ?? null, central: { name: "IMSDA Events", email: null, replyTo: null }, ...row }
  : null);

export const effectiveDeliveryDouble = {
  FALLBACK_CENTRAL_SENDER_NAME: "IMSDA Events",
  loadEventEmailSettings: async (client: Client, eventId: string) => {
    const read = client.eventMessageSettings.findUnique ?? client.eventMessageSettings.findFirst;
    return withDefaults(await read!({ where: { eventId } }));
  },
  loadEventEmailSettingsOrThrow: async (client: Client, eventId: string) => {
    const read = client.eventMessageSettings.findUniqueOrThrow ?? client.eventMessageSettings.findUnique;
    const row = await read!({ where: { eventId } });
    if (!row) throw new Error(`Event ${eventId} has no message settings.`);
    return withDefaults(row);
  },
  getEffectiveDelivery: async (client: Client, eventId: string) => {
    const read = client.eventMessageSettings.findUniqueOrThrow ?? client.eventMessageSettings.findUnique;
    const row = await read!({ where: { eventId }, select: { deliveryMode: true } });
    const mode = (row?.deliveryMode as string | undefined) ?? "LOCAL_CAPTURE";
    return { mode, reason: mode === "EXTERNAL_EMAIL" ? "ON" : "NOT_CONFIGURED", paused: false };
  },
  /**
   * The per-recipient suppression decision (#863). The delivery worker now REQUIRES the suppression table, so a fake
   * Prisma either supplies `emailAddressSuppression` (and is asked, like the real module does) or this double treats the
   * address as deliverable. The real decision and its fail-closed behavior are tested in
   * `tests/email-suppression-delivery-863.test.ts` against the real module.
   */
  checkRecipientDeliverable: async (client: { emailAddressSuppression?: { findFirst?: (args: unknown) => Promise<{ reason: string; suppressedAt: Date } | null> } }, email: string) => {
    const hit = await client.emailAddressSuppression?.findFirst?.({ where: { normalizedEmail: email.trim().toLowerCase(), reenabledAt: null } });
    return hit
      ? { deliverable: false as const, reason: "ADDRESS_SUPPRESSED" as const, suppression: hit, note: "Not sent: the address is suppressed." }
      : { deliverable: true as const };
  },
  isEmailEnvironmentConfigured: () => true,
  loadCentralSender: async () => ({ name: "IMSDA Events", email: null, replyTo: null }),
  isPlatformEmailConfigured: () => true,
  pauseFields: () => ({}),
};

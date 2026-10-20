import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * READ-ONLY migration preview for central Email settings (#1043): what migration 20261114100000_central_email will do,
 * before an administrator applies it, and which events carry a sender email that differs from the central one (that
 * address is not used after the change).
 *
 * This is the one place besides the migration that reads the retired `EventMessageSettings.deliveryMode` and
 * `senderEmail` columns, which is why `tests/effective-delivery-1043.test.ts` allows it. It runs in a
 * `SET TRANSACTION READ ONLY` transaction, so PostgreSQL refuses any write. It selects event names, slugs, modes and
 * the organization's sender addresses, never attendee data.
 */

export type PreviewMode = "DISABLED" | "LOCAL_CAPTURE" | "EXTERNAL_EMAIL";

export type PreviewEventRow = {
  eventId: string;
  slug: string;
  name: string;
  /** Null when the event has no settings row at all. */
  deliveryMode: PreviewMode | null;
  senderEmail: string | null;
};

export type CentralEmailPreview = {
  centralSenderEmail: string | null;
  totals: {
    events: number;
    /** EXTERNAL_EMAIL: stays not paused. */
    notPaused: number;
    /** DISABLED and LOCAL_CAPTURE: become paused. */
    pausedFromDisabled: number;
    pausedFromLocalCapture: number;
    /** No settings row: a paused row is created, so it cannot start sending. */
    pausedNoSettings: number;
  };
  /** Events that will be paused by the migration, so an administrator knows what to resume. */
  willBePaused: Array<{ slug: string; name: string; from: PreviewMode | "NO_SETTINGS" }>;
  /** Events whose own sender email differs from the central one. It is not used after the change. */
  senderEmailDiffers: Array<{ slug: string; name: string; deliveryMode: PreviewMode; senderEmail: string }>;
};

const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

export function buildCentralEmailPreview(rows: readonly PreviewEventRow[], centralSenderEmail: string | null): CentralEmailPreview {
  const central = normalize(centralSenderEmail);
  const totals = { events: rows.length, notPaused: 0, pausedFromDisabled: 0, pausedFromLocalCapture: 0, pausedNoSettings: 0 };
  const willBePaused: CentralEmailPreview["willBePaused"] = [];
  const senderEmailDiffers: CentralEmailPreview["senderEmailDiffers"] = [];
  for (const row of rows) {
    if (row.deliveryMode === null) {
      totals.pausedNoSettings += 1;
      willBePaused.push({ slug: row.slug, name: row.name, from: "NO_SETTINGS" });
      continue;
    }
    if (row.deliveryMode === "EXTERNAL_EMAIL") totals.notPaused += 1;
    else {
      if (row.deliveryMode === "DISABLED") totals.pausedFromDisabled += 1;
      else totals.pausedFromLocalCapture += 1;
      willBePaused.push({ slug: row.slug, name: row.name, from: row.deliveryMode });
    }
    const own = normalize(row.senderEmail);
    if (own && own !== central) {
      senderEmailDiffers.push({ slug: row.slug, name: row.name, deliveryMode: row.deliveryMode, senderEmail: own });
    }
  }
  return { centralSenderEmail: central, totals, willBePaused, senderEmailDiffers };
}

export async function loadCentralEmailPreview(prisma: PrismaClient): Promise<CentralEmailPreview> {
  return prisma.$transaction(
    async (tx) => {
      // Must be the first statement of the transaction.
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [events, platform] = await Promise.all([
        tx.event.findMany({
          orderBy: [{ startsAt: "desc" }, { id: "asc" }],
          select: { id: true, slug: true, name: true, messageSettings: { select: { deliveryMode: true, senderEmail: true } } },
        }),
        tx.platformSettings.findUnique({ where: { id: "platform" }, select: { defaultSenderEmail: true } }),
      ]);
      return buildCentralEmailPreview(
        events.map((event) => ({
          eventId: event.id,
          slug: event.slug,
          name: event.name,
          deliveryMode: event.messageSettings?.deliveryMode ?? null,
          senderEmail: event.messageSettings?.senderEmail ?? null,
        })),
        platform?.defaultSenderEmail ?? null,
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
  );
}

export function formatCentralEmailPreview(preview: CentralEmailPreview): string {
  const { totals } = preview;
  const lines = [
    "Central email migration preview (read-only; nothing was changed)",
    "",
    `Central sender email (platform default): ${preview.centralSenderEmail ?? "NOT SET - real email stays off until it is set on System management > Email"}`,
    `Events: ${totals.events}`,
    `  Real email (EXTERNAL_EMAIL) -> not paused: ${totals.notPaused}`,
    `  Off (DISABLED) -> paused: ${totals.pausedFromDisabled}`,
    `  Capture only (LOCAL_CAPTURE) -> paused: ${totals.pausedFromLocalCapture}`,
    `  No settings row -> paused row created: ${totals.pausedNoSettings}`,
    "",
    `Events the migration will pause (${preview.willBePaused.length}); resume the real ones on System management > Email:`,
    ...preview.willBePaused.map((event) => `  - ${event.slug} (${event.name}) was ${event.from}`),
    "",
    `Events whose own sender email differs from the central one (${preview.senderEmailDiffers.length}); that address is not used after the change:`,
    ...preview.senderEmailDiffers.map((event) => `  - ${event.slug} (${event.name}): ${event.senderEmail} [was ${event.deliveryMode}]`),
  ];
  return `${lines.join("\n")}\n`;
}

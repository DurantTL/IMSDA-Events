import { formatCents } from "@/modules/payments/format-cents";

/**
 * Conference club orders (#1688): pure rules, free of database access and client-safe (no server or crypto imports; the invoice
 * builder is in `conference-invoice.ts`). A club orders conference-supplied patches and pins
 * (the Iowa-Missouri Conference "Shoulder Patches and Pins" sheet) from its Orders tab. The order goes to the youth
 * department, never AdventSource, and once staff mark it Filled it is billed to the club's sponsoring church as lines on
 * that club year's hidden billing event. Owner decisions (Caleb, Nov 8, 2026): one billing container per club year;
 * postage is entered by staff when they fill the order and billed as its own line; a director may cancel only while the
 * order is still Submitted; a price change never alters a submitted order.
 */

export const CONFERENCE_ORDER_STATUSES = ["SUBMITTED", "FILLED", "CANCELLED"] as const;
export type ConferenceOrderStatus = (typeof CONFERENCE_ORDER_STATUSES)[number];

export const conferenceOrderStatusLabels: Record<ConferenceOrderStatus, string> = {
  SUBMITTED: "Submitted",
  FILLED: "Filled",
  CANCELLED: "Cancelled",
};

/** One item's quantity cannot plausibly be larger; it catches a typed extra zero. */
export const CONFERENCE_ORDER_QUANTITY_MAX = 9999;
export const CONFERENCE_ORDER_POSTAGE_MAX_CENTS = 1_000_000;
export const CONFERENCE_ORDER_REASON_MAX = 500;

export const NO_CHURCH_MESSAGE = "This club has no sponsoring church on file, so it can't order from the conference yet. Contact the youth department to add one.";

/** The conference supplies these three (the sheet's prices, in cents). Staff change prices in Admin, Club supply catalog. */
export const CONFERENCE_SUPPLY_ITEMS = [
  { name: "Pathfinder Shoulder Patch", unitPriceCents: 125 },
  { name: "Pathfinder Conference Pin", unitPriceCents: 275 },
  { name: "Adventurer Shoulder Patch", unitPriceCents: 225 },
] as const;

/** What a director may do with an order: cancel only while it is still Submitted. */
export function directorCanCancel(status: ConferenceOrderStatus) {
  return status === "SUBMITTED";
}

export function staffCanFill(status: ConferenceOrderStatus) {
  return status === "SUBMITTED";
}

export function staffCanCancel(status: ConferenceOrderStatus) {
  return status === "SUBMITTED";
}

/** A typed whole number: never negative, never above `max`; anything else counts as zero. */
export function wholeCount(value: unknown, max = CONFERENCE_ORDER_QUANTITY_MAX) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : 0;
  return Number.isFinite(number) ? Math.min(max, Math.max(0, Math.trunc(number))) : 0;
}

export const QUANTITY_CAP_MESSAGE = `Enter ${CONFERENCE_ORDER_QUANTITY_MAX.toLocaleString("en-US")} or fewer.`;

/** The plain message for a typed count that is over the cap, or null. The server refuses it and the form shows it beside the field. */
export function quantityOverCap(value: unknown): string | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : 0;
  return Number.isFinite(number) && Math.trunc(number) > CONFERENCE_ORDER_QUANTITY_MAX ? QUANTITY_CAP_MESSAGE : null;
}

export type OrderableItem = { itemId: string; name: string; unitPriceCents: number };

export type OrderLineDraft = { itemId: string; name: string; quantity: number; unitPriceCents: number; amountCents: number };

/** The lines of an order: only items with a quantity, in the catalog's name order. The prices are the ones given now (the caller's snapshot). */
export function buildOrderLines(items: readonly OrderableItem[], quantities: Readonly<Record<string, unknown>>): OrderLineDraft[] {
  return [...items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((item) => {
      const quantity = wholeCount(quantities[item.itemId]);
      return quantity > 0 ? [{ itemId: item.itemId, name: item.name, quantity, unitPriceCents: item.unitPriceCents, amountCents: quantity * item.unitPriceCents }] : [];
    });
}

export function itemsTotalCents(lines: ReadonlyArray<{ quantity: number; unitPriceCents: number }>) {
  return lines.reduce((total, line) => total + line.quantity * line.unitPriceCents, 0);
}

/** A dollars-and-cents entry such as "4.50" or "$4.50" as whole cents; blank is 0. Null when it is not a valid amount (negative, three decimals, over $10,000). */
export function parseMoneyCents(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= CONFERENCE_ORDER_POSTAGE_MAX_CENTS ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (text === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents <= CONFERENCE_ORDER_POSTAGE_MAX_CENTS ? cents : null;
}

/** Staff's postage entry; the same rules as any money entry here. */
export const parsePostageCents = parseMoneyCents;

export function orderGrandTotalCents(order: { itemsTotalCents: number; postageCents: number | null }) {
  return order.itemsTotalCents + (order.postageCents ?? 0);
}

// ---------------------------------------------------------------------------------------------
// The email to the youth department and the director's confirmation
// ---------------------------------------------------------------------------------------------

/** Free text goes into a body that delivery scans for `{{...}}` sentinels, so it is neutralized first. */
export function neutralizeText(value: string) {
  return value.replaceAll("{{", "{ {").replaceAll("}}", "} }");
}

export type ConferenceOrderEmailInput = {
  clubName: string;
  churchName: string;
  directorName: string;
  directorEmail: string;
  lines: ReadonlyArray<{ name: string; quantity: number; unitPriceCents: number }>;
  patchesToExchange: number;
  itemsTotalCents: number;
  /** The staff screen to review the order on. */
  reviewUrl: string;
};

function lineSummaries(lines: ConferenceOrderEmailInput["lines"]) {
  return lines.map((line) => `${neutralizeText(line.name)}: ${line.quantity} at ${formatCents(line.unitPriceCents)} = ${formatCents(line.quantity * line.unitPriceCents)}`);
}

/** The order email the conference orders address receives: club, church, director, items, quantities, exchanges and the total. */
export function conferenceOrderStaffEmail(input: ConferenceOrderEmailInput) {
  const club = neutralizeText(input.clubName);
  return {
    subject: `Conference club order: ${club}`,
    bodyText: [
      "A club submitted a conference order for patches and pins.",
      "",
      `Club: ${club}`,
      `Church (billed): ${neutralizeText(input.churchName)}`,
      `Director: ${neutralizeText(input.directorName)}`,
      `Director email: ${neutralizeText(input.directorEmail)}`,
      "",
      "Items:",
      ...lineSummaries(input.lines),
      `Pathfinder shoulder patches to exchange: ${input.patchesToExchange}`,
      "",
      `Items total: ${formatCents(input.itemsTotalCents)} (postage not included; added when the order is filled)`,
      "",
      "Mark it filled or cancel it (sign-in required):",
      input.reviewUrl,
      "",
      "IMAdventist",
    ].join("\n"),
  };
}

/** The director's confirmation: what was ordered, who is billed, and what happens next. */
export function conferenceOrderDirectorEmail(input: ConferenceOrderEmailInput) {
  const club = neutralizeText(input.clubName);
  const name = neutralizeText(input.directorName.trim()) || "there";
  return {
    subject: `We received the conference order for ${club}`,
    bodyText: [
      `Hello ${name},`,
      "",
      `The conference youth department received the patch and pin order for ${club}.`,
      "",
      "Items:",
      ...lineSummaries(input.lines),
      `Pathfinder shoulder patches to exchange: ${input.patchesToExchange}`,
      "",
      `Items total: ${formatCents(input.itemsTotalCents)}. Postage is not included; it is added when the order is filled.`,
      `The order is billed to ${neutralizeText(input.churchName)}. You can cancel it from the club's Orders tab until the youth department fills it.`,
      "",
      "IMAdventist",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------------------------
// The church invoice
// ---------------------------------------------------------------------------------------------

/** The invoice group key of a church's conference club orders invoice on a club year's billing event: disjoint from every other group key. */
export const CLUB_ORDERS_GROUP_KEY_PREFIX = "club-orders:";

export function clubOrdersGroupKey(churchId: string) {
  return `${CLUB_ORDERS_GROUP_KEY_PREFIX}${churchId}`;
}

/** The church a group key names, or null when it is not a club orders group key. */
export function churchIdOfClubOrdersGroupKey(groupKey: string) {
  return groupKey.startsWith(CLUB_ORDERS_GROUP_KEY_PREFIX) && groupKey.length > CLUB_ORDERS_GROUP_KEY_PREFIX.length
    ? groupKey.slice(CLUB_ORDERS_GROUP_KEY_PREFIX.length)
    : null;
}

/** The slug of a club year's billing event. */
export function billingContainerSlug(clubYear: string) {
  return `conference-club-orders-${clubYear}`;
}

export function billingContainerName(clubYear: string) {
  return `Conference club orders ${clubYear}`;
}

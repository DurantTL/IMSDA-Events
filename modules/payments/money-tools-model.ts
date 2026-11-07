import type { EventPermission } from "@/modules/access/permissions";
import { staffPageTitles, withCurrentEvent } from "@/components/staff-navigation";
import { formatCents } from "@/modules/payments/format-cents";
import { UNAVAILABLE_STATUS, type CardStatus, type HubBody, type HubCard, type HubGroup } from "@/modules/system-admin/admin-hubs-model";

/**
 * The More money tools page (#1575): the event's other finance pages as grouped cards, each with a live status where the
 * page already computes an honest one. Pure model: no database access and no authorization of its own beyond the gate each
 * card is handed. The page itself checks MANAGE_FINANCE on the server.
 *
 * Rules the model keeps (the same as the Admin hubs):
 * - A card is shown only when the viewer can open the page it links to (`gate`), and the data for a card is only asked for
 *   when that card is shown (`neededMoneyMetrics`).
 * - A value that could not be read is `null` and shows as "Unavailable". It is never turned into a zero, "None" or "All match".
 * - A value that was not asked for is absent and is treated the same way as unreadable, so a card can never claim health
 *   from data nobody read.
 * - Every card is a link and carries `?event=`. Nothing here writes, refunds, matches or changes a record.
 */
export type MoneyMetricKey = "churchFlags" | "ledgerDifferences" | "policyVersions" | "policyInEffect" | "draftInvoices" | "scholarshipBalanceCents";

/** `null` is "could not be read"; a missing key is "not asked for". */
export type MoneyMetricValues = Partial<Record<MoneyMetricKey, number | null>>;

export type MoneyToolsViewer = { permissions: readonly EventPermission[] };

type Gate = (permissions: ReadonlySet<EventPermission>) => boolean;
const holds = (permission: EventPermission): Gate => (permissions) => permissions.has(permission);
/** Every page below checks MANAGE_FINANCE on the server today. A card with a narrower page later gets its own gate here. */
const finance = holds("MANAGE_FINANCE");

type Reader = (key: MoneyMetricKey) => number | null;

type CardDef = {
  href: string;
  title: string;
  description: string;
  gate: Gate;
  metrics?: readonly MoneyMetricKey[];
  status?: (read: Reader) => CardStatus;
};

const count = (n: number, tone: CardStatus["tone"], text: string): CardStatus => ({ tone, text: `${n} ${text}` });

const groupDefs: ReadonlyArray<{ title: string; cards: readonly CardDef[] }> = [
  {
    title: "Invoices and churches",
    cards: [
      {
        href: "/finance/invoices",
        title: staffPageTitles.invoices,
        description: "Draft, review and send what churches and groups are billed after the event.",
        gate: finance,
        metrics: ["draftInvoices"],
        status: (read) => (read("draftInvoices")! > 0 ? count(read("draftInvoices")!, "review", read("draftInvoices") === 1 ? "draft open" : "drafts open") : { tone: "ok", text: "No drafts open" }),
      },
      {
        href: "/finance/church-owed",
        title: staffPageTitles.churchOwed,
        description: "What each church owes, its promo code report and sponsored lodging changes.",
        gate: finance,
        metrics: ["churchFlags"],
        // The Payments page raises the same count as a notice.
        status: (read) => (read("churchFlags")! > 0 ? count(read("churchFlags")!, "warn", read("churchFlags") === 1 ? "needs the finance office" : "need the finance office") : { tone: "ok", text: "Nothing waiting" }),
      },
      {
        href: "/finance/billing-responsibility",
        title: staffPageTitles.billingResponsibility,
        description: "Who each registration is billed to, and the ones that still need an answer.",
        gate: finance,
      },
    ],
  },
  {
    title: "Funds and matching",
    cards: [
      {
        href: "/finance/scholarship-fund",
        title: staffPageTitles.scholarshipFund,
        description: "Money given for scholarships, what has been awarded, and what is left.",
        gate: finance,
        metrics: ["scholarshipBalanceCents"],
        status: (read) => ({ tone: "draft", text: `Balance ${formatCents(read("scholarshipBalanceCents")!)}` }),
      },
      {
        // No status: the unmatched list comes from Square itself, over a date window and not for one event, so it is not read here.
        href: "/finance/square-payments",
        title: staffPageTitles.squarePayments,
        description: "Square payments that no registration has claimed yet, ready to match by hand.",
        gate: finance,
      },
      {
        href: "/finance/attendance-reconciliation",
        title: staffPageTitles.attendanceReconciliation,
        description: "Who attended and what each church is billed for, before invoices go out.",
        gate: finance,
      },
    ],
  },
  {
    title: "Rules and checks",
    cards: [
      {
        href: "/finance/cancellation-policy",
        title: staffPageTitles.cancellationPolicy,
        description: "The refund rules this event follows when someone cancels.",
        gate: finance,
        metrics: ["policyVersions", "policyInEffect"],
        status: (read) => {
          if (read("policyInEffect")! > 0) return { tone: "ok", text: "In effect" };
          return read("policyVersions")! > 0 ? { tone: "soon", text: "None in effect yet" } : { tone: "draft", text: "No rules set" };
        },
      },
      {
        href: "/more/ledger-health",
        title: staffPageTitles.ledgerCheck,
        description: "Compares each registration's total with the ledger. It only reads.",
        gate: finance,
        metrics: ["ledgerDifferences"],
        status: (read) => (read("ledgerDifferences")! > 0 ? count(read("ledgerDifferences")!, "warn", "to check") : { tone: "ok", text: "All match" }),
      },
    ],
  },
];

/** The pages the cards open, in card order. The Money tab lights the More money tools view for each of them. */
export const moneyToolPaths: readonly string[] = groupDefs.flatMap((group) => group.cards.map((card) => card.href));

export const moneyToolsDescription = "The rest of this event's finance pages. Every card opens a page; nothing here changes a record.";

function visibleCards(viewer: MoneyToolsViewer) {
  const permissions = new Set(viewer.permissions);
  return groupDefs.flatMap((group) => group.cards.filter((card) => card.gate(permissions)));
}

/** Whether the viewer sees at least one card, so a page nobody could use is never listed. */
export function canOpenMoneyTools(viewer: MoneyToolsViewer): boolean {
  return visibleCards(viewer).length > 0;
}

/** The metrics of the cards this viewer sees: nothing hidden is read. */
export function neededMoneyMetrics(viewer: MoneyToolsViewer): MoneyMetricKey[] {
  const keys = new Set<MoneyMetricKey>();
  for (const card of visibleCards(viewer)) for (const key of card.metrics ?? []) keys.add(key);
  return [...keys];
}

export function buildMoneyToolsView(viewer: MoneyToolsViewer, eventId: string, values: MoneyMetricValues): HubBody {
  const permissions = new Set(viewer.permissions);
  const reading = (key: MoneyMetricKey): number | null => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const groups = groupDefs.flatMap((group): HubGroup[] => {
    const cards = group.cards
      .filter((card) => card.gate(permissions))
      .map((card): HubCard => {
        let status: CardStatus | null = null;
        if (card.status) status = (card.metrics ?? []).some((key) => reading(key) === null) ? UNAVAILABLE_STATUS : card.status(reading);
        return { href: withCurrentEvent(card.href, eventId), title: card.title, description: card.description, status };
      });
    return cards.length > 0 ? [{ title: group.title, cards }] : [];
  });
  return { key: "money-tools", description: moneyToolsDescription, groups };
}

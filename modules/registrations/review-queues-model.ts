import type { EventPermission } from "@/modules/access/permissions";
import { withCurrentEvent } from "@/components/staff-navigation";
import { UNAVAILABLE_STATUS, type CardStatus, type HubBody, type HubCard, type HubGroup } from "@/modules/system-admin/admin-hubs-model";

/**
 * The Review queues page (#1574): the event's registration review pages as grouped cards, each with a live status only where
 * the page already computes an honest count. Pure model: no database access and no authorization of its own beyond the gate
 * each card is handed. Each card is gated exactly as its own page checks on the server.
 *
 * Rules the model keeps (the same as the Admin hubs and More money tools):
 * - A card is shown only when the viewer can open the page it links to (`gate`), and the data for a card is only asked for
 *   when that card is shown (`neededReviewQueueMetrics`).
 * - A value that could not be read is `null` and shows as "Unavailable". It is never turned into a zero or "Nothing waiting".
 * - A value that was not asked for is absent and is treated the same way as unreadable.
 * - Every card is a link and carries `?event=`. Nothing here writes, approves, sends, merges or confirms.
 * - /people/matches (possible duplicate people across all events) is not here: it stays with System identity review.
 */
export type ReviewQueueMetricKey = "responsibleAdults" | "directoryEntries" | "pendingTeams" | "approvalsWaiting";

/** `null` is "could not be read"; a missing key is "not asked for". */
export type ReviewQueueMetricValues = Partial<Record<ReviewQueueMetricKey, number | null>>;

export type ReviewQueuesViewer = {
  permissions: readonly EventPermission[];
  /** Personal staff, pastor and volunteer links are for events open to everyone; their pages say "Not available" on a club event. */
  audience: "GENERAL" | "CLUB";
};

type Gate = (viewer: { permissions: ReadonlySet<EventPermission>; audience: ReviewQueuesViewer["audience"] }) => boolean;
const holds = (permission: EventPermission): Gate => ({ permissions }) => permissions.has(permission);
/** The staff invitation pages check MANAGE_REGISTRATION and then that the event is open to everyone. */
const generalWith = (permission: EventPermission): Gate => ({ permissions, audience }) => audience === "GENERAL" && permissions.has(permission);

type Reader = (key: ReviewQueueMetricKey) => number | null;

type CardDef = {
  href: string;
  title: string;
  description: string;
  gate: Gate;
  metrics?: readonly ReviewQueueMetricKey[];
  status?: (read: Reader) => CardStatus;
};

const waiting = (n: number, noun: string, review: CardStatus["tone"] = "review"): CardStatus =>
  n > 0 ? { tone: review, text: `${n} ${noun}` } : { tone: "ok", text: "Nothing waiting" };

const groupDefs: ReadonlyArray<{ title: string; cards: readonly CardDef[] }> = [
  {
    title: "People and families",
    cards: [
      {
        // VIEW_SENSITIVE_DATA: the page shows minors' names. Editing needs MANAGE_REGISTRATION, checked on the page.
        href: "/people/responsible-adults",
        title: "Responsible adults",
        description: "Minors with no adult on record, an unknown age, or two adults claiming one child.",
        gate: holds("VIEW_SENSITIVE_DATA"),
        metrics: ["responsibleAdults"],
        // The page's own "Needs review" count.
        status: (read) => waiting(read("responsibleAdults")!, "to review"),
      },
      {
        // No status on purpose: the finder compares every registration in memory, so a count here would be a second full scan.
        href: "/people/duplicates",
        title: "Find duplicates",
        description: "People and registrations that look like the same person entered more than once.",
        gate: holds("VIEW_SENSITIVE_DATA"),
      },
      {
        href: "/people/directory-review",
        title: "Directory review",
        description: "Clubs and churches people typed in because they were not in the directory.",
        gate: holds("MANAGE_REGISTRATION"),
        metrics: ["directoryEntries"],
        status: (read) => waiting(read("directoryEntries")!, "not in the directory"),
      },
    ],
  },
  {
    title: "Teams and staff sign-ups",
    cards: [
      {
        href: "/people/pending-teams",
        title: "Teams waiting for a club",
        description: "Teams that registered through the general link and need a club confirmed.",
        gate: holds("MANAGE_REGISTRATION"),
        metrics: ["pendingTeams"],
        status: (read) => waiting(read("pendingTeams")!, read("pendingTeams") === 1 ? "team waiting" : "teams waiting"),
      },
      {
        // No status on purpose: the list's counts are an inventory of every link, not work waiting.
        href: "/people/staff-invitations",
        title: "Staff invitations",
        description: "Personal links for staff, pastors and volunteers: import, send and revoke.",
        gate: generalWith("MANAGE_REGISTRATION"),
      },
      {
        href: "/people/staff-invitations/approvals",
        title: "Staff approvals",
        description: "Staff, pastor and volunteer registrations waiting for the office to approve or decline.",
        gate: generalWith("MANAGE_REGISTRATION"),
        metrics: ["approvalsWaiting"],
        status: (read) => waiting(read("approvalsWaiting")!, "waiting for approval"),
      },
    ],
  },
];

/** The pages the cards open, in card order. The Registrations tab lights the Review queues view for each of them. */
export const reviewQueuePaths: readonly string[] = groupDefs.flatMap((group) => group.cards.map((card) => card.href));

export const reviewQueuesDescription = "The registration pages that need a person to look. Every card opens a page; nothing here changes a record.";

const gateInput = (viewer: ReviewQueuesViewer) => ({ permissions: new Set(viewer.permissions), audience: viewer.audience });

function visibleCards(viewer: ReviewQueuesViewer) {
  const input = gateInput(viewer);
  return groupDefs.flatMap((group) => group.cards.filter((card) => card.gate(input)));
}

/** Whether the viewer can open at least one queue: the Review queues view and page exist for them. */
export function hasVisibleReviewQueue(viewer: ReviewQueuesViewer): boolean {
  return visibleCards(viewer).length > 0;
}

/** The metrics of the cards this viewer sees: nothing hidden is read. */
export function neededReviewQueueMetrics(viewer: ReviewQueuesViewer): ReviewQueueMetricKey[] {
  const keys = new Set<ReviewQueueMetricKey>();
  for (const card of visibleCards(viewer)) for (const key of card.metrics ?? []) keys.add(key);
  return [...keys];
}

export function buildReviewQueuesView(viewer: ReviewQueuesViewer, eventId: string, values: ReviewQueueMetricValues): HubBody {
  const input = gateInput(viewer);
  const reading = (key: ReviewQueueMetricKey): number | null => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const groups = groupDefs.flatMap((group): HubGroup[] => {
    const cards = group.cards
      .filter((card) => card.gate(input))
      .map((card): HubCard => {
        let status: CardStatus | null = null;
        if (card.status) status = (card.metrics ?? []).some((key) => reading(key) === null) ? UNAVAILABLE_STATUS : card.status(reading);
        return { href: withCurrentEvent(card.href, eventId), title: card.title, description: card.description, status };
      });
    return cards.length > 0 ? [{ title: group.title, cards }] : [];
  });
  return { key: "review-queues", description: reviewQueuesDescription, groups };
}


import type { EventPermission } from "@/modules/access/permissions";
import { staffPageTitles, withCurrentEvent } from "@/components/staff-navigation";
import { mergeLoneCards, type HubBody, type HubCard, type HubGroup } from "@/modules/system-admin/admin-hubs-model";

/**
 * The Printouts page (#1583): every staff printout and packet for the event as grouped cards, each saying what it prints.
 * Pure model: no database access and no authorization of its own beyond the gate each card is handed. Each card is gated
 * exactly as its own page decides, so a card never leads to a "restricted" or "not available" page.
 *
 * Rules the model keeps (the same as the Admin hubs, More money tools and Review queues):
 * - A card is shown only when the viewer can open the page it links to (`gate`).
 * - Every card is a link and carries `?event=`. Nothing here prints, downloads or changes a record.
 * - No card has a status: none of these pages computes a number cheaply, and a made-up count would not be honest.
 * - A group a gate leaves with one card joins its neighbour (`mergeLoneCards`), so no row is a lone card.
 *
 * Detail pages (one club's packet, one team's filled form) are children of a card, not cards. Printouts that belong to
 * another tab (name badges and attendee passes in Check-in, the kitchen report, the emergency plan, Seminar assignment
 * rosters) stay where they are.
 */
export type PrintoutsViewer = {
  permissions: readonly EventPermission[];
  /** The event's audience: the club pages are for a club event (Pathfinder, Adventurer ...), not one open to everyone. */
  audience: "GENERAL" | "CLUB";
  /** The event uses teams (a team-settings row exists): the blank and filled team forms are not found on any other event. */
  usesTeams: boolean;
  /** The Honors classes module is on for the event, as it is for the Honors setup card. */
  honorsOn: boolean;
};

type Gate = (viewer: { permissions: ReadonlySet<EventPermission>; audience: PrintoutsViewer["audience"]; usesTeams: boolean; honorsOn: boolean }) => boolean;
/** Every page below checks VIEW_REPORTS on the server. */
const reports: Gate = ({ permissions }) => permissions.has("VIEW_REPORTS");
/** The club report pages: report access, and only a club event has clubs to print (the pages are empty on any other). */
const clubReports: Gate = (viewer) => reports(viewer) && viewer.audience === "CLUB";
const teamForms: Gate = (viewer) => clubReports(viewer) && viewer.usesTeams;
const honorsRosters: Gate = (viewer) => reports(viewer) && viewer.honorsOn;

type CardDef = { href: string; title: string; description: string; gate: Gate };

const groupDefs: ReadonlyArray<{ title: string; cards: readonly CardDef[] }> = [
  {
    title: "Packets, books and rosters",
    cards: [
      {
        href: "/more/reports/packets",
        title: staffPageTitles.groupedPackets,
        description: "A cover and one operational packet for each church, club, household or registration group. Print them all or one.",
        gate: reports,
      },
      {
        href: "/more/reports/clubs/check-in-book",
        title: staffPageTitles.checkInBook,
        description: "The paper check-in book: every club on its own printed page, with its attendees to tick off on arrival.",
        gate: clubReports,
      },
      {
        href: "/more/honors/rosters",
        title: staffPageTitles.honorsRosters,
        description: "Class, site and club rosters for the Honors classes. Also in Honors.",
        gate: honorsRosters,
      },
    ],
  },
  {
    title: "Reports and forms",
    cards: [
      {
        href: "/more/reports/clubs",
        title: staffPageTitles.clubReports,
        description: "Camping, duties and activities, spiritual milestones and special roles from each club's registration, to print or download. Each club has its own packet.",
        gate: clubReports,
      },
      {
        href: "/more/reports/clubs/team-form",
        title: "Blank team form",
        description: "The empty team form, to print for a club that mails or emails the paper.",
        gate: teamForms,
      },
      {
        href: "/more/reports/clubs/team-form/level",
        title: "Team forms by level",
        description: "Every team's filled-in form for one level, one page each. Only teams that advanced print at the next level.",
        gate: teamForms,
      },
    ],
  },
];

/** The pages the cards open, in card order. The Reports tab lights the Printouts view for each of them and for their children. */
export const printoutPaths: readonly string[] = groupDefs.flatMap((group) => group.cards.map((card) => card.href));

export const printoutsDescription = "Everything staff print for this event, packets, books and forms. Every card opens a page; nothing here prints or changes a record.";

const gateInput = (viewer: PrintoutsViewer) => ({ permissions: new Set(viewer.permissions), audience: viewer.audience, usesTeams: viewer.usesTeams, honorsOn: viewer.honorsOn });

/** Whether the viewer can open at least one printout: the Printouts view and page exist for them. */
export function hasVisiblePrintout(viewer: PrintoutsViewer): boolean {
  const input = gateInput(viewer);
  return groupDefs.some((group) => group.cards.some((card) => card.gate(input)));
}

export function buildPrintoutsView(viewer: PrintoutsViewer, eventId: string): HubBody {
  const input = gateInput(viewer);
  const shown = groupDefs.flatMap((group): HubGroup[] => {
    const cards = group.cards
      .filter((card) => card.gate(input))
      .map((card): HubCard => ({ href: withCurrentEvent(card.href, eventId), title: card.title, description: card.description, status: null }));
    return cards.length > 0 ? [{ title: group.title, cards }] : [];
  });
  const groups = mergeLoneCards(shown.map((group) => ({ title: group.title, cards: [...group.cards] })));
  return { key: "printouts", description: printoutsDescription, groups };
}

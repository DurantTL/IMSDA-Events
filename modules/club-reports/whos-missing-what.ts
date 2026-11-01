import type { AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { clubRecordStatus } from "@/modules/club-reports/coordinator-overview-domain";

/**
 * "Who's missing what" on the coordinator Overview (#1435): per club, what is missing and one next step. It is a pure
 * function of the `AreaClubSummary` rows the Overview already loaded for this coordinator, so it can never list a club
 * the Overview does not, and it reads nothing more: no birth date, medical detail, note or contact record. A club with
 * nothing missing is left out.
 */
export type MissingKind = "NO_DIRECTOR" | "RECORD_MISSING" | "EARLIER_MISSING" | "LATE" | "NO_ROSTER";

export type MissingItem = { kind: MissingKind; label: string; tone: "coral" | "gold" };

export type NextStep = {
  /** What to do, and who to ask when only someone else can fix it. */
  text: string;
  /** Always the club's own view-only page: a coordinator can open it for any club they see. */
  href: string;
  linkLabel: string;
};

export type WhosMissingRow = { clubId: string; name: string; church: string; items: MissingItem[]; next: NextStep };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function whosMissingWhat(clubs: readonly AreaClubSummary[], month: string, now: Date): WhosMissingRow[] {
  const rows: WhosMissingRow[] = [];
  for (const club of clubs) {
    const items: MissingItem[] = [];
    if (club.directors.length === 0) items.push({ kind: "NO_DIRECTOR", label: "No director", tone: "coral" });
    const current = clubRecordStatus(club, month, now);
    if (current.state === "NOT_SUBMITTED") items.push({ kind: "RECORD_MISSING", label: "Missing", tone: "coral" });
    // The overview month is counted once above; earlier months that were never filed are a separate gap.
    const earlier = club.months.filter((cell) => cell.status === "MISSING" && cell.month !== month).length;
    if (earlier > 0) items.push({ kind: "EARLIER_MISSING", label: `Missing ${plural(earlier, "earlier month", "earlier months")}`, tone: "coral" });
    if (club.rosterSize === 0) items.push({ kind: "NO_ROSTER", label: "No roster yet", tone: "gold" });
    // A late record was filed, so it is not missing. It shows as extra information only on a club that has a real gap.
    if (items.length === 0) continue;
    if (club.late > 0) items.push({ kind: "LATE", label: `Late ${plural(club.late, "record", "records")}`, tone: "coral" });
    rows.push({ clubId: club.id, name: club.name, church: club.church, items, next: nextStepFor(club.id, items) });
  }
  // Most gaps first, then by name, so the clubs that need the most help are read first.
  return rows.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

function nextStepFor(clubId: string, items: readonly MissingItem[]): NextStep {
  const href = `/account/area/${clubId}`;
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.has("NO_DIRECTOR")) {
    return { text: "Ask the conference office to add a director. Only they can.", href, linkLabel: "Open club" };
  }
  if (kinds.has("RECORD_MISSING") || kinds.has("EARLIER_MISSING")) {
    return { text: "Contact the club's director about the Monthly Record. The app sends nothing for you.", href, linkLabel: "Open club" };
  }
  return { text: "Ask the club's director to add the club's people to the roster.", href, linkLabel: "Open club" };
}

/**
 * The numbers above the Clubs attending table (#1582), each in its own unit and worked out from rows the page already
 * loaded: clubs, teams (a club can register several), people going, and adults who need Sterling Volunteers, which is
 * counted once per person (by personId, so an adult on two teams' registrations is one) and never per team. Like the
 * table, it counts only people with a club (organizationId).
 */
export type EventClubsSummaryInput = {
  clubs: ReadonlyArray<{ organizationId: string; teamName: string | null; attendeeCount: number }>;
  /** `listEventBackgroundFlags(...)`: null when the event does not check adult backgrounds. */
  backgroundFlags: { people: ReadonlyArray<{ personId: string; organizationId: string | null }> } | null;
};

export type EventClubsSummaryItem = { key: "clubs" | "teams" | "going" | "sterling"; value: number; label: string };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function eventClubsSummary({ clubs, backgroundFlags }: EventClubsSummaryInput): EventClubsSummaryItem[] {
  const clubCount = new Set(clubs.map((club) => club.organizationId)).size;
  const teamCount = clubs.filter((club) => club.teamName).length;
  const going = clubs.reduce((sum, club) => sum + club.attendeeCount, 0);
  const items: EventClubsSummaryItem[] = [{ key: "clubs", value: clubCount, label: plural(clubCount, "club", "clubs") }];
  if (teamCount > 0) items.push({ key: "teams", value: teamCount, label: plural(teamCount, "team", "teams") });
  items.push({ key: "going", value: going, label: plural(going, "person going", "people going") });
  if (backgroundFlags) {
    const needed = new Set(backgroundFlags.people.filter((person) => person.organizationId).map((person) => person.personId)).size;
    items.push({ key: "sterling", value: needed, label: `${plural(needed, "adult needs", "adults need")} Sterling Volunteers` });
  }
  return items;
}

/**
 * The facts list on the public registration confirmation. A team registered through the general registration link (#931) is free
 * and named, so it has no pricing date, says "Team members", and names the team, club and location; an ordinary registration keeps
 * its pricing (or estimate) date and "Attendees".
 */
export type ConfirmationDetailRow = { label: string; value: string; translate?: false };

export function isTeamConfirmation(group: { noCost?: boolean; teamName?: string | null } | undefined) {
  return Boolean(group?.noCost && group.teamName);
}

export function confirmationDetailRows(input: {
  team: { teamName: string; club: string; location: string | null } | null;
  waitlisted: boolean;
  eventName: string;
  email: string;
  /** The roster count and its "registered" or "on the waitlist" wording, or null when the form has no roster. */
  roster: { count: number } | null;
  /** The pricing (or estimate) date, already formatted. */
  pricingDate: string;
}): ConfirmationDetailRow[] {
  const { team, waitlisted } = input;
  const rows: ConfirmationDetailRow[] = [{ label: "Event", value: input.eventName }];
  if (team) {
    rows.push({ label: "Team", value: team.teamName, translate: false });
    if (team.club) rows.push({ label: "Club", value: team.club, translate: false });
    if (team.location) rows.push({ label: "Location", value: team.location, translate: false });
  }
  rows.push({ label: "Email", value: input.email || "Not provided" });
  if (input.roster) {
    rows.push({ label: team ? "Team members" : "Attendees", value: `${input.roster.count} ${waitlisted ? "on the waitlist" : "registered"}` });
  }
  if (!team) rows.push({ label: waitlisted ? "Estimate date" : "Pricing date", value: input.pricingDate });
  return rows;
}

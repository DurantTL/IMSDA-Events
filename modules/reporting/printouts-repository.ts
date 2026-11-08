import "server-only";

import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { moduleState } from "@/modules/event-modules/service";

/**
 * What the Printouts page needs to know about the event beyond the viewer's role (#1583). Each answer only decides whether
 * a card is shown. A read that fails hides that card: the page never links to a destination it could not confirm.
 */
export async function loadPrintoutAvailability(eventId: string): Promise<{ usesTeams: boolean; honorsOn: boolean }> {
  const [teams, modules] = await Promise.allSettled([getTeamSettings(eventId), moduleState(eventId)]);
  return {
    usesTeams: teams.status === "fulfilled" && teams.value !== null,
    honorsOn: modules.status === "fulfilled" && modules.value.effective.has("honors"),
  };
}

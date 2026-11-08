import "server-only";

import { logError } from "@/lib/logger";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { moduleState } from "@/modules/event-modules/service";

/**
 * What the Printouts page needs to know about the event beyond the viewer's role (#1583). Each answer only decides whether
 * a card applies. A read that fails is logged and becomes `null`, which the card shows as "Unavailable": it never silently
 * means "no teams" or "Honors is off".
 */
export async function loadPrintoutAvailability(eventId: string): Promise<{ usesTeams: boolean | null; honorsOn: boolean | null }> {
  const [teams, modules] = await Promise.allSettled([getTeamSettings(eventId), moduleState(eventId)]);
  if (teams.status === "rejected") logError("Printouts could not read the event's team settings", teams.reason);
  if (modules.status === "rejected") logError("Printouts could not read the event's modules", modules.reason);
  return {
    usesTeams: teams.status === "fulfilled" ? teams.value !== null : null,
    honorsOn: modules.status === "fulfilled" ? modules.value.effective.has("honors") : null,
  };
}

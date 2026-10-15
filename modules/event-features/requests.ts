import type { TeamSettings } from "@/modules/club-teams/domain";
import type { FeatureAction } from "@/modules/event-features/model";
import type { EventSettingsRecord } from "@/modules/events/repository";
import { eventColumnChangeBody } from "@/modules/events/settings-draft";

/**
 * The request each Event features switch sends (#965). Every one is an API that
 * already exists and already checks its own permission on the server; this page
 * adds no write path. A test can pin exactly which request a switch sends and that
 * none of them is new.
 */
export type FeatureRequest = { url: string; method: "PUT" | "DELETE" | "PATCH" | "POST"; body?: unknown };

/** Reads JSON from an existing GET API; throws the server's message when it refuses. */
export type FetchJson = (url: string) => Promise<unknown>;

/** The team rules of an event that has none yet: the defaults the settings form starts from. */
export const noTeamRules: TeamSettings = {
  allowMultipleTeams: false,
  minTeamMembers: null,
  maxTeamMembers: null,
  maxAlternates: 0,
  ageAsOf: null,
  maxMemberAge: null,
  booksLine: "",
  levelInfo: [],
};

export const featureFallbackMessage = "The change could not be saved. Nothing was changed.";

/**
 * Runs one switch over `fetchImpl`: the fresh reads first where the switch needs them, then the change itself. A refusal from
 * the server (a missing permission, 409 TEAMS_IN_USE, a module the event's data keeps on, a publish that is not ready) throws
 * an Error carrying the server's own message, which the table shows beside the switch or in the confirm dialog.
 */
export async function performFeatureChange(
  action: FeatureAction,
  next: boolean,
  context: { eventId: string; fetchImpl: typeof fetch },
): Promise<void> {
  const readJson = async (response: Response) => await response.json().catch(() => ({})) as { message?: string };
  const fetchJson: FetchJson = async (url) => {
    const response = await context.fetchImpl(url, { cache: "no-store" });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.message ?? featureFallbackMessage);
    return result;
  };
  const { url, method, body } = await featureRequest(action, next, { eventId: context.eventId, fetchJson });
  const response = await context.fetchImpl(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error((await readJson(response)).message ?? featureFallbackMessage);
}

/**
 * The request a switch sends. Event columns and teams are read fresh first, with the
 * existing GETs, and the body changes only that one flag, so a field another admin
 * changed after the page loaded is never written back over.
 */
export async function featureRequest(
  action: FeatureAction,
  next: boolean,
  context: { eventId: string; fetchJson: FetchJson },
): Promise<FeatureRequest> {
  const id = encodeURIComponent(context.eventId);
  switch (action.type) {
    case "module":
      // System administrators only; the service refuses anyone else and a module the event's data keeps on.
      return { url: `/api/events/${id}/modules/${encodeURIComponent(action.moduleKey)}`, method: next ? "PUT" : "DELETE" };
    case "event-column": {
      // The existing settings update with its stale-write guard (expectedStartsOn / expectedEndsOn, #445), built from the
      // event as it is now. The GET needs the same permission as the PATCH.
      const { event } = await context.fetchJson(`/api/events/${id}`) as { event?: EventSettingsRecord };
      if (!event) throw new Error("The event could not be read. Nothing was changed.");
      return { url: `/api/events/${id}`, method: "PATCH", body: eventColumnChangeBody(event, { [action.field]: next }) };
    }
    case "general-link":
      return { url: `/api/events/${id}/general-link`, method: "PUT", body: { enabled: next } };
    case "teams": {
      // Only the one switch changes; every other team rule is sent back as it is stored right now.
      const { teamSettings } = await context.fetchJson(`/api/events/${id}/team-settings`) as { teamSettings?: TeamSettings | null };
      return { url: `/api/events/${id}/team-settings`, method: "PUT", body: { ...(teamSettings ?? noTeamRules), allowMultipleTeams: next } };
    }
    case "publish":
      return { url: `/api/events/${id}/${next ? "publish" : "unpublish"}`, method: "POST" };
    case "calendar":
      return { url: `/api/admin/calendar/events/${id}`, method: "PATCH", body: { showOnCalendar: next } };
  }
}

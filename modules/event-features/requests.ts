import type { TeamSettings } from "@/modules/club-teams/domain";
import type { FeatureAction } from "@/modules/event-features/model";
import { eventColumnChangeBody, type EventColumnBase } from "@/modules/events/settings-draft";

/**
 * The request each Event features switch sends (#965). Every one is an API that
 * already exists and already checks its own permission on the server; this page
 * adds no write path. Pure, so a test can pin exactly which request a switch
 * sends and that none of them is new.
 */
export type FeatureRequest = { url: string; method: "PUT" | "DELETE" | "PATCH" | "POST"; body?: unknown };

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

export function featureRequest(
  action: FeatureAction,
  next: boolean,
  context: { eventId: string; columnBase: EventColumnBase | null; teamSettings: TeamSettings | null },
): FeatureRequest {
  const id = encodeURIComponent(context.eventId);
  switch (action.type) {
    case "module":
      // System administrators only; the service refuses anyone else and a module the event's data keeps on.
      return { url: `/api/events/${id}/modules/${encodeURIComponent(action.moduleKey)}`, method: next ? "PUT" : "DELETE" };
    case "event-column":
      // The existing settings update with its stale-write guard (expectedStartsOn / expectedEndsOn, #445).
      if (!context.columnBase) throw new Error("Event settings access is needed to change this.");
      return { url: `/api/events/${id}`, method: "PATCH", body: eventColumnChangeBody(context.columnBase, { [action.field]: next }) };
    case "general-link":
      return { url: `/api/events/${id}/general-link`, method: "PUT", body: { enabled: next } };
    case "teams":
      // Only the one switch changes; every other team rule is sent back as it is stored.
      return { url: `/api/events/${id}/team-settings`, method: "PUT", body: { ...(context.teamSettings ?? noTeamRules), allowMultipleTeams: next } };
    case "publish":
      return { url: `/api/events/${id}/${next ? "publish" : "unpublish"}`, method: "POST" };
    case "calendar":
      return { url: `/api/admin/calendar/events/${id}`, method: "PATCH", body: { showOnCalendar: next } };
  }
}

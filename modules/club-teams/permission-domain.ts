import { z } from "zod";
import { formatCalendarDate } from "@/modules/club-registrations/domain";

/** The Area Coordinator's permission flag on a team member of 18 or older (#809). Pure wording, shared by every screen and the form. */

export type PermissionStatus = "PENDING" | "GRANTED" | "DECLINED";
export type PermissionDecision = "GRANTED" | "DECLINED";

/** What the director is told when a team is saved with someone 18 or older as a team member. */
export const permissionPendingNotice = (name: string) =>
  `${name || "Someone"} is 18 or older. Team members 18 and over need approval from the Area Coordinator. Your team is registered, and the Area Coordinator has been asked to review it.`;

export const permissionGrantedNotice = (name: string) => `${name || "Someone"}: Approved by the Area Coordinator.`;

/** What to do about a declined team member: a TLT is always a team member, so a coach is not an option for them. */
const declinedRemedy = (tlt: boolean) => (tlt ? "Remove them or replace them with another team member" : "Change them to a coach or remove them from the team");

export const permissionDeclinedNotice = (name: string, tlt = false) =>
  `${name || "Someone"}: The Area Coordinator did not approve this team member. ${declinedRemedy(tlt)}, then save it again. Nobody has been removed for you.`;

export const permissionDeclinedProblem = (name: string, tlt = false) =>
  `The Area Coordinator did not approve ${name || "someone"} to be a team member. ${declinedRemedy(tlt)}.`;

/** For an attendee's own edit, where naming a teammate would tell them something that is the director's to tell. */
export const permissionDeclinedGenericProblem = "The Area Coordinator did not approve a team member on this team. Contact the event team.";

export function permissionNotice(status: PermissionStatus, name: string, tlt = false) {
  return status === "GRANTED" ? permissionGrantedNotice(name) : status === "DECLINED" ? permissionDeclinedNotice(name, tlt) : permissionPendingNotice(name);
}

/** The short wording on the printed form and in reports. */
export const permissionShortLabel = (status: PermissionStatus) =>
  status === "GRANTED" ? "AC permission: granted" : status === "DECLINED" ? "AC permission: declined" : "AC permission: pending";

/** One event's age rule, read from its team settings (never hard-coded): the oldest age and the "age as of" date. */
export type TeamAgeRule = { eventId: string; eventName: string; maxMemberAge: number | null; ageAsOf: string | null };

/** The age limit in words, e.g. "19 or younger on January 1, 2026". An event with no maximum age has no limit to word. */
export function ageLimitText(rule: Pick<TeamAgeRule, "maxMemberAge" | "ageAsOf">) {
  if (rule.maxMemberAge === null) return "No age limit";
  return rule.ageAsOf ? `${rule.maxMemberAge} or younger on ${formatCalendarDate(rule.ageAsOf)}` : `${rule.maxMemberAge} or younger on the event's age date`;
}

/**
 * The plain-language explanation at the top of the Area Coordinator's Team approvals tab (#918, #1015): what the tab is
 * for, the rules being checked, and what each decision does, in the words of the notices above. Shared so the page and
 * its test agree. The age rule is worded by `ageLimitText` from each event's own team settings.
 */
export const teamPermissionsIntro = {
  summary:
    "Team events such as the Pathfinder Bible Experience (PBE) are for youth. When a club lists someone who is 18 or older as a team member (not a coach), you confirm they still qualify before they compete. Each person who needs a decision from you is listed here, for teams at your own locations.",
  rulesHeading: "Rules to check",
  rulesLead: "Each of these must be met for the person to stay on the team as a team member.",
  rules: [
    "An inducted Pathfinder or TLT, active and in good standing.",
    "Not graduated from high school.",
  ],
  /** The age rule's lead-in; the event's own limit follows it (see `ageLimitText`). */
  ageRuleLead: "No older than the event's maximum age on its \"age as of\" date",
  coaches: "Adults who are coaching should be registered as coaches. Coaches don't need approval.",
  levels: [
    { label: "Pending approval", detail: "The club has asked. The team is registered while you decide, so nothing is held up." },
    { label: "Approved", detail: "The person stays on the team as a team member. You can change your mind later and decline." },
    { label: "Declined", detail: "The person cannot be a team member. The club's director is told to change them to a coach or take them off the team. Nobody is removed for them." },
  ],
  footer: "Choose Approve or Decline beside a name. The club's director sees your answer on their team page.",
} as const;

export const permissionDecisionSchema = z.strictObject({ decision: z.enum(["GRANTED", "DECLINED"]) });

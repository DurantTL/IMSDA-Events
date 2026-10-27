/**
 * Required club forms (#1246): pure rules, no database access and no authorization.
 *
 * Staff choose, per form template, whether it is required: not at all, once per club each club year, or once for each
 * member of the chosen roster types each club year. A form is done for a club (or a member) when a SUBMITTED entry
 * exists for that club (and member) in the club year; a draft does not count. Only forms that are turned on are
 * counted, since a club cannot fill in a form that is off.
 *
 * The Clubs dashboard's "Clubs with forms missing" card and its list page both read `clubsWithFormsMissing` on the
 * output of `computeRequiredForms`, so the card's count is the length of the list it links to.
 */

export const CLUB_FORM_REQUIREMENTS = ["NOT_REQUIRED", "ONCE_PER_CLUB_YEAR", "PER_ROLE_MEMBER_YEAR"] as const;
export type ClubFormRequirementValue = (typeof CLUB_FORM_REQUIREMENTS)[number];

/** The roster types a per-member requirement can name (the roster's own member types). */
export const REQUIRED_ROLE_TYPES = ["YOUTH", "UNDERAGE", "STAFF", "ADULT"] as const;
export type RequiredRoleType = (typeof REQUIRED_ROLE_TYPES)[number];

export const requirementLabels: Record<ClubFormRequirementValue, string> = {
  NOT_REQUIRED: "Not required",
  ONCE_PER_CLUB_YEAR: "Once per club, each year",
  PER_ROLE_MEMBER_YEAR: "Each member of a role, each year",
};

export const requiredRoleLabels: Record<RequiredRoleType, string> = {
  YOUTH: "Pathfinders (Youth)",
  UNDERAGE: "Underage",
  STAFF: "Staff",
  ADULT: "Adults",
};

export function isRequirement(value: unknown): value is ClubFormRequirementValue {
  return typeof value === "string" && (CLUB_FORM_REQUIREMENTS as readonly string[]).includes(value);
}

/** What is stored: roles only mean something for a per-member requirement, so other modes keep none. */
export function normalizeRequirement(requirement: ClubFormRequirementValue, roles: readonly string[]) {
  if (requirement !== "PER_ROLE_MEMBER_YEAR") return { requirement, roles: [] as RequiredRoleType[] };
  const unique = REQUIRED_ROLE_TYPES.filter((role) => roles.includes(role));
  return { requirement, roles: unique };
}

/** A short phrase for the admin table and the director page: "Once per club each year", "Each Staff each year". */
export function requirementSummary(requirement: ClubFormRequirementValue, roles: readonly string[]) {
  if (requirement === "NOT_REQUIRED") return "Not required";
  if (requirement === "ONCE_PER_CLUB_YEAR") return "Once per club each club year";
  const names = REQUIRED_ROLE_TYPES.filter((role) => roles.includes(role)).map((role) => requiredRoleLabels[role]);
  return `Each member (${names.join(", ") || "no role chosen"}) each club year`;
}

export type RequiredTemplate = { key: string; name: string; requirement: ClubFormRequirementValue; requiredRoles: readonly string[] };
export type RequiredClub = { id: string; name: string; church: string };
export type RequiredRosterMember = { id: string; organizationId: string; attendeeType: string; name: string };
/** One SUBMITTED entry. `rosterMemberId` is null for a club-level form. */
export type RequiredSubmission = { templateKey: string; organizationId: string; rosterMemberId: string | null };

export type RequiredFormItem = {
  templateKey: string;
  name: string;
  requirement: Exclude<ClubFormRequirementValue, "NOT_REQUIRED">;
  roles: RequiredRoleType[];
  status: "MISSING" | "DONE";
  /** Per-member forms: the active members of the chosen roles with no submitted entry. Empty for a club-level form. */
  missingMembers: Array<{ id: string; name: string }>;
  /** Per-member forms: how many active members the requirement covers. */
  memberCount: number;
};

export type ClubRequiredForms = { id: string; name: string; church: string; items: RequiredFormItem[] };

export function computeRequiredForms(input: {
  templates: readonly RequiredTemplate[];
  clubs: readonly RequiredClub[];
  members: readonly RequiredRosterMember[];
  submissions: readonly RequiredSubmission[];
}): ClubRequiredForms[] {
  const required = input.templates.filter((template) => template.requirement !== "NOT_REQUIRED");
  const memberFiled = new Set(input.submissions.filter((entry) => entry.rosterMemberId !== null).map((entry) => `${entry.templateKey}|${entry.rosterMemberId}`));
  // Once per club: any submitted entry for the club in the year counts.
  const anyFiled = new Set(input.submissions.map((entry) => `${entry.templateKey}|${entry.organizationId}`));
  return input.clubs.map((club) => {
    const clubMembers = input.members.filter((member) => member.organizationId === club.id);
    const items = required.flatMap((template): RequiredFormItem[] => {
      if (template.requirement === "ONCE_PER_CLUB_YEAR") {
        const done = anyFiled.has(`${template.key}|${club.id}`);
        return [{ templateKey: template.key, name: template.name, requirement: "ONCE_PER_CLUB_YEAR", roles: [], status: done ? "DONE" : "MISSING", missingMembers: [], memberCount: 0 }];
      }
      const roles = REQUIRED_ROLE_TYPES.filter((role) => template.requiredRoles.includes(role));
      const covered = clubMembers.filter((member) => (roles as readonly string[]).includes(member.attendeeType));
      const missingMembers = covered
        .filter((member) => !memberFiled.has(`${template.key}|${member.id}`))
        .map((member) => ({ id: member.id, name: member.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-US"));
      return [{
        templateKey: template.key,
        name: template.name,
        requirement: "PER_ROLE_MEMBER_YEAR",
        roles,
        status: missingMembers.length > 0 ? "MISSING" : "DONE",
        missingMembers,
        memberCount: covered.length,
      }];
    });
    return { id: club.id, name: club.name, church: club.church, items };
  });
}

/** The clubs with at least one required form missing, each with only what it is missing. The card's count is its length. */
export function clubsWithFormsMissing(results: readonly ClubRequiredForms[]) {
  return results
    .map((club) => ({ ...club, items: club.items.filter((item) => item.status === "MISSING") }))
    .filter((club) => club.items.length > 0);
}

export const CLUBS_FORMS_MISSING_PATH = "/admin/club-forms";

export function clubsFormsMissingHref(clubYear: string) {
  return `${CLUBS_FORMS_MISSING_PATH}?view=missing&year=${encodeURIComponent(clubYear)}`;
}

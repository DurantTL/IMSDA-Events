import { createHash } from "node:crypto";
import { attendeeAgeKey, attendeeNameKeys, guestIsAdult } from "@/modules/club-registrations/domain";
import type { TeamSettings } from "@/modules/club-teams/domain";
import {
  ALTERNATE_FIELD_KEY,
  formAsksRole,
  isAlternateAnswer,
  teamRoleFor,
  teamRuleProblems,
  type TeamPerson,
  type TeamRole,
} from "@/modules/club-teams/rules";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { parseGroupAge } from "@/modules/group-registrations/domain";

/**
 * The people typed into a general-link team (#931), read the same way for the director's submission, for a staff
 * confirmation and for the tests: a name and an age on the event's age date, the role (team member or coach) and the alternate
 * mark. Nobody is looked up on a roster: every person is an extra person for this event (a "guest"), exactly as the club
 * portal records someone not on the roster, so the registration prices, reports, checks in and prints like any other.
 *
 * Pure. The server calls it inside the submit transaction, so the size, alternate and age rules are decided there and never
 * trusted from the page.
 */

export type TypedInPerson = {
  clientId: string;
  firstName: string;
  lastName: string;
  /** The age on the event's age date, or null when it was not typed or is not a whole number from 0 to 120. */
  age: number | null;
  role: TeamRole;
  alternate: boolean;
  /** Adults are background-checked like everyone else; a guest is one at 18. */
  adult: boolean;
};

export type TypedInTeam = {
  people: TypedInPerson[];
  /** The rule problems, one sentence each; empty when every rule holds or an age is still missing (the form check names it). */
  problems: string[];
};

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function nameOf(definition: RegistrationFormDefinition, responses: Readonly<Record<string, unknown>>) {
  const keys = attendeeNameKeys(definition);
  if (!keys) return { firstName: "", lastName: "" };
  if (keys.kind === "split") return { firstName: textOf(responses[keys.first]), lastName: textOf(responses[keys.last]) };
  const [first = "", ...rest] = textOf(responses[keys.key]).split(/\s+/);
  return { firstName: first, lastName: rest.join(" ") };
}

export function readTypedInTeam(
  definition: RegistrationFormDefinition,
  attendees: ReadonlyArray<{ clientId: string; responses: Readonly<Record<string, unknown>> }>,
  settings: TeamSettings | null,
  eventDate: string,
): TypedInTeam {
  const ageKey = attendeeAgeKey(definition);
  const people = attendees.map((attendee): TypedInPerson => {
    const age = ageKey ? parseGroupAge(attendee.responses[ageKey]) : null;
    const { firstName, lastName } = nameOf(definition, attendee.responses);
    return {
      clientId: attendee.clientId,
      firstName,
      lastName,
      age,
      role: teamRoleFor({ responses: attendee.responses, maxMemberAge: settings?.maxMemberAge ?? null, formAsksRole: formAsksRole(definition), age }),
      alternate: isAlternateAnswer(attendee.responses[ALTERNATE_FIELD_KEY]),
      adult: age !== null && guestIsAdult({ age }),
    };
  });
  // A missing or unreadable age is the form check's to name, at the field; the rules wait until every age is known.
  if (!settings || people.some((person) => person.age === null)) return { people, problems: [] };
  const rulePeople: TeamPerson[] = people.map((person) => ({
    name: `${person.firstName} ${person.lastName}`.trim(),
    role: person.role,
    alternate: person.alternate,
    age: person.age,
  }));
  return { people, problems: teamRuleProblems(settings, rulePeople, eventDate) };
}

/** A stable id for a typed-in person (`clubGuestId`), so the director's submission and a staff confirmation derive the same one. */
export function typedInPersonId(seed: string, clientId: string) {
  return createHash("sha256").update(`${seed}\u0000${clientId}`).digest("hex").slice(0, 16);
}

/** The same JSON whatever the key order, for a request hash. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function requestHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * Answers to questions the form no longer asks (#1044), dropped when a team received under an older form version is attached
 * under the current one: the form engine refuses an answer it has no question for. Only the copy sent along is changed;
 * what the director typed is not edited.
 */
export function withoutRetiredAnswers(definition: RegistrationFormDefinition, answers: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const keys = new Set(definition.sections.flatMap((section) => section.fields.map((field) => field.key)));
  return Object.fromEntries(Object.entries(answers).filter(([key]) => keys.has(key)));
}

/** The sentence staff read when a waiting team has more people than the current form's roster allows, or null when it fits. */
export function rosterOverMaximumMessage(definition: RegistrationFormDefinition, count: number, formChanged = true): string | null {
  const max = definition.attendeeRoster?.enabled ? definition.attendeeRoster.maxAttendees : null;
  if (max === null || count <= max) return null;
  const cause = formChanged ? " It was received on an older form that also listed coaches." : "";
  return `This team lists ${count} people, but the current form allows at most ${max}.${cause} Ask the director to register again with the team members only, then reject this one.`;
}

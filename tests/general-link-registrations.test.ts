import { beforeEach, describe, expect, it, vi } from "vitest";
import { formTemplates, registrationFormDefinitionSchema } from "@/modules/forms/definition";
import {
  generalLinkClubAnswer,
  generalLinkClubFieldKey,
  generalLinkExtrasSchema,
  generalLinkFormProblem,
  generalLinkPath,
  generalLinkUrl,
  normalizeDirectorEmail,
  pendingConfirmationCode,
} from "@/modules/general-link-registrations/domain";
import { readTypedInTeam, requestHash, rosterOverMaximumMessage, stableJson, typedInPersonId, withoutRetiredAnswers } from "@/modules/general-link-registrations/typed-team";
import type { TeamSettings } from "@/modules/club-teams/domain";

const pbe = registrationFormDefinitionSchema.parse(formTemplates.find((template) => template.key === "pbe_registration")!.definition);

const settings: TeamSettings = {
  allowMultipleTeams: true,
  minTeamMembers: 2,
  maxTeamMembers: 7,
  maxAlternates: 1,
  ageAsOf: "2026-01-01",
  maxMemberAge: 19,
  booksLine: "",
  levelInfo: [],
};

const person = (first: string, age: number | string | undefined, role = "Pathfinder", alternate = false, clientId = first) => ({
  clientId,
  responses: { first_name: first, last_name: "Synthetic", attendee_age: age, attendee_type: role, ...(alternate ? { alternate: true } : {}) },
});

const youth = (count: number) => Array.from({ length: count }, (_, index) => person(`Kid${index}`, 14));

describe("the general registration link's address and words", () => {
  it("is a public path beside the group page, and a copyable URL", () => {
    expect(generalLinkPath("pbe-2027")).toBe("/register/pbe-2027/general");
    expect(generalLinkUrl("https://events.imsda.test/", "pbe-2027")).toBe("https://events.imsda.test/register/pbe-2027/general");
    expect(generalLinkPath("a b")).toBe("/register/a%20b/general");
  });

  it("compares director emails trimmed and lowercase", () => {
    expect(normalizeDirectorEmail("  Director.One@Example.TEST ")).toBe("director.one@example.test");
    expect(normalizeDirectorEmail("director.one@example.test")).toBe(normalizeDirectorEmail("DIRECTOR.ONE@EXAMPLE.TEST"));
  });

  it("gives a waiting team a code that is not a registration's", () => {
    expect(pendingConfirmationCode("abcdef0123456789")).toBe("PBE-ABCDEF0123");
    expect(pendingConfirmationCode("abcdef0123456789")).not.toMatch(/^REG-/);
  });

  it("takes the site and the team name beside the answers, nothing else typed", () => {
    expect(generalLinkExtrasSchema.parse({ locationId: " loc-1 ", teamName: "Bible Bees" })).toEqual({ locationId: "loc-1", teamName: "Bible Bees" });
    expect(generalLinkExtrasSchema.parse({})).toEqual({});
    expect(generalLinkExtrasSchema.safeParse({ teamName: "x".repeat(201) }).success).toBe(false);
  });
});

describe("the form the link needs", () => {
  it("accepts the PBE form: a club question that picks from the directory, and typed-in people", () => {
    expect(generalLinkClubFieldKey(pbe)).toBe("club_name");
    expect(generalLinkFormProblem(pbe)).toBeNull();
  });

  it("refuses a form with no club directory question, since the club could not be matched", () => {
    const withoutClub = {
      ...pbe,
      sections: pbe.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => field.optionSource !== "CLUBS_DIRECTORY" && field.key !== "club_name_other") })),
    };
    expect(generalLinkFormProblem(withoutClub)).toMatch(/no club question that picks from the directory/);
  });

  it("refuses a form that is not a club form at all", () => {
    expect(generalLinkFormProblem({ ...pbe, attendeeRoster: { ...pbe.attendeeRoster!, enabled: false } })).toMatch(/doesn't collect a list of attendees/);
  });

  it("reads the club answer: the directory name, or \"Not listed\" and what was typed", () => {
    expect(generalLinkClubAnswer(pbe, { club_name: "  Synthetic Club  " })).toEqual({ directoryName: "Synthetic Club", notListed: false, asEntered: "Synthetic Club" });
    const notListed = generalLinkClubAnswer(pbe, { club_name: "Not listed", club_name_other: "  The Typed Name  " });
    expect(notListed).toEqual({ directoryName: null, notListed: true, asEntered: "The Typed Name" });
    expect(generalLinkClubAnswer(pbe, {})).toEqual({ directoryName: null, notListed: false, asEntered: "" });
    expect(generalLinkClubAnswer(pbe, { club_name: "Not listed", club_name_other: "x".repeat(300) }).asEntered).toHaveLength(200);
  });
});

describe("the people typed into a team", () => {
  const read = (people: Array<{ clientId: string; responses: Record<string, unknown> }>) => readTypedInTeam(pbe, people, settings, "2027-01-16");

  it("reads names, ages on the age date, the role and the alternate", () => {
    const team = read([person("Ann", "14"), person("Bo", 19, "TLT", true), person("Cy", 41, "Coach")]);
    expect(team.problems).toEqual([]);
    expect(team.people.map((entry) => [entry.firstName, entry.age, entry.role, entry.alternate, entry.adult])).toEqual([
      ["Ann", 14, "MEMBER", false, false],
      ["Bo", 19, "MEMBER", true, true],
      ["Cy", 41, "COACH", false, true],
    ]);
  });

  it("counts everyone as a team member when the form has no role answers, the 7th the alternate (#1044)", () => {
    const noRole = (first: string, age: number, alternate = false) => ({ clientId: first, responses: { first_name: first, last_name: "Synthetic", attendee_age: age, ...(alternate ? { alternate: true } : {}) } });
    const members = (count: number) => Array.from({ length: count }, (_, index) => noRole(`Kid${index}`, 14));
    const two = read(members(2));
    expect(two.problems).toEqual([]);
    expect(two.people.map((p) => p.role)).toEqual(["MEMBER", "MEMBER"]);
    expect(read(members(1)).problems.join(" ")).toMatch(/this one has 1/);
    expect(read([...members(6), noRole("Alt", 15, true)]).problems).toEqual([]);
    expect(read([...members(7), noRole("Extra", 15)]).problems.join(" ")).toMatch(/this one has 8/);
    // An 18-year-old with no role answer is a member; the age rule is unchanged (20 is over 19 on the age date).
    expect(read([noRole("A", 18), noRole("B", 19)]).people.map((p) => p.role)).toEqual(["MEMBER", "MEMBER"]);
    expect(read([noRole("A", 14), noRole("B", 20)]).people[1]!.role).toBe("COACH");
  });

  it("holds a team to 2 to 7 members, coaches never counted", () => {
    expect(read(youth(1)).problems.join(" ")).toMatch(/at least 2 team members; this one has 1/);
    expect(read([...youth(1), person("C1", 40, "Coach"), person("C2", 41, "Coach")]).problems.join(" ")).toMatch(/this one has 1.*Coaches don't count/);
    expect(read(youth(8)).problems.join(" ")).toMatch(/at most 7 team members, including the alternate; this one has 8/);
    expect(read(youth(2)).problems).toEqual([]);
    expect(read([...youth(7), person("C1", 40, "Coach"), person("C2", 41, "Coach")]).problems).toEqual([]);
  });

  it("allows one alternate, and only a team member", () => {
    expect(read([person("A", 14, "Pathfinder", true), person("B", 14, "Pathfinder", true), person("C", 14)]).problems.join(" ")).toMatch(/Only 1 team member can be the alternate/);
    expect(read([person("A", 14), person("B", 14), person("C", 41, "Coach", true)]).problems.join(" ")).toMatch(/Synthetic is a coach, so can't be the alternate|C Synthetic is a coach/);
    expect(read([person("A", 14, "Pathfinder", true), person("B", 14)]).problems).toEqual([]);
  });

  it("counts age on 2026-01-01: 19 is a member, 20 is a coach", () => {
    expect(read([person("A", 19), person("B", 14)]).problems).toEqual([]);
    const old = read([person("A", 20), person("B", 14)]);
    expect(old.people[0]!.role).toBe("COACH");
    expect(old.problems.join(" ")).toMatch(/this one has 1/);
  });

  it("waits for every age before judging the team: a missing age is the form's own error at its field", () => {
    expect(read([person("A", 14), person("B", undefined)]).problems).toEqual([]);
    expect(read([person("A", 14), person("B", "fourteen")]).people[1]!.age).toBeNull();
    expect(read([person("A", 14), person("B", 121)]).people[1]!.age).toBeNull();
  });

  it("holds nothing to an event without team rules", () => {
    expect(readTypedInTeam(pbe, youth(1), null, "2027-01-16").problems).toEqual([]);
  });
});

describe("ids and hashes that must not change between a submission and its confirmation", () => {
  it("derives the same typed-in person id from the same seed and client id, and different ones otherwise", () => {
    const id = typedInPersonId("seed-1", "client-1");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(typedInPersonId("seed-1", "client-1")).toBe(id);
    expect(typedInPersonId("seed-2", "client-1")).not.toBe(id);
    expect(typedInPersonId("seed-1", "client-2")).not.toBe(id);
  });

  it("hashes a request the same whatever the key order", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(stableJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
    expect(requestHash({ a: 1, b: undefined })).toBe(requestHash({ a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });
});

// ---------------------------------------------------------------------------------------------
// The routes: who may call them
// ---------------------------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  class MockAccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  }
  class MockGeneralLinkError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    AccessDeniedError: MockAccessDeniedError,
    GeneralLinkError: MockGeneralLinkError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    findActiveMembership: vi.fn(),
    resolvePendingTeam: vi.fn(),
    getGeneralLinkSettings: vi.fn(),
    setGeneralRegistrationLink: vi.fn(),
    requireRosterAccess: vi.fn(),
    linkExtraPersonToRoster: vi.fn(),
    clubRegistrationApiError: vi.fn(),
  };
});

vi.mock("@/modules/access/authorization", () => ({ AccessDeniedError: mocks.AccessDeniedError, requirePermission: mocks.requirePermission }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/club-registrations/api-errors", () => ({ clubRegistrationApiError: mocks.clubRegistrationApiError }));
vi.mock("@/modules/club-rosters/access", () => ({ requireRosterAccess: mocks.requireRosterAccess, actorAttribution: (actor: { accountId: string }) => ({ accountId: actor.accountId }) }));
vi.mock("@/modules/general-link-registrations/repository", () => ({
  GeneralLinkError: mocks.GeneralLinkError,
  generalLinkErrorStatus: () => 409,
  resolvePendingTeam: mocks.resolvePendingTeam,
  getGeneralLinkSettings: mocks.getGeneralLinkSettings,
  setGeneralRegistrationLink: mocks.setGeneralRegistrationLink,
}));
vi.mock("@/modules/general-link-registrations/roster-link", () => ({ linkExtraPersonToRoster: mocks.linkExtraPersonToRoster }));

import { POST as postTeamAction } from "@/app/api/events/[eventId]/general-link/teams/[submissionId]/route";
import { GET as getSetting, PUT as putSetting } from "@/app/api/events/[eventId]/general-link/route";
import { POST as postRosterLink } from "@/app/api/attendee/clubs/[organizationId]/events/[eventId]/registration/roster-link/route";

const teamContext = { params: Promise.resolve({ eventId: "event-1", submissionId: "sub-1" }) };
const eventContext = { params: Promise.resolve({ eventId: "event-1" }) };
const rosterContext = { params: Promise.resolve({ organizationId: "club-1", eventId: "event-1" }) };
const json = (body: unknown, url = "https://events.imsda.test/api/x") => new Request(url, {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1" } });
  mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1" } });
  mocks.resolvePendingTeam.mockResolvedValue({ status: "CONFIRMED", alreadyDone: false, registrationId: "reg-1", clubName: "Synthetic Club" });
  mocks.getGeneralLinkSettings.mockResolvedValue({ enabled: true });
  mocks.setGeneralRegistrationLink.mockResolvedValue({ enabled: false });
  mocks.requireRosterAccess.mockResolvedValue({ actor: { kind: "ATTENDEE", accountId: "acct-1", sessionId: "s-1" } });
  mocks.linkExtraPersonToRoster.mockResolvedValue({ attendeeId: "att-1", linkedRosterMemberId: "member-1" });
  mocks.clubRegistrationApiError.mockImplementation((error: unknown) => Response.json({ error: "MAPPED", message: String(error) }, { status: 422 }));
});

describe("POST /api/events/[eventId]/general-link/teams/[submissionId]", () => {
  it("needs MANAGE_REGISTRATION: without it nothing is attached", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("You do not have access to this event."));
    const response = await postTeamAction(json({ action: "CONFIRM", organizationId: "club-1" }), teamContext);
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_REGISTRATION", mocks.findActiveMembership);
    expect(mocks.resolvePendingTeam).not.toHaveBeenCalled();
  });

  it("answers an unauthenticated caller 401 and a cross-origin post before anything else", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("Sign in to continue.", 401, "AUTHENTICATION_REQUIRED"));
    expect((await postTeamAction(json({ action: "CONFIRM", organizationId: "club-1" }), teamContext)).status).toBe(401);
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    mocks.requirePermission.mockClear();
    expect((await postTeamAction(json({ action: "CONFIRM", organizationId: "club-1" }), teamContext)).status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("passes the staff member and the action to the repository", async () => {
    const response = await postTeamAction(json({ action: "REASSIGN", organizationId: "club-2" }), teamContext);
    expect(response.status).toBe(200);
    expect(mocks.resolvePendingTeam).toHaveBeenCalledWith("event-1", "sub-1", "staff-1", { action: "REASSIGN", organizationId: "club-2" });
    await postTeamAction(json({ action: "REJECT", reason: "Not a club of this conference." }), teamContext);
    expect(mocks.resolvePendingTeam).toHaveBeenLastCalledWith("event-1", "sub-1", "staff-1", { action: "REJECT", reason: "Not a club of this conference." });
  });

  it("refuses an unknown action, extra fields and an over-long reason before the repository", async () => {
    for (const body of [{ action: "DELETE" }, { action: "CONFIRM" }, { action: "CONFIRM", organizationId: "club-1", extra: 1 }, { action: "REJECT", reason: "x".repeat(501) }]) {
      await postTeamAction(json(body), teamContext);
    }
    expect(mocks.resolvePendingTeam).not.toHaveBeenCalled();
    expect(mocks.clubRegistrationApiError).toHaveBeenCalledTimes(4);
  });
});

describe("the link's setting route", () => {
  it("needs CONFIGURE_EVENT to read or change it", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("You do not have access to this event."));
    expect((await getSetting(new Request("https://events.imsda.test/api/x"), eventContext)).status).toBe(403);
    expect((await putSetting(json({ enabled: true }), eventContext)).status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "CONFIGURE_EVENT", mocks.findActiveMembership);
    expect(mocks.setGeneralRegistrationLink).not.toHaveBeenCalled();
  });

  it("changes only the on/off flag, for the signed-in staff member", async () => {
    expect((await putSetting(json({ enabled: false }), eventContext)).status).toBe(200);
    expect(mocks.setGeneralRegistrationLink).toHaveBeenCalledWith("event-1", false, "staff-1");
    mocks.setGeneralRegistrationLink.mockClear();
    await putSetting(json({ enabled: true, slug: "other" }), eventContext);
    await putSetting(json({ enabled: "yes" }), eventContext);
    expect(mocks.setGeneralRegistrationLink).not.toHaveBeenCalled();
  });
});

describe("the portal's roster-link route", () => {
  it("needs roster access for the club, and the same origin", async () => {
    mocks.requireRosterAccess.mockRejectedValue(new Error("no access"));
    await postRosterLink(json({ attendeeId: "att-1", rosterMemberId: "member-1" }), rosterContext);
    expect(mocks.requireRosterAccess).toHaveBeenCalledWith("club-1", expect.any(Date), "registerForEvents");
    expect(mocks.linkExtraPersonToRoster).not.toHaveBeenCalled();
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    mocks.requireRosterAccess.mockClear();
    expect((await postRosterLink(json({ attendeeId: "att-1", rosterMemberId: null }), rosterContext)).status).toBe(403);
    expect(mocks.requireRosterAccess).not.toHaveBeenCalled();
  });

  it("links or unlinks only the club's own extra person, naming nothing but ids", async () => {
    const response = await postRosterLink(json({ attendeeId: "att-1", rosterMemberId: "member-1" }), rosterContext);
    expect(response.status).toBe(200);
    expect(mocks.linkExtraPersonToRoster).toHaveBeenCalledWith({ organizationId: "club-1", eventId: "event-1", attendeeId: "att-1", rosterMemberId: "member-1", actor: { accountId: "acct-1" } });
    await postRosterLink(json({ attendeeId: "att-1", rosterMemberId: null }), rosterContext);
    expect(mocks.linkExtraPersonToRoster).toHaveBeenLastCalledWith(expect.objectContaining({ rosterMemberId: null }));
    mocks.linkExtraPersonToRoster.mockClear();
    await postRosterLink(json({ attendeeId: "att-1", rosterMemberId: "member-1", firstName: "Nope" }), rosterContext);
    expect(mocks.linkExtraPersonToRoster).not.toHaveBeenCalled();
  });
});

describe("a team received on an older PBE form, attached under the current one (#1044)", () => {
  it("drops answers to questions the current form no longer asks, and keeps the rest", () => {
    const kept = withoutRetiredAnswers(pbe, { first_name: "Ann", attendee_age: 14, attendee_type: "Coach", alternate: true });
    expect(kept).toEqual({ first_name: "Ann", attendee_age: 14, alternate: true });
    expect(withoutRetiredAnswers(pbe, { club_name: "Synthetic Club", photo_video_release: "Yes", director_confirmation: true }))
      .toEqual({ club_name: "Synthetic Club", director_confirmation: true });
  });

  it("names the problem when the waiting team has more people than the form's maximum of 7", () => {
    expect(rosterOverMaximumMessage(pbe, 7)).toBeNull();
    const message = rosterOverMaximumMessage(pbe, 9)!;
    expect(message).toContain("9 people");
    expect(message).toContain("at most 7");
    expect(message).toMatch(/older form/);
  });
});

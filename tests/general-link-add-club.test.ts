import { beforeEach, describe, expect, it, vi } from "vitest";
import { formTemplates, registrationFormDefinitionSchema } from "@/modules/forms/definition";
import {
  GENERAL_LINK_NOT_LISTED_HELP,
  generalLinkClubFieldKey,
  generalLinkClubOtherKey,
  generalLinkDisplayDefinition,
} from "@/modules/general-link-registrations/domain";
import { addClubBlock, clubNameKey, shownMatches, similarClubMatches, type SimilarClubCandidate } from "@/modules/organizations/similar-clubs";

const pbe = registrationFormDefinitionSchema.parse(formTemplates.find((template) => template.key === "pbe_registration")!.definition);

// ---------------------------------------------------------------------------------------------
// The seeded PBE template offers "Not listed" with a typed name; the public form says what to do
// ---------------------------------------------------------------------------------------------

describe("the PBE form offers a club that is not listed (#1031)", () => {
  it("has the club menu with a typed 'Not listed' name field shown only for that choice", () => {
    const clubKey = generalLinkClubFieldKey(pbe)!;
    expect(clubKey).toBe("club_name");
    const club = pbe.sections.flatMap((section) => section.fields).find((field) => field.key === clubKey)!;
    expect(club.optionSource).toBe("CLUBS_DIRECTORY");
    const otherKey = generalLinkClubOtherKey(pbe, clubKey);
    expect(otherKey).toBe("club_name_other");
    const other = pbe.sections.flatMap((section) => section.fields).find((field) => field.key === otherKey)!;
    expect(other.type).toBe("TEXT");
    expect(other.required).toBe(true);
    expect(other.conditional).toEqual({ fieldKey: "club_name", operator: "EQUALS", value: "Not listed" });
  });

  it("says under the club menu what to do when the club is not listed", () => {
    const shown = generalLinkDisplayDefinition(pbe);
    const club = shown.sections.flatMap((section) => section.fields).find((field) => field.key === "club_name")!;
    expect(club.helpText).toBe(GENERAL_LINK_NOT_LISTED_HELP);
    expect(GENERAL_LINK_NOT_LISTED_HELP).toBe("Club not listed? Choose 'Not listed' and type your club's name. We'll add it.");
    // Nothing else changes, and the stored form is untouched.
    expect(shown.sections.flatMap((section) => section.fields).filter((field) => field.helpText === GENERAL_LINK_NOT_LISTED_HELP)).toHaveLength(1);
    expect(pbe.sections.flatMap((section) => section.fields).find((field) => field.key === "club_name")!.helpText).toBe("");
  });

  it("makes no promise on a form that has no 'Not listed' name field, and keeps a help line the form already words", () => {
    const withoutOther = {
      ...pbe,
      sections: pbe.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => field.key !== "club_name_other") })),
    };
    expect(generalLinkDisplayDefinition(withoutOther)).toBe(withoutOther);
    const worded = {
      ...pbe,
      sections: pbe.sections.map((section) => ({ ...section, fields: section.fields.map((field) => (field.key === "club_name" ? { ...field, helpText: "Pick yours." } : field)) })),
    };
    expect(generalLinkDisplayDefinition(worded).sections.flatMap((section) => section.fields).find((field) => field.key === "club_name")!.helpText).toBe("Pick yours.");
  });
});

// ---------------------------------------------------------------------------------------------
// Near-duplicate suggestions
// ---------------------------------------------------------------------------------------------

const club = (id: string, name: string, sponsorId: string | null, city: string | null = null, state: string | null = "XX", isActive = true): SimilarClubCandidate => ({
  id, name, isActive, sponsorId, sponsorName: sponsorId ? `Church ${sponsorId}` : null, city, state,
});

describe("close-name matches from the directory", () => {
  const directory = [
    club("c1", "Albia Pathfinders", "ch1", "Albia"),
    club("c2", "Albia SDA Pathfinder Club", "ch2", "Albia"),
    club("c3", "Riverside Trailblazers", "ch3", "Rivertown"),
    club("c4", "Alba Pathfinders", "ch4", "Elsewhere"),
    club("c5", "Zion Eagles", "ch5", "Zion"),
  ];

  it("ignores the words every club name shares when comparing", () => {
    expect(clubNameKey("Albia SDA Pathfinder Club")).toBe("albia");
    expect(clubNameKey("  The  ALBIA   Pathfinders ")).toBe("albia");
  });

  it("finds the same and similar names, the same church and town first", () => {
    const matches = similarClubMatches("Albia Pathfinder Club", { sponsorId: "ch1", city: "Albia", state: "XX" }, directory);
    expect(matches.map((match) => match.id)).toEqual(["c1", "c2", "c4"]);
    expect(matches[0]).toMatchObject({ kind: "SIMILAR_NAME", sameSponsor: true, sameArea: true });
    expect(matches[1]).toMatchObject({ sameSponsor: false, sameArea: true });
    expect(matches[2]).toMatchObject({ sameSponsor: false, sameArea: false });
  });

  it("calls an identical name the same name, whatever its spacing and case", () => {
    const [match] = similarClubMatches("  albia   PATHFINDERS", { sponsorId: null, city: null, state: null }, directory);
    expect(match).toMatchObject({ id: "c1", kind: "SAME_NAME" });
  });

  it("finds nothing for a name nothing is close to, and at most eight", () => {
    expect(similarClubMatches("Brand New Voyagers", { sponsorId: "ch9", city: null, state: null }, directory)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, index) => club(`m${index}`, `Albia Pathfinders ${index % 2 ? "Club" : ""}`.trim(), `ch${index}`));
    expect(shownMatches(similarClubMatches("Albia Pathfinders", { sponsorId: null, city: null, state: null }, many))).toHaveLength(8);
  });

  it("never allows the same name twice, at any church, even when staff have checked the similar ones", () => {
    const sameChurch = similarClubMatches("Albia Pathfinders", { sponsorId: "ch1", city: null, state: null }, directory);
    expect(addClubBlock(sameChurch, true)?.code).toBe("CLUB_EXISTS");
    const otherChurch = similarClubMatches("Albia Pathfinders", { sponsorId: "ch9", city: null, state: null }, directory);
    expect(otherChurch[0]).toMatchObject({ id: "c1", kind: "SAME_NAME", sameSponsor: false });
    const block = addClubBlock(otherChurch, true);
    expect(block?.code).toBe("CLUB_EXISTS");
    expect(block?.message).toMatch(/name that tells the two apart/);
    // An inactive club of that name is not in the club menu, so it is a warning, not a wall.
    const inactive = [club("x1", "Albia Pathfinders", "ch1", "Albia", "XX", false)];
    expect(addClubBlock(similarClubMatches("Albia Pathfinders", { sponsorId: "ch9", city: null, state: null }, inactive), true)).toBeNull();
    expect(addClubBlock(similarClubMatches("Albia Pathfinders", { sponsorId: "ch9", city: null, state: null }, inactive), false)?.code).toBe("SIMILAR_CLUBS");
  });

  it("still refuses an exact-name club elsewhere when nine or more clubs of the church and town rank above it", () => {
    const crowded = Array.from({ length: 10 }, (_, index) => club(`s${index}`, `Crowded Church Club ${index}`, "chX", "Albia"));
    const twin = club("twin", "Voyagers of Albia", "chFar", "Faraway");
    const matches = similarClubMatches("Voyagers of Albia", { sponsorId: "chX", city: "Albia", state: "XX" }, [...crowded, twin]);
    expect(matches).toHaveLength(11);
    expect(matches[0]).toMatchObject({ id: "twin", kind: "SAME_NAME" });
    expect(addClubBlock(matches, true)?.code).toBe("CLUB_EXISTS");
    // What is shown is cut, but the exact-name club is among it, and a block is never decided on the cut list.
    expect(shownMatches(matches)).toHaveLength(8);
    expect(shownMatches(matches).map((match) => match.id)).toContain("twin");
    // Even if it ranked low, the full list still blocks.
    expect(addClubBlock([...matches.slice(1), matches[0]!], true)?.code).toBe("CLUB_EXISTS");
  });

  it("wants a word that similar ones were checked", () => {
    const similar = similarClubMatches("Albia Pathfinder Club", { sponsorId: "ch9", city: null, state: null }, directory);
    expect(addClubBlock(similar, false)?.code).toBe("SIMILAR_CLUBS");
    expect(addClubBlock(similar, true)).toBeNull();
    expect(addClubBlock([], false)).toBeNull();
  });

  it("always lists the chosen church's clubs, whatever the name, active or not", () => {
    const churchClubs = [club("k1", "Eagle Ridge", "ch7", "Zion"), club("k2", "Old Guard", "ch7", "Zion", "XX", false), club("k3", "Elsewhere Club", "ch8")];
    const matches = similarClubMatches("Brand New Voyagers", { sponsorId: "ch7", city: "Zion", state: "XX" }, churchClubs);
    expect(matches.map((match) => match.id)).toEqual(["k1", "k2"]);
    expect(matches[1]).toMatchObject({ isActive: false, kind: "SIMILAR_NAME", sameSponsor: true });
    // A name of nothing but filler words matches no one by name, but still meets the church's own clubs.
    expect(clubNameKey("Pathfinder Club")).toBe("");
    expect(similarClubMatches("Pathfinder Club", { sponsorId: "ch7", city: null, state: null }, churchClubs).map((match) => match.id)).toEqual(["k1", "k2"]);
    expect(similarClubMatches("Pathfinder Club", { sponsorId: null, city: null, state: null }, churchClubs)).toEqual([]);
    expect(addClubBlock(matches, false)?.code).toBe("SIMILAR_CLUBS");
  });

  it("writes Mt/Mount, St/Saint and 1st/First one way", () => {
    expect(clubNameKey("Mt. Pleasant Pathfinders")).toBe(clubNameKey("Mount Pleasant SDA Club"));
    expect(clubNameKey("St Paul Club")).toBe(clubNameKey("Saint Paul"));
    expect(clubNameKey("1st Church Eagles")).toBe(clubNameKey("First Eagles"));
    const [match] = similarClubMatches("Mt Pleasant", { sponsorId: "ch9", city: null, state: null }, [club("m1", "Mount Pleasant Pathfinders", "ch1")]);
    expect(match).toMatchObject({ id: "m1", kind: "SIMILAR_NAME" });
  });
});

// ---------------------------------------------------------------------------------------------
// The staff route: who may add a club
// ---------------------------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  class AccessDeniedError extends Error {
    constructor(message: string, public readonly status = 403, public readonly code = "PERMISSION_DENIED") {
      super(message);
    }
  }
  return {
    AccessDeniedError,
    requirePermission: vi.fn(),
    getCurrentSession: vi.fn(),
    rejectCrossOriginRequest: vi.fn(),
    findActiveMembership: vi.fn(),
    resolvePendingTeam: vi.fn(),
    similarClubsFor: vi.fn(),
  };
});

vi.mock("@/modules/access/authorization", () => ({ AccessDeniedError: mocks.AccessDeniedError, requirePermission: mocks.requirePermission }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/general-link-registrations/api-errors", () => ({
  generalLinkApiError: (error: unknown) => (error instanceof mocks.AccessDeniedError
    ? Response.json({ error: error.code, message: error.message }, { status: error.status })
    : Response.json({ error: "MAPPED", message: String(error) }, { status: 422 })),
}));
vi.mock("@/modules/general-link-registrations/repository", () => ({
  resolvePendingTeam: mocks.resolvePendingTeam,
  similarClubsFor: mocks.similarClubsFor,
}));

import { POST as postTeamAction } from "@/app/api/events/[eventId]/general-link/teams/[submissionId]/route";
import { POST as postSimilar } from "@/app/api/events/[eventId]/general-link/teams/[submissionId]/similar-clubs/route";

const context = { params: Promise.resolve({ eventId: "event-1", submissionId: "sub-1" }) };
const json = (body: unknown) => new Request("https://events.imsda.test/api/x", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const addClub = { action: "ADD_CLUB", clubName: "Synthetic Trailblazers", sponsoringChurchId: "church-1", acknowledgeSimilar: false };

describe("POST .../teams/[submissionId] with ADD_CLUB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1" } });
    mocks.resolvePendingTeam.mockResolvedValue({ status: "CONFIRMED", alreadyDone: false, registrationId: "reg-1", clubName: "Synthetic Trailblazers" });
    mocks.similarClubsFor.mockResolvedValue([]);
  });

  it("is denied to registration staff who are not system administrators, before anything runs", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1", globalRole: null } });
    const response = await postTeamAction(json(addClub), context);
    expect(response.status).toBe(403);
    expect(mocks.resolvePendingTeam).not.toHaveBeenCalled();
  });

  it("is denied without the permission to confirm pending teams", async () => {
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("You do not have access to this event."));
    expect((await postTeamAction(json(addClub), context)).status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_REGISTRATION", mocks.findActiveMembership);
    expect(mocks.resolvePendingTeam).not.toHaveBeenCalled();
  });

  it("runs for a system administrator with the staff member and the typed club", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const response = await postTeamAction(json(addClub), context);
    expect(response.status).toBe(200);
    expect(mocks.resolvePendingTeam).toHaveBeenCalledWith("event-1", "sub-1", "admin-1", addClub);
  });

  it("still lets registration staff confirm, reassign and reject as before", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1", globalRole: null } });
    expect((await postTeamAction(json({ action: "CONFIRM", organizationId: "club-1" }), context)).status).toBe(200);
    expect(mocks.resolvePendingTeam).toHaveBeenCalledWith("event-1", "sub-1", "staff-1", { action: "CONFIRM", organizationId: "club-1" });
  });

  it("refuses extra fields and a missing church before the repository", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    for (const body of [{ ...addClub, extra: 1 }, { action: "ADD_CLUB", clubName: "X Club" }, { ...addClub, sponsoringChurchId: "" }, { ...addClub, clubName: "x".repeat(201) }]) {
      expect((await postTeamAction(json(body), context)).status).toBe(422);
    }
    expect(mocks.resolvePendingTeam).not.toHaveBeenCalled();
  });
});

describe("POST .../teams/[submissionId]/similar-clubs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectCrossOriginRequest.mockReturnValue(null);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.similarClubsFor.mockResolvedValue([{ id: "c1", name: "Synthetic Club" }]);
  });

  it("answers the matches to a system administrator who may confirm teams", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const response = await postSimilar(json({ clubName: "Synthetic Clubb", sponsoringChurchId: "church-1" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matches: [{ id: "c1", name: "Synthetic Club" }] });
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "event-1", "MANAGE_REGISTRATION", mocks.findActiveMembership);
    expect(mocks.similarClubsFor).toHaveBeenCalledWith("event-1", "sub-1", { clubName: "Synthetic Clubb", sponsoringChurchId: "church-1" });
  });

  it("is denied to registration staff who are not system administrators, and without the permission", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1", globalRole: null } });
    expect((await postSimilar(json({ clubName: "Synthetic Club" }), context)).status).toBe(403);
    mocks.requirePermission.mockRejectedValue(new mocks.AccessDeniedError("You do not have access to this event."));
    expect((await postSimilar(json({ clubName: "Synthetic Club" }), context)).status).toBe(403);
    expect(mocks.similarClubsFor).not.toHaveBeenCalled();
  });
});

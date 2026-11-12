import { describe, expect, it } from "vitest";
import { attendeeReturnDestination, attendeeSignInPathFor } from "@/modules/attendee-accounts/return-destination";
import { planResolution, resolveByRule, sourceLabel } from "@/modules/billing-responsibility/domain";
import { APPLICATION_VIEWS, applicationsHref, parseApplicationView } from "@/modules/club-applications/queue-model";
import {
  VISITING_SCREENING_CONFIRMATION,
  visitingClubDecisionSchema,
  visitingClubInvitePath,
  visitingClubRequestInputSchema,
  visitingClubInviteInputSchema,
  visitingInviteState,
  visitingRequestHref,
} from "@/modules/visiting-clubs/domain";

/**
 * #835: the pure rules of visiting clubs. Validation of what staff and the director send, the link's states, the
 * billing rule for a guest club, and that the link's page can be reached through sign-in. Synthetic data only.
 */

const valid = {
  clubName: "Synthetic Out-of-State Eagles",
  clubType: "PATHFINDER",
  homeConference: "Synthetic Conference",
  homeChurch: "Synthetic Home Church",
  directorPhone: "(515) 555-0100",
  screeningConfirmed: true,
};

describe("what the visiting director sends", () => {
  it("accepts a complete request and stores the phone normalised", () => {
    const parsed = visitingClubRequestInputSchema.parse(valid);
    expect(parsed.clubName).toBe("Synthetic Out-of-State Eagles");
    expect(parsed.directorPhone).toMatch(/555/);
  });

  it("requires the screening confirmation: unticked, missing or not literally true is refused", () => {
    for (const screeningConfirmed of [false, undefined, "true", 1]) {
      expect(visitingClubRequestInputSchema.safeParse({ ...valid, screeningConfirmed }).success).toBe(false);
    }
    expect(VISITING_SCREENING_CONFIRMATION).toMatch(/own conference/);
    expect(VISITING_SCREENING_CONFIRMATION).not.toMatch(/Sterling/i);
  });

  it("requires every field and a valid phone", () => {
    for (const key of ["clubName", "homeConference", "homeChurch", "directorPhone", "clubType"]) {
      const { [key]: _omitted, ...rest } = valid as Record<string, unknown>;
      void _omitted;
      expect(visitingClubRequestInputSchema.safeParse(rest).success, key).toBe(false);
    }
    for (const directorPhone of ["", "   ", "(555) 010-0100", "5550100", "not a phone"]) {
      expect(visitingClubRequestInputSchema.safeParse({ ...valid, directorPhone }).success, directorPhone).toBe(false);
    }
  });

  it("allows both club types and nothing else", () => {
    expect(visitingClubRequestInputSchema.safeParse({ ...valid, clubType: "ADVENTURER" }).success).toBe(true);
    expect(visitingClubRequestInputSchema.safeParse({ ...valid, clubType: "TEEN" }).success).toBe(false);
  });

  it("refuses fields it doesn't know, so an event or an email can never come from the form", () => {
    expect(visitingClubRequestInputSchema.safeParse({ ...valid, eventId: "event-2" }).success).toBe(false);
    expect(visitingClubRequestInputSchema.safeParse({ ...valid, directorEmail: "other@example.test" }).success).toBe(false);
  });
});

describe("what staff send", () => {
  it("takes an event, an address and an optional name", () => {
    expect(visitingClubInviteInputSchema.parse({ eventId: "event-1", email: " Vera@Example.test " })).toEqual({ eventId: "event-1", email: "vera@example.test", name: "" });
    expect(visitingClubInviteInputSchema.safeParse({ eventId: "", email: "vera@example.test" }).success).toBe(false);
    expect(visitingClubInviteInputSchema.safeParse({ eventId: "event-1", email: "not an email" }).success).toBe(false);
    expect(visitingClubInviteInputSchema.safeParse({ eventId: "event-1", email: "" }).success).toBe(false);
  });

  it("decides with approve, or decline with an optional reason of at most 500 characters", () => {
    expect(visitingClubDecisionSchema.parse({ decision: "approve" })).toEqual({ decision: "approve" });
    expect(visitingClubDecisionSchema.parse({ decision: "decline" })).toEqual({ decision: "decline" });
    expect(visitingClubDecisionSchema.safeParse({ decision: "decline", declineReason: "x".repeat(501) }).success).toBe(false);
    expect(visitingClubDecisionSchema.safeParse({ decision: "approve", declineReason: "no" }).success).toBe(false);
    expect(visitingClubDecisionSchema.safeParse({ decision: "maybe" }).success).toBe(false);
  });
});

describe("a link's state", () => {
  const now = new Date("2027-02-01T12:00:00Z");
  const future = new Date("2027-03-01T12:00:00Z");
  const past = new Date("2027-01-01T12:00:00Z");

  it("is open, used, cancelled or expired, and a used link stays used after its expiry", () => {
    expect(visitingInviteState({ usedAt: null, cancelledAt: null, expiresAt: future }, now)).toBe("OPEN");
    expect(visitingInviteState({ usedAt: null, cancelledAt: null, expiresAt: past }, now)).toBe("EXPIRED");
    expect(visitingInviteState({ usedAt: null, cancelledAt: past, expiresAt: future }, now)).toBe("CANCELLED");
    expect(visitingInviteState({ usedAt: past, cancelledAt: null, expiresAt: past }, now)).toBe("USED");
    expect(visitingInviteState({ usedAt: null, cancelledAt: null, expiresAt: now }, now)).toBe("EXPIRED");
  });
});

describe("the staff page's addresses", () => {
  it("has a fourth view, visiting, in the address", () => {
    expect(APPLICATION_VIEWS).toContain("visiting");
    expect(parseApplicationView("visiting")).toBe("visiting");
    expect(applicationsHref("visiting")).toBe("/admin/clubs/applications?status=visiting");
    expect(visitingRequestHref("req 1")).toBe("/admin/clubs/applications?visiting=req%201");
  });
});

describe("the link's page can be reached through sign-in (#835)", () => {
  it("sits under /account, so it is a safe place to return to", () => {
    const path = visitingClubInvitePath("abc_DEF-123");
    expect(path).toBe("/account/visiting-club/abc_DEF-123");
    expect(attendeeReturnDestination(path, "/account")).toBe(path);
    expect(attendeeSignInPathFor(path)).toBe(`/account/sign-in?next=${encodeURIComponent(path)}`);
  });

  it("still refuses a path that climbs out of /account", () => {
    expect(attendeeReturnDestination("/account/visiting-club/../../admin", "/account")).toBe("/account");
  });
});

describe("billing a visiting guest club (#835)", () => {
  it("bills the club to itself, with its own source, whatever its sponsor field says", () => {
    expect(resolveByRule({ club: { organizationId: "guest-club", parentOrganizationId: null, guestEventId: "event-1" }, groupBillingPersonId: null })).toEqual({
      kind: "ORGANIZATION", organizationId: "guest-club", personId: null, source: "VISITING_CLUB",
    });
    expect(resolveByRule({ club: { organizationId: "guest-club", parentOrganizationId: "church-1", guestEventId: "event-1" }, groupBillingPersonId: null })).toMatchObject({
      organizationId: "guest-club", source: "VISITING_CLUB",
    });
    expect(sourceLabel("VISITING_CLUB")).toBe("Visiting club (billed to itself)");
  });

  it("leaves a conference club on its sponsoring church, with or without the field", () => {
    for (const guestEventId of [undefined, null]) {
      expect(resolveByRule({ club: { organizationId: "club-1", parentOrganizationId: "church-1", guestEventId }, groupBillingPersonId: null })).toEqual({
        kind: "ORGANIZATION", organizationId: "church-1", personId: null, source: "CLUB_SPONSORING_CHURCH",
      });
    }
  });

  it("is stable on a second pass, and a staff decision still outranks it", () => {
    const rule = resolveByRule({ club: { organizationId: "guest-club", parentOrganizationId: null, guestEventId: "event-1" }, groupBillingPersonId: null });
    expect(planResolution(rule, rule)).toEqual({ action: "UNCHANGED" });
    expect(planResolution({ ...rule, organizationId: "church-9", source: "STAFF_OVERRIDE" }, rule)).toEqual({ action: "KEEP_STAFF_DECISION" });
  });
});

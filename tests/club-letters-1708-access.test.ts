import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can use fill-in letters (#1708): director, deputy, registrar, reporter, another club's director, an Area
 * Coordinator and staff (with and without an act-as), through the real club access check. Only sign-in, directory,
 * feature and repository lookups are mocked. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  currentStaffActingContext: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  passkeysConfigured: vi.fn(),
  prisma: {
    attendeeMfaEnrollment: { findUnique: vi.fn() },
    attendeePasskey: { count: vi.fn() },
    attendeeSession: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  isClubFeatureEnabled: vi.fn(),
  createClubLetter: vi.fn(),
  deleteClubLetter: vi.fn(),
  loadClubLetters: vi.fn(),
  loadClubLetterSheets: vi.fn(),
  updateClubLetter: vi.fn(),
  rateLimit: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.passkeysConfigured }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: vi.fn(async () => "/account/two-step") }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/rate-limit/service", () => ({ checkClubLettersRateLimit: mocks.rateLimit }));
vi.mock("@/modules/club-features/repository", () => ({ isClubFeatureEnabled: mocks.isClubFeatureEnabled }));
vi.mock("@/modules/club-rosters/home-view", () => ({ yearLabel: (year: string) => year }));
vi.mock("@/modules/club-letters/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-letters/repository")>("@/modules/club-letters/repository");
  return {
    ...actual,
    createClubLetter: mocks.createClubLetter,
    deleteClubLetter: mocks.deleteClubLetter,
    loadClubLetters: mocks.loadClubLetters,
    loadClubLetterSheets: mocks.loadClubLetterSheets,
    updateClubLetter: mocks.updateClubLetter,
  };
});

import ClubLettersPage, { metadata } from "@/app/(public)/account/(portal)/clubs/[organizationId]/letters/page";
import { POST } from "@/app/api/attendee/clubs/[organizationId]/letters/route";
import PrintPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/letters/[templateId]/print/page";
import { DELETE, PATCH } from "@/app/api/attendee/clubs/[organizationId]/letters/[templateId]/route";

type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const params = { params: Promise.resolve({ organizationId: "club-1" }) };
const templateParams = { params: Promise.resolve({ organizationId: "club-1", templateId: "letter-1" }) };
const url = "https://events.imsda.test/api/attendee/clubs/club-1/letters";
const post = (body: unknown) => new Request(url, {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const del = () => new Request(`${url}/letter-1`, { method: "DELETE", headers: { origin: "https://events.imsda.test" } });
const goodBody = { kind: "LETTER", title: "Welcome", body: "Dear {first_name}," };
const list = { clubYear: "2026-27", letters: [], people: [] };
const patch = (body: unknown) => new Request(`${url}/letter-1`, {
  method: "PATCH",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

function signedInAs(role: Role | null, clubId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue(role ? [{ organizationId: clubId, name: "Test Pathfinders", role, sponsoringChurch: null }] : []);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.prisma.attendeeMfaEnrollment.findUnique.mockResolvedValue({ status: "ACTIVE" });
  mocks.prisma.attendeePasskey.count.mockResolvedValue(0);
  mocks.prisma.attendeeSession.findUnique.mockResolvedValue({ secondFactorVerifiedAt: new Date() });
}

function actingAsDirector(organizationId = "club-1", extra: Record<string, unknown> = {}) {
  mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId, userId: "staff-1", staffSessionId: "s", actAsId: "act-1", ...extra });
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.passkeysConfigured.mockResolvedValue(false);
  mocks.isClubFeatureEnabled.mockResolvedValue(true);
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.createClubLetter.mockResolvedValue({ id: "letter-1" });
  mocks.deleteClubLetter.mockResolvedValue(undefined);
  mocks.updateClubLetter.mockResolvedValue({ id: "letter-1" });
  mocks.loadClubLetterSheets.mockImplementation(async (_id: string, capabilities: { editProfile: boolean }, templateId: string) => (capabilities.editProfile && templateId === "letter-1" ? { kind: "LETTER", title: "Welcome", sheets: [{ personId: "p1", name: "Ann Example", text: "Dear Ann," }] } : null));
  mocks.loadClubLetters.mockImplementation(async (_id: string, capabilities: { editProfile: boolean }) => (capabilities.editProfile ? list : null));
});

describe("adding a template (POST)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s save one, attributed to their own account", async (role) => {
    signedInAs(role);
    const response = await POST(post(goodBody), params);
    expect(response.status).toBe(201);
    expect(mocks.createClubLetter).toHaveBeenCalledTimes(1);
    expect(mocks.createClubLetter.mock.calls[0]![0]).toBe("club-1");
    expect(mocks.createClubLetter.mock.calls[0]![1]).toMatchObject({ kind: "LETTER", title: "Welcome", body: "Dear {first_name}," });
    expect(mocks.createClubLetter.mock.calls[0]![2]).toEqual({ accountId: "account-1" });
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s with 403 and writes nothing", async (role) => {
    signedInAs(role);
    expect((await POST(post(goodBody), params)).status).toBe(403);
    expect(mocks.createClubLetter).not.toHaveBeenCalled();
  });

  it("answers 404 to another club's director, and to an Area Coordinator with no grant here", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await POST(post(goodBody), params)).status).toBe(404);
    signedInAs(null);
    expect((await POST(post(goodBody), params)).status).toBe(404);
    expect(mocks.createClubLetter).not.toHaveBeenCalled();
  });

  it("answers 401 to staff with no act-as, and to staff acting as another club's director", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await POST(post(goodBody), params)).status).toBe(401);
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-2", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    expect((await POST(post(goodBody), params)).status).toBe(401);
    expect(mocks.createClubLetter).not.toHaveBeenCalled();
  });

  it("saves for staff acting as this club's director by user and act-as, and a Clubs Administrator as one", async () => {
    actingAsDirector();
    expect((await POST(post(goodBody), params)).status).toBe(201);
    expect(mocks.createClubLetter.mock.calls[0]![2]).toEqual({ userId: "staff-1", actAsId: "act-1" });
    actingAsDirector("club-1", { viaClubsAdministrator: true });
    expect((await POST(post(goodBody), params)).status).toBe(201);
    expect(mocks.createClubLetter.mock.calls[1]![2]).toEqual({ userId: "staff-1", actAsId: "act-1", viaClubsAdministrator: true });
  });

  it("answers 404 and writes nothing while the club has not switched the feature on", async () => {
    signedInAs("DIRECTOR");
    mocks.isClubFeatureEnabled.mockResolvedValue(false);
    const response = await POST(post(goodBody), params);
    expect(response.status).toBe(404);
    expect(mocks.isClubFeatureEnabled).toHaveBeenCalledWith("club-1", "fill-in-letters");
    expect(mocks.createClubLetter).not.toHaveBeenCalled();
  });

  it("answers 409 when the club already has 50 templates", async () => {
    signedInAs("DIRECTOR");
    const { ClubLetterError } = await import("@/modules/club-letters/repository");
    mocks.createClubLetter.mockRejectedValue(new ClubLetterError("LIMIT_REACHED", "A club can keep at most 50 letters and certificates."));
    const response = await POST(post(goodBody), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("LIMIT_REACHED");
  });

  it.each([
    ["an unknown placeholder", { ...goodBody, body: "Born {birth_date}" }],
    ["an empty title", { ...goodBody, title: "" }],
    ["an empty body", { ...goodBody, body: "  " }],
    ["a body over 10,000 characters", { ...goodBody, body: "x".repeat(10_001) }],
    ["an unknown kind", { ...goodBody, kind: "EMAIL" }],
    ["a recipients list (nothing is sent)", { ...goodBody, recipients: ["a@example.test"] }],
    ["no body", {}],
  ])("answers 400 for %s and writes nothing", async (_name, body) => {
    signedInAs("DIRECTOR");
    expect((await POST(post(body), params)).status).toBe(400);
    expect(mocks.createClubLetter).not.toHaveBeenCalled();
  });

  it("answers 429 when rate limited, before writing", async () => {
    signedInAs("DIRECTOR");
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    expect((await POST(post(goodBody), params)).status).toBe(429);
    expect(mocks.createClubLetter).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before any check", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response(null, { status: 403 }));
    expect((await POST(post(goodBody), params)).status).toBe(403);
    expect(mocks.currentStaffActingContext).not.toHaveBeenCalled();
  });
});

describe("removing a template (DELETE)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s delete one", async (role) => {
    signedInAs(role);
    expect((await DELETE(del(), templateParams)).status).toBe(200);
    expect(mocks.deleteClubLetter).toHaveBeenCalledWith("club-1", "letter-1", { accountId: "account-1" });
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s", async (role) => {
    signedInAs(role);
    expect((await DELETE(del(), templateParams)).status).toBe(403);
    expect(mocks.deleteClubLetter).not.toHaveBeenCalled();
  });

  it("answers 404 to another club's director, an Area Coordinator, and when the feature is off", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await DELETE(del(), templateParams)).status).toBe(404);
    signedInAs(null);
    expect((await DELETE(del(), templateParams)).status).toBe(404);
    signedInAs("DIRECTOR");
    mocks.isClubFeatureEnabled.mockResolvedValue(false);
    expect((await DELETE(del(), templateParams)).status).toBe(404);
    expect(mocks.deleteClubLetter).not.toHaveBeenCalled();
  });

  it("answers 404 for a template the club does not hold", async () => {
    signedInAs("DIRECTOR");
    const { ClubLetterError } = await import("@/modules/club-letters/repository");
    mocks.deleteClubLetter.mockRejectedValue(new ClubLetterError("LETTER_NOT_FOUND", "That letter could not be found."));
    expect((await DELETE(del(), templateParams)).status).toBe(404);
  });

  it("works for staff acting as this club's director and refuses without an act-as", async () => {
    actingAsDirector();
    expect((await DELETE(del(), templateParams)).status).toBe(200);
    expect(mocks.deleteClubLetter).toHaveBeenCalledWith("club-1", "letter-1", { userId: "staff-1", actAsId: "act-1" });
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await DELETE(del(), templateParams)).status).toBe(401);
  });
});

describe("changing a template (PATCH)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s change one, attributed to their account", async (role) => {
    signedInAs(role);
    expect((await PATCH(patch(goodBody), templateParams)).status).toBe(200);
    expect(mocks.updateClubLetter).toHaveBeenCalledWith("club-1", "letter-1", expect.objectContaining({ title: "Welcome" }), { accountId: "account-1" });
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s with 403", async (role) => {
    signedInAs(role);
    expect((await PATCH(patch(goodBody), templateParams)).status).toBe(403);
    expect(mocks.updateClubLetter).not.toHaveBeenCalled();
  });

  it("answers 404 to another club's director, an Area Coordinator and a feature that is off; 401 to staff with no act-as", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await PATCH(patch(goodBody), templateParams)).status).toBe(404);
    signedInAs(null);
    expect((await PATCH(patch(goodBody), templateParams)).status).toBe(404);
    signedInAs("DIRECTOR");
    mocks.isClubFeatureEnabled.mockResolvedValue(false);
    expect((await PATCH(patch(goodBody), templateParams)).status).toBe(404);
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await PATCH(patch(goodBody), templateParams)).status).toBe(401);
    expect(mocks.updateClubLetter).not.toHaveBeenCalled();
  });

  it("works for staff acting as this club's director, and answers 400 for an unknown placeholder", async () => {
    actingAsDirector();
    expect((await PATCH(patch(goodBody), templateParams)).status).toBe(200);
    expect(mocks.updateClubLetter.mock.calls[0]![3]).toEqual({ userId: "staff-1", actAsId: "act-1" });
    expect((await PATCH(patch({ ...goodBody, body: "{nope}" }), templateParams)).status).toBe(400);
  });
});

function flat(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) { for (const child of node) flat(child, found); return found; }
  if (!isValidElement<Record<string, unknown>>(node)) return found;
  found.push(node);
  flat(node.props.children as ReactNode, found);
  return found;
}

describe("the letters page", () => {
  it("is named Letters and certificates", () => {
    expect(metadata.title).toBe("Letters and certificates");
  });

  it.each(["DIRECTOR", "DEPUTY"] as const)("shows the page to a club %s", async (role) => {
    signedInAs(role);
    const page = await ClubLettersPage(params);
    expect(page).not.toBeNull();
    expect(mocks.loadClubLetters.mock.calls[0]![0]).toBe("club-1");
    expect(flat(page as ReactNode).length).toBeGreaterThan(3);
  });

  it("shows the page to staff acting as this club's director", async () => {
    actingAsDirector();
    expect(await ClubLettersPage(params)).not.toBeNull();
    expect(mocks.loadClubLetters).toHaveBeenCalledTimes(1);
  });

  it("is not found when the club has not switched it on (the loader returns nothing)", async () => {
    signedInAs("DIRECTOR");
    mocks.loadClubLetters.mockResolvedValue(null);
    await expect(ClubLettersPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is not found for a registrar, even with the feature on", async () => {
    signedInAs("REGISTRAR");
    await expect(ClubLettersPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("loads nothing for a reporter, who has no roster access (the page says the role does not include it)", async () => {
    signedInAs("REPORTER");
    const page = await ClubLettersPage(params);
    expect(mocks.loadClubLetters).not.toHaveBeenCalled();
    expect(page).not.toBeNull();
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
  ])("loads nothing for %s (the club layout answers 404)", async (_name, arrange) => {
    arrange();
    expect(await ClubLettersPage(params)).toBeNull();
    expect(mocks.loadClubLetters).not.toHaveBeenCalled();
  });

  it("loads nothing for staff with no act-as and no attendee sign-in, or acting as another club", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await ClubLettersPage(params)).toBeNull();
    actingAsDirector("club-2");
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await ClubLettersPage(params)).toBeNull();
    expect(mocks.loadClubLetters).not.toHaveBeenCalled();
  });
});

describe("the print page", () => {
  const printParams = (templateId = "letter-1", organizationId = "club-1") => ({ params: Promise.resolve({ organizationId, templateId }), searchParams: Promise.resolve({ people: "p1" }) });

  it.each(["DIRECTOR", "DEPUTY"] as const)("shows the sheets to a club %s", async (role) => {
    signedInAs(role);
    expect(await PrintPage(printParams())).not.toBeNull();
    expect(mocks.loadClubLetterSheets.mock.calls[0]!.slice(0, 1).concat(mocks.loadClubLetterSheets.mock.calls[0]!.slice(2))).toEqual(["club-1", "letter-1", "p1"]);
  });

  it("shows each sheet as escaped plain text, one section per person, certificates in the certificate layout", async () => {
    signedInAs("DIRECTOR");
    mocks.loadClubLetterSheets.mockResolvedValue({
      kind: "CERTIFICATE",
      title: "Thanks",
      sheets: [{ personId: "p1", name: "Ann Example", text: "<script>alert(1)</script> Ann\nExample" }, { personId: "p2", name: "Zed Sample", text: "Zed Sample" }],
    });
    const html = renderToStaticMarkup((await PrintPage(printParams())) as ReactElement);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Ann");
    expect(html).not.toContain("<script>");
    expect(html.match(/<section/g)).toHaveLength(2);
    expect(html).toContain("certificate");
    expect(html).toContain("2 pages");
    expect(html).toContain("Thanks for Ann Example");
  });

  it("shows the sheets to staff acting as this club's director", async () => {
    actingAsDirector();
    expect(await PrintPage(printParams())).not.toBeNull();
  });

  it("is not found for another club's template, a registrar, or a club with the feature off", async () => {
    signedInAs("DIRECTOR");
    await expect(PrintPage(printParams("letter-of-club-2"))).rejects.toThrow("NEXT_NOT_FOUND");
    signedInAs("REGISTRAR");
    await expect(PrintPage(printParams())).rejects.toThrow("NEXT_NOT_FOUND");
    signedInAs("DIRECTOR");
    mocks.loadClubLetterSheets.mockResolvedValue(null);
    await expect(PrintPage(printParams())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
  ])("loads nothing for %s", async (_name, arrange) => {
    arrange();
    expect(await PrintPage(printParams())).toBeNull();
    expect(mocks.loadClubLetterSheets).not.toHaveBeenCalled();
  });

  it("loads nothing for staff with no act-as", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await PrintPage(printParams())).toBeNull();
    expect(mocks.loadClubLetterSheets).not.toHaveBeenCalled();
  });
});

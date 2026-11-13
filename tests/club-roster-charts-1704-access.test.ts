import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can open the roster charts page (#1704), through the real club access check, the real repository and the real
 * feature switch audit. Only sign-in, directory and database lookups are mocked. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  currentStaffActingContext: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  passkeysConfigured: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    attendeeMfaEnrollment: { findUnique: vi.fn() },
    attendeePasskey: { count: vi.fn() },
    attendeeSession: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    clubOptionalFeature: { findUnique: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    clubRosterMember: { findMany: vi.fn() },
    clubMeetingAttendance: { findMany: vi.fn() },
  },
  writeAuditLog: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.passkeysConfigured }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: vi.fn(async () => "/account/two-step") }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/club-rosters/home-view", () => ({ yearLabel: (year: string) => year }));
// Sealed birth dates are plain "sealed:YYYY-MM-DD" strings here, so no key is needed.
vi.mock("@/modules/club-rosters/birth-dates", () => ({ openBirthDate: (sealed: string) => sealed.replace("sealed:", ""), sealBirthDate: (value: string) => `sealed:${value}` }));

import ClubRosterChartsPage, { metadata } from "@/app/(public)/account/(portal)/clubs/[organizationId]/charts/page";
import { setClubFeature } from "@/modules/club-features/repository";

type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const params = { params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({} as { month?: string }) };
const withMonth = (month: string) => ({ params: params.params, searchParams: Promise.resolve({ month }) });

function signedInAs(role: Role | null, clubId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue(role ? [{ organizationId: clubId, name: "Test Pathfinders", role, sponsoringChurch: null }] : []);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.prisma.attendeeMfaEnrollment.findUnique.mockResolvedValue({ status: "ACTIVE" });
  mocks.prisma.attendeePasskey.count.mockResolvedValue(0);
  mocks.prisma.attendeeSession.findUnique.mockResolvedValue({ secondFactorVerifiedAt: new Date() });
}

function actingAsDirector(organizationId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId, userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
}

const roster = [
  { attendeeType: "YOUTH", classLevel: "FRIEND", schoolGrade: "GRADE_5", sealedBirthDate: "sealed:2015-11-20", person: { firstName: "Ann", lastName: "Example" } },
  { attendeeType: "YOUTH", classLevel: "RANGER", schoolGrade: "GRADE_8", sealedBirthDate: "sealed:2012-03-04", person: { firstName: "Bo", lastName: "Test" } },
  { attendeeType: "STAFF", classLevel: null, schoolGrade: null, sealedBirthDate: "sealed:1985-11-02", person: { firstName: "Cy", lastName: "Sample" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
  mocks.passkeysConfigured.mockResolvedValue(false);
  mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
  mocks.prisma.clubRosterMember.findMany.mockImplementation(async (args: { select: Record<string, unknown> }) => (args.select.sealedBirthDate ? roster : roster.map(({ attendeeType, classLevel, schoolGrade }) => ({ attendeeType, classLevel, schoolGrade }))));
  mocks.prisma.clubMeetingAttendance.findMany.mockResolvedValue([
    { present: true, meetingNote: { id: "n1", meetingDate: "2026-10-10" } },
    { present: false, meetingNote: { id: "n1", meetingDate: "2026-10-10" } },
  ]);
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => unknown) => work(mocks.prisma));
  mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true });
  mocks.prisma.clubOptionalFeature.createMany.mockResolvedValue({ count: 1 });
  mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 1 });
});

const html = async (arg = params) => renderToStaticMarkup((await ClubRosterChartsPage(arg)) as ReactElement);

describe("the optional feature switch", () => {
  it("writes an audit entry naming the club, the feature and the account when it is switched on", async () => {
    await setClubFeature("club-1", "roster-charts", true, { accountId: "account-1" });
    expect(mocks.prisma.clubOptionalFeature.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "club-1", featureKey: "roster-charts", enabledByAccountId: "account-1" }],
      skipDuplicates: true,
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "CLUB_FEATURE_ENABLED",
      entityType: "ClubOptionalFeature",
      entityId: "club-1",
      summary: "Turned on Roster charts and birthdays for the club.",
      metadata: { organizationId: "club-1", featureKey: "roster-charts", actorAttendeeAccountId: "account-1" },
    });
  });

  it("audits switching it off, and writes nothing when nothing changed", async () => {
    await setClubFeature("club-1", "roster-charts", false, { accountId: "account-1" });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "CLUB_FEATURE_DISABLED", metadata: { featureKey: "roster-charts" } });
    mocks.writeAuditLog.mockClear();
    mocks.prisma.clubOptionalFeature.deleteMany.mockResolvedValue({ count: 0 });
    await setClubFeature("club-1", "roster-charts", false, { accountId: "account-1" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the charts page", () => {
  it("is named Roster charts", () => {
    expect(metadata.title).toBe("Roster charts");
  });

  it.each(["DIRECTOR", "DEPUTY"] as const)("shows counts, age groups and birthdays to a club %s", async (role) => {
    signedInAs(role);
    const page = await html();
    expect(page).toContain("Members by class");
    expect(page).toContain("Members by school grade");
    expect(page).toContain("Members by type");
    expect(page).toContain("Members by age group");
    expect(page).toContain("Meetings and people present, by month");
    expect(page).toContain("Birthdays in November");
    expect(page).toContain("Ann Example");
    expect(page).toContain("November 20");
    expect(page).toContain("Cy Sample");
    expect(page).not.toContain("Bo Test");
  });

  it("lets the director pick another month", async () => {
    signedInAs("DIRECTOR");
    const page = await html(withMonth("3"));
    expect(page).toContain("Birthdays in March");
    expect(page).toContain("Bo Test");
    expect(page).toContain("March 4");
    expect(page).not.toContain("Ann Example");
  });

  it("shows no 4-digit year next to any birthday", async () => {
    signedInAs("DIRECTOR");
    const page = await html();
    const section = page.slice(page.indexOf("Birthdays in November"));
    const listed = section.slice(section.indexOf("<ul"), section.indexOf("</ul>"));
    expect(listed).toContain("Ann Example");
    expect(listed.replace(/<[^>]*>/g, " ")).not.toMatch(/\d{4}/);
    expect(listed.replace(/<[^>]*>/g, " ")).not.toMatch(/\bage\b|years? old/i);
  });

  it("shows a registrar the counts but no age groups and no birthday section, and never opens a birth date", async () => {
    signedInAs("REGISTRAR");
    const page = await html();
    expect(page).toContain("Members by class");
    expect(page).toContain("Members by type");
    expect(page).not.toMatch(/birthday/i);
    expect(page).not.toContain("age group");
    expect(page).not.toContain("Ann Example");
    expect(page).not.toContain("Cy Sample");
    expect(page).not.toMatch(/name="month"/);
    const askedForBirthDates = mocks.prisma.clubRosterMember.findMany.mock.calls.some(([args]) => "sealedBirthDate" in (args as { select: object }).select);
    expect(askedForBirthDates).toBe(false);
  });

  it("shows the page to staff acting as this club's director, birthdays included", async () => {
    actingAsDirector();
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue({ id: "feature-1" });
    const page = await html();
    expect(page).toContain("Birthdays in November");
  });

  it("is not found when the club has not switched it on", async () => {
    signedInAs("DIRECTOR");
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    expect(mocks.prisma.clubOptionalFeature.findUnique).not.toHaveBeenCalled();
    await expect(ClubRosterChartsPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.prisma.clubOptionalFeature.findUnique).toHaveBeenCalledWith({ where: { organizationId_featureKey: { organizationId: "club-1", featureKey: "roster-charts" } }, select: { id: true } });
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("is not found for a registrar either when the feature is off", async () => {
    signedInAs("REGISTRAR");
    mocks.prisma.clubOptionalFeature.findUnique.mockResolvedValue(null);
    await expect(ClubRosterChartsPage(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("loads nothing for a reporter, who has no roster access", async () => {
    signedInAs("REPORTER");
    const page = await ClubRosterChartsPage(params);
    expect(page).not.toBeNull();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(page as ReactElement)).not.toContain("Members by class");
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
  ])("loads nothing for %s (the club layout answers 404)", async (_name, arrange) => {
    arrange();
    expect(await ClubRosterChartsPage(params)).toBeNull();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("loads nothing for staff with no act-as, or acting as another club", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await ClubRosterChartsPage(params)).toBeNull();
    actingAsDirector("club-2");
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await ClubRosterChartsPage(params)).toBeNull();
    expect(mocks.prisma.clubRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("only counts this club's active people this club year", async () => {
    signedInAs("DIRECTOR");
    await html();
    const call = mocks.prisma.clubRosterMember.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ organizationId: "club-1", clubYear: "2026-27", status: "ACTIVE" });
  });
});

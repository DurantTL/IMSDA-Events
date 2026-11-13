import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can use class and honor certificates (#1696): director, deputy, registrar, reporter, another club's director, an Area
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
  loadClubCertificates: vi.fn(),
  loadCertificateSheets: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/account/clubs/club-1/certificates", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.passkeysConfigured }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: vi.fn(async () => "/account/two-step") }));
vi.mock("@/modules/club-features/repository", () => ({ isClubFeatureEnabled: mocks.isClubFeatureEnabled }));
vi.mock("@/modules/club-rosters/home-view", () => ({ yearLabel: (year: string) => year }));
vi.mock("@/modules/club-certificates/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-certificates/repository")>("@/modules/club-certificates/repository");
  return { ...actual, loadClubCertificates: mocks.loadClubCertificates, loadCertificateSheets: mocks.loadCertificateSheets };
});

import CertificatesPage, { metadata } from "@/app/(public)/account/(portal)/clubs/[organizationId]/certificates/page";
import PrintPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/certificates/print/page";


type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const params = { params: Promise.resolve({ organizationId: "club-1" }) };
const pageProps = (query: Record<string, string> = {}) => ({ ...params, searchParams: Promise.resolve(query) });
const printProps = (items = "h:m1:h1", organizationId = "club-1") => ({ params: Promise.resolve({ organizationId }), searchParams: Promise.resolve({ items }) });
const candidate = { key: "h:m1:h1", kind: "HONOR", memberId: "m1", firstName: "Ann", lastName: "Example", title: "Archery", completedOn: "2026-10-04" };
const list = { clubYear: "2026-27", clubName: "Test Pathfinders", candidates: [candidate] };

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

function staffNotActing() {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
  mocks.passkeysConfigured.mockResolvedValue(false);
  mocks.isClubFeatureEnabled.mockResolvedValue(true);
  mocks.loadClubCertificates.mockImplementation(async (_id: string, capabilities: { editProfile: boolean }) => (capabilities.editProfile ? list : null));
  mocks.loadCertificateSheets.mockImplementation(async (_id: string, capabilities: { editProfile: boolean }) => (capabilities.editProfile ? { clubName: "Test Pathfinders", sheets: [candidate] } : null));
});

describe("the certificates page", () => {
  it("is named Class and honor certificates", () => {
    expect(metadata.title).toBe("Class and honor certificates");
  });

  it.each(["DIRECTOR", "DEPUTY"] as const)("shows the page to a club %s", async (role) => {
    signedInAs(role);
    expect(await CertificatesPage(pageProps())).not.toBeNull();
    expect(mocks.loadClubCertificates.mock.calls[0]![0]).toBe("club-1");
  });

  it("shows the page to staff acting as this club's director", async () => {
    actingAsDirector();
    expect(await CertificatesPage(pageProps())).not.toBeNull();
    expect(mocks.loadClubCertificates).toHaveBeenCalledTimes(1);
  });

  it("is not found when the club has not switched it on (the loader returns nothing)", async () => {
    signedInAs("DIRECTOR");
    mocks.loadClubCertificates.mockResolvedValue(null);
    await expect(CertificatesPage(pageProps())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is not found for a registrar, even with the feature on", async () => {
    signedInAs("REGISTRAR");
    await expect(CertificatesPage(pageProps())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("loads nothing for a reporter, who has no roster access", async () => {
    signedInAs("REPORTER");
    expect(await CertificatesPage(pageProps())).not.toBeNull();
    expect(mocks.loadClubCertificates).not.toHaveBeenCalled();
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
    ["staff who are not acting", staffNotActing],
    ["staff acting as another club's director", () => { actingAsDirector("club-2"); mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null }); }],
  ])("loads nothing for %s", async (_name, arrange) => {
    arrange();
    expect(await CertificatesPage(pageProps())).toBeNull();
    expect(mocks.loadClubCertificates).not.toHaveBeenCalled();
  });

  it("lists the completions filtered by the query's kind and dates", async () => {
    signedInAs("DIRECTOR");
    const html = renderToStaticMarkup((await CertificatesPage(pageProps({ kind: "CLASS" }))) as ReactElement);
    expect(html).toContain("0 completions shown");
    const all = renderToStaticMarkup((await CertificatesPage(pageProps({ from: "2026-10-01", to: "2026-10-31" }))) as ReactElement);
    expect(all).toContain("1 completion shown");
    expect(all).toContain("Ann Example: Archery");
    expect(all).toContain("Select all");
    expect(all).toContain("Clear filters");
    const none = renderToStaticMarkup((await CertificatesPage(pageProps())) as ReactElement);
    expect(none).not.toContain("Clear filters");
  });

  it("points an empty club to the Honors and Class tracking pages", async () => {
    signedInAs("DIRECTOR");
    mocks.loadClubCertificates.mockResolvedValue({ ...list, candidates: [] });
    const html = renderToStaticMarkup((await CertificatesPage(pageProps())) as ReactElement);
    expect(html).toContain("/account/clubs/club-1/honors");
    expect(html).toContain("/account/clubs/club-1/class-tracking");
  });
});

describe("the print page", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("shows the certificates to a club %s", async (role) => {
    signedInAs(role);
    expect(await PrintPage(printProps())).not.toBeNull();
    expect(mocks.loadCertificateSheets.mock.calls[0]![0]).toBe("club-1");
    expect(mocks.loadCertificateSheets.mock.calls[0]![2]).toBe("h:m1:h1");
  });

  it("shows one certificate per item with only the name, what was completed, the date and the club", async () => {
    signedInAs("DIRECTOR");
    const html = renderToStaticMarkup((await PrintPage(printProps())) as ReactElement);
    expect(html.match(/<section/g)).toHaveLength(1);
    for (const text of ["Certificate of completion", "Ann Example", "Archery", "October 4, 2026", "Test Pathfinders", "Director", "Date", "1 certificate,"]) expect(html).toContain(text);
    expect(html).not.toMatch(/birth|phone|email|health/i);
  });

  it("shows a notice and no print button when nothing is left to print", async () => {
    signedInAs("DIRECTOR");
    mocks.loadCertificateSheets.mockResolvedValue({ clubName: "Test Pathfinders", sheets: [] });
    const html = renderToStaticMarkup((await PrintPage(printProps("junk"))) as ReactElement);
    expect(html).toContain("Nothing to print");
    expect(html).not.toContain("<section");
  });

  it("shows the certificates to staff acting as this club's director", async () => {
    actingAsDirector();
    expect(await PrintPage(printProps())).not.toBeNull();
  });

  it("is not found for a registrar and for a club with the feature off", async () => {
    signedInAs("REGISTRAR");
    await expect(PrintPage(printProps())).rejects.toThrow("NEXT_NOT_FOUND");
    signedInAs("DIRECTOR");
    mocks.loadCertificateSheets.mockResolvedValue(null);
    await expect(PrintPage(printProps())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["another club's director", () => signedInAs("DIRECTOR", "club-2")],
    ["an Area Coordinator", () => signedInAs(null)],
    ["staff who are not acting", staffNotActing],
  ])("loads nothing for %s", async (_name, arrange) => {
    arrange();
    expect(await PrintPage(printProps())).toBeNull();
    expect(mocks.loadCertificateSheets).not.toHaveBeenCalled();
  });
});

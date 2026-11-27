import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can void a printed certificate, and what the certificates page and the public check page show (#2052). The real
 * club access check runs; sign-in, directory, feature and repository lookups are mocked. Synthetic data only.
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
  rejectCrossOriginRequest: vi.fn(),
  isClubFeatureEnabled: vi.fn(),
  loadClubCertificates: vi.fn(),
  voidClubCertificate: vi.fn(),
  findCertificateForCheck: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/account/clubs/club-1/certificates", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
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
  return { ...actual, loadClubCertificates: mocks.loadClubCertificates, voidClubCertificate: mocks.voidClubCertificate, findCertificateForCheck: mocks.findCertificateForCheck };
});

import CertificatesPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/certificates/page";
import { POST } from "@/app/api/attendee/clubs/[organizationId]/certificates/[certificateId]/void/route";
import VerifyPage, { metadata as verifyMetadata } from "@/app/(public)/verify/page";
import VerifyResultPage, { metadata as resultMetadata } from "@/app/(public)/verify/[code]/page";

type Role = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";
const params = { params: Promise.resolve({ organizationId: "club-1", certificateId: "cert-1" }) };
const post = () => new Request("https://events.imsda.test/api/attendee/clubs/club-1/certificates/cert-1/void", { method: "POST", headers: { origin: "https://events.imsda.test" } });
const issued = {
  total: 2,
  rows: [
    { id: "cert-1", code: "ABCD2345", firstName: "Ann", lastName: "Example", title: "Archery", kind: "HONOR", completedOn: "2026-10-04", issuedAt: "2026-11-01T10:00:00.000Z", voidedAt: null },
    { id: "cert-2", code: "WXYZ6789", firstName: "Zed", lastName: "Sample", title: "Explorer Class", kind: "CLASS", completedOn: "2026-06-20", issuedAt: "2026-10-01T10:00:00.000Z", voidedAt: "2026-10-02T10:00:00.000Z" },
  ],
};
const list = { clubYear: "2026-27", clubName: "Test Pathfinders", candidates: [], issued };

function signedInAs(role: Role | null, clubId = "club-1") {
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue(role ? [{ organizationId: clubId, name: "Test Pathfinders", role, sponsoringChurch: null }] : []);
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.prisma.attendeeMfaEnrollment.findUnique.mockResolvedValue({ status: "ACTIVE" });
  mocks.prisma.attendeePasskey.count.mockResolvedValue(0);
  mocks.prisma.attendeeSession.findUnique.mockResolvedValue({ secondFactorVerifiedAt: new Date() });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.passkeysConfigured.mockResolvedValue(false);
  mocks.isClubFeatureEnabled.mockResolvedValue(true);
  mocks.loadClubCertificates.mockResolvedValue(list);
  mocks.voidClubCertificate.mockResolvedValue(true);
});

describe("voiding a printed certificate (POST)", () => {
  it.each(["DIRECTOR", "DEPUTY"] as const)("lets a club %s void it, attributed to their own account and the profile-editing capability", async (role) => {
    signedInAs(role);
    const response = await POST(post(), params);
    expect(response.status).toBe(200);
    expect(mocks.voidClubCertificate).toHaveBeenCalledTimes(1);
    const args = mocks.voidClubCertificate.mock.calls[0]!;
    expect(args[0]).toBe("club-1");
    expect(args[1]).toBe("cert-1");
    expect(args[2]).toMatchObject({ editProfile: true });
    expect(args[3]).toEqual({ accountId: "account-1" });
  });

  it("lets staff acting as this club's director void it, recorded by user and act-as", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-1", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    mocks.prisma.organization.findUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders", parentOrganization: null });
    expect((await POST(post(), params)).status).toBe(200);
    expect(mocks.voidClubCertificate.mock.calls[0]![3]).toEqual({ userId: "staff-1", actAsId: "act-1" });
  });

  it.each(["REGISTRAR", "REPORTER"] as const)("refuses a club %s and voids nothing", async (role) => {
    signedInAs(role);
    expect((await POST(post(), params)).status).toBe(403);
    expect(mocks.voidClubCertificate).not.toHaveBeenCalled();
  });

  it("answers 404, never revealing the club, to another club's director and to an Area Coordinator", async () => {
    signedInAs("DIRECTOR", "club-2");
    expect((await POST(post(), params)).status).toBe(404);
    signedInAs(null);
    expect((await POST(post(), params)).status).toBe(404);
    expect(mocks.voidClubCertificate).not.toHaveBeenCalled();
  });

  it("answers 401 to staff who are not acting, and to staff acting as another club's director", async () => {
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect((await POST(post(), params)).status).toBe(401);
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", organizationId: "club-2", userId: "staff-1", staffSessionId: "s", actAsId: "act-1" });
    expect((await POST(post(), params)).status).toBe(401);
    expect(mocks.voidClubCertificate).not.toHaveBeenCalled();
  });

  it("answers 404 with the same words when the certificate is not this club's, is voided already, or the feature is off", async () => {
    signedInAs("DIRECTOR");
    mocks.voidClubCertificate.mockResolvedValue(false);
    const response = await POST(post(), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND", message: "That certificate could not be found." });
  });

  it("refuses a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }));
    signedInAs("DIRECTOR");
    expect((await POST(post(), params)).status).toBe(403);
    expect(mocks.voidClubCertificate).not.toHaveBeenCalled();
  });
});

describe("the printed certificates section", () => {
  it("lists each certificate with its number, person, title, dates and status, and a Void button only on the valid one", async () => {
    signedInAs("DIRECTOR");
    const html = renderToStaticMarkup((await CertificatesPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({}) })) as ReactElement);
    for (const text of ["Printed certificates", "ABCD-2345", "Ann Example", "Archery", "completed October 4, 2026", "printed November 1, 2026", "Valid", "WXYZ-6789", "Voided on October 2, 2026", "2 printed certificates."]) expect(html).toContain(text);
    expect(html.match(/>Void</g) ?? html.match(/Void<span/g)).toHaveLength(1);
    expect(html).toContain("no longer valid");
    expect(html).toContain("new number");
  });

  it("shows a certificate whose person was removed from the roster, and dates in Central time", async () => {
    signedInAs("DIRECTOR");
    const rows = [
      { id: "cert-3", code: "GONE2345", firstName: null, lastName: null, title: "Knots", kind: "HONOR", completedOn: "2026-10-04", issuedAt: "2026-11-02T01:00:00.000Z", voidedAt: "2026-11-02T04:30:00.000Z" },
    ];
    mocks.loadClubCertificates.mockResolvedValue({ ...list, issued: { total: 1, rows } });
    const html = renderToStaticMarkup((await CertificatesPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toContain("Removed from the roster");
    expect(html).toContain("GONE-2345");
    // 8 pm Central on Nov 1 is already Nov 2 in UTC; 11:30 pm Central on Nov 1 likewise.
    expect(html).toContain("printed November 1, 2026");
    expect(html).toContain("Voided on November 1, 2026");
    expect(html).toContain("void the old certificate");
  });

  it("says when nothing has been printed, and when the list is cut", async () => {
    signedInAs("DIRECTOR");
    mocks.loadClubCertificates.mockResolvedValue({ ...list, issued: { total: 0, rows: [] } });
    const empty = renderToStaticMarkup((await CertificatesPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({}) })) as ReactElement);
    expect(empty).toContain("No certificates have been printed yet");
    mocks.loadClubCertificates.mockResolvedValue({ ...list, issued: { total: 80, rows: issued.rows } });
    const cut = renderToStaticMarkup((await CertificatesPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({}) })) as ReactElement);
    expect(cut).toContain("The latest 2 are listed; 80 certificates have been printed in all.");
  });

  it("shows nothing of it to a registrar", async () => {
    signedInAs("REGISTRAR");
    mocks.loadClubCertificates.mockResolvedValue(null);
    await expect(CertificatesPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the public check pages", () => {
  const render = async (code: string) => renderToStaticMarkup((await VerifyResultPage({ params: Promise.resolve({ code }) })) as ReactElement);
  const genuine = { kind: "HONOR", title: "Archery", completedOn: "2026-10-04", clubName: "Test Pathfinders", voidedAt: null };

  it("are not indexed or cached", () => {
    for (const metadata of [verifyMetadata, resultMetadata]) expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
  });

  it("shows a genuine certificate's title, kind, date and club, and never a person", async () => {
    // The lookup only ever returns these five fields; the page also never asks for a person.
    mocks.findCertificateForCheck.mockResolvedValue({ ...genuine, personName: "Ann Example", birthDate: "2012-01-01" });
    const html = await render("ABCD-2345");
    for (const text of ["This certificate is genuine", "Honor:", "Archery", "Completed:", "October 4, 2026", "Club:", "Test Pathfinders"]) expect(html).toContain(text);
    expect(html).not.toMatch(/Ann|Example|2012|birth/i);
    expect(mocks.findCertificateForCheck).toHaveBeenCalledWith("ABCD-2345");
  });

  it("marks the title and club so a translator leaves them alone", async () => {
    mocks.findCertificateForCheck.mockResolvedValue(genuine);
    const html = await render("ABCD2345");
    expect(html).toContain('<span translate="no">Archery</span>');
    expect(html).toContain('<span translate="no">Test Pathfinders</span>');
  });

  it("says a withdrawn certificate is no longer valid and shows no details", async () => {
    mocks.findCertificateForCheck.mockResolvedValue({ ...genuine, voidedAt: new Date("2026-11-01T00:00:00Z") });
    const html = await render("ABCD2345");
    expect(html).toContain("This certificate is no longer valid");
    expect(html).toContain("The club withdrew this certificate");
    expect(html).not.toMatch(/Archery|Test Pathfinders|October 4/);
  });

  it("gives an unknown number and a malformed one exactly the same page", async () => {
    mocks.findCertificateForCheck.mockResolvedValue(null);
    const unknown = await render("ABCD2345");
    const malformed = await render("not-a-number");
    expect(unknown).toBe(malformed);
    expect(unknown).toContain("We couldn&#x27;t find a certificate with that number. Check the number on the certificate and try again.");
    expect(unknown).not.toContain("ABCD2345");
    expect(malformed).not.toContain("not-a-number");
  });

  it("the form page sends a good number to its page and an invalid one back with the same not-found message", async () => {
    const run = (code?: string | string[]) => VerifyPage({ searchParams: Promise.resolve({ code }) });
    await expect(run("abcd-2345")).rejects.toThrow("REDIRECT /verify/ABCD2345");
    const html = renderToStaticMarkup((await run("nope")) as ReactElement);
    expect(html).toContain("We couldn&#x27;t find a certificate with that number.");
    expect(html).toContain("Verification number");
    expect(html).toContain("Check");
    expect(html).not.toContain("nope");
    const plain = renderToStaticMarkup((await run()) as ReactElement);
    expect(plain).not.toContain("couldn&#x27;t find");
    expect(plain).toContain('method="get"');
  });
});

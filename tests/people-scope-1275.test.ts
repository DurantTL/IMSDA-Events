import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1275: who sees what. A system administrator ("full") gets every box and control; an active Clubs Administrator
 * ("clubs") gets Area Coordinator and club role controls only, and nothing about events, sign-in or system roles
 * is even loaded for them. Everyone else is sent to /no-access. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  clubsGrantFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  accountFindUnique: vi.fn(),
  accountFindMany: vi.fn(),
  membershipFindMany: vi.fn(),
  staffLoginRedirectPath: vi.fn(async () => "/login"),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubsAdministratorGrant: { findFirst: mocks.clubsGrantFindFirst },
    user: { findUnique: mocks.userFindUnique, findMany: mocks.userFindMany },
    attendeeAccount: { findUnique: mocks.accountFindUnique, findMany: mocks.accountFindMany },
    eventMembership: { findMany: mocks.membershipFindMany },
  }),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: mocks.staffLoginRedirectPath }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: vi.fn(async () => false) }));

import PeopleAccessPage from "@/app/(workspace)/admin/people/page";
import { PersonAccess } from "@/components/person-access";
import { getPersonDetail, loadPeopleRows, type PersonDetail } from "@/modules/system-admin/people-directory";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";

const person: PersonDetail = {
  name: "Sample Person",
  email: "sample@example.test",
  staffEmail: "sample@example.test",
  accountEmail: "sample@example.test",
  staffId: "u-target",
  accountId: "a-target",
  systemAdministrator: false,
  clubsAdministrator: false,
  areaCoordinator: false,
  staff: { status: "ACTIVE", signInDisabled: false, displayName: "Sample Person", jobTitle: "", phone: "", bio: "", twoStep: "On", lastSignedInAt: null },
  account: { status: "ACTIVE", signInDisabled: false, emailVerified: false, twoStep: "On", lastSignedInAt: null },
  events: [{ membershipId: "m-1", eventId: "e-1", eventName: "Synthetic Event One", role: "READ_ONLY_STAFF", active: true, healthInformation: false, finalizeInvoices: false }],
  clubs: [
    { grantId: "g-1", organizationId: "o-1", clubName: "Synthetic Club", role: "DIRECTOR", status: "active", effectiveFrom: "2026-01-01T00:00:00.000Z" },
    { grantId: "g-2", organizationId: "o-1", clubName: "Synthetic Club", role: "DEPUTY", status: "scheduled", effectiveFrom: "2027-02-03T00:00:00.000Z" },
    { grantId: "g-3", organizationId: "o-1", clubName: "Synthetic Club", role: "REPORTER", status: "ended", effectiveFrom: "2025-01-01T00:00:00.000Z" },
    { grantId: "g-4", organizationId: "o-1", clubName: "Synthetic Club", role: "REGISTRAR", status: "revoked", effectiveFrom: "2025-01-01T00:00:00.000Z" },
  ],
};
const render = (scope: "full" | "clubs") => renderToStaticMarkup(createElement(PersonAccess, {
  person,
  scope,
  viewerUserId: "u-viewer",
  eventOptions: [{ id: "e-2", name: "Synthetic Event Two" }],
  clubOptions: [{ id: "o-1", name: "Synthetic Club" }],
  linkedEmailChangesTogether: false,
}));

describe("the person page by viewer scope", () => {
  it("gives a Clubs Administrator only Area Coordinator and club role controls", () => {
    const html = render("clubs");
    expect(html).toContain("Make Area Coordinator");
    expect(html).toContain("Give club role");
    expect(html).toContain("System-wide");
    for (const absent of [
      "Make system administrator", "Remove system administrator", "Make Clubs Administrator", "Remove Clubs Administrator",
      ">Events<", "Add to event", "Synthetic Event One", ">Account<", "Disable sign-in", "Allow sign-in", "Sign out everywhere",
      "Change staff email", "Change website email", "Send password reset", "Edit profile", "Send verification email",
      "Reset staff two-step", "Reset website two-step", "Link a staff login", "Unlink staff login", "Act as",
    ]) expect(html, absent).not.toContain(absent);
  });

  it("gives a system administrator every box and control", () => {
    const html = render("full");
    for (const present of [
      "Make system administrator", "Make Clubs Administrator", "Make Area Coordinator", ">Events<", "Add to event", "Synthetic Event One",
      ">Account<", "Disable sign-in", "Sign out everywhere", "Change staff email", "Change website email", "Send password reset",
      "Edit profile", "Send verification email", "Reset staff two-step", "Reset website two-step", "Unlink staff login", "Give club role",
    ]) expect(html, present).toContain(present);
  });

  it("labels club roles Active, Scheduled with the start date, Ended and Revoked, and revokes only current or scheduled ones", () => {
    const html = render("full");
    expect(html).toContain("Active");
    expect(html).toContain("Scheduled (starts 2/3/2027)");
    expect(html).toContain("Ended");
    expect(html).toContain("Revoked");
    expect(html.match(/aria-label="Revoke /g)).toHaveLength(2);
  });

  it("puts the act-as button on the list page, for a system administrator only", async () => {
    const { readFileSync } = await import("node:fs");
    const list = readFileSync("app/(workspace)/admin/people/page.tsx", "utf8");
    const detail = readFileSync("app/(workspace)/admin/people/[kind]/[id]/page.tsx", "utf8");
    expect(list).toMatch(/viewer\.scope === "full" \?\s*\(?\s*<ActAsButton/);
    expect(detail).not.toContain("ActAsButton");
  });
});

describe("the people viewer gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clubsGrantFindFirst.mockResolvedValue(null);
  });

  it("admits a system administrator and an active Clubs Administrator, and nobody else", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: "SYSTEM_ADMIN" } });
    expect((await resolvePeopleViewer()).scope).toBe("full");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: null } });
    mocks.clubsGrantFindFirst.mockResolvedValue({ id: "g" });
    expect((await resolvePeopleViewer()).scope).toBe("clubs");
    // An Event Admin: no global role, no Clubs Administrator grant.
    mocks.clubsGrantFindFirst.mockResolvedValue(null);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u3", globalRole: null } });
    expect((await resolvePeopleViewer()).scope).toBeNull();
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect(await resolvePeopleViewer()).toEqual({ user: null, scope: null });
  });

  it("sends an Event Admin to /no-access and a signed-out visitor to sign-in, before searching anything", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u3", globalRole: null } });
    await expect(PeopleAccessPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/no-access");
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(PeopleAccessPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/login");
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.accountFindMany).not.toHaveBeenCalled();
  });
});

describe("what is loaded for a Clubs Administrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ id: "u-target", attendeeAccountId: "a-target" });
    mocks.accountFindUnique.mockResolvedValue({ id: "a-target", linkedUser: { id: "u-target" } });
    mocks.membershipFindMany.mockResolvedValue([]);
  });

  it("getPersonDetail(clubs) loads no memberships, staff or account details, and only CLUB-type grants", async () => {
    const account = {
      email: "sample@example.test", displayName: "Sample Person", status: "ACTIVE", disabledAt: null, emailVerifiedAt: new Date(),
      areaCoordinatorGrant: null, mfaEnrollment: null, _count: { passkeys: 0 }, sessions: [],
      clubDirectorGrants: [{ id: "g-1", role: "DIRECTOR", revokedAt: null, effectiveFrom: new Date("2020-01-01"), effectiveTo: null, organization: { id: "o-1", name: "Synthetic Club" } }],
    };
    mocks.userFindUnique.mockImplementation(async (args: { select: Record<string, unknown> }) => (
      args.select.email ? { email: "sample@example.test", displayName: "Sample Person", jobTitle: "x", phone: "y", bio: "z", globalRole: "SYSTEM_ADMIN", accountStatus: "ACTIVE", credential: null, clubsAdministratorGrant: null, mfaEnrollment: null, sessions: [] } : { id: "u-target", attendeeAccountId: "a-target" }
    ));
    mocks.accountFindUnique.mockImplementation(async (args: { select: Record<string, unknown> }) => (args.select.email ? account : { id: "a-target", linkedUser: { id: "u-target" } }));
    const detail = await getPersonDetail("staff", "u-target", "clubs");
    expect(detail).not.toBeNull();
    expect(detail!.events).toBeNull();
    expect(detail!.staff).toBeNull();
    expect(detail!.account).toBeNull();
    expect(mocks.membershipFindMany).not.toHaveBeenCalled();
    const accountQuery = mocks.accountFindUnique.mock.calls.find(([args]) => args.select.email)![0];
    expect(accountQuery.select.clubDirectorGrants.where).toEqual({ organization: { type: "CLUB" } });
    expect(detail!.clubs).toEqual([expect.objectContaining({ clubName: "Synthetic Club", status: "active" })]);
    // The full view loads events and details.
    const full = await getPersonDetail("staff", "u-target", "full");
    expect(full!.events).toEqual([]);
    expect(full!.staff).not.toBeNull();
    expect(mocks.membershipFindMany).toHaveBeenCalledTimes(1);
  });

  it("the list rows for a Clubs Administrator carry no sign-in, event or system role information", async () => {
    mocks.accountFindMany.mockResolvedValue([{
      id: "a-1", status: "ACTIVE", disabledAt: null,
      areaCoordinatorGrant: { revokedAt: null, expiresAt: null },
      clubDirectorGrants: [
        { revokedAt: null, effectiveFrom: new Date("2020-01-01"), effectiveTo: null },
        { revokedAt: null, effectiveFrom: new Date("2999-01-01"), effectiveTo: null },
        { revokedAt: new Date("2021-01-01"), effectiveFrom: new Date("2020-01-01"), effectiveTo: null },
      ],
    }]);
    const people = [{ key: "u-1", staffId: "u-1", accountId: "a-1", name: "Sample", email: "s@example.test" }];
    const [row] = await loadPeopleRows(people, "clubs");
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(row.signIn).toEqual([]);
    expect(row.access).toEqual(["Area Coordinator", "1 club role"]);
    const query = mocks.accountFindMany.mock.calls[0]![0];
    expect(query.select.clubDirectorGrants.where).toEqual({ organization: { type: "CLUB" } });

    mocks.userFindMany.mockResolvedValue([{ id: "u-1", globalRole: "SYSTEM_ADMIN", accountStatus: "ACTIVE", credential: null, clubsAdministratorGrant: null, _count: { memberships: 3 } }]);
    const [fullRow] = await loadPeopleRows(people, "full");
    expect(fullRow.signIn).toHaveLength(2);
    expect(fullRow.access).toEqual(["System administrator", "Area Coordinator", "3 events", "1 club role"]);
  });
});

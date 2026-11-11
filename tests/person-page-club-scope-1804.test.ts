import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1804 (Caleb, 2026-11-11): a Clubs Administrator opens the page of a club person only; anyone else answers as not found.
 * A system administrator opens anyone. A first club role for an existing website account is given through an email
 * lookup that shows only what is needed. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  accountFindUnique: vi.fn(),
  accountFindFirst: vi.fn(),
  resolveClubsActor: vi.fn(),
  membershipFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst },
    eventMembership: { findMany: mocks.membershipFindMany },
    attendeeAccount: { findUnique: mocks.accountFindUnique, findFirst: mocks.accountFindFirst },
  }),
}));
vi.mock("@/modules/access/admin-roles", () => ({ resolveClubsActor: mocks.resolveClubsActor }));

import { getPersonDetail } from "@/modules/system-admin/people-directory";
import { clubPeopleWhere } from "@/modules/system-admin/people-directory-model";
import { inviteLookupHref, deferredPersonHref } from "@/modules/system-admin/people-invite-href";
import { findInviteLookupPerson, normalizeLookupEmail } from "@/modules/system-admin/people-invite-lookup";

const now = new Date("2026-11-11T18:00:00.000Z");
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

const userRow = { email: "staff@example.test", displayName: "Sam Staff", globalRole: "USER", accountStatus: "ACTIVE", credential: null, clubsAdministratorGrant: null, siteContentEditorGrant: null, mfaEnrollment: null, sessions: [] };
const accountRow = { email: "family@example.test", displayName: "Fran Family", status: "ACTIVE", disabledAt: null, emailVerifiedAt: null, areaCoordinatorGrant: null, mfaEnrollment: null, _count: { passkeys: 0 }, sessions: [], clubDirectorGrants: [] };

/** Which ids the club-person check finds: its two existence queries answer by the id they were asked about. */
function clubPeople(ids: { staff?: readonly string[]; account?: readonly string[] }) {
  mocks.userFindFirst.mockImplementation(async ({ where }: { where: { AND: [{ id: string }] } }) => (ids.staff?.includes(where.AND[0].id) ? { id: where.AND[0].id } : null));
  mocks.accountFindFirst.mockImplementation(async ({ where }: { where: { AND: [{ id: string }] } }) => (ids.account?.includes(where.AND[0].id) ? { id: where.AND[0].id } : null));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "u-linked" ? { id: "u-linked", attendeeAccountId: "a-linked", ...userRow } : where.id.startsWith("u-") ? { id: where.id, attendeeAccountId: null, ...userRow } : null));
  mocks.accountFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "a-linked" ? { id: "a-linked", linkedUser: { id: "u-linked" }, ...accountRow } : where.id.startsWith("a-") ? { id: where.id, linkedUser: null, ...accountRow } : null));
  mocks.membershipFindMany.mockResolvedValue([]);
  clubPeople({});
});

describe("getPersonDetail for a Clubs Administrator", () => {
  it("answers nothing for a staff login that is not a club person", async () => {
    expect(await getPersonDetail("staff", "u-plain", "clubs")).toBeNull();
  });

  it("answers nothing for a website account that is not a club person", async () => {
    expect(await getPersonDetail("account", "a-plain", "clubs")).toBeNull();
  });

  it("asks the same rule as the list, by id, on each side", async () => {
    await getPersonDetail("staff", "u-linked", "clubs");
    const where = clubPeopleWhere(now);
    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "u-linked" }, where.staff] } }));
    expect(mocks.accountFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "a-linked" }, where.account] } }));
  });

  it.each([
    ["a club director or club staff, by account", "account", "a-director", { account: ["a-director"] }],
    ["an Area Coordinator, by account", "account", "a-coordinator", { account: ["a-coordinator"] }],
    ["a Clubs Administrator, by staff login", "staff", "u-clubsadmin", { staff: ["u-clubsadmin"] }],
  ] as const)("opens %s", async (_label, kind, id, found) => {
    clubPeople(found);
    const person = await getPersonDetail(kind, id, "clubs");
    expect(person).not.toBeNull();
    expect(person?.events).toBeNull();
    expect(person?.staff).toBeNull();
    expect(person?.account).toBeNull();
  });

  it("opens a linked pair from either id when only one side is a club person", async () => {
    clubPeople({ account: ["a-linked"] });
    expect((await getPersonDetail("staff", "u-linked", "clubs"))?.accountId).toBe("a-linked");
    expect((await getPersonDetail("account", "a-linked", "clubs"))?.staffId).toBe("u-linked");
    clubPeople({ staff: ["u-linked"] });
    expect(await getPersonDetail("account", "a-linked", "clubs")).not.toBeNull();
  });

  it("still answers nothing for an id that does not exist", async () => {
    expect(await getPersonDetail("staff", "nobody", "clubs")).toBeNull();
  });
});

describe("getPersonDetail for a system administrator", () => {
  it("opens anyone without asking the club rule", async () => {
    expect(await getPersonDetail("staff", "u-plain", "full")).not.toBeNull();
    expect(await getPersonDetail("account", "a-plain", "full")).not.toBeNull();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.accountFindFirst).not.toHaveBeenCalled();
  });
});

describe("the deferred href after Invite a person", () => {
  const items = [{ type: "club", organizationId: "org-1", role: "DIRECTOR" }] as const;

  it("points a Clubs Administrator at the lookup with the email and the chosen access", () => {
    expect(inviteLookupHref("Fran@Example.test", items)).toBe("/admin/people/invite-lookup?email=Fran%40Example.test&grant=c%3Aorg-1%3ADIRECTOR");
  });

  it("carries only family items and omits an empty grant", () => {
    expect(inviteLookupHref("a@example.test", [{ type: "sa" }, { type: "ac" }])).toBe("/admin/people/invite-lookup?email=a%40example.test&grant=ac");
    expect(inviteLookupHref("a@example.test", [{ type: "ca" }])).toBe("/admin/people/invite-lookup?email=a%40example.test");
  });

  it("keeps a system administrator on the person page", () => {
    expect(deferredPersonHref({ staffId: "u1", accountId: "a1" }, items)).toBe("/admin/people/account/a1?grant=c%3Aorg-1%3ADIRECTOR");
  });

  it("is chosen by who is inviting", () => {
    const source = read("modules/system-admin/people-invite.ts");
    expect(source).toContain("actor.systemAdmin ? deferredPersonHref(personAfter, deferredItems) : inviteLookupHref(email, deferredItems)");
  });
});

describe("findInviteLookupPerson", () => {
  beforeEach(() => {
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.accountFindUnique.mockResolvedValue(null);
  });
  const accountByEmail = (extra: object = {}) =>
    mocks.accountFindUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => (
      where.email ? { id: "a-1", linkedUser: null } : { id: "a-1", displayName: "Fran Family", email: "family@example.test", ...extra }
    ));

  it("normalises the typed email", () => {
    expect(normalizeLookupEmail("  Fran@Example.TEST ")).toBe("fran@example.test");
    expect(normalizeLookupEmail(["a@example.test", "b"])).toBe("a@example.test");
    expect(normalizeLookupEmail(undefined)).toBe("");
    expect(normalizeLookupEmail("x".repeat(400))).toHaveLength(254);
  });

  it("returns nothing for an empty email", async () => {
    expect(await findInviteLookupPerson("  ", "clubs", now)).toBeNull();
  });

  it("gives a system administrator the person's ids, staff-only logins included", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u-1", attendeeAccountId: null });
    expect(await findInviteLookupPerson("staff@example.test", "full", now)).toEqual({ scope: "full", staffId: "u-1", accountId: null });
  });

  it("tells a Clubs Administrator a club person is one (their page opens)", async () => {
    accountByEmail();
    clubPeople({ account: ["a-1"] });
    expect(await findInviteLookupPerson("family@example.test", "clubs", now)).toEqual({ scope: "clubs", clubPerson: true, accountId: "a-1" });
  });

  it("gives a Clubs Administrator only the name and email of a website account with no club role", async () => {
    accountByEmail();
    expect(await findInviteLookupPerson("family@example.test", "clubs", now)).toEqual({
      scope: "clubs", clubPerson: false, accountId: "a-1", displayName: "Fran Family", accountEmail: "family@example.test",
    });
  });

  it("finds nothing for a Clubs Administrator when the email is a staff login's linked to an account with another email", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u-1", attendeeAccountId: "a-1" });
    expect(await findInviteLookupPerson("staff@example.test", "clubs", now)).toBeNull();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.accountFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.accountFindUnique.mock.calls[0]![0].where).toEqual({ email: "staff@example.test" });
  });

  it("finds nothing for a Clubs Administrator when no website account uses the email", async () => {
    expect(await findInviteLookupPerson("nobody@example.test", "clubs", now)).toBeNull();
  });

  it("finds nothing usable for a Clubs Administrator when the email is a staff login with no website account", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u-1", attendeeAccountId: null });
    expect(await findInviteLookupPerson("staff@example.test", "clubs", now)).toBeNull();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });
});

describe("the pages", () => {
  const person = read("app/(workspace)/admin/people/[kind]/[id]/page.tsx");
  const lookup = read("app/(workspace)/admin/people/invite-lookup/page.tsx");

  it("the person page answers not found when the module returns nothing", () => {
    expect(person).toContain("const person = await getPersonDetail(kind, id, viewer.scope);");
    expect(person).toContain("if (!person) notFound();");
  });

  it("the lookup has the same viewer gate as the person page", () => {
    for (const source of [person, lookup]) {
      expect(source).toContain("if (!viewer.user) redirect(await staffLoginRedirectPath());");
      expect(source).toContain('if (!viewer.scope) redirect("/no-access");');
    }
  });

  it("the lookup page looks nobody up for a Clubs Administrator unless a club role is chosen", () => {
    expect(lookup).toContain('const canLookUp = viewer.scope === "full" || items.length > 0;');
    expect(lookup).toContain("email && canLookUp ? await findInviteLookupPerson");
  });

  it("the lookup page uses the shared email input and filter form, and links the next steps to People & access", () => {
    expect(lookup).toContain("<EmailInput");
    expect(lookup).toContain("<GetFilterForm");
    expect(lookup).toContain('<Link href="/admin/people">Invite a person</Link>');
  });

  it("the lookup never passes staff details to the grant panel for a Clubs Administrator", () => {
    expect(lookup).toContain("staffId: null, accountId: person.accountId, staffEmail: null");
    expect(lookup).toContain('planGrantItems(items, "clubs"');
  });
});

describe("person links a Clubs Administrator is given", () => {
  it("shows the directors link only for current grants when links are limited to club people", async () => {
    const { ClubDirectorsWorkspace } = await import("@/components/club-directors-workspace");
    const grant = (id: string, status: string, accountId: string) => ({
      id, organizationId: "o1", role: "DIRECTOR", status, effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null, reason: "Sample", revokedAt: null, revokeReason: null,
      createdAt: "2026-01-01T00:00:00.000Z", account: { id: accountId, displayName: `Person ${accountId}`, email: `${accountId}@example.test` }, grantedBy: null, revokedBy: null,
    });
    const grants = [grant("g1", "ACTIVE", "a1"), grant("g2", "SCHEDULED", "a2"), grant("g3", "ENDED", "a3"), grant("g4", "REVOKED", "a4")];
    const show = (linkCurrentOnly: boolean) => renderToStaticMarkup(createElement(ClubDirectorsWorkspace, { club: { id: "o1", name: "Synthetic Club", isActive: true }, initialGrants: grants as never, canOpenPeople: true, linkCurrentOnly }));
    const limited = show(true);
    expect(limited).toContain('href="/admin/people/account/a1"');
    expect(limited).toContain('href="/admin/people/account/a2"');
    expect(limited).not.toContain('href="/admin/people/account/a3"');
    expect(limited).not.toContain('href="/admin/people/account/a4"');
    expect(show(false)).toContain('href="/admin/people/account/a3"');
  });

  it("gives the event staff page's person link to a system administrator only", () => {
    expect(read("app/(workspace)/staff/page.tsx")).toContain('(await resolvePeopleViewer()).scope === "full"');
  });
});

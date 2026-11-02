import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  clubFormSubmission: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => prisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/secret-box", () => ({ isSecretEncryptionConfigured: () => true, SecretBoxError: class extends Error {} }));

import { listSubmissionsForViewer, pageSubmissionsForViewer } from "@/modules/club-forms/submissions";
import type { ClubFormsViewer } from "@/modules/club-forms/domain";

const leader = { kind: "CLUB_LEADER", organizationId: "club-1", actor: { accountId: "a1" } } as unknown as ClubFormsViewer;
const coordinator = { kind: "AREA_COORDINATOR", actor: { accountId: "a2" } } as unknown as ClubFormsViewer;
const staff = { kind: "STAFF", userId: "u1", systemAdmin: false, clubsAdministrator: true, sensitiveAnswers: false } as ClubFormsViewer;

const row = (id: string) => ({
  id, clubYear: "2026-27", rosterMemberId: null, subjectName: "Sam", status: "SUBMITTED", submittedAt: new Date("2026-10-01T12:00:00Z"),
  updatedAt: new Date("2026-10-01T12:00:00Z"), enteredVia: "LINK", hasSensitiveAnswers: false, template: { key: "t", name: "Form" },
  unlistedClubName: null, organization: { id: "club-1", name: "Synthetic Club" },
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.clubFormSubmission.count.mockResolvedValue(60);
  prisma.clubFormSubmission.findMany.mockResolvedValue([row("s1")]);
});

const sort = (key: string | null, dir: "asc" | "desc" = "asc") => ({ key: key as never, dir });
const lastFindMany = () => prisma.clubFormSubmission.findMany.mock.calls.at(-1)![0];

describe("pageSubmissionsForViewer (#1458)", () => {
  it("uses the same scoping as listSubmissionsForViewer, for a club leader, a coordinator and staff", async () => {
    for (const viewer of [leader, coordinator, staff]) {
      prisma.clubFormSubmission.findMany.mockClear();
      await listSubmissionsForViewer(viewer, {});
      const listed = prisma.clubFormSubmission.findMany.mock.calls[0]![0].where;
      prisma.clubFormSubmission.findMany.mockClear();
      prisma.clubFormSubmission.count.mockClear();
      await pageSubmissionsForViewer(viewer, {}, { sort: sort(null), page: 1, pageSize: 25 });
      expect(lastFindMany().where).toEqual(listed);
      expect(prisma.clubFormSubmission.count.mock.calls[0]![0].where).toEqual(listed);
    }
    // The club leader is pinned to their own club, a coordinator never sees a club-less submission, staff see all.
    await pageSubmissionsForViewer(leader, { organizationId: "club-1" }, { sort: sort(null), page: 1, pageSize: 25 });
    expect(lastFindMany().where).toMatchObject({ organizationId: "club-1" });
    await pageSubmissionsForViewer(coordinator, {}, { sort: sort(null), page: 1, pageSize: 25 });
    expect(lastFindMany().where).toMatchObject({ organizationId: { not: null }, status: "SUBMITTED" });
    await expect(pageSubmissionsForViewer(leader, { organizationId: "club-2" }, { sort: sort(null), page: 1, pageSize: 25 })).rejects.toMatchObject({ code: "CLUB_NOT_FOUND" });
  });

  it("only orders by a whitelisted column: __proto__ and unknown keys fall back to the default order", async () => {
    await pageSubmissionsForViewer(staff, {}, { sort: sort("subject", "desc"), page: 1, pageSize: 25 });
    expect(lastFindMany().orderBy).toEqual([{ subjectName: "desc" }, { id: "asc" }]);
    for (const key of ["__proto__", "constructor", "toString", "password", "id;drop"]) {
      await pageSubmissionsForViewer(staff, {}, { sort: sort(key, "desc"), page: 1, pageSize: 25 });
      expect(lastFindMany().orderBy).toEqual([{ organization: { name: "asc" } }, { template: { sortOrder: "asc" } }, { updatedAt: "desc" }, { id: "asc" }]);
    }
  });

  it("clamps the page and does the skip and take maths", async () => {
    const result = await pageSubmissionsForViewer(staff, {}, { sort: sort(null), page: 99, pageSize: 25 });
    expect(result).toMatchObject({ total: 60, page: 3, pageCount: 3, pageSize: 25 });
    expect(lastFindMany()).toMatchObject({ skip: 50, take: 25 });
    await pageSubmissionsForViewer(staff, {}, { sort: sort(null), page: -4, pageSize: 25 });
    expect(lastFindMany()).toMatchObject({ skip: 0, take: 25 });
    await pageSubmissionsForViewer(staff, {}, { sort: sort(null), page: Number.NaN, pageSize: 25 });
    expect(lastFindMany()).toMatchObject({ skip: 0 });
    prisma.clubFormSubmission.count.mockResolvedValue(0);
    expect(await pageSubmissionsForViewer(staff, {}, { sort: sort(null), page: 5, pageSize: 25 })).toMatchObject({ page: 1, pageCount: 1 });
  });

  it("sorts \"How entered\" by the label shown: all non-link rows, then all link rows, across the page edge", async () => {
    // 30 non-link rows (club director) then 30 link rows; page 2 of 25 starts at row 26: 5 non-link, then 20 link.
    prisma.clubFormSubmission.count.mockImplementation(async ({ where }: { where: { AND?: Array<{ enteredVia?: unknown }> } }) => (where.AND ? 30 : 60));
    prisma.clubFormSubmission.findMany.mockImplementation(async ({ skip, take }: { skip: number; take: number }) => {
      const groupSize = 30;
      return Array.from({ length: Math.max(0, Math.min(take, groupSize - skip)) }, (_, index) => row(`r${skip + index}`));
    });
    await pageSubmissionsForViewer(staff, {}, { sort: sort("entered", "asc"), page: 2, pageSize: 25 });
    const [first, second] = prisma.clubFormSubmission.findMany.mock.calls.map((call) => call[0]);
    expect(first.where.AND[1]).toEqual({ enteredVia: { not: "LINK" } });
    expect(first).toMatchObject({ skip: 25, take: 25 });
    expect(second.where.AND[1]).toEqual({ enteredVia: "LINK" });
    expect(second).toMatchObject({ skip: 0, take: 20 });
    // Z to A puts the link rows first.
    prisma.clubFormSubmission.findMany.mockClear();
    await pageSubmissionsForViewer(staff, {}, { sort: sort("entered", "desc"), page: 1, pageSize: 25 });
    expect(prisma.clubFormSubmission.findMany.mock.calls[0]![0].where.AND[1]).toEqual({ enteredVia: "LINK" });
  });
});

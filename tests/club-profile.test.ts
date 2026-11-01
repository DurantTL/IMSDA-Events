import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  findOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  upsertProfile: vi.fn(),
}));

const client = {
  organization: { findUnique: mocks.findOrganization, update: mocks.updateOrganization },
  clubProfile: { upsert: mocks.upsertProfile },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { EMAIL_FIELD_MESSAGE, PHONE_FIELD_MESSAGE } from "@/lib/field-validation";
import { updateClubProfile } from "@/modules/organizations/club-profile-repository";
import { clubProfileInputSchema } from "@/modules/organizations/club-profile-schemas";

const stored = {
  id: "club-1",
  type: "CLUB",
  name: "Test Pathfinders",
  isActive: true,
  parentOrganizationId: "church-1",
  parentOrganization: { id: "church-1", name: "Example Church" },
  clubProfile: null,
};

const input = (overrides: Record<string, unknown> = {}) => clubProfileInputSchema.parse({
  name: "Test Pathfinders",
  sponsoringChurchId: "church-1",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOrganization.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
    where.id === "church-2" ? { type: "CHURCH", isActive: true }
      : where.id === "company-1" ? { type: "COMPANY", isActive: true }
        : where.id === "group-1" ? { type: "GROUP", isActive: true }
          : where.id === "school-1" ? { type: "SCHOOL", isActive: true }
            : where.id === "company-closed" ? { type: "COMPANY", isActive: false }
      : where.id === "club-9" ? { type: "CLUB", isActive: true }
        : stored,
  ));
});

describe("club profile (#375)", () => {
  it("saves and audits only the fields that changed, without their values", async () => {
    await updateClubProfile("club-1", input({ name: "Renamed Pathfinders", meetingPlace: "Fellowship hall" }), { accountId: "account-1" });
    expect(mocks.updateOrganization).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "Renamed Pathfinders", normalizedName: "renamed pathfinders" }),
    }));
    expect(mocks.upsertProfile).toHaveBeenCalledOnce();
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: "CLUB_PROFILE_UPDATED", metadata: { fields: ["name", "meetingPlace"], actorAttendeeAccountId: "account-1" } });
    expect(JSON.stringify(entry.metadata)).not.toContain("Fellowship");
  });

  it("records a staff editor as the audit actor", async () => {
    await updateClubProfile("club-1", input({ contactPhone: "(515) 555-0100" }), { userId: "staff-1" });
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ actorUserId: "staff-1" });
  });

  it("writes nothing when nothing changed", async () => {
    await updateClubProfile("club-1", input(), { accountId: "account-1" });
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("accepts only an active church as sponsor", async () => {
    await updateClubProfile("club-1", input({ sponsoringChurchId: "church-2" }), { accountId: "account-1" });
    expect(mocks.updateOrganization).toHaveBeenCalled();
    await expect(updateClubProfile("club-1", input({ sponsoringChurchId: "club-9" }), { accountId: "account-1" }))
      .rejects.toMatchObject({ code: "ORGANIZATION_PARENT_INVALID" });
  });

  it("accepts an active company or group as sponsor, and refuses a school or a closed company (#822)", async () => {
    for (const id of ["company-1", "group-1"]) {
      mocks.updateOrganization.mockClear();
      await updateClubProfile("club-1", input({ sponsoringChurchId: id }), { accountId: "account-1" });
      expect(mocks.updateOrganization).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ parentOrganizationId: id }) }));
    }
    for (const id of ["school-1", "company-closed"]) {
      await expect(updateClubProfile("club-1", input({ sponsoringChurchId: id }), { accountId: "account-1" }))
        .rejects.toMatchObject({ code: "ORGANIZATION_PARENT_INVALID" });
    }
  });

  it("requires a sponsoring church; a club can't be left without one", async () => {
    await expect(updateClubProfile("club-1", input({ sponsoringChurchId: null }), { accountId: "account-1" }))
      .rejects.toMatchObject({ code: "ORGANIZATION_PARENT_REQUIRED" });
    expect(mocks.updateOrganization).not.toHaveBeenCalled();
  });

  it("allows a blank contact email and phone", async () => {
    expect(clubProfileInputSchema.safeParse({ name: "Club", contactEmail: "" }).success).toBe(true);
    await updateClubProfile("club-1", input({ contactEmail: "", contactPhone: "" }), { accountId: "account-1" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  describe("contact email and phone use the shared check against the saved values (#1451)", () => {
    const withStored = (clubProfile: Record<string, unknown>) => mocks.findOrganization.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
      where.id === "church-2" ? { type: "CHURCH", isActive: true } : { ...stored, clubProfile: { meetingPlace: "", meetingSchedule: "", contactEmail: "", contactPhone: "", publicDescription: "", listPublicly: false, updatedAt: new Date("2026-01-01T00:00:00Z"), ...clubProfile } },
    ));
    const saved = () => mocks.upsertProfile.mock.calls[0][0].update;
    const failure = async (promise: Promise<unknown>) => {
      const error = await promise.then(() => null, (caught: unknown) => caught as { issues: Array<{ path: unknown[]; message: string }> });
      expect(error?.issues).toBeDefined();
      return error!.issues;
    };

    it("saves an unrelated change with an old bad saved phone and keeps the phone exactly", async () => {
      withStored({ contactPhone: "555-0100" });
      await updateClubProfile("club-1", input({ contactPhone: "555-0100", meetingPlace: "Fellowship hall" }), { accountId: "account-1" });
      expect(saved()).toMatchObject({ meetingPlace: "Fellowship hall", contactPhone: "555-0100" });
      expect(mocks.writeAuditLog.mock.calls[0][0].metadata.fields).toEqual(["meetingPlace"]);
    });

    it("rejects a changed bad phone with the one message, naming the field and not the number", async () => {
      withStored({ contactPhone: "555-0100" });
      const issues = await failure(updateClubProfile("club-1", input({ contactPhone: "(555) 010-0199" }), { accountId: "account-1" }));
      expect(issues).toEqual([expect.objectContaining({ path: ["contactPhone"], message: PHONE_FIELD_MESSAGE })]);
      expect(JSON.stringify(issues)).not.toContain("010-0199");
      expect(mocks.upsertProfile).not.toHaveBeenCalled();
    });

    it("stores a changed valid phone normalised", async () => {
      withStored({ contactPhone: "555-0100" });
      await updateClubProfile("club-1", input({ contactPhone: "5155550134" }), { accountId: "account-1" });
      expect(saved().contactPhone).toBe("(515) 555-0134");
    });

    it("does not trust anything but the saved value: the same bad phone is rejected when nothing is saved", async () => {
      withStored({ contactPhone: "" });
      const issues = await failure(updateClubProfile("club-1", input({ contactPhone: "555-0100", meetingPlace: "Hall" }), { accountId: "account-1" }));
      expect(issues[0]).toMatchObject({ path: ["contactPhone"], message: PHONE_FIELD_MESSAGE });
    });

    it("saves an unrelated change with an old bad saved email and keeps it exactly", async () => {
      withStored({ contactEmail: "Old Address@@Example" });
      await updateClubProfile("club-1", input({ contactEmail: "Old Address@@Example", meetingPlace: "Fellowship hall" }), { accountId: "account-1" });
      expect(saved()).toMatchObject({ meetingPlace: "Fellowship hall", contactEmail: "Old Address@@Example" });
    });

    it("rejects a changed bad email, accepts a changed good one, and reports both fields together", async () => {
      withStored({ contactEmail: "old@@example" });
      const issues = await failure(updateClubProfile("club-1", input({ contactEmail: "not an email", contactPhone: "idk" }), { accountId: "account-1" }));
      expect(issues.map((issue) => issue.path[0])).toEqual(["contactEmail", "contactPhone"]);
      expect(issues[0].message).toBe(EMAIL_FIELD_MESSAGE);
      await updateClubProfile("club-1", input({ contactEmail: "Club@Example.TEST" }), { accountId: "account-1" });
      expect(saved().contactEmail).toBe("club@example.test");
    });
  });
});

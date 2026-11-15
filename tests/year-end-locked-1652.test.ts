import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerEnv: vi.fn(), rosterFindMany: vi.fn(), completionFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubRosterMember: { findMany: mocks.rosterFindMany },
    memberClassCompletion: { findMany: mocks.completionFindMany },
    memberHonorEntry: { findMany: async () => [] },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { resetDataKeyringForTests, setDataKeyStateForTests } from "@/lib/data-key/keyring";
import { DataKeyUnavailableError } from "@/lib/secret-box";
import { clubReportApiError } from "@/modules/club-reports/api-errors";
import { sealBirthDate } from "@/modules/club-rosters/birth-dates";
import { yearEndPrefill } from "@/modules/club-reports/year-end-repository";

const ring = { current: { version: 1, ikm: Buffer.alloc(32, 99) } };

beforeEach(() => {
  vi.clearAllMocks();
  resetDataKeyringForTests();
  mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: "synthetic-sign-in-key-0123456789-abcdefghijklm" });
  mocks.completionFindMany.mockResolvedValue([]);
});

describe("the Year-End Report counts while the personal-data key is unavailable (#1652)", () => {
  function rosterWith(sealedBirthDate: string | null) {
    mocks.rosterFindMany.mockResolvedValue([
      { attendeeType: "YOUTH", isTlt: false, gender: "FEMALE", reportedAge: 12, sealedBirthDate, personId: "p1", status: "ACTIVE", removedAt: null, updatedAt: new Date("2026-01-01T00:00:00Z") },
    ]);
  }

  it("refuses, instead of counting by a reported age and filing numbers that look right", async () => {
    setDataKeyStateForTests({ kind: "ready", ring });
    rosterWith(sealBirthDate("2013-05-02"));
    setDataKeyStateForTests({ kind: "unavailable", reason: "vault-unreachable" });
    await expect(yearEndPrefill("club-1", "2026-27", new Date("2026-10-01T12:00:00Z"))).rejects.toBeInstanceOf(DataKeyUnavailableError);
  });

  it("still works for a roster with no locked birth date", async () => {
    setDataKeyStateForTests({ kind: "unavailable", reason: "vault-unreachable" });
    rosterWith(null);
    await expect(yearEndPrefill("club-1", "2026-27", new Date("2026-10-01T12:00:00Z"))).resolves.toBeDefined();
  });

  it("answers a save with a retryable 503", async () => {
    const response = clubReportApiError(new DataKeyUnavailableError(), "Saving the year-end report");
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("DATA_KEY_UNAVAILABLE");
  });
});

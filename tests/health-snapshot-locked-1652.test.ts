import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerEnv: vi.fn(), getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => true, requireHealthRecordsEnabled: () => undefined }));
vi.mock("@/modules/health-records/acknowledgment", () => ({ requireHealthPrivacyAcknowledgment: vi.fn() }));
const breakGlass = vi.hoisted(() => ({ recordBreakGlassUse: vi.fn() }));
vi.mock("@/modules/health-records/break-glass", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/health-records/break-glass")>()),
  activeGrantsFor: vi.fn(async (_admin: unknown, ids: string[]) => new Map(ids.map((id) => [id, "grant1"]))),
  recordBreakGlassUse: breakGlass.recordBreakGlassUse,
}));

import { resetDataKeyringForTests, setDataKeyStateForTests } from "@/lib/data-key/keyring";
import { DataKeyUnavailableError } from "@/lib/secret-box";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { viewSealedSnapshots } from "@/modules/health-records/snapshot-access-repository";
import { sealHealthSnapshot } from "@/modules/health-records/snapshot-repository";

beforeEach(() => {
  vi.clearAllMocks();
  resetDataKeyringForTests();
  mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: "synthetic-sign-in-key-0123456789-abcdefghijklm" });
});

describe("sealing a health copy while the personal-data key is unavailable (#1652)", () => {
  it("takes no copy, reports it as unavailable, and never touches the database", async () => {
    setDataKeyStateForTests({ kind: "unavailable", reason: "vault-unreachable" });
    await expect(sealHealthSnapshot({ eventId: "e1", personId: "p1", trigger: "CHECK_IN" })).resolves.toEqual({ outcome: "DATA_KEY_UNAVAILABLE" });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("still reports a server with no key at all as not configured", async () => {
    setDataKeyStateForTests("not-separate");
    mocks.getServerEnv.mockReturnValue({});
    await expect(sealHealthSnapshot({ eventId: "e1", personId: "p1", trigger: "CHECK_IN" })).resolves.toEqual({ outcome: "ENCRYPTION_NOT_CONFIGURED" });
  });
});

describe("opening sealed health copies while their key is not loaded (#1652)", () => {
  it("refuses as locked before recording a break-glass use or a view entry", async () => {
    setDataKeyStateForTests({ kind: "unavailable", reason: "vault-unreachable" });
    const transaction = vi.fn();
    mocks.getPrisma.mockReturnValue({
      healthRecordSnapshot: {
        findMany: vi.fn(async () => [{
          id: "s1", eventId: "e1", eventDate: new Date("2026-06-01T00:00:00Z"), trigger: "CHECK_IN", takenAt: new Date("2026-06-01T00:00:00Z"),
          consentVersion: 1, signedOn: null, expiresAt: null, fieldCount: 1, event: { name: "Synthetic Camporee" },
          fields: [{ fieldKey: "hasAllergies", sealedValue: "d1.1.bm9uY2U.dGFn.Y3Q" }],
        }]),
      },
      $transaction: transaction,
    });
    await expect(viewSealedSnapshots({ kind: "SYSTEM_ADMIN", userId: "u1" } as never, "p1")).rejects.toBeInstanceOf(DataKeyUnavailableError);
    expect(transaction).not.toHaveBeenCalled();
    expect(breakGlass.recordBreakGlassUse).not.toHaveBeenCalled();
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  it("also refuses a copy on a previous key version that failed to load, while the current key works", async () => {
    // The current key (version 2) works; the copy was sealed with version 1, which could not be loaded.
    setDataKeyStateForTests({ kind: "ready", ring: { current: { version: 2, ikm: Buffer.alloc(32, 12) }, previousProblem: "access-denied" } });
    const transaction = vi.fn();
    mocks.getPrisma.mockReturnValue({
      healthRecordSnapshot: {
        findMany: vi.fn(async () => [{
          id: "s1", eventId: "e1", eventDate: new Date("2026-06-01T00:00:00Z"), trigger: "CHECK_IN", takenAt: new Date("2026-06-01T00:00:00Z"),
          consentVersion: 1, signedOn: null, expiresAt: null, fieldCount: 1, event: { name: "Synthetic Camporee" },
          fields: [{ fieldKey: "hasAllergies", sealedValue: "d1.1.bm9uY2U.dGFn.Y3Q" }],
        }]),
      },
      $transaction: transaction,
    });
    await expect(viewSealedSnapshots({ kind: "SYSTEM_ADMIN", userId: "u1" } as never, "p1")).rejects.toBeInstanceOf(DataKeyUnavailableError);
    expect(transaction).not.toHaveBeenCalled();
    expect(breakGlass.recordBreakGlassUse).not.toHaveBeenCalled();
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerEnv: vi.fn(), getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => true }));

import { resetDataKeyringForTests, setDataKeyStateForTests } from "@/lib/data-key/keyring";
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

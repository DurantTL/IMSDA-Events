import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { resetDataKeyringForTests, setDataKeyStateForTests } from "@/lib/data-key/keyring";
import { DataKeyUnavailableError } from "@/lib/secret-box";
import { clubTeacherApiError } from "@/modules/club-teachers/api-errors";
import { sealBirthDate } from "@/modules/club-rosters/birth-dates";
import { rosterAgeOn, rosterAgeOnStrict } from "@/modules/club-teachers/repository";

const ring = { current: { version: 1, ikm: Buffer.alloc(32, 95) } };

beforeEach(() => {
  resetDataKeyringForTests();
  mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: "synthetic-sign-in-key-0123456789-abcdefghijklm" });
});

describe("a teacher's age while the personal-data key is unavailable (#1652)", () => {
  it("reads an age normally, and a locked birth date is refused rather than counted as 'age unknown'", () => {
    setDataKeyStateForTests({ kind: "ready", ring });
    const sealed = sealBirthDate("1980-01-02");
    expect(rosterAgeOnStrict({ sealedBirthDate: sealed, reportedAge: null }, "2026-11-07")).toBe(46);
    setDataKeyStateForTests({ kind: "unavailable", reason: "access-denied" });
    expect(() => rosterAgeOnStrict({ sealedBirthDate: sealed, reportedAge: 40 }, "2026-11-07")).toThrow(DataKeyUnavailableError);
    // The display reader keeps its old behaviour and never throws.
    expect(rosterAgeOn({ sealedBirthDate: sealed, reportedAge: 40 }, "2026-11-07")).toBe(40);
  });

  it("does not touch people with no birth date on file", () => {
    setDataKeyStateForTests({ kind: "unavailable", reason: "access-denied" });
    expect(rosterAgeOnStrict({ sealedBirthDate: null, reportedAge: 33 }, "2026-11-07")).toBe(33);
  });

  it("answers 503 DATA_KEY_UNAVAILABLE, retryable", async () => {
    const response = clubTeacherApiError(new DataKeyUnavailableError(), "Naming teachers");
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("DATA_KEY_UNAVAILABLE");
    expect(response.headers.get("Retry-After")).toBe("60");
  });
});

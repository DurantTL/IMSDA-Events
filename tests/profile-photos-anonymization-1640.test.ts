import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ removePhotos: vi.fn(), transaction: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ $transaction: mocks.transaction }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/profile-photos/repository", () => ({ removeProfilePhotosForPerson: mocks.removePhotos }));

import { anonymizePerson } from "@/modules/people/anonymization";

function transactionFor(person: { id: string; anonymizedAt: Date | null } | null) {
  const tx = {
    $executeRaw: vi.fn(),
    user: { findUnique: vi.fn(async () => ({ globalRole: "SYSTEM_ADMIN" })) },
    person: { findUnique: vi.fn(async () => person), updateMany: vi.fn(async () => ({ count: 1 })) },
    personMatchCandidate: { updateMany: vi.fn() },
    personAnonymization: { create: vi.fn() },
  };
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
}

const input = { personId: "p1", approvedByUserId: "admin", approvalReference: "REQ-12345" };

beforeEach(() => vi.clearAllMocks());

describe("anonymization removes linked staff photos (#1640)", () => {
  it("removes them after the anonymization commits", async () => {
    transactionFor({ id: "p1", anonymizedAt: null });
    mocks.removePhotos.mockImplementation(async () => {
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
    });
    expect(await anonymizePerson(input)).toEqual({ personId: "p1", alreadyAnonymized: false });
    expect(mocks.removePhotos).toHaveBeenCalledWith("p1");
  });

  it("does not remove photos when the person was not found", async () => {
    transactionFor(null);
    await expect(anonymizePerson(input)).rejects.toThrow();
    expect(mocks.removePhotos).not.toHaveBeenCalled();
  });

  it("retries the cleanup on a repeat call", async () => {
    transactionFor({ id: "p1", anonymizedAt: new Date() });
    expect(await anonymizePerson(input)).toEqual({ personId: "p1", alreadyAnonymized: true });
    expect(mocks.removePhotos).toHaveBeenCalledWith("p1");
  });
});

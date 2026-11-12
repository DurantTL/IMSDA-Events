import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  requireSystemAdministrator: vi.fn(),
  writeAuditLog: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/logger")>()), logError: mocks.logError }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/access", () => ({ requireSystemAdministrator: mocks.requireSystemAdministrator }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const tx = { organization: { findUnique: mocks.findUnique, update: mocks.update } };
  return { getPrisma: () => ({ ...tx, $transaction: (run: (client: typeof tx) => unknown) => run(tx) }) };
});

import { PATCH } from "@/app/api/admin/organizations/[organizationId]/club-kind/route";
import { AccessDeniedError } from "@/modules/access/authorization";

function patch(body: unknown) {
  return PATCH(
    new Request("https://events.imsda.test/api/admin/organizations/org-1/club-kind", {
      method: "PATCH",
      headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ organizationId: "org-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireSystemAdministrator.mockResolvedValue({ id: "admin-1", globalRole: "SYSTEM_ADMIN" });
});

describe("PATCH club kind (#1517)", () => {
  it("refuses anyone who is not a system administrator", async () => {
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("System administrator access is required.", 403, "PERMISSION_DENIED"));
    const response = await patch({ clubKind: "ADVENTURER" });
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses an organization that is not a club", async () => {
    mocks.findUnique.mockResolvedValue({ type: "CHURCH", name: "Synthetic Church", clubKind: "PATHFINDER" });
    const response = await patch({ clubKind: "ADVENTURER" });
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind or an extra field", async () => {
    expect((await patch({ clubKind: "OTHER" })).status).toBe(400);
    expect((await patch({ clubKind: "ADVENTURER", name: "x" })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("changes the kind and writes an audit entry with only the old and new kind", async () => {
    mocks.findUnique.mockResolvedValue({ type: "CLUB", name: "Synthetic Club", clubKind: "PATHFINDER" });
    const response = await patch({ clubKind: "ADVENTURER" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clubKind: "ADVENTURER" });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "org-1" }, data: { clubKind: "ADVENTURER" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "admin-1", action: "CLUB_KIND_CHANGED", entityType: "Organization", entityId: "org-1", metadata: { from: "PATHFINDER", to: "ADVENTURER" } });
  });

  it("writes nothing when the kind is already set", async () => {
    mocks.findUnique.mockResolvedValue({ type: "CLUB", name: "Synthetic Club", clubKind: "ADVENTURER" });
    expect((await patch({ clubKind: "ADVENTURER" })).status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

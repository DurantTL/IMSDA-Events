import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  session: vi.fn(),
  memberships: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ HEALTH_RECORDS_ENABLED: state.enabled }) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ eventMembership: { findMany: state.memberships } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: state.audit }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: state.session }));
vi.mock("@/modules/health-records/acknowledgment", () => ({ requireHealthPrivacyAcknowledgment: vi.fn() }));
vi.mock("@/modules/health-records/crypto", () => ({ openSnapshotField: vi.fn() }));

import { AccessDeniedError } from "@/modules/access/authorization";
import { HealthRecordError } from "@/modules/health-records/errors";
import { requireSnapshotAdminViewer } from "@/modules/health-records/snapshot-access-repository";

/** Who may reach the sealed-copy routes, and what is audited when someone may not (#924). Synthetic ids only. */

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.session.mockResolvedValue({ user: { id: "user-1", globalRole: null } });
  state.memberships.mockResolvedValue([]);
});

describe("requireSnapshotAdminViewer", () => {
  it("lets a system administrator through", async () => {
    state.session.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    await expect(requireSnapshotAdminViewer("PLACE_HOLD", null)).resolves.toEqual({ kind: "SYSTEM_ADMIN", userId: "admin-1" });
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("answers an unauthenticated request with 401 and audits nothing: there is no one to attribute it to", async () => {
    state.session.mockResolvedValue({ user: null });
    const error = await requireSnapshotAdminViewer("PLACE_HOLD", null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect((error as AccessDeniedError).status).toBe(401);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("refuses signed-in staff without the health permission, and audits who and what", async () => {
    const error = await requireSnapshotAdminViewer("LIFT_HOLD", "hold-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HealthRecordError);
    expect((error as HealthRecordError).code).toBe("FORBIDDEN");
    expect(state.audit).toHaveBeenCalledTimes(1);
    expect(state.audit.mock.calls[0]![0]).toMatchObject({
      actorUserId: "user-1",
      action: "HEALTH_SNAPSHOT_ACCESS_REFUSED",
      entityId: "hold-1",
      metadata: { viewerKind: "STAFF_NO_HEALTH_PERMISSION", attempted: "LIFT_HOLD", reason: "NOT_SYSTEM_ADMIN" },
    });
  });

  it("refuses the event health role too, audited as that role", async () => {
    state.memberships.mockResolvedValue([{ permissions: ["VIEW_HEALTH_INFORMATION"] }]);
    await expect(requireSnapshotAdminViewer("VIEW_SEALED_COPIES", "person-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.audit.mock.calls[0]![0]).toMatchObject({ actorUserId: "user-1", metadata: { viewerKind: "HEALTH_ROLE", attempted: "VIEW_SEALED_COPIES" } });
  });

  it("stores no caller-supplied text as the target id", async () => {
    await requireSnapshotAdminViewer("LIFT_HOLD", "<script>alert(1)</script>").catch(() => null);
    expect(state.audit.mock.calls[0]![0].entityId).toBe("invalid");
  });

  it("with the switch off, only a system administrator gets through, and only on the hold routes", async () => {
    state.enabled = false;
    state.session.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    await expect(requireSnapshotAdminViewer("PLACE_HOLD", null, { flagOptional: true })).resolves.toMatchObject({ kind: "SYSTEM_ADMIN" });
    await expect(requireSnapshotAdminViewer("VIEW_SEALED_COPIES", "p")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Anyone else, signed in or not, gets the unknown-route answer and nothing is audited.
    state.session.mockResolvedValue({ user: { id: "user-1", globalRole: null } });
    await expect(requireSnapshotAdminViewer("PLACE_HOLD", null, { flagOptional: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.session.mockResolvedValue({ user: null });
    await expect(requireSnapshotAdminViewer("PLACE_HOLD", null, { flagOptional: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.audit).not.toHaveBeenCalled();
  });
});

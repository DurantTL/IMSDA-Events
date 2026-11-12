import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1685: while a Youth Admin acts as an Area Coordinator, the audit entries written by the coordinator pages say so
 * (`actorRole: YOUTH_ADMINISTRATOR`), never the Clubs Administrator label; a Clubs Administrator keeps theirs and a
 * system administrator carries neither. Synthetic data only.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ currentStaffActingContext: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => ({ account: null, via: null, sessionId: null }) }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { resolveAreaCoordinatorViewer } from "@/modules/club-forms/access";
import { viewerAuditFields } from "@/modules/club-forms/domain";
import { resolveAreaGuardianViewer } from "@/modules/club-rosters/guardians-access";
import { guardianAuditActor } from "@/modules/club-rosters/guardians-domain";
import { resolveCoordinatorReportActor } from "@/modules/reporting/club-report-api";
import { auditActor } from "@/modules/reporting/club-report-export";

const acting = { userId: "u-staff", staffSessionId: "s-1", actAsId: "act-1", role: "AREA_COORDINATOR" as const, organizationId: null, expiresAt: new Date("2026-11-12T20:00:00.000Z") };
const variants = [
  ["a Youth Admin", { viaYouthAdministrator: true as const }, "YOUTH_ADMINISTRATOR"],
  ["a Clubs Administrator", { viaClubsAdministrator: true as const }, "CLUBS_ADMINISTRATOR"],
  ["a system administrator", {}, undefined],
] as const;

beforeEach(() => vi.clearAllMocks());

describe.each(variants)("acting as an Area Coordinator as %s", (_label, marks, role) => {
  const expected = role ? { actorRole: role } : {};
  beforeEach(() => mocks.currentStaffActingContext.mockResolvedValue({ ...acting, ...marks }));

  it("labels the report layout and export audit entries", async () => {
    const actor = await resolveCoordinatorReportActor();
    expect(actor).toMatchObject({ kind: "act-as", ...marks });
    expect(auditActor(actor!).metadata).toMatchObject({ viewer: "AREA_COORDINATOR", actAsId: "act-1", ...expected });
    if (!role) expect(auditActor(actor!).metadata).not.toHaveProperty("actorRole");
  });

  it("labels the club forms views and link emails", async () => {
    const viewer = await resolveAreaCoordinatorViewer();
    expect(viewer).toMatchObject({ actor: marks });
    const fields = viewerAuditFields(viewer!);
    expect(fields.actorUserId).toBe("u-staff");
    expect(fields.metadata).toMatchObject({ actAsId: "act-1", ...expected });
    if (!role) expect(fields.metadata).not.toHaveProperty("actorRole");
  });

  it("labels the guardian views", async () => {
    const viewer = await resolveAreaGuardianViewer();
    expect(guardianAuditActor(viewer!).metadata).toMatchObject({ actAsId: "act-1", ...expected });
  });
});

it("never writes the Clubs Administrator label for a Youth Admin", async () => {
  mocks.currentStaffActingContext.mockResolvedValue({ ...acting, viaYouthAdministrator: true });
  const actor = await resolveCoordinatorReportActor();
  const viewer = await resolveAreaCoordinatorViewer();
  expect(JSON.stringify([auditActor(actor!), viewerAuditFields(viewer!)])).not.toContain("CLUBS_ADMINISTRATOR");
});

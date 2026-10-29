import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Draft saving and version publication (#114) against an in-memory stand-in
 * for the emergency plan tables. Synthetic data only.
 */
type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({
  plans: [] as Row[],
  locations: [] as Row[],
  procedures: [] as Row[],
  contacts: [] as Row[],
  versions: [] as Row[],
  audits: [] as Row[],
  event: { name: "Synthetic Camp Meeting", startsAt: new Date("2026-07-15T14:00:00Z"), endsAt: new Date("2026-07-19T20:00:00Z"), timezone: "America/Chicago" },
  nextId: 1,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => {
  const sorted = (rows: Row[], key: string) => [...rows].sort((a, b) => (a[key] as number) - (b[key] as number));
  const planFor = (where: { eventId?: string }) => store.plans.find((plan) => plan.eventId === where.eventId);
  const delegate = (rows: () => Row[], remove: (planId: unknown) => void) => ({
    deleteMany: async ({ where }: { where: { planId: unknown } }) => remove(where.planId),
    createMany: async ({ data }: { data: Row[] }) => { for (const row of data) rows().push({ id: `row-${store.nextId++}`, ...row }); },
  });
  const tx = {
    emergencyPlan: {
      findUnique: async ({ where }: { where: { eventId: string } }) => {
        const plan = planFor(where);
        if (!plan) return null;
        return {
          locations: sorted(store.locations.filter((row) => row.planId === plan.id), "sortOrder"),
          procedures: sorted(store.procedures.filter((row) => row.planId === plan.id), "sortOrder"),
          contacts: sorted(store.contacts.filter((row) => row.planId === plan.id), "escalationOrder"),
        };
      },
      upsert: async ({ where, create }: { where: { eventId: string }; create: Row }) => {
        let plan = planFor(where);
        if (!plan) { plan = { id: `plan-${store.nextId++}`, ...create }; store.plans.push(plan); }
        return { id: plan.id };
      },
      update: async () => ({}),
    },
    emergencyPlanLocation: delegate(() => store.locations, (planId) => { store.locations = store.locations.filter((row) => row.planId !== planId); }),
    emergencyPlanProcedure: delegate(() => store.procedures, (planId) => { store.procedures = store.procedures.filter((row) => row.planId !== planId); }),
    emergencyPlanContact: delegate(() => store.contacts, (planId) => { store.contacts = store.contacts.filter((row) => row.planId !== planId); }),
    emergencyPlanVersion: {
      aggregate: async ({ where }: { where: { planId: unknown } }) => ({
        _max: { versionNumber: Math.max(0, ...store.versions.filter((row) => row.planId === where.planId).map((row) => row.versionNumber as number)) || null },
      }),
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: `version-${store.nextId++}`, publishedAt: new Date(), ...data };
        store.versions.push(row);
        return { id: row.id, versionNumber: row.versionNumber, publishedAt: row.publishedAt };
      },
      findMany: async () => sorted(store.versions, "versionNumber").reverse(),
      findFirst: async ({ where }: { where: { versionNumber?: number } }) => {
        const rows = sorted(store.versions.filter((row) => where.versionNumber === undefined || row.versionNumber === where.versionNumber), "versionNumber").reverse();
        return rows[0] ?? null;
      },
    },
    event: { findUnique: async () => store.event },
    auditLog: { create: async ({ data }: { data: Row }) => { store.audits.push(data); return data; } },
  };
  const client = { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) };
  return { getPrisma: () => client };
});

import { emergencyPlanDraftSchema } from "@/modules/emergency-plans/domain";
import { EmergencyPlanError } from "@/modules/emergency-plans/access";
import { getEmergencyPlanDraft, getEmergencyPlanVersion, listEmergencyPlanVersions, publishEmergencyPlan, saveEmergencyPlanDraft } from "@/modules/emergency-plans/repository";

const draftOne = emergencyPlanDraftSchema.parse({
  locations: [{ kind: "ASSEMBLY", name: "Main field", description: "", capacityNote: "", directions: "", mapReference: null }],
  procedures: [],
  contacts: [{ role: "Director", name: "Sample Director", phone: "(515) 555-0100", escalationOrder: 1 }],
});
const draftTwo = emergencyPlanDraftSchema.parse({
  ...draftOne,
  locations: [...draftOne.locations, { kind: "SHELTER", name: "Gym", description: "", capacityNote: "250", directions: "", mapReference: null }],
});

beforeEach(() => {
  Object.assign(store, { plans: [], locations: [], procedures: [], contacts: [], versions: [], audits: [], nextId: 1 });
});

describe("emergency plan versions", () => {
  it("publishes v1, then v2 after a draft edit, and v1 never changes", async () => {
    await saveEmergencyPlanDraft("event-1", draftOne, "staff-1");
    const first = await publishEmergencyPlan("event-1", "staff-1");
    expect(first.versionNumber).toBe(1);
    const v1Before = JSON.stringify((await getEmergencyPlanVersion("event-1", 1))?.snapshot);

    await saveEmergencyPlanDraft("event-1", draftTwo, "staff-1");
    // Editing the draft alone publishes nothing.
    expect((await listEmergencyPlanVersions("event-1")).map((row) => row.versionNumber)).toEqual([1]);
    expect(JSON.stringify((await getEmergencyPlanVersion("event-1", 1))?.snapshot)).toBe(v1Before);

    const second = await publishEmergencyPlan("event-1", "staff-1");
    expect(second.versionNumber).toBe(2);
    expect((await listEmergencyPlanVersions("event-1")).map((row) => row.versionNumber)).toEqual([2, 1]);

    const v1 = await getEmergencyPlanVersion("event-1", 1);
    const v2 = await getEmergencyPlanVersion("event-1", 2);
    expect(JSON.stringify(v1?.snapshot)).toBe(v1Before);
    expect(v1?.snapshot.locations).toHaveLength(1);
    expect(v2?.snapshot.locations).toHaveLength(2);
  });

  it("defaults to the latest published version, and is null when nothing is published", async () => {
    expect(await getEmergencyPlanVersion("event-1")).toBeNull();
    await saveEmergencyPlanDraft("event-1", draftOne, "staff-1");
    await publishEmergencyPlan("event-1", "staff-1");
    await saveEmergencyPlanDraft("event-1", draftTwo, "staff-1");
    await publishEmergencyPlan("event-1", "staff-1");
    expect((await getEmergencyPlanVersion("event-1"))?.versionNumber).toBe(2);
    expect(await getEmergencyPlanVersion("event-1", 9)).toBeNull();
  });

  it("round-trips the draft, with contacts in escalation order", async () => {
    const saved = await saveEmergencyPlanDraft("event-1", emergencyPlanDraftSchema.parse({
      ...draftOne,
      contacts: [
        { role: "Second", name: "B", phone: "(515) 555-0101", escalationOrder: 2 },
        { role: "First", name: "A", phone: "(515) 555-0100", escalationOrder: 1 },
      ],
    }), "staff-1");
    expect(saved.contacts.map((contact) => contact.role)).toEqual(["First", "Second"]);
    expect(await getEmergencyPlanDraft("event-1")).toEqual(saved);
  });

  it("refuses to publish an empty plan", async () => {
    await expect(publishEmergencyPlan("event-1", "staff-1")).rejects.toMatchObject({ code: "EMPTY_PLAN" });
    await expect(publishEmergencyPlan("event-1", "staff-1")).rejects.toBeInstanceOf(EmergencyPlanError);
    expect(store.versions).toHaveLength(0);
  });

  it("audits saves and publication with the acting staff user", async () => {
    await saveEmergencyPlanDraft("event-1", draftOne, "staff-9");
    await publishEmergencyPlan("event-1", "staff-9");
    expect(store.audits.map((entry) => [entry.action, entry.actorUserId, entry.eventId])).toEqual([
      ["emergency-plan.draft-saved", "staff-9", "event-1"],
      ["emergency-plan.published", "staff-9", "event-1"],
    ]);
    expect(store.versions[0].publishedByUserId).toBe("staff-9");
  });
});

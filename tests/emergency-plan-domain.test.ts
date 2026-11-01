import { describe, expect, it } from "vitest";
import {
  buildEmergencyPlanSnapshot,
  emergencyIssueTarget,
  emergencyPlanDraftSchema,
  parseEmergencyPlanSnapshot,
  snapshotAllowedKeys,
  type EmergencyPlanDraft,
} from "@/modules/emergency-plans/domain";

/** Emergency plan validation and the snapshot builder (#114). Synthetic data only. */

const event = { name: "Synthetic Camp Meeting", startsAt: new Date("2026-07-15T14:00:00Z"), endsAt: new Date("2026-07-19T20:00:00Z"), timezone: "America/Chicago" };

function draft(overrides: Partial<EmergencyPlanDraft> = {}) {
  return {
    locations: [{ kind: "ASSEMBLY", name: "Main field flagpole", description: "Open lawn by the flagpole.", capacityNote: "About 400", directions: "Out the north door, left.", mapReference: "Grid C4" }],
    procedures: [{ kind: "EVACUATION", title: "Evacuate the main hall", body: "Leave calmly.\n\nDo not use elevators.", items: [{ title: "Exit", text: "Use the nearest door." }] }],
    contacts: [
      { role: "Camp director", name: "Sample Director", phone: "(515) 555-0100", escalationOrder: 2 },
      { role: "Site security", name: "Sample Guard", phone: "515-555-0101", escalationOrder: 1 },
    ],
    ...overrides,
  };
}

describe("emergency plan draft validation", () => {
  it("accepts a complete plan and normalises phones", () => {
    const parsed = emergencyPlanDraftSchema.parse(draft());
    expect(parsed.contacts.map((contact) => contact.phone)).toEqual(["(515) 555-0100", "(515) 555-0101"]);
  });

  it("rejects an invalid phone, naming the problem and not the number", () => {
    const result = emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ role: "Director", name: "Sample", phone: "(555) 010-0100", escalationOrder: 1 }] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("10-digit US number");
      expect(result.error.issues[0].message).not.toContain("010-0100");
    }
  });

  it("requires a phone, a role, a name, and location and procedure names", () => {
    expect(emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ role: "Director", name: "Sample", phone: "", escalationOrder: 1 }] })).success).toBe(false);
    expect(emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ role: "", name: "Sample", phone: "(515) 555-0100", escalationOrder: 1 }] })).success).toBe(false);
    expect(emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ role: "Director", name: " ", phone: "(515) 555-0100", escalationOrder: 1 }] })).success).toBe(false);
    expect(emergencyPlanDraftSchema.safeParse(draft({ locations: [{ kind: "SHELTER", name: "", description: "", capacityNote: "", directions: "", mapReference: null }] })).success).toBe(false);
    expect(emergencyPlanDraftSchema.safeParse(draft({ procedures: [{ kind: "OTHER", title: "", body: "", items: [] }] })).success).toBe(false);
  });

  it("requires a positive, unique escalation order", () => {
    const contact = { role: "Director", name: "Sample", phone: "(515) 555-0100" };
    expect(emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ ...contact, escalationOrder: 0 }] })).success).toBe(false);
    expect(emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ ...contact, escalationOrder: 1.5 }] })).success).toBe(false);
    const duplicate = emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ ...contact, escalationOrder: 1 }, { ...contact, name: "Other", escalationOrder: 1 }] }));
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) expect(duplicate.error.issues[0].path).toEqual(["contacts", 1, "escalationOrder"]);
  });

  it("accepts a grid reference or an https map address and refuses other schemes", () => {
    const withMap = (mapReference: string) => emergencyPlanDraftSchema.safeParse(draft({ locations: [{ kind: "ASSEMBLY", name: "Gate", description: "", capacityNote: "", directions: "", mapReference }] }));
    expect(withMap("Grid C4").success).toBe(true);
    expect(withMap("https://maps.example.test/gate").success).toBe(true);
    expect(withMap("javascript:alert(1)").success).toBe(false);
    expect(withMap("data:text/html,x").success).toBe(false);
    expect(withMap("").success).toBe(true);
  });

  it("uses the event content step shape and refuses extra fields", () => {
    expect(emergencyPlanDraftSchema.safeParse(draft({ procedures: [{ kind: "OTHER", title: "Lockdown", body: "", items: [{ title: "", text: "x" }] }] })).success).toBe(false);
    expect(emergencyPlanDraftSchema.safeParse({ ...draft(), registrationId: "r1" }).success).toBe(false);
    expect(emergencyPlanDraftSchema.safeParse(draft({ locations: [{ kind: "ASSEMBLY", name: "Gate", description: "", capacityNote: "", directions: "", mapReference: null, personId: "p1" } as never] })).success).toBe(false);
  });

  it("limits a procedure body like event content", () => {
    expect(emergencyPlanDraftSchema.safeParse(draft({ procedures: [{ kind: "OTHER", title: "Long", body: "x".repeat(20001), items: [] }] })).success).toBe(false);
  });
});

describe("emergency plan snapshot", () => {
  it("copies only allowlisted keys, even when the input carries extras", () => {
    const parsed = emergencyPlanDraftSchema.parse(draft());
    const tainted = {
      locations: parsed.locations.map((row) => ({ ...row, personId: "p1", medicalNote: "x" })),
      procedures: parsed.procedures.map((row) => ({ ...row, incidentId: "i1", items: row.items.map((item) => ({ ...item, guardian: "g" })) })),
      contacts: parsed.contacts.map((row) => ({ ...row, email: "a@example.test", registrationId: "r1" })),
    } as unknown as EmergencyPlanDraft;
    const snapshot = buildEmergencyPlanSnapshot(tainted, event);
    expect(Object.keys(snapshot).sort()).toEqual([...snapshotAllowedKeys.root].sort());
    expect(Object.keys(snapshot.event).sort()).toEqual([...snapshotAllowedKeys.event].sort());
    for (const row of snapshot.locations) expect(Object.keys(row).sort()).toEqual([...snapshotAllowedKeys.location].sort());
    for (const row of snapshot.procedures) {
      expect(Object.keys(row).sort()).toEqual([...snapshotAllowedKeys.procedure].sort());
      for (const item of row.items) expect(Object.keys(item).sort()).toEqual([...snapshotAllowedKeys.item].sort());
    }
    for (const row of snapshot.contacts) expect(Object.keys(row).sort()).toEqual([...snapshotAllowedKeys.contact].sort());
    expect(JSON.stringify(snapshot)).not.toMatch(/personId|medicalNote|incidentId|guardian|registrationId|a@example/);
  });

  it("orders contacts by escalation and dates the event in its own timezone", () => {
    const snapshot = buildEmergencyPlanSnapshot(emergencyPlanDraftSchema.parse(draft()), event);
    expect(snapshot.contacts.map((contact) => contact.escalationOrder)).toEqual([1, 2]);
    expect(snapshot.event).toEqual({ name: "Synthetic Camp Meeting", startsOn: "2026-07-15", endsOn: "2026-07-19", timezone: "America/Chicago" });
  });

  it("reads back only a snapshot of the expected shape", () => {
    const snapshot = buildEmergencyPlanSnapshot(emergencyPlanDraftSchema.parse(draft()), event);
    expect(parseEmergencyPlanSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(parseEmergencyPlanSnapshot({ ...snapshot, attendees: [] })).toBeNull();
    expect(parseEmergencyPlanSnapshot(null)).toBeNull();
  });
});

describe("mapping an issue back to its field", () => {
  it("names the entry and the field the editor marks invalid", () => {
    expect(emergencyIssueTarget(["contacts", 3, "phone"])).toEqual({ fieldKey: "con-phone-3", entry: "Contact 4" });
    expect(emergencyIssueTarget(["contacts", 0, "escalationOrder"])).toEqual({ fieldKey: "con-order-0", entry: "Contact 1" });
    expect(emergencyIssueTarget(["locations", 1, "mapReference"])).toEqual({ fieldKey: "loc-map-1", entry: "Location 2" });
    expect(emergencyIssueTarget(["procedures", 0, "title"])).toEqual({ fieldKey: "proc-title-0", entry: "Procedure 1" });
    expect(emergencyIssueTarget(["procedures", 2, "items", 1, "title"])).toEqual({ fieldKey: "step-title-2-1", entry: "Procedure 3, step 2" });
    expect(emergencyIssueTarget(["contacts"])).toEqual({ fieldKey: null, entry: null });
  });

  it("gives a blank escalation order a sentence, not a type error", () => {
    const result = emergencyPlanDraftSchema.safeParse(draft({ contacts: [{ role: "Director", name: "Sample", phone: "(515) 555-0100", escalationOrder: "" as unknown as number }] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("escalation order");
  });
});

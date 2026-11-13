import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GATE_MODE_OFF_MESSAGE,
  classifyGateEntry,
  gateArrivalSchema,
  gateLookupSchema,
  gateModeToggleSchema,
  gateStateFor,
  gateStateLabel,
  gateStateReminder,
} from "@/modules/checkin-stations/domain";

const key = "d67776d0-f79d-4e8f-bec2-ee61abb7337c";

describe("gate mode domain (#1684)", () => {
  it("accepts a pass or a name of two to eighty characters, trimmed", () => {
    expect(gateLookupSchema.parse({ kind: "name", value: "  Jo  " })).toEqual({ kind: "name", value: "Jo" });
    expect(gateLookupSchema.parse({ kind: "pass", value: "abc.def" })).toEqual({ kind: "pass", value: "abc.def" });
    expect(gateLookupSchema.safeParse({ kind: "name", value: "J" }).success).toBe(false);
    expect(gateLookupSchema.safeParse({ kind: "name", value: "x".repeat(81) }).success).toBe(false);
    expect(gateLookupSchema.safeParse({ kind: "name", value: "x".repeat(80) }).success).toBe(true);
    expect(gateLookupSchema.safeParse({ kind: "confirmation", value: "ABC123" }).success).toBe(false);
    expect(gateLookupSchema.safeParse({ kind: "name", value: "Jo Park", extra: 1 }).success).toBe(false);
  });

  it("needs a real key and one attendee for an arrival, and a boolean for the switch", () => {
    expect(gateArrivalSchema.safeParse({ attendeeId: "a1", idempotencyKey: key }).success).toBe(true);
    expect(gateArrivalSchema.safeParse({ attendeeId: "a1", idempotencyKey: "nope" }).success).toBe(false);
    expect(gateArrivalSchema.safeParse({ attendeeId: "", idempotencyKey: key }).success).toBe(false);
    expect(gateModeToggleSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(gateModeToggleSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(gateModeToggleSchema.safeParse({}).success).toBe(false);
  });

  it("tells a long dotted token (a pass) from a name", () => {
    expect(classifyGateEntry("   ")).toBeNull();
    expect(classifyGateEntry("Sam Rivera")).toEqual({ kind: "name", value: "Sam Rivera" });
    expect(classifyGateEntry("imsda-pass.v1.abcdefghijklmnop.signature")?.kind).toBe("pass");
    expect(classifyGateEntry("Sam R. Rivera-Smith-Long-Name")?.kind).toBe("name");
  });

  it("maps Sterling to the green or yellow state, with words for each state", () => {
    expect(gateStateFor(null)).toBe("REGISTERED");
    expect(gateStateFor(true)).toBe("REGISTERED");
    expect(gateStateFor(false)).toBe("STERLING_NOT_CURRENT");
    expect(gateStateLabel("REGISTERED")).toBe("Registered");
    expect(gateStateLabel("STERLING_NOT_CURRENT")).toBe("Registered: Sterling not current");
    expect(gateStateLabel("NOT_REGISTERED")).toBe("Not registered");
    expect(gateStateReminder("REGISTERED")).toBe("Let them in.");
    expect(gateStateReminder("STERLING_NOT_CURRENT")).toBe("Call the event lead before letting them in.");
    expect(gateStateReminder("NOT_REGISTERED")).toBe("Send them to registration or call the event lead.");
    expect(GATE_MODE_OFF_MESSAGE).toMatch(/off/i);
  });
});

describe("gate mode schema (#1684)", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20270160100000_check_in_gate_mode/migration.sql", "utf8");

  it("is off by default and stores arrivals with a unique key", () => {
    expect(schema).toMatch(/checkInGateModeEnabled\s+Boolean\s+@default\(false\)/);
    expect(migration).toContain('ADD COLUMN "checkInGateModeEnabled" BOOLEAN NOT NULL DEFAULT false');
    const model = /model CheckInGateArrival \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
    expect(model).toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(model).toMatch(/event\s+Event\s+@relation\(.*onDelete: Cascade/);
    expect(model).toMatch(/attendee\s+RegistrationAttendee\s+@relation\(.*onDelete: Cascade/);
    expect(model).toMatch(/station\s+CheckInStation\?\s+@relation\(.*onDelete: SetNull/);
    expect(model).toContain("@@index([eventId, attendeeId])");
    expect(model).not.toMatch(/birth|health|payment|email|phone/i);
  });

  it("is not copied into a cloned event", () => {
    for (const file of ["modules/event-clones/repository.ts", "modules/event-clones/domain.ts", "modules/event-templates/repository.ts"]) {
      expect(readFileSync(file, "utf8")).not.toContain("checkInGateModeEnabled");
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  MAX_ASSIGNMENTS_PER_ACTIVITY,
  activityGaps,
  activityInputSchema,
  assignmentConflict,
  assignmentInputSchema,
  roleCounts,
  sortAssignments,
  staffingCsv,
  summarizeStaffing,
  type ActivityView,
  type AssignmentView,
} from "@/modules/event-staffing/domain";

let counter = 0;
const person = (role: AssignmentView["role"], name: string, extra: Partial<AssignmentView> = {}): AssignmentView => {
  counter += 1;
  const [first = "", last = ""] = name.split(" ");
  return { id: `a${counter}`, role, kind: "person", assigneeId: `p${counter}`, name, sortedName: `${last}, ${first}`, active: true, ...extra };
};
const activity = (name: string, over: Partial<ActivityView> = {}): ActivityView => ({
  id: `act-${name}`, name, description: "", location: "", timeText: "", tltsNeeded: 0, lifeguardsNeeded: 0, helpersNeeded: 0, assignments: [], ...over,
});

describe("gaps on the staffing sheet (#1678)", () => {
  it("says no lead when an activity has none", () => {
    expect(activityGaps(activity("Surprise")).map((gap) => gap.text)).toEqual(["Surprise: no lead"]);
  });

  it("says how many of each role are in place, in the words the owner gave", () => {
    const canoe = activity("Canoe", { lifeguardsNeeded: 4, assignments: [person("LEAD", "Sam Sample"), person("LIFEGUARD", "Pat Example"), person("LIFEGUARD", "Lee Sample")] });
    const frisbee = activity("Frisbee", { tltsNeeded: 3, assignments: [person("LEAD", "Alex Sample")] });
    expect(activityGaps(canoe).map((gap) => gap.text)).toEqual(["Canoe: 2 of 4 lifeguards"]);
    expect(activityGaps(frisbee).map((gap) => gap.text)).toEqual(["Frisbee: 0 of 3 TLTs"]);
    expect(summarizeStaffing([activity("Surprise"), canoe, frisbee])).toMatchObject({ activityCount: 3, activitiesWithGaps: 3 });
  });

  it("has no gap once everything is filled, and more than needed is not a gap", () => {
    const full = activity("Catapult", { helpersNeeded: 1, assignments: [person("LEAD", "Sam Sample"), person("HELPER", "Pat Example"), person("HELPER", "Lee Sample")] });
    expect(activityGaps(full)).toEqual([]);
    expect(summarizeStaffing([full])).toEqual({ activityCount: 1, activitiesWithGaps: 0, gaps: [] });
  });

  it("counts nobody who is no longer registered", () => {
    const stale = activity("Canoe", { lifeguardsNeeded: 1, assignments: [person("LEAD", "Sam Sample", { active: false }), person("LIFEGUARD", "Pat Example", { active: false })] });
    expect(activityGaps(stale).map((gap) => gap.text)).toEqual(["Canoe: no lead", "Canoe: 0 of 1 lifeguards"]);
  });

  it("counts TLT rows when the table holds them, so tag-based assignment can be added later", () => {
    const tlt = activity("Frisbee", { tltsNeeded: 2, assignments: [person("LEAD", "Sam Sample"), person("TLT", "Kit Example")] });
    expect(roleCounts(tlt)).toEqual([{ role: "TLT", needed: 2, assigned: 1 }]);
    expect(activityGaps(tlt).map((gap) => gap.text)).toEqual(["Frisbee: 1 of 2 TLTs"]);
  });
});

describe("what may be saved", () => {
  it("accepts a plain activity with counts, defaulting the optional text and the counts", () => {
    expect(activityInputSchema.parse({ name: " Canoe ", lifeguardsNeeded: 4 })).toEqual({ name: "Canoe", description: "", location: "", timeText: "", tltsNeeded: 0, lifeguardsNeeded: 4, helpersNeeded: 0 });
  });

  it("refuses a missing name, negative or fractional or huge counts, and fields it does not have", () => {
    for (const bad of [{}, { name: "  " }, { name: "A", tltsNeeded: -1 }, { name: "A", tltsNeeded: 1.5 }, { name: "A", helpersNeeded: 201 }, { name: "A", ageLimit: 12 }, { name: "x".repeat(81) }]) {
      expect(activityInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("only lets lead, adult helper and lifeguard be assigned in this slice, never TLT", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["LEAD", "HELPER", "LIFEGUARD"]);
    const base = { activityId: "act-1", assignee: { kind: "person", id: "p1" } };
    for (const role of ASSIGNABLE_ROLES) expect(assignmentInputSchema.safeParse({ ...base, role }).success).toBe(true);
    expect(assignmentInputSchema.safeParse({ ...base, role: "TLT" }).success).toBe(false);
  });

  it("takes an assignee as a kind and an id only, nothing else", () => {
    expect(assignmentInputSchema.safeParse({ activityId: "a", role: "LEAD", assignee: { kind: "person", id: "p", name: "Sam" } }).success).toBe(false);
    expect(assignmentInputSchema.safeParse({ activityId: "a", role: "LEAD", assignee: { kind: "attendee", id: "p" } }).success).toBe(false);
    expect(assignmentInputSchema.safeParse({ activityId: "a", role: "LEAD", assignee: { kind: "user", id: "u1" } }).success).toBe(true);
  });

  it("refuses the same person twice on one activity, and a crowded activity", () => {
    const sam = person("HELPER", "Sam Sample", { assigneeId: "p-sam" });
    expect(assignmentConflict(activity("Canoe", { assignments: [sam] }), { role: "LIFEGUARD", assignee: { kind: "person", id: "p-sam" } })).toMatchObject({ code: "CONFLICT" });
    expect(assignmentConflict(activity("Canoe", { assignments: [sam] }), { role: "LIFEGUARD", assignee: { kind: "user", id: "p-sam" } })).toBeNull();
    const crowded = activity("Canoe", { assignments: Array.from({ length: MAX_ASSIGNMENTS_PER_ACTIVITY }, (_, index) => person("HELPER", `Pat Person${index}`)) });
    expect(assignmentConflict(crowded, { role: "HELPER", assignee: { kind: "person", id: "new" } })).toMatchObject({ code: "TOO_MANY" });
  });
});

describe("the CSV", () => {
  const sheet = [
    activity("Canoe", { lifeguardsNeeded: 2, assignments: [person("LIFEGUARD", "Pat Example"), person("LEAD", "Sam Sample"), person("HELPER", "Gone Person", { active: false })] }),
    activity("Surprise"),
  ];
  const csv = staffingCsv("Sample Spring Camporee", sheet);

  it("lists activity, role and name with the lead first, and leaves out people no longer on the event", () => {
    const lines = csv.trim().split("\r\n");
    expect(lines.slice(0, 5)).toEqual([
      '"Event staffing","Sample Spring Camporee",""',
      '"Activity","Role","Name"',
      '"Canoe","Lead","Sample, Sam"',
      '"Canoe","Lifeguard","Example, Pat"',
      '"","",""',
    ]);
    expect(csv).not.toContain("Gone");
  });

  it("lists what is still needed after the names", () => {
    expect(csv).toContain('"Still needed","Role","Short by"');
    expect(csv).toContain('"Canoe","Lifeguard","1"');
    expect(csv).toContain('"Surprise","Lead","1"');
  });

  it("has no column for contact details, ages or birth dates", () => {
    expect(csv.split("\r\n")[1]).toBe('"Activity","Role","Name"');
    expect(csv).not.toMatch(/@|birth|age|phone|email/i);
  });

  it("guards a name that starts like a formula", () => {
    const tricky = staffingCsv("E", [activity("A", { assignments: [person("LEAD", "=Cmd Evil", { sortedName: "=Evil, Cmd" })] })]);
    expect(tricky).toContain(`"'=Evil, Cmd"`);
  });

  it("orders people lead, TLT, lifeguard, helper, then by name", () => {
    const ordered = sortAssignments([person("HELPER", "Zed A"), person("LEAD", "Y B"), person("LIFEGUARD", "X C"), person("TLT", "W D"), person("HELPER", "Aaa A")]);
    expect(ordered.map((entry) => entry.role)).toEqual(["LEAD", "TLT", "LIFEGUARD", "HELPER", "HELPER"]);
    expect(ordered.at(-1)!.sortedName).toBe("A, Zed");
  });
});

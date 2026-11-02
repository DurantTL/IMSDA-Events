import { describe, expect, it } from "vitest";
import { staffAssignmentDirty } from "@/components/staff-assignment-dirty";

const blank = { displayName: "", email: "", role: "READ_ONLY_STAFF", status: "ACTIVE" };

describe("staffAssignmentDirty (#1468)", () => {
  it("is clean when no dialog is open", () => {
    expect(staffAssignmentDirty(null, { ...blank, displayName: "Alex" }, null)).toBe(false);
  });

  it("adding is dirty once a name or email is typed or the role moves off the default", () => {
    expect(staffAssignmentDirty("add", blank, null)).toBe(false);
    expect(staffAssignmentDirty("add", { ...blank, displayName: "  " }, null)).toBe(false);
    expect(staffAssignmentDirty("add", { ...blank, displayName: "Alex Staff" }, null)).toBe(true);
    expect(staffAssignmentDirty("add", { ...blank, email: "alex@example.org" }, null)).toBe(true);
    expect(staffAssignmentDirty("add", { ...blank, role: "EVENT_ADMIN" }, null)).toBe(true);
  });

  it("editing is dirty only while the role or access differs from the saved assignment", () => {
    const saved = { role: "EVENT_ADMIN", status: "ACTIVE" };
    expect(staffAssignmentDirty("edit", { ...blank, role: "EVENT_ADMIN" }, saved)).toBe(false);
    expect(staffAssignmentDirty("edit", { ...blank, role: "READ_ONLY_STAFF" }, saved)).toBe(true);
    expect(staffAssignmentDirty("edit", { ...blank, role: "EVENT_ADMIN", status: "INACTIVE" }, saved)).toBe(true);
  });
});

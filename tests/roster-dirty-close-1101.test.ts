import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  rosterCloseDecision,
  rosterDialogIsDirty,
  rosterDiscardPrompt,
  rosterFormSnapshot,
  rosterFormSnapshots,
} from "@/components/roster-dialog-dirty";

const loaded: Array<[string, string]> = [
  ["firstName", "Sample"],
  ["lastName", "Pathfinder"],
  ["role", ""],
  ["g1Name", "Example Guardian"],
  ["g1Phone", "555-0100"],
];

describe("roster editor dirty tracking (#1101)", () => {
  it("is clean right after load and ignores field order", () => {
    const baseline = rosterFormSnapshots(loaded);
    expect(rosterDialogIsDirty(baseline, rosterFormSnapshots([...loaded].reverse()))).toBe(false);
    expect(rosterDialogIsDirty(null, baseline)).toBe(false);
  });

  it("detects person and contact edits independently", () => {
    const baseline = rosterFormSnapshots(loaded);
    const personEdit = loaded.map(([k, v]): [string, string] => (k === "firstName" ? [k, "Changed"] : [k, v]));
    const contactEdit = loaded.map(([k, v]): [string, string] => (k === "g1Phone" ? [k, "555-0111"] : [k, v]));
    expect(rosterDialogIsDirty(baseline, rosterFormSnapshots(personEdit))).toBe(true);
    expect(rosterDialogIsDirty(baseline, rosterFormSnapshots(contactEdit))).toBe(true);
  });

  it("keeps person and contact snapshots separate so a contact refresh cannot hide person edits", () => {
    expect(rosterFormSnapshot(loaded, "person")).not.toContain("g1Name");
    expect(rosterFormSnapshot(loaded, "contacts")).not.toContain("firstName");
    const baseline = rosterFormSnapshots(loaded);
    const edited = rosterFormSnapshots(loaded.map(([k, v]): [string, string] => (k === "lastName" ? [k, "Typed"] : [k, v])));
    // Re-baselining contacts only (as a guardian refresh does) leaves the person edit visible.
    expect(rosterDialogIsDirty({ ...baseline, contacts: edited.contacts }, edited)).toBe(true);
  });

  it("decides one way for every dismissal path", () => {
    expect(rosterCloseDecision({ saving: false, reviewing: false, dirty: false })).toBe("close");
    expect(rosterCloseDecision({ saving: false, reviewing: false, dirty: true })).toBe("confirm");
    expect(rosterCloseDecision({ saving: true, reviewing: false, dirty: true })).toBe("ignore");
    expect(rosterCloseDecision({ saving: true, reviewing: false, dirty: false })).toBe("ignore");
    expect(rosterCloseDecision({ saving: false, reviewing: true, dirty: true })).toBe("ignore");
  });

  it("offers Keep editing or Discard changes", () => {
    expect(rosterDiscardPrompt.confirmLabel).toBe("Discard changes");
    expect(rosterDiscardPrompt.cancelLabel).toBe("Keep editing");
    expect(rosterDiscardPrompt.destructive).toBe(true);
  });

  it("routes Close, Cancel, Escape and the backdrop through requestClose; save success closes directly", () => {
    const source = readFileSync(path.join(process.cwd(), "components/club-roster-workspace.tsx"), "utf8");
    expect(source).toMatch(/useAccessibleDialog<HTMLElement>\(dialogOpen,\s*requestClose\)/);
    expect(source).toMatch(/event\.target === event\.currentTarget\)\s*void requestClose\(\)/);
    expect(source.match(/onClick=\{\(\) => void requestClose\(\)\}/g)).toHaveLength(2);
    expect(source).not.toMatch(/onClick=\{closeDialog\}/);
    // Only a successful save result closes the dialog and resets the form.
    expect(source).toMatch(/if \(result\) \{\s*setBirthDates\(null\);\s*formElement\.reset\(\);\s*closeDialog\(\);/);
  });

  it("Deactivate/Reactivate warns when there are unsaved edits", () => {
    const source = readFileSync(path.join(process.cwd(), "components/club-roster-workspace.tsx"), "utf8");
    const start = source.indexOf("async function confirmSetStatus");
    const body = source.slice(start, source.indexOf("async function remove", start));
    expect(body).toMatch(/editorIsDirty\(\)/);
    expect(body).toContain("You have unsaved changes. Save them first, or they will be discarded.");
  });

  it("Keep editing returns focus inside the editor", () => {
    const source = readFileSync(path.join(process.cwd(), "components/club-roster-workspace.tsx"), "utf8");
    const start = source.indexOf("const requestClose");
    const body = source.slice(start, source.indexOf("useAccessibleDialog<HTMLElement>", start));
    expect(body).toMatch(/document\.activeElement/);
    expect(body).toMatch(/previous\.focus\(\)/);
    expect(body).toMatch(/dialog\?\.focus\(\)/);
  });
});

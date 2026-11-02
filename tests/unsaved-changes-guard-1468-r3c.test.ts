// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { returnSheetDirty } from "@/components/asset-return-panel";
import { formHasEdits } from "@/components/form-has-edits";

function form(html: string) {
  const el = document.createElement("form");
  el.innerHTML = html;
  return el;
}

describe("unsaved-changes helpers, round 3c (#1468)", () => {
  it("an uncontrolled form is dirty only when a field moved off its starting value", () => {
    const html = '<input name="a" value="x"><select name="s"><option value="1">1</option><option value="2" selected>2</option></select><input type="checkbox" name="c" checked><input type="hidden" name="h" value="k">';
    expect(formHasEdits(form(html))).toBe(false);

    const typed = form(html);
    (typed.elements.namedItem("a") as HTMLInputElement).value = "y";
    expect(formHasEdits(typed)).toBe(true);

    const picked = form(html);
    (picked.elements.namedItem("s") as HTMLSelectElement).value = "1";
    expect(formHasEdits(picked)).toBe(true);

    const unticked = form(html);
    (unticked.elements.namedItem("c") as HTMLInputElement).checked = false;
    expect(formHasEdits(unticked)).toBe(true);

    const reset = form(html);
    (reset.elements.namedItem("a") as HTMLInputElement).value = "y";
    reset.reset();
    expect(formHasEdits(reset)).toBe(false);
  });

  it("a return sheet is dirty once an item has an outcome, typed text or a scanned code", () => {
    const blank = { outcome: "" as const, quantity: "", note: "", evidenceRef: "", replacement: "" };
    expect(returnSheetDirty({}, [])).toBe(false);
    expect(returnSheetDirty({ a: blank }, [])).toBe(false);
    expect(returnSheetDirty({ a: { ...blank, outcome: "RETURNED" } }, [])).toBe(true);
    expect(returnSheetDirty({ a: { ...blank, note: "  " } }, [])).toBe(false);
    expect(returnSheetDirty({ a: { ...blank, note: "cracked" } }, [])).toBe(true);
    expect(returnSheetDirty({}, ["K-214"])).toBe(true);
  });

  it("each form changed in this round mounts the guard", () => {
    for (const path of [
      "components/asset-closeout-workspace.tsx",
      "components/asset-issue-desk.tsx",
      "components/asset-return-panel.tsx",
      "components/issued-assets-workspace.tsx",
      "components/check-in-station.tsx",
      "components/attendance-reconciliation-controls.tsx",
      "components/kitchen-counts-entry.tsx",
      "components/meals-workspace.tsx",
      "components/notifications-workspace.tsx",
    ]) {
      expect(readFileSync(join(__dirname, "..", path), "utf8"), path).toContain("useUnsavedChangesGuard(");
    }
  });
});

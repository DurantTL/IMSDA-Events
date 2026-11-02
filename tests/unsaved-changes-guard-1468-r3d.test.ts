// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formHasEdits } from "@/components/form-has-edits";
import { useEditedForms } from "@/components/use-edited-forms";

/** #1468 round 3d: the shared helpers for the finance and lodging forms. Synthetic data only. */

function form(html: string) {
  const el = document.createElement("form");
  el.innerHTML = html;
  return el;
}

beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => document.body.replaceChildren());

function Harness() {
  const edits = useEditedForms();
  const [shown, setShown] = useState(true);
  return createElement("div", { "data-dirty": String(edits.dirty) },
    shown ? createElement("form", { id: "a", ref: edits.gone("a"), onChange: edits.track("a") }, createElement("input", { name: "reason", defaultValue: "" })) : null,
    createElement("form", { id: "b", onChange: edits.track("b") }, createElement("input", { name: "note", defaultValue: "" })),
    createElement("button", { id: "clear", type: "button", onClick: () => edits.clear("b") }),
    createElement("button", { id: "hide", type: "button", onClick: () => setShown(false) }),
  );
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(id: string) { await act(async () => { (document.getElementById(id) as HTMLButtonElement).click(); }); }

describe("unsaved-changes helpers, round 3d (#1468)", () => {
  it("formHasEdits can skip named controlled fields", () => {
    const el = form('<input name="amount" value=""><input name="sponsorName" value="">');
    (el.elements.namedItem("sponsorName") as HTMLInputElement).value = "typed";
    expect(formHasEdits(el)).toBe(true);
    expect(formHasEdits(el, { ignore: ["sponsorName"] })).toBe(false);
    (el.elements.namedItem("amount") as HTMLInputElement).value = "5";
    expect(formHasEdits(el, { ignore: ["sponsorName"] })).toBe(true);
  });

  it("useEditedForms tracks each form by key, clears on a change back, on clear(), and when the form leaves the page", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
    const dirty = () => host.firstElementChild!.getAttribute("data-dirty");
    const a = host.querySelector("#a input") as HTMLInputElement;
    const b = host.querySelector("#b input") as HTMLInputElement;
    expect(dirty()).toBe("false");

    await type(a, "why");
    expect(dirty()).toBe("true");
    await type(a, "");
    expect(dirty()).toBe("false");

    await type(b, "note");
    await type(a, "why");
    await click("clear");
    expect(dirty()).toBe("true");

    await click("hide");
    expect(dirty()).toBe("false");
    await act(async () => root.unmount());
  });

  it("the merge dialog is clean when it opens with the first person pre-selected, and dirty only on a different pick or a reason", () => {
    const src = readFileSync(join(__dirname, "..", "components/duplicate-match-review-workspace.tsx"), "utf8");
    expect(src).toContain("primaryPersonId !== merging.personA.id || mergeReason.trim() !== \"\"");
    expect(src).toContain("setMerging(candidate); setPrimaryPersonId(candidate.personA.id)");
  });

  it("the finance adjustment form counts the controlled fund and Type fields from state", () => {
    const src = readFileSync(join(__dirname, "..", "components/finance-workspace.tsx"), "utf8");
    expect(src).toContain('adjustKind !== "SCHOLARSHIP" || fundEdited');
    expect(src).toContain("onEdited={setFundEdited}");
    const fields = readFileSync(join(__dirname, "..", "components/scholarship-fund-award-fields.tsx"), "utf8");
    expect(fields).toContain("const edited = useFund;");
    expect(fields).toContain("return () => onEdited?.(false)");
  });

  it("each form changed in this round mounts the guard", () => {
    for (const path of [
      "components/finance-workspace.tsx",
      "components/invoice-controls.tsx",
      "components/invoice-ledger-controls.tsx",
      "components/billing-responsibility-controls.tsx",
      "components/scholarship-fund-workspace.tsx",
      "components/lodging-workspace.tsx",
      "components/lodging-assignments-workspace.tsx",
      "components/lodging-assignments-panels.tsx",
      "components/lodging-requests-workspace.tsx",
      "components/duplicate-match-review-workspace.tsx",
    ]) {
      expect(readFileSync(join(__dirname, "..", path), "utf8"), path).toContain("useUnsavedChangesGuard(");
    }
  });
});

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formHasEdits, samePhoneNumber } from "@/components/form-has-edits";
import { useEditedForms } from "@/components/use-edited-forms";

/** #1468 round 3e: the helpers added for the honors, people, calendar and team-result forms. Synthetic data only. */

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
    shown ? createElement("form", { id: "a", ref: edits.gone("a", "a:phone"), onChange: edits.track("a", { ignore: ["phone"] }) },
      createElement("input", { name: "reason", defaultValue: "" }),
      createElement("input", { name: "phone", defaultValue: "" })) : null,
    createElement("button", { id: "mark", type: "button", onClick: () => edits.mark("a:phone", true) }),
    createElement("button", { id: "hide", type: "button", onClick: () => setShown(false) }),
  );
}

async function click(id: string) { await act(async () => { (document.getElementById(id) as HTMLButtonElement).click(); }); }

describe("unsaved-changes helpers, round 3e (#1468)", () => {
  it("formHasEdits can skip a controlled group of unnamed fields by selector", () => {
    const el = form('<input name="title" value=""><fieldset class="repeat"><input type="checkbox" checked><input type="search" value=""></fieldset>');
    const group = el.querySelector(".repeat")!;
    (group.querySelector("input[type=checkbox]") as HTMLInputElement).checked = false;
    (group.querySelector("input[type=search]") as HTMLInputElement).value = "typed";
    expect(formHasEdits(el)).toBe(true);
    expect(formHasEdits(el, { ignoreWithin: ".repeat" })).toBe(false);
    (el.elements.namedItem("title") as HTMLInputElement).value = "Rally";
    expect(formHasEdits(el, { ignoreWithin: ".repeat" })).toBe(true);
  });

  it("samePhoneNumber treats a tidied valid number as the same number, and a different number as a change", () => {
    expect(samePhoneNumber("5155550134", "(515) 555-0134")).toBe(true);
    expect(samePhoneNumber("(515) 555-0134", "(515) 555-0134")).toBe(true);
    expect(samePhoneNumber("", "")).toBe(true);
    expect(samePhoneNumber("(515) 555-0135", "(515) 555-0134")).toBe(false);
    expect(samePhoneNumber("5155550134", "")).toBe(false);
  });

  it("mark() records a field the form cannot see, and leaving the page clears it with the form's own key", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
    const dirty = () => host.firstElementChild!.getAttribute("data-dirty");
    expect(dirty()).toBe("false");
    await click("mark");
    expect(dirty()).toBe("true");
    await click("hide");
    expect(dirty()).toBe("false");
    await act(async () => root.unmount());
  });

  it("each form changed in this round mounts the guard", () => {
    for (const path of [
      "components/honor-catalog-workspace.tsx",
      "components/honor-seat-override.tsx",
      "components/honor-watch-panel.tsx",
      "components/honors-instructors-workspace.tsx",
      "components/honors-schedule-board.tsx",
      "components/honors-setup-workspace.tsx",
      "components/people-workspace.tsx",
      "components/person-access-controls.tsx",
      "components/calendar-admin-workspace.tsx",
      "components/calendar-feeds-panel.tsx",
      "components/team-results-workspace.tsx",
    ]) {
      expect(readFileSync(join(__dirname, "..", path), "utf8"), path).toContain("useUnsavedChangesGuard(");
    }
  });

  it("the two public entries left the follow-up list in round 3f", () => {
    const list = readFileSync(join(__dirname, "unsaved-changes-guard-1452.test.ts"), "utf8");
    expect(list).not.toContain('"components/public-registration-contact-form.tsx": "needs guard');
    expect(list).not.toContain('"components/cancellation-request-panel.tsx": "needs guard');
  });
});

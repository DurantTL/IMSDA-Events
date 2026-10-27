// @vitest-environment jsdom
import { createElement, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));

import { RegistrationBuilderWorkspace } from "@/components/registration-builder-workspace";
import { editDraftKey, saveEditDraft } from "@/lib/local-edit-draft";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { buttonByText, click, mount, type Mounted } from "./helpers/dom-render";

/** The registration builder's local backup (#1263): restore, switching forms, a refused value, Discard. Synthetic data only. */
const stamp = "2026-09-01T00:00:00.000Z";
const definitionWith = (label: string) => registrationFormDefinitionSchema.parse({
  title: "Fall Camporee", description: "", confirmationMessage: "Saved.",
  sections: [{ id: "s_one", title: "Details", description: "", fields: [
    { id: "f_one", key: "camp_name", label, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
  ] }],
});
function formView(id: string, name: string, label: string) {
  const version = { id: `ver_${id}`, versionNumber: 1, status: "DRAFT", definition: definitionWith(label), updatedAt: stamp, createdAt: stamp, publishedAt: null, createdBy: "Synthetic Admin", testSubmissionCount: 0, choiceUsage: {}, testSubmissions: [] };
  return { id, eventId: "evt_1", createdBy: "Synthetic Admin", createdAt: stamp, name, slug: id, status: "DRAFT", updatedAt: stamp, activeVersion: version, versions: [version] };
}
const forms = [formView("form_a", "Form A", "Saved A question"), formView("form_b", "Form B", "Saved B question")];
const keyFor = (formId: string) => editDraftKey("registration-builder", `evt_1:${formId}`);

let mounted: Mounted | null = null;
const tick = (ms = 10) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
// Question labels show as text in the field rows; input values hold the form title and section names.
const shown = () => `${mounted!.container.textContent ?? ""} ${[...mounted!.container.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value).join(" ")}`;
const buttonContaining = (text: string) => {
  const match = [...mounted!.container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
  if (!match) throw new Error(`No button containing "${text}"`);
  return match;
};
const open = async (initialForms = forms) => {
  mounted = await mount(createElement(RegistrationBuilderWorkspace, {
    eventId: "evt_1", eventSlug: "fall", eventName: "Fall", initialForms: initialForms as never, templates: [], layout: "classic",
  }));
  await tick();
};

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe("registration builder backup (#1263)", () => {
  it("restores unsaved edits to the open form after a reload and shows the notice", async () => {
    saveEditDraft(window.localStorage, keyFor("form_a"), stamp, definitionWith("Unsaved A question"));
    await open();
    expect(mounted!.container.textContent).toContain("We restored your unsaved changes from earlier.");
    expect(shown()).toContain("Unsaved A question");
    expect(shown()).not.toContain("Saved A question");
  });

  it("restores the backup of a form chosen later, and does not clear it while switching", async () => {
    saveEditDraft(window.localStorage, keyFor("form_b"), stamp, definitionWith("Unsaved B question"));
    await open();
    expect(mounted!.container.textContent).not.toContain("We restored your unsaved changes");
    await click(buttonContaining("Form B"));
    expect(window.localStorage.getItem(keyFor("form_b"))).not.toBeNull();
    await tick();
    expect(shown()).toContain("Unsaved B question");
    expect(mounted!.container.textContent).toContain("We restored your unsaved changes from earlier.");
    expect(window.localStorage.getItem(keyFor("form_b"))).not.toBeNull();
  });

  it("rejects a backup that is not a valid form definition, removes it and shows no notice", async () => {
    saveEditDraft(window.localStorage, keyFor("form_a"), stamp, { title: 7, sections: "nope" });
    await open();
    expect(mounted!.container.textContent).not.toContain("We restored your unsaved changes");
    expect(shown()).toContain("Saved A question");
    expect(window.localStorage.getItem(keyFor("form_a"))).toBeNull();
  });

  it("ignores a backup made against another version of the form", async () => {
    saveEditDraft(window.localStorage, keyFor("form_a"), "2025-01-01T00:00:00.000Z", definitionWith("Old unsaved question"));
    await open();
    expect(shown()).not.toContain("Old unsaved question");
    expect(mounted!.container.textContent).not.toContain("We restored your unsaved changes");
  });

  it("Discard goes back to the saved form in place, without a reload, and clears the backup", async () => {
    saveEditDraft(window.localStorage, keyFor("form_a"), stamp, definitionWith("Unsaved A question"));
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
    try {
      await open();
      await click(buttonByText(mounted!.container, "Discard"));
      await tick(1000);
      expect(reload).not.toHaveBeenCalled();
      expect(shown()).toContain("Saved A question");
      expect(shown()).not.toContain("Unsaved A question");
      expect(mounted!.container.textContent).not.toContain("We restored your unsaved changes");
      expect(window.localStorage.getItem(keyFor("form_a"))).toBeNull();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});

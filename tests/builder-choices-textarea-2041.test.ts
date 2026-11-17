// @vitest-environment jsdom
import { createElement, useEffect, useState } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({
  apply: null as null | ((patch: Record<string, unknown>) => void),
  setOptions: null as null | ((options: string[]) => void),
}));
vi.mock("@/components/registration-builder/builder-context", () => ({
  useLoadedBuilder: () => ({ canEdit: true, information: false, updateField: (_s: number, _f: number, patch: Record<string, unknown>) => ctx.apply?.(patch) }),
}));

import { BuilderChoiceSettings } from "@/components/registration-builder/builder-choice-settings";
import type { RegistrationFormField } from "@/modules/forms/definition";
import { mount, typeInto, choose, type Mounted } from "./helpers/dom-render";

/** #2041: Enter and spaces survive in the "Choices — one per line" box while the saved choices stay trimmed. Synthetic data only. */
const baseField = { key: "shirt_size", label: "Shirt size", type: "SELECT", required: false, options: ["Medium"] } as unknown as RegistrationFormField;
const updates: Array<Record<string, unknown>> = [];
let mounted: Mounted | undefined;

function Harness() {
  const [field, setField] = useState<RegistrationFormField>(baseField);
  useEffect(() => {
    ctx.apply = (patch) => { updates.push(patch); setField((current) => ({ ...current, ...patch }) as RegistrationFormField); };
    ctx.setOptions = (options) => setField((current) => ({ ...current, options }));
  }, []);
  return createElement(BuilderChoiceSettings, { field, sectionIndex: 0, fieldIndex: 0 });
}

function box(container: HTMLElement) {
  return container.querySelector<HTMLTextAreaElement>('textarea[name="builder-rb-note-9"]')!;
}

afterEach(async () => { await mounted?.unmount(); mounted = undefined; updates.length = 0; });

describe("choices textarea keeps what is typed (#2041)", () => {
  it("keeps the new empty line after Enter", async () => {
    mounted = await mount(createElement(Harness));
    const textarea = box(mounted.container);
    expect(textarea.value).toBe("Medium");
    await typeInto(textarea, "Small\n");
    expect(box(mounted.container).value).toBe("Small\n");
    expect(updates.at(-1)?.options).toEqual(["Small"]);
  });

  it("lets a space be typed inside and after a choice", async () => {
    mounted = await mount(createElement(Harness));
    await typeInto(box(mounted.container), "Large ");
    expect(box(mounted.container).value).toBe("Large ");
    await typeInto(box(mounted.container), "Large size");
    expect(box(mounted.container).value).toBe("Large size");
    await typeInto(box(mounted.container), "Large size\n  \nExtra large  ");
    expect(box(mounted.container).value).toBe("Large size\n  \nExtra large  ");
    expect(updates.at(-1)?.options).toEqual(["Large size", "Extra large"]);
  });

  it("shows choices that change from outside the box", async () => {
    mounted = await mount(createElement(Harness));
    await typeInto(box(mounted.container), "Small\n");
    await act(async () => { ctx.setOptions?.(["Youth", "Adult"]); });
    expect(box(mounted.container).value).toBe("Youth\nAdult");
  });

  it("shows a quick-choices preset in the box", async () => {
    mounted = await mount(createElement(Harness));
    const select = mounted.container.querySelector<HTMLSelectElement>('select[aria-label="Quick choices for Shirt size"]')!;
    const preset = [...select.options].map((option) => option.value).find(Boolean)!;
    await typeInto(box(mounted.container), "Small\n");
    await choose(select, preset);
    expect(box(mounted.container).value).toBe((updates.at(-1)!.options as string[]).join("\n"));
  });
});

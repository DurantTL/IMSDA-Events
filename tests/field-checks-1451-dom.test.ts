// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EmailInput } from "@/components/email-input";
import { PhoneInput } from "@/components/phone-input";
import { EMAIL_FIELD_MESSAGE, PHONE_FIELD_MESSAGE } from "@/lib/field-validation";
import { mount, typeInto, type Mounted } from "./helpers/dom-render";

/** #1451: a valid changed phone is tidied when the person leaves the field; a bad one is left alone. Synthetic values only. */

let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; });

const blur = async (input: HTMLInputElement) => {
  await act(async () => {
    input.focus();
    input.blur();
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
};

describe("PhoneInput formats on blur (8.5)", () => {
  it("replaces a valid number with its normalised form and tells a controlled caller", async () => {
    const seen: string[] = [];
    mounted = await mount(createElement(PhoneInput, { label: "Phone", name: "phone", onValueChange: (value: string) => seen.push(value) }));
    const input = mounted.container.querySelector("input")!;
    await typeInto(input, "5155550134");
    await blur(input);
    expect(input.value).toBe("(515) 555-0134");
    expect(seen.at(-1)).toBe("(515) 555-0134");
  });

  it("never reformats an unchanged invalid stored number", async () => {
    mounted = await mount(createElement(PhoneInput, { label: "Phone", name: "phone", defaultValue: "555-0100", stored: "555-0100" }));
    const input = mounted.container.querySelector("input")!;
    await blur(input);
    expect(input.value).toBe("555-0100");
    expect(mounted.container.textContent).toContain("This saved number needs correcting.");
  });

  it("leaves a bad typed number as typed and shows the one message", async () => {
    mounted = await mount(createElement(PhoneInput, { label: "Phone", name: "phone" }));
    const input = mounted.container.querySelector("input")!;
    await typeInto(input, "idk 911");
    await blur(input);
    expect(input.value).toBe("idk 911");
    expect(mounted.container.textContent).toContain(PHONE_FIELD_MESSAGE);
  });
});

describe("the needs-correcting notice keeps the caller's description (#1451)", () => {
  it("joins the notice id to aria-describedby on both inputs", async () => {
    for (const element of [
      createElement(PhoneInput, { label: "Phone", "aria-describedby": "help-1", defaultValue: "555-0100", stored: "555-0100" }),
      createElement(EmailInput, { label: "Email", "aria-describedby": "help-1", defaultValue: "old@@example", stored: "old@@example" }),
    ]) {
      mounted = await mount(element);
      const input = mounted.container.querySelector("input")!;
      const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
      expect(ids).toContain("help-1");
      expect(ids).toHaveLength(2);
      expect(mounted.container.querySelector(`[id="${ids[1]}"]`)?.textContent).toContain("needs correcting");
      await mounted.unmount();
      mounted = null;
    }
  });
});

describe("EmailInput", () => {
  it("shows the one shared message after the field is left, and never repeats the address", async () => {
    mounted = await mount(createElement(EmailInput, { label: "Email", name: "email" }));
    const input = mounted.container.querySelector("input")!;
    expect(input.getAttribute("type")).toBe("email");
    expect(input.getAttribute("inputmode")).toBe("email");
    await typeInto(input, "not an email");
    expect(mounted.container.textContent).not.toContain(EMAIL_FIELD_MESSAGE);
    await blur(input);
    expect(mounted.container.textContent).toContain(EMAIL_FIELD_MESSAGE);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(mounted.container.textContent).not.toContain("not an email");
  });

  it("only flags an old saved address, and shows a message handed in from the form", async () => {
    mounted = await mount(createElement(EmailInput, { label: "Email", defaultValue: "old@@example", stored: "old@@example" }));
    expect(mounted.container.textContent).toContain("This saved answer needs correcting.");
    await mounted.unmount();
    mounted = await mount(createElement(EmailInput, { label: "Email", error: "Enter your email address.", errorId: "x-error" }));
    expect(mounted.container.querySelector("#x-error")?.textContent).toContain("Enter your email address.");
  });
});

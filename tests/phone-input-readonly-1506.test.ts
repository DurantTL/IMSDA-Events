// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneInput } from "@/components/phone-input";
import { flush, mount, type Mounted } from "./helpers/dom-render";

/** A locked phone is shown as stored: leaving it never tidies it or reports a new value (#1506). Synthetic numbers only. */
let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

async function leave(props: Record<string, unknown>) {
  const onValueChange = vi.fn();
  mounted = await mount(createElement(PhoneInput, { label: "Phone", value: "5155550134", onValueChange, ...props }));
  const input = document.querySelector("input")!;
  input.focus();
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  await flush(20);
  return onValueChange;
}

describe("PhoneInput on a locked value", () => {
  it("never calls onValueChange on blur when read-only or disabled", async () => {
    expect(await leave({ readOnly: true })).not.toHaveBeenCalled();
    await mounted?.unmount();
    expect(await leave({ disabled: true })).not.toHaveBeenCalled();
  });

  it("still tidies an editable number on blur", async () => {
    expect(await leave({})).toHaveBeenCalledWith("(515) 555-0134");
  });
});

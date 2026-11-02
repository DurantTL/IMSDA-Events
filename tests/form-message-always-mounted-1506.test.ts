// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FormMessage, savedMessage } from "@/components/form-message";
import { mount, type Mounted } from "./helpers/dom-render";

/** The contact form keeps one polite live region mounted, and that same element receives the result (#1506). */
let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("FormMessage alwaysMounted", () => {
  it("renders nothing when empty without the prop, so other forms are unchanged", async () => {
    mounted = await mount(createElement(FormMessage, { tone: "success", message: "" }));
    expect(mounted.container.innerHTML).toBe("");
  });

  it("keeps the same live-region node before and after a message arrives, for success and error", async () => {
    mounted = await mount(createElement(FormMessage, { tone: "success", message: "", alwaysMounted: true }));
    const before = mounted.container.firstElementChild as HTMLElement;
    expect(before.getAttribute("role")).toBe("status");
    expect(before.getAttribute("aria-live")).toBe("polite");
    expect(before.className).toBe("sr-only");
    expect(before.textContent).toBe("");

    await act(async () => mounted!.root.render(createElement(FormMessage, { tone: "success", message: savedMessage(), alwaysMounted: true })));
    const after = mounted.container.firstElementChild as HTMLElement;
    expect(after).toBe(before);
    expect(after.getAttribute("role")).toBe("status");
    expect(after.getAttribute("aria-live")).toBe("polite");
    expect(after.className).toContain("inline-notice");
    expect(after.textContent).toBe("Saved.");

    await act(async () => mounted!.root.render(createElement(FormMessage, { tone: "error", message: "Not saved: try again.", alwaysMounted: true })));
    const error = mounted.container.firstElementChild as HTMLElement;
    expect(error).toBe(before);
    expect(error.getAttribute("role")).toBe("status");
    expect(error.className).toContain("error");
  });

  it("without the prop an error is still an alert", async () => {
    mounted = await mount(createElement(FormMessage, { tone: "error", message: "Not saved: try again." }));
    expect(mounted.container.firstElementChild?.getAttribute("role")).toBe("alert");
  });
});

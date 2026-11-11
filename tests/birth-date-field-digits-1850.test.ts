// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BirthDateField } from "@/components/birth-date-field";
import { mount, typeInto, type Mounted } from "./helpers/dom-render";

/**
 * A birth date typed on an iPhone number pad, which has no "/" key (#1850):
 * digits alone are read and saved, and the box says how it read them.
 * Synthetic data only.
 */
describe("birth date field: digits only (#1850)", () => {
  let mounted: Mounted | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
  });

  async function setup() {
    mounted = await mount(createElement(BirthDateField, { name: "birthDate", label: "Birth date", required: true }));
    const box = mounted.container.querySelector<HTMLInputElement>('input[name="birthDateText"]')!;
    const hidden = mounted.container.querySelector<HTMLInputElement>('input[type="hidden"][name="birthDate"]')!;
    const help = mounted.container.querySelector<HTMLElement>("#birthDate-parsed")!;
    return { box, hidden, help };
  }

  it("keeps the number pad and says digits work", async () => {
    const { box, help } = await setup();
    expect(box.getAttribute("inputmode")).toBe("numeric");
    expect(help.textContent).toBe("Month/day/year, e.g. 4/17/2014 or 04172014.");
  });

  it("reads MMDDYYYY and MMDDYY and saves the date", async () => {
    const { box, hidden, help } = await setup();
    await typeInto(box, "08241986");
    expect(hidden.value).toBe("1986-08-24");
    expect(help.textContent).toBe("Reads as August 24, 1986.");
    expect(box.validity.customError).toBe(false);

    await typeInto(box, "041714");
    expect(hidden.value).toBe("2014-04-17");
    expect(help.textContent).toBe("Reads as April 17, 2014.");
  });

  it("blocks a date that isn't real or a length that's ambiguous", async () => {
    const { box, hidden, help } = await setup();
    for (const typed of ["02302010", "0824198"]) {
      await typeInto(box, typed);
      expect(hidden.value).toBe("");
      expect(help.textContent).toBe("Enter a date like 4/17/2014 or 04172014.");
      expect(box.validity.customError).toBe(true);
    }
  });
});

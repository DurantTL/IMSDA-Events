// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HonorCombobox, type HonorComboboxOption } from "@/components/honor-combobox";
import { ClubClassPicker } from "@/components/club-class-picker";
import { mount, typeInto, type Mounted } from "./helpers/dom-render";

/** The shared search box with a listed-but-unavailable choice, and the class picker built on it (#1600). Synthetic data only. */
vi.mock("@/components/class-waitlist-panel", () => ({ ClassWaitlistPanel: () => null }));

const OPTIONS: HonorComboboxOption[] = [
  { id: "full", name: "Archery", unavailableReason: "Full" },
  { id: "open1", name: "Basketry", detail: "3 of 5 seats left" },
  { id: "full2", name: "Canoeing", unavailableReason: "Full" },
  { id: "open2", name: "Dutch Oven" },
];

function Harness({ onPick }: { onPick: (id: string) => void }) {
  const [value, setValue] = useState("");
  return createElement(HonorCombobox, { allLabel: "No class", label: "Morning", noun: "class", onChange: (id: string) => { setValue(id); onPick(id); }, options: OPTIONS, value });
}

let mounted: Mounted;
afterEach(async () => { await mounted?.unmount(); });

const input = () => mounted.container.querySelector<HTMLInputElement>("input[role=combobox]")!;
const items = () => [...mounted.container.querySelectorAll<HTMLElement>("li[role=option]")];
const key = (name: string) => act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const focus = () => act(async () => { input().focus(); });
const mouseDown = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });

describe("HonorCombobox unavailable choices", () => {
  it("lists them greyed with the reason and aria-disabled, and shows everything when empty (S1, S2)", async () => {
    mounted = await mount(createElement(Harness, { onPick: () => {} }));
    await focus();
    expect(items().map((li) => li.textContent)).toEqual(["No class", "Archery (Full)", "Basketry (3 of 5 seats left)", "Canoeing (Full)", "Dutch Oven"]);
    expect(items().map((li) => li.getAttribute("aria-disabled"))).toEqual([null, "true", null, "true", null]);
  });

  it("narrows by name as you type, not by the reason (S4)", async () => {
    mounted = await mount(createElement(Harness, { onPick: () => {} }));
    await focus();
    await typeInto(input(), "full");
    expect(items()).toHaveLength(0);
    await typeInto(input(), "ca");
    expect(items().map((li) => li.textContent)).toEqual(["Canoeing (Full)"]);
  });

  it("skips them with the arrow keys and never picks one with Enter", async () => {
    const picked = vi.fn();
    mounted = await mount(createElement(Harness, { onPick: picked }));
    await focus();
    const activeText = () => items().find((li) => li.getAttribute("aria-selected") === "true")?.textContent;
    expect(activeText()).toBe("No class");
    await key("ArrowDown");
    expect(activeText()).toBe("Basketry (3 of 5 seats left)");
    await key("ArrowDown");
    expect(activeText()).toBe("Dutch Oven");
    await key("ArrowDown");
    expect(activeText()).toBe("No class");
    await key("ArrowUp");
    expect(activeText()).toBe("Dutch Oven");
    expect(input().getAttribute("aria-activedescendant")).toBe(items()[4]!.id);
    await key("ArrowUp");
    await key("ArrowUp");
    expect(activeText()).toBe("No class");
    await typeInto(input(), "arch");
    await key("Enter");
    expect(picked).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("ignores a click on an unavailable choice and still picks an available one", async () => {
    const picked = vi.fn();
    mounted = await mount(createElement(Harness, { onPick: picked }));
    await focus();
    await mouseDown(items()[1]!);
    expect(picked).not.toHaveBeenCalled();
    expect(items()[1]!.hidden).toBe(false);
    await mouseDown(items()[2]!);
    expect(picked).toHaveBeenCalledWith("open1");
    expect(input().value).toBe("Basketry");
  });
});

describe("ClubClassPicker uses the shared search box", () => {
  const offering = (id: string, honorName: string, extra: Record<string, unknown> = {}) => ({
    id, honorName, honorCode: id, span: "SINGLE_SESSION", sessionId: "s1", sessionName: null, sessionOrder: 0, capacity: 5, minimumAge: null,
    perClubLimit: null, teacherName: "", location: "", isActive: true, seatsTaken: 0, clubSeatsTaken: 0, ...extra,
  });
  const workspace = {
    open: true,
    registrationClosesOn: null,
    sessions: [{ id: "s1", name: "Sabbath Morning", sortOrder: 1 }],
    attendees: [{ id: "a1", firstName: "Sam", lastName: "Sample", attendeeType: "YOUTH", consumesSeat: true, ageOnEventDate: 12 }],
    offerings: [
      offering("o-full", "Archery", { seatsTaken: 5 }),
      offering("o-open", "Basketry"),
      offering("o-all", "Weekend Camp", { span: "ALL_SESSIONS", sessionId: null }),
    ],
    selections: {},
  };
  const render = () => mount(createElement(ClubClassPicker, { organizationId: "org_1", eventId: "evt_1", initialWorkspace: workspace } as never));

  it("renders a search box per session and for all sessions, with the full class unavailable", async () => {
    mounted = await render();
    expect(mounted.container.querySelectorAll("select")).toHaveLength(0);
    const boxes = [...mounted.container.querySelectorAll<HTMLInputElement>("input[role=combobox]")];
    expect(boxes).toHaveLength(2);
    expect(mounted.container.textContent).toContain("All sessions");
    expect(mounted.container.textContent).toContain("Sabbath Morning");
    await act(async () => { boxes[1]!.focus(); });
    const lis = [...mounted.container.querySelectorAll<HTMLElement>("li[role=option]")].filter((li) => li.textContent?.includes("Archery") || li.textContent?.includes("Basketry"));
    expect(lis.map((li) => [li.textContent, li.getAttribute("aria-disabled")])).toEqual([["Archery (Full)", "true"], ["Basketry (5 of 5 seats left)", null]]);
  });

  it("picking an available class shows it in the box; the all-sessions pick disables the session boxes", async () => {
    mounted = await render();
    const boxes = () => [...mounted.container.querySelectorAll<HTMLInputElement>("input[role=combobox]")];
    await act(async () => { boxes()[1]!.focus(); });
    const open = [...mounted.container.querySelectorAll<HTMLElement>("li[role=option]")].find((li) => li.textContent?.startsWith("Basketry"))!;
    await act(async () => { open.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    expect(boxes()[1]!.value).toBe("Basketry");
    await act(async () => { boxes()[0]!.focus(); });
    const all = [...mounted.container.querySelectorAll<HTMLElement>("li[role=option]")].find((li) => li.textContent?.startsWith("Weekend Camp"))!;
    await act(async () => { all.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    expect(boxes()[0]!.value).toBe("Weekend Camp");
    expect(boxes()[1]!.disabled).toBe(true);
  });
});

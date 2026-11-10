// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { IssuedAssetsWorkspace } from "@/components/issued-assets-workspace";
import type { CatalogView } from "@/modules/issued-assets/view";
import { buttonByText, click, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

// #1581: the add and edit forms are accessible dialogs with a dirty-close guard, saves report inside the dialog,
// and every request body is the one the page sent before. fetch is a mock: nothing here touches a real stock count. Synthetic data only.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/more/issued-assets" }));

const catalog: CatalogView = {
  truncated: false,
  types: [{ id: "t1", name: "Dorm room key", mode: "SERIALIZED", active: true, assigneeKinds: ["ATTENDEE", "REGISTRATION"], roomLinked: false, depositPolicyRef: null, replacementPolicyRef: null, depositCents: 0, depositShortfall: "KEEP_ALL", replacementFeeCents: 0, assetCount: 0, availableQuantity: 0, outQuantity: 0 }],
  assets: [],
};

let mounted: Mounted;
let requests: Array<{ url: string; body: Record<string, unknown> }>;
let reply: () => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  requests = [];
  reply = () => json({ result: { created: 3 }, catalog });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return reply();
  }));
});
afterEach(async () => { await mounted?.unmount(); vi.unstubAllGlobals(); });

async function open(initial: CatalogView = catalog) {
  mounted = await mount(createElement(IssuedAssetsWorkspace, { eventId: "ev1", initialCatalog: initial, canOpenDesk: true }));
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const frame = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
const openWith = async (name: string) => { const button = buttonByText(mounted.container, name); button.focus(); await click(button); await frame(); return button; };
const topDialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
const escape = () => act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
const field = (name: string) => dialog()!.querySelector(`[name="${name}"]`) as HTMLInputElement;

describe("the issued item dialogs (#1581)", () => {
  it("opens the add form as a labelled modal dialog and returns focus to the button that opened it", async () => {
    await open();
    expect(dialog()).toBeNull();
    const opener = await openWith("Add a kind of item");
    const sheet = dialog()!;
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(sheet.getAttribute("aria-labelledby")!)!.textContent).toBe("Add a kind of item");
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(sheet.textContent).toContain("Numbered (one holder at a time)");
    await escape();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("asks before discarding typed work, and keeps it when the viewer keeps editing", async () => {
    await open();
    await openWith("Add a kind of item");
    await typeInto(field("name"), "Gym key");
    await escape();
    expect(document.body.textContent).toContain("Discard your changes?");
    expect(dialog()!.textContent).toContain("Add a kind of item");
    await click(buttonByText(topDialog(), "Cancel"));
    expect(document.body.textContent).not.toContain("Discard your changes?");
    expect(field("name").value).toBe("Gym key");
    await escape();
    await click(buttonByText(topDialog(), "Discard changes"));
    expect(dialog()).toBeNull();
    expect(requests).toEqual([]);
  });

  it("sends the same add-kind request as before and closes on success", async () => {
    await open();
    await openWith("Add a kind of item");
    await typeInto(field("name"), "Gym key");
    await submitForm(dialog()!.querySelector("form")!);
    await flush();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("/api/events/ev1/assets/types");
    expect(requests[0]!.body).toMatchObject({ action: "create", name: "Gym key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE", "REGISTRATION"], roomLinked: false, depositCents: 0, depositShortfall: "KEEP_ALL", replacementFeeCents: 0 });
    expect(dialog()).toBeNull();
    expect(mounted.container.textContent).toContain("Kind of item added.");
  });

  it("shows the server's invalid range message inside the range dialog, not behind it", async () => {
    await open();
    await openWith("Add items");
    expect(document.getElementById(dialog()!.getAttribute("aria-labelledby")!)!.textContent).toBe("Add items to Dorm room key");
    expect(dialog()!.textContent).toContain("Add a numbered range");
    reply = () => json({ message: "The range must end at or after where it starts." }, 400);
    await typeInto(field("from"), "60");
    await typeInto(field("to"), "20");
    const forms = [...dialog()!.querySelectorAll("form")];
    await submitForm(forms[1]!);
    await flush();
    const alert = dialog()!.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("The range must end at or after where it starts.");
    expect([...mounted.container.querySelectorAll('[role="alert"]')].filter((element) => !dialog()!.contains(element))).toEqual([]);
    expect(requests[0]!.body).toMatchObject({ action: "bulk", typeId: "t1", prefix: "", from: 60, to: 20, width: 0, condition: "GOOD", location: "" });
    expect(dialog()).not.toBeNull();
  });

  it("edits with one Save that sends only the requests for what changed", async () => {
    await open();
    await openWith("Edit");
    expect(document.getElementById(dialog()!.getAttribute("aria-labelledby")!)!.textContent).toBe("Edit Dorm room key");
    await click(field("active"));
    await submitForm(dialog()!.querySelector("form")!);
    await flush();
    expect(requests.map((request) => request.body)).toEqual([{ action: "update", typeId: "t1", active: false }]);
    expect(dialog()).toBeNull();
  });

  it("closes an unchanged edit without sending anything, and refuses to clear every holder", async () => {
    await open();
    await openWith("Edit");
    await submitForm(dialog()!.querySelector("form")!);
    await flush();
    expect(requests).toEqual([]);
    expect(dialog()).toBeNull();
    await openWith("Edit");
    for (const box of dialog()!.querySelectorAll<HTMLInputElement>('input[name="kinds"]:checked')) await click(box);
    await submitForm(dialog()!.querySelector("form")!);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain("Choose at least one");
    expect(requests).toEqual([]);
  });

  it("does not bring a failed save's error back onto the page after Cancel and Discard", async () => {
    await open();
    await openWith("Add items");
    reply = () => json({ message: "The range must end at or after where it starts." }, 400);
    await typeInto(field("from"), "60");
    await typeInto(field("to"), "20");
    await submitForm([...dialog()!.querySelectorAll("form")][1]!);
    await flush();
    expect(dialog()!.querySelector('[role="alert"]')).not.toBeNull();
    await click(buttonByText(dialog()!, "Close"));
    await click(buttonByText(topDialog(), "Discard changes"));
    expect(dialog()).toBeNull();
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull();
  });

  it("says what was saved and what was not when a later group fails, and counts only the unsaved group as an edit", async () => {
    await open();
    await openWith("Edit");
    await click(field("active"));
    await typeInto(field("depositDollars"), "15");
    let call = 0;
    reply = () => (++call === 1 ? json({ result: {}, catalog }) : json({ message: "The deposit is not allowed." }, 400));
    await submitForm(dialog()!.querySelector("form")!);
    await flush();
    expect(requests.map((request) => Object.keys(request.body).includes("active"))).toEqual([true, false]);
    const alert = dialog()!.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain("Dorm room key switched off.");
    expect(alert).toContain("The policy and money change could not be saved: The deposit is not allowed.");
    expect(dialog()).not.toBeNull();
    // The unsaved deposit still counts, so closing asks, and the question says part was saved.
    await escape();
    expect(topDialog().textContent).toContain("Part of this form was saved");
    await click(buttonByText(topDialog(), "Cancel"));
    // Undo the unsaved deposit: nothing unsaved is left, so closing no longer asks.
    await typeInto(field("depositDollars"), "0.00");
    await escape();
    expect(document.body.textContent).not.toContain("Discard your changes?");
    expect(dialog()).toBeNull();
  });

  it("shows Saving… on the button while a save is in flight", async () => {
    await open();
    await openWith("Add a kind of item");
    await typeInto(field("name"), "Gym key");
    let release: (response: Response) => void = () => undefined;
    reply = () => new Promise<Response>((resolve) => { release = resolve; }) as unknown as Response;
    await act(async () => { dialog()!.querySelector("form")!.requestSubmit(); });
    expect(buttonByText(dialog()!, "Saving…").disabled).toBe(true);
    await act(async () => { release(json({ result: {}, catalog })); });
  });
});

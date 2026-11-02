// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/clubs/club-a/forms/x/new",
}));

import { ClubFormFillIn } from "@/components/club-form-fill-in";
import { ClubOrderWorkspace } from "@/components/club-order-workspace";
import { ClubProfileForm } from "@/components/club-profile-form";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { act } from "react";
import { flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/** #1501: the club bugs the real-browser journeys found, as component tests. Synthetic data only. */
let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; });

const definition: RegistrationFormDefinition = {
  title: "Yearly form", description: "", confirmationMessage: "Thanks",
  sections: [{ id: "sec_a", title: "Collection", description: "", fields: [
    { id: "f_place", key: "place", label: "Where did the club collect", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
    { id: "f_cans", key: "cans", label: "Cans collected", helpText: "", type: "NUMBER", scope: "REGISTRATION", required: true, options: [] },
    { id: "f_note", key: "note", label: "Notes", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [] },
  ] }],
};

describe("club form fill-in: missing answers use the shared summary (B7)", () => {
  it("turns the browser bubbles off, lists each missing answer as a link, and marks the field with its own message", async () => {
    mounted = await mount(createElement(ClubFormFillIn, {
      definition, sectionNotes: {}, sensitiveFieldKeys: [], mode: "club", organizationId: "club-a", templateKey: "yearly",
      rosterMembers: [], doneHref: "/account/clubs/club-a/forms",
    }));
    const form = mounted.container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    await submitForm(form);
    await flush();
    const summary = mounted.container.querySelector<HTMLElement>('.form-error-summary[role="alert"]')!;
    expect(summary).not.toBeNull();
    expect(document.activeElement).toBe(summary);
    const links = [...summary.querySelectorAll<HTMLAnchorElement>("li a")];
    expect(links.map((link) => link.textContent)).toEqual(["Where did the club collect is required.", "Cans collected is required."]);
    for (const link of links) {
      const control = document.getElementById(link.getAttribute("href")!.slice(1))!;
      expect(control.getAttribute("aria-invalid")).toBe("true");
      const message = document.getElementById(control.getAttribute("aria-describedby")!)!;
      expect(message.textContent).toMatch(/is required/);
    }
    // One alert announces everything.
    expect(mounted.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    // Answering one drops only its item.
    const place = document.getElementById("club-form-f_place") as HTMLInputElement;
    await typeInto(place, "Journey church lot");
    await flush();
    expect([...mounted.container.querySelectorAll(".form-error-summary li a")].map((link) => link.textContent)).toEqual(["Cans collected is required."]);
  });
});

describe("club profile: an edit turns the unsaved guard on (B6)", () => {
  it("warns on leaving only after something was changed", async () => {
    const profile = {
      id: "club-a", name: "Example Pathfinders", sponsoringChurchId: "church-a", meetingPlace: "", meetingSchedule: "", contactEmail: "",
      contactPhone: "", publicDescription: "", listPublicly: false, updatedAt: "2026-10-01T00:00:00.000Z",
    } as unknown as Parameters<typeof ClubProfileForm>[0]["initialProfile"];
    mounted = await mount(createElement(ClubProfileForm, { sponsors: [{ id: "church-a", name: "Sample Church", type: "CHURCH" }], endpoint: "/api/x", initialProfile: profile }));
    const event = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(event()).toBe(false);
    await typeInto(mounted.container.querySelector<HTMLInputElement>('input[name="meetingPlace"]')!, "Fellowship hall");
    await flush();
    expect(event()).toBe(true);
  });
});

describe("club form fill-in: Save draft versus Submit with empty required answers (#1501 review)", () => {
  const props = {
    definition, sectionNotes: {}, sensitiveFieldKeys: [], mode: "club" as const, organizationId: "club-a", templateKey: "yearly",
    rosterMembers: [], doneHref: "/account/clubs/club-a/forms",
  };

  it("Save draft sends the request even though required answers are empty, and shows no required errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ submission: { id: "s1", status: "DRAFT" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      mounted = await mount(createElement(ClubFormFillIn, props));
      const draft = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Save draft")!;
      await act(async () => { draft.click(); });
      await flush(20);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).submit).toBe(false);
      expect(mounted.container.querySelector(".form-error-summary")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Submit still stops on the empty required answers and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      mounted = await mount(createElement(ClubFormFillIn, props));
      await submitForm(mounted.container.querySelector("form")!);
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mounted.container.querySelector(".form-error-summary strong")!.textContent).toMatch(/before submitting/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Orders: remove a line, Undo, focus and a failed Undo (#1501 review)", () => {
  const line = { itemId: "i1", honorId: null, section: "HONORS" as const, name: "Camping Skills", size: "", catalogNumber: "005157", computedNeeded: 3, needed: 3, edited: false, onHand: 0, toOrder: 3 };
  const helperAfter = (needed: number, edited: boolean) => ({ helper: [{ ...line, needed, edited, toOrder: needed }], batches: [], unmatched: [], awardable: [], waiting: [], firstOrderAt: null });

  it("offers Undo at once after a confirmed remove and moves focus to the message; a failed Undo keeps Undo beside the error", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (method === "PUT") {
        putCount += 1;
        // The second PUT is the Undo, and it fails.
        return putCount === 2 ? json({ message: "That could not be saved." }, 500) : json({});
      }
      if (String(url).endsWith("/uniforms")) return json({ needs: [], catalog: [], members: [], issuedCount: 0 });
      return json({ ...helperAfter(0, true), batches: [], unmatched: [], awardable: [], waiting: [], firstOrderAt: null });
    }));
    try {
      mounted = await mount(createElement(ClubOrderWorkspace, { organizationId: "club-1", initial: helperAfter(3, false), stock: [] }));
      const remove = mounted.container.querySelector<HTMLButtonElement>('button[aria-label^="Remove from the list: Camping Skills"]')!;
      await act(async () => { remove.click(); });
      await flush();
      const confirmButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Remove from the list")!;
      await act(async () => { confirmButton.click(); });
      await flush(30);
      const slot = mounted.container.querySelector<HTMLElement>("#club-order-message-slot")!;
      expect(slot.textContent).toContain("Took Camping Skills off the list.");
      const undo = [...slot.querySelectorAll("button")].find((button) => button.textContent === "Undo")!;
      expect(undo).toBeTruthy();
      await flush(50);
      expect(document.activeElement).toBe(undo);
      // Undo fails: the error shows with Undo still on offer, and focus is on it.
      await act(async () => { undo.click(); });
      await flush(50);
      expect(slot.textContent).toContain("That could not be saved.");
      const retry = [...slot.querySelectorAll("button")].find((button) => button.textContent === "Undo");
      expect(retry).toBeTruthy();
      expect(document.activeElement).toBe(retry);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

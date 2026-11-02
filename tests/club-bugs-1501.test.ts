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
import { ClubProfileForm } from "@/components/club-profile-form";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
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

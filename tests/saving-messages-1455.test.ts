// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/profile",
}));

import { AttendeeProfileForm } from "@/components/attendee-profile-form";
import { ClubProfileForm } from "@/components/club-profile-form";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { settingsSaveState } from "@/components/settings-save-state";
import { getEventPublishReadiness } from "@/modules/events/readiness";
import type { EventSettingsRecord } from "@/modules/events/repository";
import { buttonByText, click, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/**
 * Rules 5 and 10 (#1455): the pressed button reads "Saving…" (aria-busy) until the answer comes back, then one message
 * sits in one slot under the buttons: "Saved." for success, "Not saved: ..." for an error, Undo only where a reverse exists.
 * Synthetic values only.
 */

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const root = process.cwd();

/** A fetch that stays open until `release` is called, so the in-flight state can be read. */
function heldFetch(status: number, body: unknown) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchMock = vi.fn(async (input: unknown) => {
    void input;
    await gate;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: async () => { release(); await flush(); await flush(); } };
}

function liveRegionsWith(container: HTMLElement, text: RegExp) {
  return [...container.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].filter((node) => text.test(node.textContent ?? ""));
}

describe("FormMessage and the shared words", () => {
  it("success is a polite status that starts with Saved", async () => {
    mounted = await mount(createElement(FormMessage, { tone: "success", message: savedMessage("One more sentence.") }));
    const node = mounted.container.querySelector('[role="status"]')!;
    expect(node.textContent).toBe("Saved. One more sentence.");
    expect(node.classList.contains("inline-notice")).toBe(true);
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull();
  });

  it("an error is an alert that starts with Not saved:", async () => {
    mounted = await mount(createElement(FormMessage, { tone: "error", message: notSavedMessage("the server did not answer. Try Save again.") }));
    const node = mounted.container.querySelector('[role="alert"]')!;
    expect(node.textContent).toBe("Not saved: the server did not answer. Try Save again.");
    expect(node.classList.contains("error")).toBe(true);
    expect(notSavedMessage("Not saved: already worded")).toBe("Not saved: already worded");
    expect(savedMessage()).toBe("Saved.");
  });

  it("Undo is a real button that calls its handler", async () => {
    const onUndo = vi.fn();
    mounted = await mount(createElement(FormMessage, { tone: "success", message: "Deactivated Jordan Ellis.", undo: { onUndo } }));
    const undo = buttonByText(mounted.container, "Undo");
    expect(undo.type).toBe("button");
    await click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("the settings save words start with Not saved", () => {
    expect(settingsSaveState({ saving: false, dirty: true, outcome: "failed" }).label).toBe("Not saved");
    expect(settingsSaveState({ saving: false, dirty: true, outcome: "conflict" }).label).toMatch(/^Not saved/);
  });
});

const profile = {
  firstName: "Test", lastName: "Person", phone: "", mailingLine1: "", mailingLine2: "", mailingCity: "", mailingRegion: "",
  mailingPostalCode: "", mailingCountry: "", emergencyContactName: "", emergencyContactRelationship: "", emergencyContactPhone: "",
  shirtSize: "", dietaryNeeds: "", accessibilityNeeds: "",
};

describe("Saving… then one message", () => {
  it("attendee profile", async () => {
    const held = heldFetch(200, { profile });
    mounted = await mount(createElement(AttendeeProfileForm, { initialProfile: profile as never }));
    const { container } = mounted;
    await submitForm(container.querySelector("form")!);
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.textContent).toBe("Saving…");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    expect(container.textContent).not.toContain("Saving profile");
    await held.release();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe("Save profile");
    const messages = liveRegionsWith(container, /Saved/);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.getAttribute("role")).toBe("status");
    expect(messages[0]!.textContent).toBe("Saved. New registration forms can use these details.");
  });

  it("attendee profile error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "The profile service is down." }), { status: 500 })));
    mounted = await mount(createElement(AttendeeProfileForm, { initialProfile: profile as never }));
    await submitForm(mounted.container.querySelector("form")!);
    await flush();
    const alerts = mounted.container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toMatch(/^Not saved: /);
  });

  it("club profile", async () => {
    const clubProfile = {
      id: "club-1", name: "Synthetic Pathfinders", sponsoringChurchId: "church-1", meetingPlace: "", meetingSchedule: "",
      contactEmail: "", contactPhone: "", publicDescription: "", listPublicly: false, updatedAt: "2027-01-01T00:00:00.000Z",
    };
    const held = heldFetch(200, { profile: { ...clubProfile, updatedAt: "2027-01-02T00:00:00.000Z" } });
    mounted = await mount(createElement(ClubProfileForm, {
      sponsors: [{ id: "church-1", name: "Synthetic Church", type: "CHURCH" }],
      endpoint: "/api/club-profile",
      initialProfile: clubProfile as never,
    }));
    const { container } = mounted;
    await submitForm(container.querySelector("form")!);
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.textContent).toBe("Saving…");
    expect(button.getAttribute("aria-busy")).toBe("true");
    await held.release();
    const messages = liveRegionsWith(container, /Saved/);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.textContent).toBe("Saved.");
    expect(container.textContent).not.toContain("Club settings saved");
  });
});

const eventFields = {
  id: "event-1", name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-08", endsOn: "2027-10-10",
  timezone: "America/Chicago", location: "Camp Heritage", capacity: 350, publicInfoUrl: null, supportContact: "registration@imsda.org",
  tagline: null, subtitle: null, helpEmail: null, hubTitle: null, hubIntro: null, refundPolicy: null,
  hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null,
  approvedPaymentInstructions: null, isPublished: false, archivedAt: null, showOnCalendar: true,
  registrationOpensOn: "2027-05-01", registrationClosesOn: "2027-10-01", paymentDueOn: null, waitlistEnabled: false,
  collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false,
  attendeeEditPolicy: "VERIFY_EVERY_EDIT" as const, billingMode: "ATTENDEE_PAY" as const, audience: "GENERAL" as const,
  seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false, autoPromoteWaitlist: false,
  featured: false, featuredOrder: null, featureUntil: null, publishedFormCount: 0, publishedForms: [], attendeeTypesWithAgeRangeCount: 1, attendeeTypeNames: ["Adult"], centralSenderEmail: "events@example.test", hasCancellationPolicy: true,
  createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z",
};
const eventRecord: EventSettingsRecord = { ...eventFields, readiness: getEventPublishReadiness(eventFields, 0), warnings: [] };

describe("Event settings", () => {
  async function save(status: number, body: unknown) {
    const held = heldFetch(status, body);
    mounted = await mount(createElement(EventSettingsWorkspace, { mode: "edit", initialEvent: eventRecord }));
    const { container } = mounted;
    await typeInto(container.querySelector<HTMLInputElement>("#event-field-location")!, "Edited Camp");
    await submitForm(container.querySelector("form.event-settings-layout")!);
    const button = container.querySelector<HTMLButtonElement>("#event-save-button")!;
    expect(button.textContent).toBe("Saving…");
    expect(button.getAttribute("aria-busy")).toBe("true");
    await held.release();
    return container;
  }

  it("a failed save is announced once, in the save bar", async () => {
    const container = await save(500, { error: "EVENT_REQUEST_FAILED", message: "The event settings could not be saved." });
    const messages = liveRegionsWith(container, /could not be saved/);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.textContent).toMatch(/^Not saved: /);
    expect(container.querySelector(".settings-save-status")!.getAttribute("role")).toBeNull();
    expect(container.querySelector(".settings-save-status")!.getAttribute("aria-live")).toBeNull();
  });
});

describe("Roster deactivate", () => {
  const person = {
    id: "m1", firstName: "Jordan", lastName: "Ellis", attendeeType: "ADULT", role: "", classLevel: null, gender: null, status: "ACTIVE",
    source: "DIRECTOR", age: 30, reportedAge: null, birthDateNeeded: false, updatedAt: "2027-01-01T00:00:00.000Z",
  };

  it("says Deactivated with an Undo that calls the existing reactivate request", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { status?: string };
      bodies.push(body);
      return new Response(JSON.stringify({ members: [{ ...person, status: body.status ?? "ACTIVE" }] }), { status: 200 });
    }));
    mounted = await mount(createElement(ClubRosterWorkspace, {
      canSeeBirthDates: false, clubYear: "2026-2027", initialMembers: [person], organizationId: "club-1",
    } as never));
    const { container } = mounted;
    await click(container.querySelector("#roster-edit-m1")!);
    await click(buttonByText(container.ownerDocument.body, "Deactivate"));
    await click(buttonByText(container.ownerDocument.body, "Deactivate Jordan Ellis"));
    await flush();
    const status = [...container.querySelectorAll('[role="status"]')].find((node) => /Deactivated/.test(node.textContent ?? ""));
    expect(status?.textContent).toMatch(/^Deactivated.*Jordan Ellis/);
    expect(bodies[0]).toEqual({ status: "INACTIVE" });
    await click(buttonByText(container, "Undo"));
    await flush();
    expect(bodies[1]).toEqual({ status: "ACTIVE" });
    expect(liveRegionsWith(container, /Reactivated Jordan Ellis/)).toHaveLength(1);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Undo")).toBe(false);
  });
});

/**
 * Source scan: success text is built by the shared helper, not typed per form. A component may not set a bare
 * "Saved" or "<thing> saved." success string; the files below are allowed with the reason they differ.
 */
describe("one set of success words", () => {
  const allowlist: Record<string, string> = {
    "components/form-message.tsx": "the shared helper",
    "components/settings-save-state.ts": "the shared status vocabulary",
    "components/meals-workspace.tsx": "follow-up: PR #1461 is rewriting its confirm flows",
    "components/people-workspace.tsx": "follow-up: PR #1461 is rewriting its confirm flows",
    "components/csv-import-dialog.tsx": "dialog heading once an import finished; the import result, not a form save",
    "components/background-check-import.tsx": "dialog heading once an import finished; the sentence under it uses savedMessage()",
    "components/club-event-list.tsx": "status chip on a club's event list (a saved registration draft), not a save result",
  };

  function files(dir: string): string[] {
    return readdirSync(path.join(root, dir)).flatMap((name) => {
      const relative = `${dir}/${name}`;
      if (statSync(path.join(root, relative)).isDirectory()) return files(relative);
      return /\.(ts|tsx)$/.test(name) ? [relative] : [];
    });
  }

  const banned = [
    /["'`]Club settings saved\.?["'`]/,
    /["'`]Profile saved\.?["'`]/,
    /["'`]Saved\.?["'`]/,
    /["'`]Draft saved\.?["'`]/,
    /["'`]Draft saved locally\.?["'`]/,
    /Saving profile…/,
    /["'`][A-Z][A-Za-z ]*(?<!\bbe|\bnot|\bwas|\bis) saved\.["'`]/,
  ];

  it("no component sets its own success string", () => {
    const offenders: string[] = [];
    for (const file of files("components")) {
      if (allowlist[file]) continue;
      const lines = readFileSync(path.join(root, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (banned.some((pattern) => pattern.test(line))) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

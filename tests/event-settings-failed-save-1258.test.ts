// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/more/event-settings",
}));

import { EventSettingsWorkspace } from "@/components/event-settings-workspace";
import { getEventPublishReadiness } from "@/modules/events/readiness";
import type { EventSettingsRecord } from "@/modules/events/repository";
import { mount, submitForm, typeInto, flush, type Mounted } from "./helpers/dom-render";

const fields = {
  id: "event-1", name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-08", endsOn: "2027-10-10",
  timezone: "America/Chicago", location: "Camp Heritage", capacity: 350, publicInfoUrl: null, supportContact: "registration@imsda.org",
  tagline: null, subtitle: null, helpEmail: null, hubTitle: null, hubIntro: null, refundPolicy: null,
  hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null,
  approvedPaymentInstructions: null, isPublished: false, archivedAt: null,
  registrationOpensOn: "2027-05-01", registrationClosesOn: "2027-10-01", paymentDueOn: null, waitlistEnabled: false,
  collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false,
  attendeeEditPolicy: "VERIFY_EVERY_EDIT" as const, billingMode: "ATTENDEE_PAY" as const, audience: "GENERAL" as const,
  seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false, autoPromoteWaitlist: false,
  featured: false, featuredOrder: null, featureUntil: null, publishedFormCount: 0, publishedForms: [],
  createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z",
};
const event: EventSettingsRecord = { ...fields, readiness: getEventPublishReadiness(fields, 0), warnings: [] };

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function saveAnswering(status: number, body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  mounted = await mount(createElement(EventSettingsWorkspace, { mode: "edit", initialEvent: event }));
  const location = mounted.container.querySelector<HTMLInputElement>("#event-field-location")!;
  await typeInto(location, "Edited Camp");
  await submitForm(mounted.container.querySelector("form.event-settings-layout")!);
  await flush();
  // The failed state comes from the save itself, not from a request made when the page mounted.
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("/api/events/event-1");
  expect(calls[0][1].method).toBe("PATCH");
  return { location, status: mounted.container.querySelector("[data-save-state]")?.getAttribute("data-save-state"), bar: mounted.container.querySelector(".event-savebar-status")?.textContent ?? "" };
}

describe("a failed Event settings save keeps the edits (#1258)", () => {
  it("keeps the typed value and says access was lost on a 403 mid-edit", async () => {
    const result = await saveAnswering(403, { error: "EVENT_ACCESS_DENIED", message: "No access." });
    expect(result.location.value).toBe("Edited Camp");
    expect(result.status).toBe("failed");
    expect(result.bar).toContain("no longer have permission");
    expect(result.bar).toContain("Your edits are still here");
  });

  it("shows Conflict for 409 EVENT_CHANGED and keeps the edit", async () => {
    const result = await saveAnswering(409, { error: "EVENT_CHANGED", message: "Dates changed." });
    expect(result.location.value).toBe("Edited Camp");
    expect(result.status).toBe("conflict");
    expect(result.bar).toContain("Conflict: not saved");
  });

  it("keeps the edit on a plain server failure", async () => {
    const result = await saveAnswering(500, { error: "EVENT_REQUEST_FAILED", message: "The event settings could not be saved." });
    expect(result.location.value).toBe("Edited Camp");
    expect(result.status).toBe("failed");
  });
});

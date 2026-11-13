// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/x", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
import { ClubDraftReminderSettings } from "@/components/club-draft-reminder-settings";
import type { ClubDraftReminderOverview } from "@/modules/club-registrations/draft-reminders-domain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** #164: the staff settings section. Synthetic numbers; fetch is a stand-in. */
const overview = (overrides: Partial<ClubDraftReminderOverview> = {}): ClubDraftReminderOverview => ({
  policy: { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 },
  emailOn: true, registrationOpen: true, sendHours: "9 a.m. to 7 p.m. Central", drafts: 0, dueNow: 0, upcoming: [],
  counts: { queued: 0, sent: 0, failed: 0, suppressed: 0, cancelled: 0 },
  limits: { firstAfterDays: [1, 14], repeatEveryDays: [1, 14], maxReminders: [1, 3], staleAfterDays: [7, 90] },
  ...overrides,
});

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(initial: ClubDraftReminderOverview) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => { root.render(createElement(ClubDraftReminderSettings, { eventId: "event-1", eventTimezone: "America/Chicago", initial })); });
  return container;
}

const input = (container: HTMLElement, key: string) => container.querySelector<HTMLInputElement>(`#club-draft-reminder-${key}`)!;
const buttonText = (container: HTMLElement, text: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text)) as HTMLButtonElement;

async function type(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function stubFetch(next: ClubDraftReminderOverview) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ changed: true, overview: next }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const sentBody = (fetchMock: ReturnType<typeof stubFetch>) => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);

describe("the club registration reminder settings", () => {
  it("the switch sends the saved policy with only the switch changed, even when a box holds a cleared or invalid number", async () => {
    const fetchMock = stubFetch(overview({ policy: { enabled: false, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 } }));
    const container = mount(overview());
    await type(input(container, "firstAfterDays"), "");
    await type(input(container, "maxReminders"), "99");
    await act(async () => { buttonText(container, "Turn off").click(); });
    expect(sentBody(fetchMock)).toEqual({ enabled: false, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 });
    expect(container.querySelector('[data-testid="club-draft-reminder-state"]')?.textContent).toBe("Reminders are off for this event.");
  });

  it("Save timing shows each problem at its field and in the summary, and sends nothing", async () => {
    const fetchMock = stubFetch(overview());
    const container = mount(overview());
    await type(input(container, "firstAfterDays"), "20");
    await type(input(container, "repeatEveryDays"), "");
    await act(async () => { buttonText(container, "Save timing").click(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input(container, "firstAfterDays").getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("#club-draft-reminder-firstAfterDays-error")?.textContent).toMatch(/whole number from 1 to 14/);
    expect(container.querySelector("#club-draft-reminder-repeatEveryDays-error")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/2 things to fix before saving/);
  });

  it("shows the expiry-before-first-reminder rule on the expiry field", async () => {
    const container = mount(overview());
    await type(input(container, "firstAfterDays"), "10");
    await type(input(container, "staleAfterDays"), "7");
    await act(async () => { buttonText(container, "Save timing").click(); });
    expect(input(container, "staleAfterDays").getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("#club-draft-reminder-staleAfterDays-error")?.textContent).toMatch(/would expire before it is reminded/);
  });

  it("Save timing sends the typed numbers with the saved switch", async () => {
    const fetchMock = stubFetch(overview({ policy: { enabled: true, firstAfterDays: 4, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 } }));
    const container = mount(overview());
    await type(input(container, "firstAfterDays"), "4");
    await act(async () => { buttonText(container, "Save timing").click(); });
    expect(sentBody(fetchMock)).toEqual({ enabled: true, firstAfterDays: 4, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 });
  });

  it("gives a next step for held email and for closed registration, and says the send hours in words", () => {
    const container = mount(overview({ emailOn: false, registrationOpen: false }));
    const text = container.textContent ?? "";
    expect(text).toMatch(/A system administrator can change this under System management, then Email/);
    expect(text).toMatch(/ask your event administrator/);
    expect(container.querySelector('a[href="/more/event-settings?event=event-1"]')?.textContent).toBe("Event settings");
    expect(text).toContain("only from 9 a.m. to 7 p.m. Central");
    expect(text).not.toMatch(/America\/Chicago|19:00/);
  });
});

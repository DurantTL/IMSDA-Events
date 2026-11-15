// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));
import { CheckInStationScreen } from "@/components/check-in-station";
import { stationQueueStorageKey } from "@/modules/checkin-stations/offline-queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** #1577: where a device goes after Stop. Synthetic names and ids; fetch is a stand-in. */
const stationId = "station_1";
const eventId = "event_1";
const queuedBatch = {
  id: "batch_1",
  queuedAt: "2026-11-10T15:00:00.000Z",
  registrationId: "registration_1",
  confirmationCode: "CM27-ONE",
  items: [{ attendeeId: "attendee_1", idempotencyKey: "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b", name: "Pat Sample" }],
};

let root: Root | null = null;
let container: HTMLElement;

type Answer = { status: number; body?: unknown } | "no-answer";
function stubFetch(answers: { stop: Answer; checkIn?: Answer }) {
  const respond = (answer: Answer) => {
    if (answer === "no-answer") return Promise.reject(new TypeError("offline"));
    return Promise.resolve(new Response(JSON.stringify(answer.body ?? {}), { status: answer.status }));
  };
  vi.stubGlobal("fetch", vi.fn((path: string) => (
    path.endsWith("/stop") ? respond(answers.stop) : respond(answers.checkIn ?? { status: 200, body: { results: [] } })
  )));
}

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(CheckInStationScreen, {
      stationId, eventId, eventName: "Camp Meeting 2027", stationLabel: "Front desk", canRecordPayments: false,
    }));
  });
}

const button = (text: string) => [...document.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === text) as HTMLButtonElement;
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function stopStation() {
  await act(async () => { button("Stop station").click(); });
  await act(async () => { document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button').forEach((entry) => { if (entry.textContent === "Stop station") entry.click(); }); });
  await settle();
}

beforeEach(() => {
  replace.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Stop station (#1577)", () => {
  it("goes straight back to the Check-in tab for this event when nothing is waiting", async () => {
    stubFetch({ stop: { status: 200, body: { stopped: true } } });
    mount();
    await settle();
    await act(async () => { button("Stop station").click(); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("This device goes back to the Check-in tab.");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("sign in");
    await act(async () => { button("Cancel").click(); });
    await stopStation();
    expect(replace).toHaveBeenCalledWith("/check-in?event=event_1");
    expect(document.querySelector("h1")?.textContent).toBe("Check-in station");
    expect(document.body.textContent).toContain("Going back to Check-in");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/check-in?event=event_1");
    expect(document.activeElement).toBe(document.querySelector("h1"));
  });

  it("keeps the stopped screen with the names when check-ins are still waiting", async () => {
    window.localStorage.setItem(stationQueueStorageKey(stationId), JSON.stringify([queuedBatch]));
    stubFetch({ stop: { status: 200, body: { stopped: true } }, checkIn: "no-answer" });
    mount();
    await settle();
    await stopStation();
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This station is not active");
    expect(document.body.textContent).toContain("Pat Sample");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/check-in?event=event_1");
  });

  it("keeps the stopped screen with the names when a check-in needs attention", async () => {
    window.localStorage.setItem(stationQueueStorageKey(stationId), JSON.stringify([queuedBatch]));
    stubFetch({
      stop: { status: 200, body: { stopped: true } },
      checkIn: { status: 200, body: { results: [{ attendeeId: "attendee_1", status: "SEND_TO_DESK" }] } },
    });
    mount();
    await settle();
    expect(document.body.textContent).toContain("Needs attention");
    await stopStation();
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This station is not active");
    expect(document.body.textContent).toContain("Pat Sample");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/check-in?event=event_1");
  });

  it("keeps the stopped screen, with no redirect, when the stop was already done elsewhere (401)", async () => {
    stubFetch({ stop: { status: 401, body: { message: "Not active" } } });
    mount();
    await settle();
    await stopStation();
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This station is not active");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/check-in?event=event_1");
  });
});

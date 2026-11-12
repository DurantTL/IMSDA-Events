// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never) }));

import { InspectionEntry, saveTimeoutMs } from "@/components/inspection-entry";
import type { InspectionView } from "@/modules/event-inspections/service";
import { buttonByText, flush, mount, submitForm, typeInto, type Mounted } from "./helpers/dom-render";

/** #1896: the phone entry rows on a slow connection. Synthetic clubs only. */

const view = (over: Partial<InspectionView> = {}): InspectionView => ({
  eventName: "Sample Camporee",
  enabled: true,
  scoringEnabled: true,
  published: false,
  capabilities: { canSwitch: true, canEnter: true, canCorrectAfterPublish: false },
  inspections: [{ key: "campsite", name: "Campsite inspection", activityId: "a1" }, { key: "uniform", name: "Uniform inspection", activityId: "a2" }],
  clubs: [{ organizationId: "club-1", name: "Sample Eagles" }],
  entries: [],
  ...over,
});

let mounted: Mounted | null = null;
beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = async (initial: InspectionView) => {
  mounted = await mount(createElement(InspectionEntry, { endpoint: "/api/x/inspections", initial, scoringHref: "/more/event-scoring?event=e1" }));
  return mounted.container;
};
const input = (container: HTMLElement) => container.querySelector("input[inputmode='decimal']") as HTMLInputElement;
const form = (container: HTMLElement) => container.querySelector("form") as HTMLFormElement;
const answer = (text: string) => ({ ok: true, json: async () => ({ enabled: true, saved: { inspection: "campsite", subjectId: "club-1", text } }) });

function held() {
  const releases: Array<(value: unknown) => void> = [];
  const fetchMock = vi.fn(() => new Promise((resolve) => { releases.push(resolve); }));
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: async (value: unknown) => { releases.shift()!(value); await flush(); await flush(); } };
}

describe("a row on a slow connection (#1896)", () => {
  it("does not overwrite what was typed while the save was on its way", async () => {
    const { fetchMock, release } = held();
    const container = await render(view());
    await typeInto(input(container), "80");
    await submitForm(form(container));
    await typeInto(input(container), "90");
    await release(answer("80"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(input(container).value).toBe("90");
    expect(container.textContent).toContain("Unsaved changes");
    expect(buttonByText(container, "Save: Sample Eagles").disabled).toBe(false);
  });

  it("takes the saved form of an untouched box and says Saved", async () => {
    const { release } = held();
    const container = await render(view());
    await typeInto(input(container), "80.50");
    await submitForm(form(container));
    await release(answer("80.5"));
    expect(input(container).value).toBe("80.5");
    expect(container.querySelector("[role='status'][id$='-status']")!.textContent).toBe("Saved");
  });

  it("sends one request when a row is saved twice while the first is in flight", async () => {
    const { fetchMock } = held();
    const container = await render(view());
    await typeInto(input(container), "80");
    await submitForm(form(container));
    await submitForm(form(container));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after 15 seconds, marks the row failed with Retry and keeps the typed score", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const container = await render(view());
    await typeInto(input(container), "80");
    await submitForm(form(container));
    await vi.advanceTimersByTimeAsync(saveTimeoutMs);
    await flush();
    expect(input(container).value).toBe("80");
    expect(input(container).getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Not saved: The connection is too slow");
    expect(buttonByText(container, "Retry: Sample Eagles").disabled).toBe(false);
  });
});

describe("removing a score and the surrounding copy (#1896)", () => {
  it("asks before a cleared box deletes a saved score", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, saved: { inspection: "campsite", subjectId: "club-1", text: "" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const container = await render(view({ entries: [{ inspection: "campsite", subjectId: "club-1", text: "85" }] }));
    await typeInto(input(container), "");
    await submitForm(form(container));
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Remove score")).toBe(true));
    const confirmButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Remove score")!;
    await import("./helpers/dom-render").then(({ click }) => click(confirmButton));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("labels the box with the inspection and keeps the club name out of translation", async () => {
    const container = await render(view());
    const label = container.querySelector("label")!;
    expect(label.textContent).toBe("Campsite inspection score for Sample Eagles");
    expect(label.querySelector("[translate='no']")!.textContent).toBe("Sample Eagles");
  });

  it("says who turns Camporee scoring on, with a link, when it is off", async () => {
    const container = await render(view({ scoringEnabled: false, enabled: false }));
    const note = container.querySelector("[data-testid='inspection-scoring-off']")!;
    expect(note.textContent).toContain("Area Coordinators can turn it on");
    expect(note.querySelector("a")!.getAttribute("href")).toBe("/more/event-scoring?event=e1");
  });

  it("gives a next step when no club is registered", async () => {
    const container = await render(view({ clubs: [] }));
    expect(container.textContent).toContain("ask the Clubs Administrator");
  });
});

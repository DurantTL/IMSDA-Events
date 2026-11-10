// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonByText, click, flush, mount, type Mounted } from "./helpers/dom-render";

vi.mock("next/navigation", () => ({ usePathname: () => "/more/lodging/assignments", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { LodgingAssignmentsWorkspace } from "@/components/lodging-assignments-workspace";
import type { AssignmentWorkspaceView, PersonCard, UnitCard } from "@/modules/lodging/assignment-view";

// #1578: the special-use confirmation is the shared accessible dialog, so it is in view where the person tapped.
const nights = ["2027-06-15", "2027-06-16"];
const unit: UnitCard = {
  eventUnitId: "u314", key: "k314", name: "314", kind: "ROOM", isArea: false, floor: 3, groundLevel: false, bathroom: "SHARED", specialUse: true, category: "DORM_ROOM",
  beds: "2 twin", status: "AVAILABLE", capacity: 2, nightStatuses: nights.map(() => "AVAILABLE" as const), nightCapacities: [2, 2], nightOccupied: [0, 0],
  holdReasons: [], unavailableReason: null, extraBedding: false, occupants: [],
};
const person: PersonCard = {
  occupantKey: "p2", occupantId: "p2", kind: "ATTENDEE", name: "Sam Sample", registrationId: "reg-p2", registrationCode: "CODE-p2", registrationStatus: "CONFIRMED", active: true, colorIndex: 1, people: 1,
  category: "DORM_ROOM", roomCount: 1, bringsExtraBedding: false, asksForLodging: true, wantedFirstNight: nights[0]!, wantedLastNight: nights[1]!, wantedNights: 2, placements: [], uncoveredNights: 2, waitlistStatus: null, householdKeys: [],
};
const otherUnit: UnitCard = {
  ...unit, eventUnitId: "u101", key: "k101", name: "101", specialUse: false, status: "PARTIAL", nightOccupied: [1, 1],
  occupants: [{ assignmentId: "a1", occupantKey: "p1", occupantId: "p1", kind: "ATTENDEE", name: "Pat Example", registrationCode: "CODE-p1", firstNight: nights[0]!, lastNight: nights[1]!, people: 1, colorIndex: 1, inactive: false }],
};
const placed: PersonCard = {
  ...person, occupantKey: "p1", occupantId: "p1", name: "Pat Example", registrationId: "reg-p1", registrationCode: "CODE-p1", uncoveredNights: 0,
  placements: [{ assignmentId: "a1", unitId: "u101", bucketId: null, label: "101", firstNight: nights[0]!, lastNight: nights[1]!, people: 1 }],
};
const view: AssignmentWorkspaceView = {
  eventId: "ev1", propertyName: "Sunnydale Academy", nights,
  settings: { showAssignmentsToAttendees: false, showRoommateFirstNames: false, attendeeInstructions: null },
  canSeeSensitive: false, palette: 12,
  buildings: [{ key: "boys", name: "Boys Dorm", floors: [{ floor: 3, label: "3rd floor", units: [unit, otherUnit] }] }],
  buckets: [], people: [person, placed], exceptions: [], waitlist: [], notices: [], counts: { placed: 1, unplaced: 1, waitingOnList: 0, exceptions: 0 },
};

let mounted: Mounted;
afterEach(async () => { await mounted?.unmount(); vi.unstubAllGlobals(); });

async function openDialog() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  mounted = await mount(createElement(LodgingAssignmentsWorkspace, { initialView: view, canConfigure: true, canExport: true }));
  await click(mounted.container.querySelector('li button[aria-pressed="false"]')!);
  const trigger = buttonByText(mounted.container, "Assign Sam Sample here");
  trigger.focus();
  await click(trigger);
  await flush(30);
  return { trigger, fetchMock };
}

describe("the special-use room confirmation (#1578)", () => {
  it("opens the shared dialog with focus inside, and asks the server for nothing until confirmed", async () => {
    const { fetchMock } = await openDialog();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("314 is a special-use room");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels with the Cancel button without placing anyone, and returns focus to the button that was tapped", async () => {
    const { trigger, fetchMock } = await openDialog();
    await click(buttonByText(document.body, "No, keep my selection"));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("sends the placement with the special-use confirmation only after Yes", async () => {
    const { fetchMock } = await openDialog();
    await click(buttonByText(document.body, "Yes, place them there"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.placements[0].confirmSpecialUse).toBe(true);
    expect(body.placements[0].place).toEqual({ kind: "UNIT", eventUnitId: "u314" });
  });

  it("cancels on Escape without a request, and returns focus to the button that was tapped", async () => {
    const { trigger, fetchMock } = await openDialog();
    await act(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("asks before a drag-and-drop move into a special-use room, and sends MOVE with the confirmation only after Yes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(LodgingAssignmentsWorkspace, { initialView: view, canConfigure: true, canExport: true }));
    const room = [...mounted.container.querySelectorAll("article")].find((article) => article.getAttribute("aria-label") === null && article.querySelector("h4")?.textContent === "314")!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "move:a1:p1" } });
    await act(async () => { room.dispatchEvent(drop); });
    await flush(30);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("314 is a special-use room");
    expect(fetchMock).not.toHaveBeenCalled();
    await click(buttonByText(document.body, "Yes, place them there"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.placements[0]).toMatchObject({ mode: "MOVE", confirmSpecialUse: true, place: { kind: "UNIT", eventUnitId: "u314" } });
  });
});

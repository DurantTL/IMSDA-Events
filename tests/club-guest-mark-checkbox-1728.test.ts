// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { ClubRegistrationEditor } from "@/components/club-registration-editor";
import { click, mount, type Mounted } from "./helpers/dom-render";

/**
 * Ticking "Not a Pathfinder" on a guest already on the registration, in the edit step (#1728): the box flips and the page
 * keeps working. Synthetic data only.
 */
const definition = {
  title: "Sample club form", description: "", confirmationMessage: "Thanks",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 50, attendeeLabel: "Club member", addButtonLabel: "Add" },
  sections: [{ id: "roster", title: "Roster", description: "", fields: [
    { id: "a_first", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
    { id: "a_role", key: "attendee_type", label: "Roster role", helpText: "", type: "RADIO", scope: "ATTENDEE", required: false, options: ["Pathfinder", "Child"] },
  ] }],
};

function workspace(teams: boolean) {
  const guest = (id: string, age: number, marked: boolean) => ({
    attendeeId: `attendee-${id}`, firstName: "Robin", lastName: `Visitor${id}`, ageOnEventDate: age, teamRole: null, alternate: false, permission: null,
    temporary: true, guestChild: false, guestYouthNotPathfinder: marked, clubRosterMemberId: null, guestId: id, linkedRosterMemberId: null,
    offRoster: false, responses: { attendee_type: marked ? "Child" : "Pathfinder" },
  });
  return {
    event: { id: "event-1", ageAsOf: null, ageDate: "2026-12-05" },
    experience: { form: { definition } },
    registration: { updatedAt: "2026-10-15T13:00:00.000Z", teamKey: null, location: null, registrationResponses: {}, attendees: [guest("guestteen001", 13, true), guest("guestkid002", 5, false)] },
    roster: [], locations: [], teams: { settings: teams ? {} : null }, lockedAttendeeFieldKeys: [],
  } as never;
}

let mounted: Mounted | null = null;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => { await mounted?.unmount(); mounted = null; vi.unstubAllGlobals(); });

describe("the Not a Pathfinder box on a kept guest (#1728)", () => {
  it("flips when clicked, without crashing, and only for a guest aged 10 to 17", async () => {
    mounted = await mount(createElement(ClubRegistrationEditor, { organizationId: "club-1", workspace: workspace(false) }));
    await click(mounted.container.querySelector("button.secondary-button")!);
    const boxes = mounted.container.querySelectorAll<HTMLInputElement>('label input[type="checkbox"]');
    const guestBoxes = [...boxes].filter((box) => box.closest("label")?.textContent?.includes("Not a Pathfinder"));
    expect(guestBoxes).toHaveLength(1);
    expect(guestBoxes[0]!.checked).toBe(true);
    await click(guestBoxes[0]!);
    expect(guestBoxes[0]!.checked).toBe(false);
    expect(mounted.container.textContent).not.toContain("Youth guest (not a Pathfinder)");
    await click(guestBoxes[0]!);
    expect(guestBoxes[0]!.checked).toBe(true);
    expect(mounted.container.textContent).toContain("Youth guest (not a Pathfinder)");
  });

  it("offers no box on an event with team rules", async () => {
    mounted = await mount(createElement(ClubRegistrationEditor, { organizationId: "club-1", workspace: workspace(true) }));
    await click(mounted.container.querySelector("button.secondary-button")!);
    expect(mounted.container.textContent).not.toContain("Not a Pathfinder (for example");
  });
});

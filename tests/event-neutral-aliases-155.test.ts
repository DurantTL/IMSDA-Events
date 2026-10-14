import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Old retreat-named import paths and exports must keep resolving (#155), so no
 * caller, link, or historical reference breaks during the migration.
 */
describe("pre-#155 retreat names still resolve", () => {
  it("hub repository aliases point at the event-neutral functions", async () => {
    const current = await import("@/modules/attendee-accounts/event-hub-repository");
    const legacyModule = await import("@/modules/attendee-accounts/retreat-hub-repository");
    expect(legacyModule.getAttendeeRetreatHub).toBe(current.getAttendeeEventHub);
    expect(legacyModule.getStaffRetreatHubPreview).toBe(current.getStaffEventHubPreview);
    expect(legacyModule.retreatHubAnnouncementRecords).toBe(current.eventHubAnnouncementRecords);
    expect(legacyModule.getAttendeeEventHub).toBe(current.getAttendeeEventHub);
  });

  it("packet repository alias points at the event-neutral function", async () => {
    const current = await import("@/modules/reporting/event-packets-repository");
    const legacyModule = await import("@/modules/reporting/retreat-packets-repository");
    expect(legacyModule.getRetreatPackets).toBe(current.getEventPackets);
  });

  it("stored message template keys are unchanged", async () => {
    const { MESSAGE_TEMPLATE_KEYS } = await import("@/modules/communications/templates");
    // Stored template versions reference these keys; they are history and are never renamed.
    expect(MESSAGE_TEMPLATE_KEYS).toContain("SHIRT_SIZE_REQUEST");
  });
});

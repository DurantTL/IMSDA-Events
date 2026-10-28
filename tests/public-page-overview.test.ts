import { describe, expect, it } from "vitest";
import { getPublicPageOverview } from "@/modules/events/public-page-overview";
import { SAVED_SHARE_ADDRESS_NOTE } from "@/modules/events/share-links";

const edit = (over: Partial<Extract<Parameters<typeof getPublicPageOverview>[0], { mode: "edit" }>> = {}) =>
  getPublicPageOverview({
    mode: "edit",
    eventId: "evt 1",
    published: true,
    archivedAt: null,
    savedSlug: "camp-meeting",
    typedSlug: "camp-meeting",
    showOnCalendar: true,
    ...over,
  });

describe("public page overview", () => {
  it("links to the saved page when public", () => {
    const o = edit();
    expect(o.isPublic).toBe(true);
    expect(o.status.text).toBe("Public");
    expect(o.page.href).toBe("/events/camp-meeting");
    expect(o.page.path).toBe("/events/camp-meeting");
    expect(o.page.addressNote).toBeNull();
    expect(o.calendar.text).toBe("On the calendar");
    expect(o.calendar.href).toBe("/more/features?event=evt%201");
    expect(o.calendar.linkLabel).toBe("See Event features");
    expect(o.publicState).toBe("Public");
  });

  it("uses the saved slug and notes an edited one", () => {
    const o = edit({ typedSlug: "new-slug" });
    expect(o.page.href).toBe("/events/camp-meeting");
    expect(o.page.addressNote).toBe(SAVED_SHARE_ADDRESS_NOTE);
  });

  it("never links an unpublished draft", () => {
    const o = edit({ published: false });
    expect(o.status.text).toContain("Not public yet");
    expect(o.page.href).toBeNull();
    expect(o.page.path).toBe("/events/camp-meeting");
    expect(o.page.note).toBe("Works once the event is published.");
    expect(o.page.addressNote).toBeNull();
    expect(o.calendar.text).toBe("On the calendar once published");
  });

  it("never links an archived event", () => {
    const o = edit({ archivedAt: "2026-01-01T00:00:00.000Z" });
    expect(o.isPublic).toBe(false);
    expect(o.status.text).toBe("Archived: hidden from the public site.");
    expect(o.publicState).toBe("Archived");
    expect(o.page.href).toBeNull();
  });

  it("words the calendar row for hidden events", () => {
    expect(edit({ showOnCalendar: false }).calendar.text).toBe("Hidden from the calendar");
    expect(edit({ showOnCalendar: false, published: false }).calendar.text).toBe("Hidden");
  });

  it("create mode shows plain text only", () => {
    const o = getPublicPageOverview({ mode: "create", typedSlug: "spring-camporee", showOnCalendar: true });
    expect(o.status.text).toBe("Not public yet. Save the draft, then publish.");
    expect(o.page.path).toBe("/events/spring-camporee");
    expect(o.page.href).toBeNull();
    expect(o.calendar.href).toBeNull();
    expect(o.calendar.note).toBe("Chosen in the features step above.");
    const blank = getPublicPageOverview({ mode: "create", typedSlug: " ", showOnCalendar: false });
    expect(blank.page.path).toBeNull();
    expect(blank.page.note).toBe("Set a page address in Step 1.");
  });
});

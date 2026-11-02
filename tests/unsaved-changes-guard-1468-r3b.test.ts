// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addFormHasInput } from "@/components/attendee-configuration-workspace";
import { moderationFormEdited } from "@/components/community-moderation-workspace";
import { notificationDraftsDirty } from "@/components/registration-form-notifications-panel";

function form(html: string) {
  const el = document.createElement("form");
  el.innerHTML = html;
  return el;
}

describe("unsaved-changes helpers, round 3b (#1468)", () => {
  it("an add form is dirty only when it holds more than its starting values", () => {
    const html = '<input name="code" value=""><input name="sortOrder" value="0">';
    expect(addFormHasInput(form(html), { sortOrder: "0" })).toBe(false);
    expect(addFormHasInput(form('<input name="code" value="ADULT"><input name="sortOrder" value="0">'), { sortOrder: "0" })).toBe(true);
    expect(addFormHasInput(form('<input name="code" value=""><input name="sortOrder" value="3">'), { sortOrder: "0" })).toBe(true);
  });

  it("a moderation form is dirty only when the status or note differs from what it opened with", () => {
    const base = '<select name="status"><option value="PUBLISHED" selected>V</option><option value="HIDDEN">H</option></select>';
    expect(moderationFormEdited(form(`${base}<input name="note" value="seen">`), "PUBLISHED", "seen")).toBe(false);
    expect(moderationFormEdited(form(`${base}<input name="note" value="seen again">`), "PUBLISHED", "seen")).toBe(true);
    expect(moderationFormEdited(form(`${base}<input name="note" value="">`), "HIDDEN", "")).toBe(true);
  });

  it("notification drafts ignore the local key of a new row but count an added row", () => {
    const row = {
      localKey: "a", id: "a", name: "Camping", recipientsText: "x@example.org", savedRecipients: ["x@example.org"],
      conditionFieldKey: "", conditionOperator: "EQUALS" as const, conditionValue: "", onlyTheseSections: false,
      sectionIds: [], warnings: [], clubRemoved: false,
    };
    expect(notificationDraftsDirty([row], [{ ...row, localKey: "other" }])).toBe(false);
    expect(notificationDraftsDirty([{ ...row, name: "Camping 2" }], [row])).toBe(true);
    expect(notificationDraftsDirty([row, { ...row, localKey: "n1", id: undefined }], [row])).toBe(true);
    const blank = { ...row, localKey: "n2", id: undefined, name: "", recipientsText: "", savedRecipients: [] };
    expect(notificationDraftsDirty([blank], [])).toBe(false);
    expect(notificationDraftsDirty([{ ...blank, name: "Camping" }], [])).toBe(true);
  });
});

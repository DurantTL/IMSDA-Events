import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SELECTED_AUDIENCE_MAX_REGISTRATIONS,
  boundRegistrationSelection,
  selectionLimitSummary,
} from "@/modules/communications/selected-audience-limit";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `REG-${index + 1}`);

describe("report email selection limit (#1103)", () => {
  it("keeps the 250 limit", () => {
    expect(SELECTED_AUDIENCE_MAX_REGISTRATIONS).toBe(250);
  });

  it.each([
    [0, 0, 0],
    [1, 1, 0],
    [250, 250, 0],
    [251, 250, 1],
    [400, 250, 150],
  ])("%i distinct registrations select %i and omit %i", (matched, selected, omitted) => {
    const result = boundRegistrationSelection(ids(matched));
    expect(result.matchedCount).toBe(matched);
    expect(result.selectedCount).toBe(selected);
    expect(result.registrationIds).toHaveLength(selected);
    expect(result.omittedCount).toBe(omitted);
    expect(result.selectedCount + result.omittedCount).toBe(result.matchedCount);
    expect(selectionLimitSummary(result) === "").toBe(omitted === 0);
  });

  it("does not spend selection slots on duplicate registration ids", () => {
    const result = boundRegistrationSelection([...ids(250), ...ids(250)]);
    expect(result.matchedCount).toBe(250);
    expect(result.omittedCount).toBe(0);
    expect(result.registrationIds).toEqual(ids(250));
  });

  it("keeps report order and deduplicates by registration id, not by address", () => {
    expect(boundRegistrationSelection(["B", "A", "B", "C"], 2)).toEqual({
      matchedCount: 3,
      registrationIds: ["B", "A"],
      selectedCount: 2,
      omittedCount: 1,
    });
  });

  it("says plainly who is and is not reviewed", () => {
    const summary = selectionLimitSummary(boundRegistrationSelection(ids(251)));
    expect(summary).toContain("251 registrations");
    expect(summary).toContain("first 250");
    expect(summary).toContain("1 registration will not be contacted");
  });

  it("wires the disclosure and acknowledgement into the existing review dialog", () => {
    const button = readFileSync("components/email-registrations-button.tsx", "utf8");
    const dialog = readFileSync("components/selected-audience-dialog.tsx", "utf8");
    expect(button).toContain("boundRegistrationSelection(registrationIds)");
    expect(button).toContain("registrationIds={selection.registrationIds}");
    expect(dialog).toContain("!limitReady");
    expect(dialog).toContain("previewFingerprint: preview.fingerprint");
  });

  it("shows no acknowledgement and keeps the plain eyebrow at exactly 250", () => {
    const dialog = readFileSync("components/selected-audience-dialog.tsx", "utf8");
    const exact = boundRegistrationSelection(ids(250));
    expect(exact.omittedCount).toBe(0);
    // The checkbox, the notice and the reduced eyebrow all hang on omittedCount > 0.
    expect(dialog).toContain("omittedCount > 0 && (\n              <label");
    expect(dialog).toContain("`${registrationIds.length} selected registration${registrationIds.length === 1 ? \"\" : \"s\"}`");
    expect(dialog).toContain("omittedCount === 0 || limitAcknowledged");
  });

  it("links the notices to their controls and uses one shared limit", () => {
    const dialog = readFileSync("components/selected-audience-dialog.tsx", "utf8");
    const button = readFileSync("components/email-registrations-button.tsx", "utf8");
    expect(dialog).toContain('id="selected-audience-limit-note"');
    expect(dialog).toContain('aria-describedby="selected-audience-limit-note"');
    expect(button).toContain('id="email-registrations-limit-note"');
    expect(button).toContain('"email-registrations-limit-note" : undefined');
    expect(readFileSync("modules/communications/selected-audience.ts", "utf8")).toContain("max(SELECTED_AUDIENCE_MAX_REGISTRATIONS)");
  });
});

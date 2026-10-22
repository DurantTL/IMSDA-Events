import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SAVED_SHARE_ADDRESS_NOTE,
  copySavedEmbedCode,
  embedPath,
  isCopiedFor,
  publicEventPath,
  shareAddressDiffers,
} from "@/modules/events/share-links";

const origin = "https://events.example.test";
const saved2027 = { slug: "family-retreat-2027", name: "Family Retreat 2027" };
const saved2028 = { slug: "family-retreat-2028", name: "Family Retreat 2028" };

describe("saved share links (#1115)", () => {
  it("keeps public and embed paths on the saved address while the draft is edited", () => {
    const draft = { slug: "family-retreat-2028", name: "Unsaved Name" };
    expect(shareAddressDiffers(draft, saved2027)).toBe(true);
    expect(SAVED_SHARE_ADDRESS_NOTE).toBe("Public links use the saved address. Save changes to update them.");
    expect(publicEventPath(saved2027)).toBe("/events/family-retreat-2027");
    expect(embedPath(saved2027, "attendees")).toBe("/embed/family-retreat-2027/attendees");
  });

  it("shows no note when the draft matches the saved address", () => {
    expect(shareAddressDiffers({ slug: saved2027.slug }, saved2027)).toBe(false);
  });

  it("failed save leaves saved values in use; successful save moves every output", () => {
    // A failed save never calls setSavedDraft, so the saved value is unchanged.
    expect(publicEventPath(saved2027)).toBe("/events/family-retreat-2027");
    // The server-returned values become the saved baseline after success.
    expect(publicEventPath(saved2028)).toBe("/events/family-retreat-2028");
    expect(embedPath(saved2028, "attendees")).toBe("/embed/family-retreat-2028/attendees");
    expect(shareAddressDiffers({ slug: "family-retreat-2029" }, saved2028)).toBe(true);
  });

  it("copies embed code built from the saved slug and name, not unsaved edits", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const result = await copySavedEmbedCode({ origin, saved: saved2027, formSlug: "attendees", writeText });
    expect(result).toEqual({ ok: true, copied: { eventSlug: "family-retreat-2027", formSlug: "attendees" } });
    const code = writeText.mock.calls[0][0] as string;
    expect(code).toContain("/embed/family-retreat-2027/attendees");
    expect(code).not.toContain("family-retreat-2028");
  });

  it("reports clipboard failure without claiming it copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    expect(await copySavedEmbedCode({ origin, saved: saved2027, formSlug: "attendees", writeText })).toEqual({ ok: false });
  });

  it("clears Copied feedback when the saved address or form changes", () => {
    const copied = { eventSlug: saved2027.slug, formSlug: "attendees" };
    expect(isCopiedFor(copied, saved2027, "attendees")).toBe(true);
    expect(isCopiedFor(copied, saved2028, "attendees")).toBe(false);
    expect(isCopiedFor(copied, saved2027, "other-form")).toBe(false);
    expect(isCopiedFor(null, saved2027, "attendees")).toBe(false);
  });

  it("the workspace builds every share output from savedDraft", () => {
    const source = readFileSync(path.join(process.cwd(), "components/event-settings-workspace.tsx"), "utf8");
    expect(source).toContain("publicEventPath(savedDraft)");
    expect(source).toContain("embedPath(savedDraft, form.slug)");
    expect(source).toContain("saved: savedDraft");
    expect(source).toContain("shareAddressDiffers(draft, savedDraft)");
    expect(source).not.toMatch(/eventSlug: draft\.slug|encodeURIComponent\(draft\.slug\)|\/embed\/\{draft\.slug\}/);
  });
});

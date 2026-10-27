import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { EventShareButton, shareOrCopy, shareStatusMessage } from "@/components/event-share-button";

const data = { title: "Synthetic Retreat", url: "https://events.example.test/events/synthetic-retreat" };

describe("share this event (#1214)", () => {
  it("copies the link when there is no native share", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy(data, { clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it("reports a copy failure so the selectable field can show", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    expect(await shareOrCopy(data, { clipboard: { writeText } })).toBe("failed");
  });

  it("uses the native share sheet with the title and URL only", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share, clipboard: { writeText } } as never)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: data.title, url: data.url });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats a cancelled share sheet as a quiet no-op with no copy fallback", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share, clipboard: { writeText } } as never)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to copying when the share sheet fails for another reason", async () => {
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy(data, { share, clipboard: { writeText } } as never)).toBe("copied");
  });

  it("renders a labelled button with a polite live region, and nothing without a URL", () => {
    const markup = renderToStaticMarkup(createElement(EventShareButton, data));
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Share this event");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(renderToStaticMarkup(createElement(EventShareButton, { title: data.title, url: null }))).toBe("");
  });

  it("words the live region for each result and stays quiet when idle", () => {
    expect(shareStatusMessage("copied")).toBe("Link copied.");
    expect(shareStatusMessage("failed")).toMatch(/Could not copy/);
    expect(shareStatusMessage("idle")).toBe("");
  });
});

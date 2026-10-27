import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { EventWhenWhere } from "@/components/event-when-where";
import { directionsTargets } from "@/modules/events/directions";

vi.mock("server-only", () => ({}));

describe("When / Where actions (#1213, #1214)", () => {
  const base = { dateLabel: "June 5", timeLabel: "9 AM", location: "Camp Heritage" };

  it("renders directions links that open in a new tab, announced as such, and the share button", () => {
    const markup = renderToStaticMarkup(createElement(EventWhenWhere, {
      ...base, directions: directionsTargets({ location: "Camp Heritage" }), shareUrl: "https://events.example.test/events/x", shareTitle: "X",
    }));
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('<span class="sr-only"> (opens in a new tab)</span>');
    expect(markup).toContain("Share this event");
  });

  it("renders neither without directions or a share URL", () => {
    const markup = renderToStaticMarkup(createElement(EventWhenWhere, { ...base, directions: [], shareUrl: null }));
    expect(markup).not.toContain("Get directions");
    expect(markup).not.toContain("Share this event");
  });
});

describe("canonical share URL (#1214)", () => {
  it("is absolute, uses the saved slug encoded, and has no query or fragment", async () => {
    const { getServerEnv } = await import("@/lib/env");
    const url = new URL(`/events/${encodeURIComponent("spring camp/2027")}`, getServerEnv().APP_BASE_URL).toString();
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/events/spring%20camp%2F2027");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("");
    expect(url.startsWith(getServerEnv().APP_BASE_URL.replace(/\/$/, ""))).toBe(true);
  });
});

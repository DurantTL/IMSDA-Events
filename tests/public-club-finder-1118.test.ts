import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicClubDirectory, matches } from "@/components/public-club-directory";
import { announcedCountText, createRetryableLoader, effectiveView, nextTileStatus, unmappedSentence } from "@/components/public-club-finder-logic";
import type { PublicClubListing } from "@/modules/organizations/public-club-directory";

function club(over: Partial<PublicClubListing>): PublicClubListing {
  return {
    id: "c", clubName: "Synthetic Club", churchName: "Synthetic Church", town: "Exampleton", state: "XX",
    zip: "00000", meetingSchedule: "Sabbath 3 pm", latitude: 40, longitude: -93, ...over,
  };
}

const clubs = [
  club({ id: "a", clubName: "Eagles Pathfinders", churchName: "Riverton Church", town: "Riverton", zip: "50001", latitude: 41, longitude: -93 }),
  club({ id: "b", clubName: "Adventurers", churchName: "Riverton Church", town: "Riverton", zip: "50001", latitude: 41, longitude: -93 }),
  club({ id: "c", clubName: "Brookside Explorers", churchName: "Brookside Church", town: "Brookside", zip: "50002", latitude: null, longitude: null }),
];

describe("find a club search and results (#1118)", () => {
  it("matches town, ZIP, club and church, ignoring case and surrounding spaces", () => {
    expect(matches(clubs[0], " RIVERTON ")).toBe(true);
    expect(matches(clubs[0], "50001")).toBe(true);
    expect(matches(clubs[0], "eagles")).toBe(true);
    expect(matches(clubs[2], "brookside church")).toBe(true);
    expect(matches(clubs[2], "riverton")).toBe(false);
    expect(matches(clubs[2], "   ")).toBe(true);
  });

  it("labels the real search capability and states counts from the same set", () => {
    const html = renderToStaticMarkup(createElement(PublicClubDirectory, { clubs }));
    expect(html).toContain("Search town, ZIP, club or church</label>");
    expect(html).toContain("3 publicly listed clubs found · 2 shown on map");
    expect(html).toContain("1 club has no map location and is listed only.");
    expect(html).toContain('aria-label="Show results as"');
    expect(html).not.toContain("Clear search");
  });

  it("keeps unmapped clubs in the list and the zero-published state separate", () => {
    const html = renderToStaticMarkup(createElement(PublicClubDirectory, { clubs }));
    expect(html).toContain("Brookside Explorers");
    const empty = renderToStaticMarkup(createElement(PublicClubDirectory, { clubs: [] }));
    expect(empty).toContain("No clubs are listed publicly yet");
    expect(empty).not.toContain("publicly listed clubs found");
  });
});

describe("find a club logic (#1118 review)", () => {
  it("retries an import after a rejection instead of caching it", async () => {
    let calls = 0;
    const load = createRetryableLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error("chunk");
      return "map";
    });
    await expect(load()).rejects.toThrow("chunk");
    await expect(load()).resolves.toBe("map");
    await load();
    expect(calls).toBe(2);
  });

  it("keeps a tile failure until retry", () => {
    expect(nextTileStatus("ready", "tileerror")).toBe("tiles-failed");
    expect(nextTileStatus("tiles-failed", "tileload")).toBe("tiles-failed");
  });

  it("announces the count without the unmapped sentence, and not the map part when it is down", () => {
    expect(announcedCountText(3, 2, true)).toBe("3 publicly listed clubs found · 2 shown on map");
    expect(announcedCountText(1, 0, false)).toBe("1 publicly listed club found");
    expect(unmappedSentence(0)).toBe("");
    expect(unmappedSentence(1)).toContain("no map location");
  });

  it("falls back to the list when the phone map would be empty or broken", () => {
    expect(effectiveView("map", 0, false)).toBe("list");
    expect(effectiveView("map", 3, true)).toBe("list");
    expect(effectiveView("map", 3, false)).toBe("map");
    expect(effectiveView("list", 0, true)).toBe("list");
  });
});

describe("find a club styles (#1118)", () => {
  const css = readFileSync(path.join(process.cwd(), "components/public-club-directory.module.css"), "utf8");
  it("gives phone controls 44px targets and hides one pane at a time", () => {
    expect(css).toMatch(/\.viewToggle button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.clearButton,\s*\.retryButton,\s*\.resetButton \{[^}]*min-height: 44px/);
    expect(css).toContain('.content[data-view="list"] .mapPane');
  });
});

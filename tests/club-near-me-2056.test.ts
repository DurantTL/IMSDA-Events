import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clubMiles, formatMiles, milesBetween, nearestPoints, sortByDistance, type DistanceOrigin } from "@/components/club-distance";
import { buildPlaceIndex, lookUpPlace, normalizeTownName, placeLookupMessage } from "@/components/place-lookup";
import { placeLookupRows } from "@/components/place-lookup-data";
import { NEAR_ME_MAX_ZOOM } from "@/components/public-club-map";
import { locationProblemMessage, problemFromErrorCode } from "@/components/public-club-near-me";
import nextConfig from "../next.config";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const desMoines: DistanceOrigin = { latitude: 41.5868, longitude: -93.625, label: "Des Moines, IA", source: "place" };
const club = (id: string, latitude: number | null, longitude: number | null) => ({ id, latitude, longitude });

describe("Near me distances (#2056)", () => {
  it("measures straight-line miles", () => {
    expect(milesBetween(desMoines, desMoines)).toBe(0);
    // Des Moines to St. Louis is about 260 miles as the crow flies.
    const miles = milesBetween(desMoines, { latitude: 38.627, longitude: -90.1994 });
    expect(miles).toBeGreaterThan(250);
    expect(miles).toBeLessThan(275);
    expect(clubMiles(club("x", null, null), desMoines)).toBeNull();
    expect(clubMiles(club("x", 41.5868, -93.625), null)).toBeNull();
  });

  it("sorts nearest first, keeps ties and clubs without a map location in their usual order", () => {
    const clubs = [
      club("far", 38.627, -90.199),
      club("unmapped-1", null, null),
      club("near-a", 41.6, -93.6),
      club("near-b", 41.6, -93.6),
      club("unmapped-2", null, null),
      club("middle", 42.03, -93.62),
    ];
    expect(sortByDistance(clubs, desMoines).map((entry) => entry.id)).toEqual(["near-a", "near-b", "middle", "far", "unmapped-1", "unmapped-2"]);
    expect(sortByDistance(clubs, null)).toBe(clubs);
  });

  it("shows whole miles and frames the nearest pins", () => {
    expect(formatMiles(0.4)).toBe("Under 1 mi");
    expect(formatMiles(4.4)).toBe("4 mi");
    expect(formatMiles(1234.6)).toBe("1,235 mi");
    const points = [
      { latitude: 38.627, longitude: -90.199, id: "far" },
      { latitude: 41.6, longitude: -93.6, id: "near" },
      { latitude: 42.03, longitude: -93.62, id: "middle" },
    ];
    expect(nearestPoints(points, desMoines, 2).map((point) => point.id)).toEqual(["near", "middle"]);
  });
});

describe("town and ZIP lookup in the browser (#2056)", () => {
  const index = buildPlaceIndex(placeLookupRows);

  it("bundles Iowa and Missouri only, every row readable", () => {
    const rows = placeLookupRows.split("\n");
    expect(rows.length).toBeGreaterThan(2000);
    for (const row of rows) expect(row).toMatch(/^\d{5}\|[^|]+\|(IA|MO)\|-?\d+\.\d{3}\|-?\d+\.\d{3}$/);
  });

  it("finds a ZIP, a town, and a town with its state in any common spelling", () => {
    const ames = lookUpPlace(index, "50010");
    expect(ames).toMatchObject({ status: "found", origin: { label: "ZIP 50010 (Ames, IA)" } });
    expect(lookUpPlace(index, " 50010-1234 ")).toMatchObject({ status: "found" });
    expect(lookUpPlace(index, "ames")).toMatchObject({ status: "found", origin: { label: "Ames, IA" } });
    expect(lookUpPlace(index, "St. Louis")).toMatchObject({ status: "found", origin: { label: "Saint Louis, MO" } });
    expect(lookUpPlace(index, "west des moines, iowa")).toMatchObject({ status: "found", origin: { label: "West Des Moines, IA" } });
    expect(lookUpPlace(index, "Columbia MO")).toMatchObject({ status: "found", origin: { label: "Columbia, MO" } });
    const desMoinesTown = lookUpPlace(index, "Des Moines, IA");
    expect(desMoinesTown.status).toBe("found");
    if (desMoinesTown.status === "found") expect(milesBetween(desMoinesTown.origin, desMoines)).toBeLessThan(15);
  });

  it("asks for the state when a town is in both, and says plainly what it could not find", () => {
    expect(lookUpPlace(index, "Clinton")).toEqual({ status: "ambiguous", town: "Clinton" });
    expect(lookUpPlace(index, "Clinton, MO")).toMatchObject({ status: "found", origin: { label: "Clinton, MO" } });
    expect(lookUpPlace(index, "clinton iowa")).toMatchObject({ status: "found", origin: { label: "Clinton, IA" } });
    expect(lookUpPlace(index, "   ")).toEqual({ status: "empty" });
    expect(lookUpPlace(index, "500")).toEqual({ status: "bad-zip" });
    expect(lookUpPlace(index, "90210")).toEqual({ status: "zip-not-found", zip: "90210" });
    expect(lookUpPlace(index, "Atlantis")).toEqual({ status: "not-found", query: "Atlantis" });
    expect(placeLookupMessage({ status: "ambiguous", town: "Clinton" })).toBe("There is a Clinton in Iowa and in Missouri. Add IA or MO, like “Clinton, IA”.");
    expect(placeLookupMessage({ status: "zip-not-found", zip: "90210" })).toContain("isn't in Iowa or Missouri");
    expect(normalizeTownName("  Ft. Madison ")).toBe("fort madison");
  });
});

describe("location problems are said plainly (#2056, #1445)", () => {
  it("maps refused, unavailable and timed out", () => {
    expect(problemFromErrorCode(1)).toBe("blocked");
    expect(problemFromErrorCode(2)).toBe("unavailable");
    expect(problemFromErrorCode(3)).toBe("unavailable");
    for (const problem of ["blocked", "unavailable", "unsupported"] as const) {
      expect(locationProblemMessage(problem)).toContain("the list stays in its usual order");
      expect(locationProblemMessage(problem)).toContain("enter a town or ZIP instead");
    }
  });
});

describe("the location never leaves the browser (#2056)", () => {
  const sources = ["components/club-distance.ts", "components/place-lookup.ts", "components/public-club-near-me.tsx"].map((file) => [file, read(file)] as const);

  it("sends, stores, logs and measures nothing", () => {
    for (const [file, source] of sources) {
      for (const banned of ["fetch(", "sendBeacon", "sendHit", "public-metrics", "XMLHttpRequest", "localStorage", "sessionStorage", "document.cookie", "history.", "searchParams", "useClientSearch", "console.", "action="]) {
        expect(source.includes(banned), `${file} uses ${banned}`).toBe(false);
      }
    }
  });

  it("the page and map that carry the point send, store and log nothing either", () => {
    for (const file of ["components/public-club-directory.tsx", "components/public-club-map.tsx"]) {
      const source = read(file);
      for (const banned of ["fetch(", "sendBeacon", "sendHit", "XMLHttpRequest", "localStorage", "sessionStorage", "document.cookie", "console."]) {
        expect(source.includes(banned), `${file} uses ${banned}`).toBe(false);
      }
    }
    // Map pictures around the point stay regional (ADR 0018).
    expect(NEAR_ME_MAX_ZOOM).toBe(9);
  });

  it("loads the town table only on demand, from the bundle", () => {
    expect(read("components/place-lookup.ts")).toContain('import("@/components/place-lookup-data")');
    for (const [file, source] of sources) expect(source, file).not.toMatch(/from "@\/components\/place-lookup-data"/);
    expect(read("components/public-club-directory.tsx")).not.toContain("place-lookup-data");
  });

  it("the town box has no name, so nothing typed can go into a submitted address", () => {
    const source = read("components/public-club-near-me.tsx");
    expect(source).not.toMatch(/<input[^>]*\sname=/);
  });

  it("lets only the Find a club page ask for location", async () => {
    const rules = await nextConfig.headers!();
    const policy = (source: string) => rules.find((rule) => rule.source === source)?.headers.find((header) => header.key === "Permissions-Policy")?.value;
    expect(policy("/:path*")).toContain("geolocation=()");
    expect(policy("/clubs")).toBe("camera=(), microphone=(), geolocation=(self), browsing-topics=()");
    // The /clubs rule comes after the site-wide one, so it wins on /clubs and nowhere else.
    expect(rules.findIndex((rule) => rule.source === "/clubs")).toBeGreaterThan(rules.findIndex((rule) => rule.source === "/:path*"));
  });
});

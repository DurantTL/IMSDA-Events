import { describe, expect, it } from "vitest";
import { directionsTargets, usableLocationText } from "@/modules/events/directions";

const maps = "https://www.google.com/maps/search/?api=1&query=";

describe("directions targets (#1213)", () => {
  it("links a plain place with the typed text encoded", () => {
    expect(directionsTargets({ location: "Camp Heritage" })).toEqual([{ label: "Get directions", href: `${maps}Camp%20Heritage` }]);
  });

  it("encodes an address with commas and an ampersand so it cannot break the query", () => {
    const [target] = directionsTargets({ location: "Fox & Hound Hall, 12 Main St, Des Moines, IA" });
    expect(target.href).toBe(`${maps}Fox%20%26%20Hound%20Hall%2C%2012%20Main%20St%2C%20Des%20Moines%2C%20IA`);
    expect(new URL(target.href).searchParams.get("query")).toBe("Fox & Hound Hall, 12 Main St, Des Moines, IA");
  });

  it.each(["TBD", "tba", " TBD. ", "To be determined", "to be announced.", "(TBA)", "Location details coming soon", "Location details coming soon."])(
    "shows no link for the placeholder %j", (text) => {
      expect(usableLocationText(text)).toBeNull();
      expect(directionsTargets({ location: text })).toEqual([]);
    });

  it.each(["Online", "VIRTUAL", "Zoom", "livestream", "Online only!", "-- Virtual --"])("shows no link for online-only text %j", (text) => {
    expect(directionsTargets({ location: text })).toEqual([]);
  });

  it("does not drop a real place that merely contains such a word", () => {
    expect(directionsTargets({ location: "Zoom Lake Lodge" })).toHaveLength(1);
  });

  it.each([null, undefined, "", "   "])("shows no link for empty location %j", (text) => {
    expect(directionsTargets({ location: text })).toEqual([]);
    expect(directionsTargets({ location: text, sites: [] })).toEqual([]);
  });

  it("gives each site its own labelled link, its address first and its name otherwise, ignoring the event-level region", () => {
    const targets = directionsTargets({
      location: "Iowa and Missouri",
      sites: [{ name: "Camp Heritage", address: "1 Lake Rd, Ames, IA" }, { name: "Sunnydale", address: null }, { name: "Zoom", address: "" }],
    });
    expect(targets).toEqual([
      { label: "Get directions to Camp Heritage", href: `${maps}1%20Lake%20Rd%2C%20Ames%2C%20IA` },
      { label: "Get directions to Sunnydale", href: `${maps}Sunnydale` },
    ]);
  });

  it("uses the plain label for a single site, and never falls back to the region when sites exist", () => {
    expect(directionsTargets({ location: "Iowa and Missouri", sites: [{ name: "Camp Heritage" }] })).toEqual([
      { label: "Get directions", href: `${maps}Camp%20Heritage` },
    ]);
    expect(directionsTargets({ location: "Iowa and Missouri", sites: [{ name: "TBD" }] })).toEqual([]);
  });
});

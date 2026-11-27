/**
 * The sources whose license is recorded for requirement text (#2054). Text is
 * imported only from one of these, matched by the host of the page it came
 * from, and the source's name, license and license link are copied onto each
 * imported set so the credit shown with the text matches where it came from.
 *
 * Adding a source is a reviewed code change: record its license here first.
 */
export type RequirementSource = {
  key: string;
  /** The credit line's name for the source. */
  name: string;
  /** Who publishes it, shown after the name. */
  publisher: string;
  /** Page hosts that belong to this source. */
  hosts: readonly string[];
  license: string;
  licenseUrl: string;
  /** Languages imported from it so far (#2055 decides Spanish). */
  languages: readonly string[];
};

/**
 * The Pathfinder Wiki is the North American Division Youth Ministries' own
 * site ("an official site of the North American Division Youth & Young Adult
 * Ministries"); its footer licenses the text under Creative Commons
 * Attribution-ShareAlike (2.5 or 3.0). Checked Nov 27, 2026. The license
 * covers the text only, not patch artwork, so no pictures come from it.
 */
export const PATHFINDER_WIKI: RequirementSource = {
  key: "pathfinder-wiki",
  name: "Pathfinder Wiki",
  publisher: "North American Division Youth Ministries",
  hosts: ["wiki.pathfindersonline.org", "www.wiki.pathfindersonline.org"],
  license: "CC BY-SA 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  languages: ["en"],
};

export const REQUIREMENT_SOURCES: readonly RequirementSource[] = [PATHFINDER_WIKI];

/** The recorded source a page address belongs to, or null for an address that isn't an https page of a recorded source. */
export function requirementSourceForUrl(address: string): RequirementSource | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return REQUIREMENT_SOURCES.find((source) => source.hosts.includes(host)) ?? null;
}

export function requirementSourceByKey(key: string): RequirementSource | null {
  return REQUIREMENT_SOURCES.find((source) => source.key === key) ?? null;
}

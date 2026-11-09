import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #1596 release-1 crawl: the builder's back arrow went to /event-setup (Create an event), which only system administrators may
// open, so registrars and Clubs Administrators landed on "no access". It goes to the event's Overview, which anyone who can open
// the builder can see.
const source = readFileSync(join(process.cwd(), "components/registration-builder/builder-editor-shell.tsx"), "utf8");

describe("registration builder back arrow (#1596)", () => {
  it("goes to the event overview, not the system-admin Create an event page", () => {
    expect(source).toContain('`/overview?event=${encodeURIComponent(eventId)}`');
    expect(source).toContain('"Back to event overview"');
    expect(source).not.toContain("/event-setup?event=");
  });
});

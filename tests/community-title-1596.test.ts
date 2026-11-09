import { describe, expect, it } from "vitest";
import { staffSubpageTitle } from "@/components/staff-navigation";

// #1596 release-1 crawl: the Attendee community tab's page was headed "Event home" because the shell had no name for it.
describe("Attendee community header (#1596)", () => {
  it("names the community page after its tab", () => {
    expect(staffSubpageTitle("/community")).toBe("Attendee community");
  });
  it("leaves Emails and Help alone", () => {
    expect(staffSubpageTitle("/communications")).not.toBe("Attendee community");
    expect(staffSubpageTitle("/help")).not.toBe("Attendee community");
  });
});

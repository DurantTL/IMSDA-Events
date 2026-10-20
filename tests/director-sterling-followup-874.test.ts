import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DirectorSterlingFollowUp } from "@/components/director-sterling-followup";
import { BackgroundCheckList } from "@/components/background-check-flags";
import type { BackgroundFlag } from "@/modules/background-checks/repository";

const flag = (overrides: Partial<BackgroundFlag> = {}): BackgroundFlag => ({
  attendeeId: "attendee-1",
  personId: "person-1",
  firstName: "Dana",
  lastName: "Example",
  attendeeType: "Adult",
  clubName: "Sample Club",
  organizationId: "club-1",
  confirmationCode: "TEST-1",
  registrationId: "registration-1",
  state: "EXPIRED",
  expiresOn: "2026-09-01",
  contactEmail: "dana.example@example.test",
  issuesNote: "Staff-only note",
  issueReasons: ["Marked Non-Driver"],
  ...overrides,
});

describe("Sterling Volunteers follow-up lists (#874)", () => {
  it("shows a director their own club's people by status only: no dates, contact or staff-only notes", () => {
    const markup = renderToStaticMarkup(createElement(DirectorSterlingFollowUp, { people: [flag()] }));
    expect(markup).toContain("Example, Dana");
    expect(markup).toContain("Expired");
    expect(markup).not.toContain("2026-09-01");
    expect(markup).not.toContain("dana.example@example.test");
    expect(markup).not.toContain("Staff-only note");
    expect(markup).not.toContain("Marked Non-Driver");
    expect(markup).toContain("never held");
  });

  it("says so when everyone is current", () => {
    expect(renderToStaticMarkup(createElement(DirectorSterlingFollowUp, { people: [] }))).toContain("Everyone registered from your club is current.");
  });

  it("gives staff the club and a contact email", () => {
    const markup = renderToStaticMarkup(createElement(BackgroundCheckList, { people: [flag()] }));
    expect(markup).toContain("Sample Club");
    expect(markup).toContain("dana.example@example.test");
  });
});

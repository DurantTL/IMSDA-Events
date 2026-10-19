import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { PendingTeamsReview } from "@/components/pending-teams-review";

const team = {
  id: "sub-1",
  confirmationCode: "PBE-ABC",
  createdAt: "2026-10-20T15:00:00.000Z",
  teamName: "Bible Bees",
  clubNameAsEntered: "Synthetic Trailblazers",
  suggestedClub: null,
  directorName: "Synthetic Director",
  directorEmail: "director@example.test",
  emailClubs: [],
  attendeeCount: 3,
  locationName: null,
  members: [],
  coaches: [],
};
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(PendingTeamsReview, { eventId: "event-1", clubs: [{ id: "club-1", name: "Synthetic Club" }], teams: [team], ...props }));

describe("the waiting team's card offers to add a club that is not in the directory (#1031)", () => {
  it("shows 'Add this club to the directory' for a system administrator when the named club is not in the directory", () => {
    const html = render({ canAddClub: true, sponsors: [{ id: "church-1", name: "Synthetic Church", city: "Synthville", state: "XX" }] });
    expect(html).toContain("Add this club to the directory");
    expect(html).toContain('aria-expanded="false"');
  });

  it("does not offer it when the director picked a club that is in the directory", () => {
    const html = render({ canAddClub: true, teams: [{ ...team, suggestedClub: { id: "club-1", name: "Synthetic Club" } }] });
    expect(html).not.toContain("Add this club to the directory");
  });

  it("tells other staff who can add it, without a button", () => {
    const html = render({ canAddClub: false });
    expect(html).not.toContain("Add this club to the directory");
    expect(html).toContain("A system administrator can add it and confirm the team in one step.");
  });
});

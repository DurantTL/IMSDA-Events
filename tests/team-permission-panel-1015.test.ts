import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";


import { TeamPermissionPanel } from "@/components/team-permission-panel";
import type { TeamPermissionRow } from "@/modules/club-teams/permission-repository";

/** #1015: the coordinator's panel uses approval wording. Synthetic data only. */
const row = (id: string, status: TeamPermissionRow["status"]): TeamPermissionRow => ({
  id, eventId: "evt_1", eventName: "Synthetic PBE", registrationId: `reg_${id}`, clubEventRegistrationId: `cer_${id}`,
  teamLabel: "Team A", locationName: "Iowa", name: `Person ${id}`, age: 18, status,
  decidedAt: status === "PENDING" ? null : "2026-10-01T12:00:00.000Z", decidedBy: status === "PENDING" ? null : "Coordinator",
});

describe("team approvals panel (#1015)", () => {
  const html = renderToStaticMarkup(createElement(TeamPermissionPanel, {
    rows: [row("1", "PENDING"), row("2", "GRANTED")], endpointBase: "/api/test", canDecide: true,
  }));

  it("offers Approve and Decline and says who is waiting for approval", () => {
    expect(html).toMatch(/<button[^>]*>Approve<\/button>/);
    expect(html).toMatch(/<button[^>]*>Decline<\/button>/);
    expect(html).toContain("waiting for approval");
    expect(html).not.toMatch(/>Grant</);
  });

  it("labels a decided person Approved, not Permission granted", () => {
    expect(html).toContain("Approved");
    expect(html).not.toContain("Permission granted");
  });
});

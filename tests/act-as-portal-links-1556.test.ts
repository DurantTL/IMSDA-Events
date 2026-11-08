import { readFileSync } from "node:fs";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ organization: { findUnique: async () => ({ name: "Test Pathfinders" }) } }) }));
vi.mock("@/components/stop-acting-button", () => ({ StopActingButton: () => null }));

import { ActAsBanner } from "@/components/act-as-banner";
import { actAsPortalHref, actAsPortalLabel } from "@/modules/organizations/act-as-portal";

function collect(node: ReactNode, found: Array<{ href?: string; text: string }> = []) {
  if (Array.isArray(node)) node.forEach((child) => collect(child, found));
  else if (isValidElement(node)) {
    const props = node.props as { href?: string; children?: ReactNode };
    if (node.type === "a") found.push({ href: props.href, text: JSON.stringify(props.children) });
    collect(props.children, found);
  }
  return found;
}

const base = { userId: "u", staffSessionId: "s", actAsId: "a", expiresAt: new Date("2026-11-06T20:00:00Z") };

describe("act-as portal links (#1556)", () => {
  it("points each role straight at its portal, never My account", () => {
    expect(actAsPortalHref("CLUB_DIRECTOR", "club-1")).toBe("/account/clubs/club-1");
    expect(actAsPortalHref("AREA_COORDINATOR", null)).toBe("/account/area-clubs/overview");
    expect(actAsPortalLabel("CLUB_DIRECTOR")).toBe("Open the club portal");
    expect(actAsPortalLabel("AREA_COORDINATOR")).toBe("Open the Area Coordinator portal");
  });

  it("links the staff-workspace banner to the club portal for a director act-as", async () => {
    const tree = await ActAsBanner({ acting: { ...base, role: "CLUB_DIRECTOR", organizationId: "club-1" }, inShell: true });
    expect(collect(tree).map((link) => link.href)).toEqual(["/account/clubs/club-1"]);
  });

  it("links the banner to the Area Coordinator portal for an Area Coordinator act-as", async () => {
    const tree = await ActAsBanner({ acting: { ...base, role: "AREA_COORDINATOR", organizationId: null }, inShell: true });
    expect(collect(tree).map((link) => link.href)).toEqual(["/account/area-clubs/overview"]);
  });

  it("adds no link inside the portal, and no banner when not acting", async () => {
    const inPortal = await ActAsBanner({ acting: { ...base, role: "CLUB_DIRECTOR", organizationId: "club-1" }, inAccount: true });
    expect(collect(inPortal)).toEqual([]);
    expect(await ActAsBanner({ acting: null })).toBeNull();
  });
});

describe("Area Coordinator act-as in Clubs administration (#1556)", () => {
  const clubs = readFileSync("app/(workspace)/admin/clubs/page.tsx", "utf8");
  const club = readFileSync("app/(workspace)/admin/organizations/[organizationId]/club/page.tsx", "utf8");

  it("is offered to everyone who passes the page's Clubs administration check, against the same endpoint as People", () => {
    expect(clubs).toContain('if (!(await hasClubsAdministration(user))) redirect("/no-access");');
    expect(clubs).toMatch(/<div className="intro-actions">\s*<ActAsButton/);
    expect(clubs).not.toMatch(/viewer === "SYSTEM_ADMIN" \?\s*\(\s*<div className="intro-actions">/);
    expect(clubs).toContain('endpoint="/api/admin/act-as/area-coordinator"');
  });

  it("keeps Act as Director under the club and the 2-hour label", () => {
    expect(club).toContain("act-as-director");
    expect(club).toContain("Act as Director (2 hours)");
  });

  it("the start routes answer with the shared portal links", () => {
    const ac = readFileSync("app/api/admin/act-as/area-coordinator/route.ts", "utf8");
    const dir = readFileSync("app/api/admin/organizations/[organizationId]/act-as-director/route.ts", "utf8");
    expect(ac).toContain("AREA_COORDINATOR_PORTAL_HREF");
    expect(ac).toContain("requireClubsAdministration");
    expect(ac).toContain("actAsActor(actor)");
    expect(ac).not.toContain("requireSystemAdministrator");
    expect(dir).toContain("clubDirectorPortalHref(organizationId)");
  });
});

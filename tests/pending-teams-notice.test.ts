import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PendingTeamsNotice, pendingTeamsLabel } from "@/components/pending-teams-notice";

const render = (props: { count: number; canManage: boolean }) => renderToStaticMarkup(createElement(PendingTeamsNotice, { eventId: "evt_1", ...props }));

describe("the Registrations page notice for teams waiting for a club", () => {
  it("shows with a waiting team, says how many, and links to the waiting teams page for the event", () => {
    const one = render({ count: 1, canManage: true });
    expect(one).toContain("1 team waiting for a club.");
    expect(one).toContain('href="/people/pending-teams?event=evt_1"');
    expect(one).toContain("not registrations until staff confirm the club");
    expect(render({ count: 3, canManage: true })).toContain("3 teams waiting for a club.");
  });

  it("hides when nothing is waiting", () => {
    expect(render({ count: 0, canManage: true })).toBe("");
  });

  it("hides from someone who cannot resolve waiting teams", () => {
    expect(render({ count: 2, canManage: false })).toBe("");
  });

  it("labels the count the way the expected badge does", () => {
    expect(pendingTeamsLabel(1)).toBe("1 team waiting for a club");
    expect(pendingTeamsLabel(2)).toBe("2 teams waiting for a club");
  });

  it("is only counted for MANAGE_REGISTRATION on the page, and never added to the registration figures", () => {
    const page = readFileSync("app/(workspace)/people/page.tsx", "utf8");
    expect(page).toMatch(/permissions\.includes\("MANAGE_REGISTRATION"\) \? await countPendingTeams\(event\.id\) : 0/);
    const workspace = readFileSync("components/people-workspace.tsx", "utf8");
    expect(workspace).toMatch(/<PendingTeamsNotice canManage=\{canEdit\} count=\{pendingTeamCount\}/);
    expect(workspace).toMatch(/expected\{pageScoped \? " on this page" : ""\}\{canEdit && pendingTeamCount > 0/);
    expect(workspace).toMatch(/No team is registered yet, but/);
  });
});

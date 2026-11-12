import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { MasterGuideAreaApprovals, MasterGuideCandidates } from "@/components/master-guide";
import type { AreaApprovalRow, MasterGuideList, MasterGuideRow } from "@/modules/master-guide/repository";

/** What the Master Guide screens show (#1698). Synthetic names only. */

const window = (pastWindow: boolean) => ({ earliestFinish: "2026-11-01", latestFinish: "2028-11-01", pastWindow });
const row = (over: Partial<MasterGuideRow>): MasterGuideRow => ({
  id: "cand-1", personId: "person-1", name: "Casey Sample", startedOn: "2025-11-01", mentorName: "Sam Sample", status: "IN_PROGRESS",
  window: window(false), clubApprovedOn: null, areaApprovedOn: null, approvalProblem: null, ...over,
});
const list = (rows: MasterGuideRow[], over: Partial<MasterGuideList> = {}): MasterGuideList => ({ clubYear: "2026-27", rows, eligible: [{ personId: "person-2", name: "Adult Roster" }], needBirthDate: [], ...over });
const html = (value: MasterGuideList) => renderToStaticMarkup(createElement(MasterGuideCandidates, { list: value, organizationId: "club-1" }));

describe("the club's candidate list", () => {
  it("shows start date, mentor, the earliest and latest finish and the status", () => {
    const out = html(list([row({})]));
    expect(out).toContain("Casey Sample");
    expect(out).toContain("Nov 1, 2025");
    expect(out).toContain("Sam Sample");
    expect(out).toContain("Nov 1, 2026");
    expect(out).toContain("Nov 1, 2028");
    expect(out).toContain("In progress");
    expect(out).not.toContain("Past the 3-year window");
  });

  it("flags a candidate past the 3-year window", () => {
    expect(html(list([row({ window: window(true) })]))).toContain("Past the 3-year window");
  });

  it("offers Approve for the club, edit and remove only while in progress", () => {
    const inProgress = html(list([row({})]));
    expect(inProgress).toContain("Approve for the club");
    expect(inProgress).toContain("Edit start date and mentor");
    expect(inProgress).toContain(">Remove<");
    const approved = html(list([row({ status: "CLUB_APPROVED", clubApprovedOn: "2026-11-01" })]));
    expect(approved).not.toContain("Approve for the club");
    expect(approved).not.toContain("Edit start date and mentor");
    expect(approved).not.toContain(">Remove<");
    expect(approved).toContain("Approved by the club");
  });

  it("explains instead of offering approval when the candidate is under 18 or has no birth date", () => {
    const out = html(list([row({ approvalProblem: "Birth date needed on the roster." })]));
    expect(out).toContain("Birth date needed on the roster.");
    expect(out).not.toContain("Approve for the club");
  });

  it("lists people who need a birth date and offers the roster people who can be added", () => {
    const out = html(list([], { needBirthDate: ["Nodate Roster"] }));
    expect(out).toContain("Adult Roster");
    expect(out).toContain("Birth date needed on the roster before they can be added: Nodate Roster.");
    expect(out).toContain("No Master Guide candidates yet.");
  });
});

describe("the Area Coordinator's list", () => {
  const area: AreaApprovalRow = { id: "cand-1", organizationId: "club-1", clubName: "Test Pathfinders", name: "Casey Sample", startedOn: "2025-11-01", mentorName: null, clubApprovedOn: "2026-11-01", window: window(false) };

  it("shows each candidate with its club and one action: Approve", () => {
    const out = renderToStaticMarkup(createElement(MasterGuideAreaApprovals, { rows: [area] }));
    expect(out).toContain("Test Pathfinders");
    expect(out).toContain("Approve Casey Sample");
    expect(out).not.toMatch(/Remove|Edit start date|<input|<select/);
  });

  it("says when nothing is waiting", () => {
    expect(renderToStaticMarkup(createElement(MasterGuideAreaApprovals, { rows: [] }))).toContain("No Master Guide candidates are waiting for your approval.");
  });
});

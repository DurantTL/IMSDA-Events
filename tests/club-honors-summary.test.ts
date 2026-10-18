import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({}) }));

import { ClubHonorsWorkspace } from "@/components/club-honors-workspace";
import { HonorsSummaryCell, MemberHonorsViewDialog } from "@/components/honors-summary";
import { honorSummaryCounts, type ClubHonorsRow, type CurrentMemberHonor } from "@/modules/honors/member-honor-domain";

function honor(n: number, status: CurrentMemberHonor["status"], completionDate = ""): CurrentMemberHonor {
  return { honorId: `h${n}`, honorCode: `C${n}`, honorName: `Synthetic Honor ${n}`, status, completionDate, createdAt: "2026-01-01T00:00:00.000Z" };
}
const many = [
  ...Array.from({ length: 8 }, (_, i) => honor(i, "COMPLETED", "2026-03-01")),
  honor(8, "IN_PROGRESS"),
  honor(9, "IN_PROGRESS"),
];
const cell = (honors: CurrentMemberHonor[]) =>
  renderToStaticMarkup(createElement(HonorsSummaryCell, { honors, person: "Pat Example", onView: () => {} }));

describe("club Honors summary cell", () => {
  it("counts total, completed and in progress", () => {
    expect(honorSummaryCounts(many)).toEqual({ total: 10, completed: 8, inProgress: 2 });
  });
  it("shows None yet and no View button with no honors", () => {
    const html = cell([]);
    expect(html).toContain("None yet");
    expect(html).not.toContain("View");
  });
  it("shows one honor with a View button", () => {
    const html = cell([honor(1, "IN_PROGRESS")]);
    expect(html).toContain("1 honor<");
    expect(html).toContain("1 in progress");
    expect(html).not.toContain("0 completed");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="View honor for Pat Example"');
    expect(html).toContain(">View<");
  });
  it("shows the many-honor counts without listing chips", () => {
    const html = cell(many);
    expect(html).toContain("10 honors");
    expect(html).toContain("8 completed");
    expect(html).toContain("2 in progress");
    expect(html).toContain('<span aria-hidden="true"> · </span><span class="sr-only">, </span>');
    expect(html).toContain('aria-label="View honors for Pat Example"');
    expect(html).not.toContain("Synthetic Honor");
  });
});

describe("member honors view dialog", () => {
  it("lists every honor with its status and the shared close button", () => {
    const html = renderToStaticMarkup(createElement(MemberHonorsViewDialog, { honors: many, person: "Pat Example", onClose: () => {} }));
    for (let i = 0; i < 10; i += 1) expect(html).toContain(`Synthetic Honor ${i}<`);
    expect(html.match(/Completed/g)).toHaveLength(8);
    expect(html.match(/In progress/g)).toHaveLength(2);
    expect(html).toContain("icon-button modal-close-button");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Honors for Pat Example"');
    // Completion dates read the same as the summary line, never as a raw ISO date.
    expect(html).toContain("March 1, 2026");
    expect(html).not.toContain("2026-03-01");
  });
});

const rows: ClubHonorsRow[] = [{
  memberId: "m1", firstName: "Pat", lastName: "Example", classLevel: null,
  honors: [honor(1, "COMPLETED", "2026-03-03"), honor(2, "IN_PROGRESS"), honor(3, "COMPLETED", "2026-04-01")],
}];
const options = [{ id: "h1", code: "C1", name: "Synthetic Honor 1" }, { id: "h2", code: "C2", name: "Synthetic Honor 2" }];
const workspace = (props: Partial<Parameters<typeof ClubHonorsWorkspace>[0]>) =>
  renderToStaticMarkup(createElement(ClubHonorsWorkspace, { organizationId: "org-1", clubYear: "2026-27", initialRows: rows, honorOptions: options, ...props }));

describe("Honors page summary under filters", () => {
  it("shows whole-person totals with no filter", () => {
    const html = workspace({});
    expect(html).toContain("3 honors");
    expect(html).toContain("2 completed");
    expect(html).toContain("1 in progress");
    expect(html).not.toContain("honors-summary-filter");
  });
  it("an honor filter adds that honor's status and date, and keeps the whole-person total", () => {
    const completed = workspace({ initialHonorFilter: "h1" });
    expect(completed).toContain("3 honors");
    expect(completed).toContain("Synthetic Honor 1</span>: Completed March 3, 2026");
    const inProgress = workspace({ initialHonorFilter: "h2" });
    expect(inProgress).toContain("Synthetic Honor 2</span>: In progress");
    expect(inProgress).not.toContain("In progress March");
  });
  it("a status filter alone shows the filtered count out of the total", () => {
    expect(workspace({ initialStatusFilter: "COMPLETED" })).toContain("2 of 3 completed");
    expect(workspace({ initialStatusFilter: "IN_PROGRESS" })).toContain("1 of 3 in progress");
  });
});

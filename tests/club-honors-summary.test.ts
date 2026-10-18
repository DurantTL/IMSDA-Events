import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HonorsSummaryCell, MemberHonorsViewDialog } from "@/components/honors-summary";
import { honorSummaryCounts, type CurrentMemberHonor } from "@/modules/honors/member-honor-domain";

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
    expect(html).toContain("0 completed · 1 in progress");
    expect(html).toContain(">View<");
  });
  it("shows the many-honor counts without listing chips", () => {
    const html = cell(many);
    expect(html).toContain("10 honors");
    expect(html).toContain("8 completed · 2 in progress");
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
  });
});

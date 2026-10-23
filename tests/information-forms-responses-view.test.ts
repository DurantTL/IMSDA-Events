import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/staff-page-header", () => ({
  StaffPageHeader: ({ description, primary }: { description?: string; primary?: unknown }) => createElement("header", null, description, primary as never),
}));

import { answerText, InformationFormResponsesView, responseColumns, type ResponseRowView } from "@/components/information-form-responses-view";

const rows: ResponseRowView[] = [
  { id: "r2", versionNumber: 2, submittedAt: new Date("2026-10-22T15:00:00Z"), signedIn: true, answers: [{ key: "rating", label: "Rating", type: "SELECT", value: "Great" }, { key: "tags", label: "What worked", type: "MULTISELECT", value: ["Food", "Music"] }] },
  { id: "r1", versionNumber: 1, submittedAt: new Date("2026-10-21T15:00:00Z"), signedIn: false, answers: [{ key: "rating", label: "Rating", type: "SELECT", value: "Fine" }, { key: "old", label: "Old question", type: "SHORT_TEXT", value: "kept" }] },
];

function render(overrides: Partial<Parameters<typeof InformationFormResponsesView>[0]> = {}) {
  return renderToStaticMarkup(createElement(InformationFormResponsesView, {
    formName: "Camp survey", total: 2, rows, selected: null, exportHref: "/api/x/responses/export", rowHref: (id) => `/r?response=${id}`, closeHref: "/r", nextHref: null, ...overrides,
  }));
}

describe("information form responses view (#1150)", () => {
  it("has one column per question across versions, newest response first", () => {
    expect(responseColumns(rows).map((column) => column.label)).toEqual(["Rating", "What worked", "Old question"]);
    const html = render();
    expect(html).toContain("2 responses");
    expect(html.indexOf("r2")).toBeLessThan(html.indexOf("r1"));
    expect(html).toContain('class="report-table table-cards information-form-table"');
    expect(html).toContain('data-label="Rating"');
    expect(html).toContain("Food, Music");
  });

  it("offers the CSV download and says when there are no responses", () => {
    expect(render()).toContain('href="/api/x/responses/export"');
    const empty = render({ total: 0, rows: [] });
    expect(empty).toContain("0 responses");
    expect(empty).toContain("No one has answered yet.");
    expect(empty).not.toContain("Download CSV");
    expect(render({ total: 1, rows: [rows[0]!] })).toContain("1 response<");
  });

  it("opens one response with every labelled answer, and pages older ones", () => {
    const html = render({ selected: rows[0]!, nextHref: "/r?cursor=r1" });
    expect(html).toContain("Form version 2");
    expect(html).toContain("<dt>What worked</dt><dd>Food, Music</dd>");
    expect(html).toContain('href="/r?cursor=r1"');
  });

  it("formats answers as plain text", () => {
    expect(answerText(true)).toBe("Yes");
    expect(answerText({ street: "1 Sample Way", city: "Sampletown", zip: "" })).toBe("1 Sample Way, Sampletown");
    expect(answerText(undefined)).toBe("");
  });
});

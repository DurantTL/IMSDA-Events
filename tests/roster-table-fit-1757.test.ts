import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SortableHeader } from "@/components/list-sort";
import { RosterTableScroll } from "@/components/roster-table-scroll";

describe("roster table fit (#1757)", () => {
  it("shows a short header and still reads out the full name", () => {
    const html = renderToStaticMarkup(
      createElement(SortableHeader, { active: false, direction: "asc", fullLabel: "Seventh-day Adventist church member", hiddenLabel: "Members", label: "SDA member", onSort: () => undefined }),
    );
    expect(html).toContain("SDA member");
    expect(html).toContain('<span class="sr-only"> (Seventh-day Adventist church member)</span>');
  });

  it("wraps the table in the shared wrap, and is not a tab stop until it scrolls", () => {
    const html = renderToStaticMarkup(createElement(RosterTableScroll, { label: "Members, scrolls sideways" }, createElement("table")));
    expect(html).toContain("report-table-wrap");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("role=");
  });
});

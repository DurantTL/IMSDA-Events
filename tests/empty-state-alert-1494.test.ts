import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/empty-state";

const html = (announce?: boolean | "alert") => renderToStaticMarkup(createElement(EmptyState, { title: "Nothing here", announce }, "Why."));

describe("EmptyState announce", () => {
  it("is a polite status by default", () => expect(html()).toContain('role="status"'));
  it("has no live region when false", () => expect(html(false)).not.toContain("role="));
  it('is role="alert" for announce="alert"', () => {
    const out = html("alert");
    expect(out).toContain('role="alert"');
    expect(out).not.toContain('role="status"');
  });
});

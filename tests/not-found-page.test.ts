import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("site-wide not-found page (#470)", () => {
  it("is branded and links to the events home and the calendar, never off-site", () => {
    const html = renderToStaticMarkup(NotFound());

    expect(html).toContain("IMSDA");
    expect(html).toContain("Events home");
    expect(html).toContain("See the calendar");
    expect(html).toContain('href="/calendar"');
    // The header logo goes to the calendar (#1496); the "Events home" link is the only one to "/".
    expect(html).toContain('aria-label="IMSDA Events calendar"');
    expect(html.match(/href="\/"/g)?.length).toBe(1);
    expect(html).not.toContain("imsda.org");
  });
});

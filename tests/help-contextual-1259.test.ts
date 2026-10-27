import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextualHelp } from "@/components/contextual-help";
import { GuideScreenshotFigure } from "@/components/guide-screenshot";
import { eventPermissions } from "@/modules/access/permissions";
import { contextualPortalHelp, contextualStaffHelp } from "@/modules/help/contextual";
import { publicFileExists } from "@/modules/help/guide-check-files";
import { helpGuides } from "@/modules/help/guides";
import { portalGuides } from "@/modules/help/portal-guides";
import type { PortalHelpViewer } from "@/modules/help/portal-visibility";
import { screenshotCaption, screenshotIsStale, screenshotStaleNote } from "@/modules/help/screenshot";
import type { HelpViewer } from "@/modules/help/visibility";

/** Contextual help and guide screenshots (#1259). Synthetic viewers only. */

const root = process.cwd();
const staff = (permissions: HelpViewer["permissions"], isSystemAdmin = false): HelpViewer => ({ isSystemAdmin, selectedEventId: "evt_synthetic", permissions });
const director: PortalHelpViewer = { hasAccount: true, directedClubs: [{ organizationId: "org_a", role: "DIRECTOR" }], isAreaCoordinator: false, acting: null };

describe("the server's choice of contextual guide", () => {
  it("offers the guide only to a viewer who may see it", () => {
    expect(contextualStaffHelp("import-with-preview", staff(["MANAGE_IMPORTS"]))?.guideId).toBe("import-with-preview");
    expect(contextualStaffHelp("import-with-preview", staff(["VIEW_EVENT"]))).toBeNull();
    expect(contextualStaffHelp("resolve-email-problem", staff([...eventPermissions], true))?.guideId).toBe("resolve-email-problem");
    expect(contextualStaffHelp("resolve-email-problem", staff(["MANAGE_IMPORTS"]))).toBeNull();
    expect(contextualStaffHelp("no-such-guide", staff([...eventPermissions], true))).toBeNull();
    expect(contextualPortalHelp("director-monthly-record", director)?.guideId).toBe("director-monthly-record");
    expect(contextualPortalHelp("director-monthly-record", { ...director, directedClubs: [] })).toBeNull();
  });

  it("hands over only the guide's static text and a link to the full guide", () => {
    const help = contextualStaffHelp("import-with-preview", staff(["MANAGE_IMPORTS"]))!;
    expect(Object.keys(help).sort()).toEqual(["fullHref", "guideId", "steps", "summary", "title"]);
    expect(help.fullHref).toBe("/help/import-with-preview?event=evt_synthetic");
    expect(contextualPortalHelp("director-monthly-record", director)!.fullHref).toBe("/account/help/director-monthly-record");
    const guide = helpGuides.find((g) => g.id === "import-with-preview")!;
    expect(help.steps).toEqual(guide.steps);
  });

  it("is wired on the working pages, not in a shared header", () => {
    const read = (path: string) => readFileSync(join(root, path), "utf8");
    expect(read("app/(workspace)/imports/page.tsx")).toContain('guideId="import-with-preview"');
    expect(read("app/(workspace)/communications/page.tsx")).toContain('guideId="resolve-email-problem"');
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx")).toContain('guideId="director-monthly-record"');
    expect(read("components/staff-page-header.tsx")).not.toContain("ContextualHelp");
    expect(read("app/(workspace)/layout.tsx")).not.toContain("ContextualHelp");
  });
});

describe("the dialog", () => {
  const help = contextualStaffHelp("import-with-preview", staff(["MANAGE_IMPORTS"]))!;
  const html = renderToStaticMarkup(createElement(ContextualHelp, { help }));

  it("is a native dialog named by its title, with a visible Close and a new-tab link to the full guide", () => {
    expect(html).toContain("<dialog");
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain(`>${help.title}</h2>`);
    expect(html).toContain(">Close</button>");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(`href="${help.fullHref}"`);
  });

  it("has a Help trigger that announces a dialog, and shows the guide's steps", () => {
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Help/);
    for (const step of help.steps.slice(0, 2)) expect(html).toContain(step.replace(/'/g, "&#x27;"));
  });

  it("opens with showModal, closes with close, and returns focus to the trigger (read from the source: the repo has no DOM test environment)", () => {
    const source = readFileSync(join(root, "components/contextual-help.tsx"), "utf8");
    expect(source).toContain("showModal()");
    expect(source).toContain(".close()");
    expect(source).toMatch(/onClose=\{\(\) => triggerRef\.current\?\.focus\(\)\}/);
    const css = readFileSync(join(root, "components/contextual-help.module.css"), "utf8");
    expect(css).toMatch(/\.trigger,\s*\.action\s*\{[^}]*min-height: 44px/);
  });
});

describe("guide screenshots", () => {
  const guide = (lastReviewed: string, capturedFor = "2026-10-27") => ({ lastReviewed, screenshot: { src: "/help/x.webp", alt: "a", width: 800, height: 600, capturedFor } });

  it("is stale only when the guide was reviewed after the picture was taken", () => {
    expect(screenshotIsStale(guide("2026-10-27"))).toBe(false);
    expect(screenshotIsStale(guide("2026-10-26"))).toBe(false);
    expect(screenshotIsStale(guide("2026-10-28"))).toBe(true);
    expect(screenshotIsStale(guide("2027-01-01", "2026-12-31"))).toBe(true);
    expect(screenshotIsStale({ lastReviewed: "2030-01-01" })).toBe(false);
  });

  it("renders a figure labelled as sample data, with the out-of-date note only when stale", () => {
    const fresh = renderToStaticMarkup(createElement(GuideScreenshotFigure, { guide: guide("2026-10-27") }));
    expect(fresh).toContain("<figure");
    expect(fresh).toContain(screenshotCaption);
    expect(fresh).toContain('alt="a"');
    expect(fresh).not.toContain(screenshotStaleNote);
    expect(renderToStaticMarkup(createElement(GuideScreenshotFigure, { guide: guide("2026-11-02") }))).toContain(screenshotStaleNote);
    expect(renderToStaticMarkup(createElement(GuideScreenshotFigure, { guide: { lastReviewed: "2026-10-27" } }))).toBe("");
  });

  it("only uses small image files that exist under public/, with alt text and a capture date", () => {
    for (const guide of [...helpGuides, ...portalGuides]) {
      if (!guide.screenshot) continue;
      expect(publicFileExists(guide.screenshot.src), guide.id).toBe(true);
      expect(guide.screenshot.alt.length, guide.id).toBeGreaterThan(10);
      expect(guide.screenshot.width, guide.id).toBeGreaterThan(0);
      expect(guide.screenshot.height, guide.id).toBeGreaterThan(0);
      expect(guide.screenshot.capturedFor, guide.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(readFileSync(join(root, "public", guide.screenshot.src)).length, guide.id).toBeLessThan(150 * 1024);
    }
    expect([...helpGuides, ...portalGuides].filter((guide) => guide.screenshot).length).toBeGreaterThanOrEqual(3);
  });
});

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EventContentWorkspace } from "@/components/event-content-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffPageTitles } from "@/components/staff-navigation";

// #1586 (staff redesign): the Public content editor. Synthetic data only.
const read = (file: string) => readFileSync(file, "utf8");
const page = read("app/(workspace)/more/event-content/page.tsx");
const workspace = read("components/event-content-workspace.tsx");

const section = (kind: string, title: string, isPublished: boolean) => ({
  id: `s-${title}`, kind, title, body: "", tone: null, placement: "PUBLIC_PAGE", items: [], data: {}, isPublished, links: [],
});

const markup = renderToStaticMarkup(createElement(EventContentWorkspace, {
  eventId: "event-1",
  eventName: "Synthetic Event",
  eventSlug: "synthetic-event",
  eventTiming: { startsAt: "2026-10-09T23:00:00.000Z", endsAt: "2026-10-11T17:00:00.000Z", timezone: "America/Chicago" },
  isSystemAdmin: false,
  initialSections: [section("RICH_TEXT", "About camp", true), section("STEPS", "", false)] as never,
  initialSanitizedHtml: {},
  initialAssets: [],
}));

describe("Public content layout (#1586)", () => {
  it("draws its own title from the shared header and is listed as owning it", () => {
    expect(staffPageTitles.eventContent).toBe("Public content");
    expect(page).toContain("<PageHeader");
    expect(page).toContain("title={staffPageTitles.eventContent}");
    expect(pageOwnsHeader("/more/event-content")).toBe(true);
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain(">Public content</h2>");
  });

  it("gives each section a heading with kind and state chips", () => {
    expect(markup).toContain("<h2>Sections</h2>");
    expect(markup).toMatch(/<h3[^>]*>About camp<\/h3>/);
    expect(markup).toContain("status-chip green");
    expect(markup).toContain(">Published<");
    expect(markup).toContain("status-chip gold");
    expect(markup).toContain(">Draft<");
    expect(markup).not.toContain("· draft");
  });

  it("has local anchors to the uploads and sections areas", () => {
    expect(page).toContain('href="#event-content-uploads"');
    expect(page).toContain('href="#event-content-sections"');
    expect(markup).toContain('id="event-content-uploads"');
    expect(markup).toContain('id="event-content-sections"');
  });

  it("keeps one filled button, in a pinned save bar when there are unsaved edits", () => {
    expect(markup.match(/primary-button/g)).toHaveLength(1);
    expect(workspace).toContain("event-savebar${dirty ? \" is-pinned\" : \"\"}");
    expect(workspace).toContain('aria-live="polite"');
  });

  it("groups the add controls under one heading", () => {
    expect(markup).toContain(">Add a section</h2>");
    expect(markup).toContain("Add a text section");
    expect(markup).toContain("Add block");
  });

  it("deletes a file through the shared confirm dialog, with the same request", () => {
    expect(workspace).not.toContain('aria-labelledby="delete-asset-title"');
    expect(workspace).not.toContain("useAccessibleDialog");
    expect(workspace).toMatch(/<ConfirmDialog[^>]*\n[^]*?confirmLabel="Delete file"/);
    expect(workspace).toContain('method: "DELETE"');
  });

  it("links to the public page with the shared address helper, and moves the starter to the header", () => {
    expect(page).toContain('import { publicEventPath } from "@/modules/events/share-links"');
    expect(page).toContain("publicEventPath({ slug: event.slug })");
    expect(page).toContain("View public page");
    expect(page).toContain("secondary={<EventContentStarterButton />}");
    expect(markup).not.toContain("Add event guide starter");
  });

  it("sizes the file delete button to 44px and drops the stack's doubled top padding", () => {
    const css = read("components/event-content-workspace.module.css");
    expect(css).toMatch(/\.deleteFile:global\(\.icon-button\)\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(css).toMatch(/\.workspace:global\(\.page-stack\)\s*\{\s*padding-top: 0;/);
    expect(workspace).toContain("styles.deleteFile");
    expect(workspace).toContain("styles.workspace");
  });
});

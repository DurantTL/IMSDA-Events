// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SavedViewsPanel, savedViewHref } from "@/components/saved-views-panel";
import type { SavedViewItem } from "@/modules/registrations/saved-views-domain";

// #1511: the Saved views panel. Synthetic data only.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(),
}));

const views: SavedViewItem[] = [
  { id: "v1", name: "Unpaid", query: "payment=UNPAID", shared: false, isOwn: true, ownerName: null, stale: false },
  { id: "v2", name: "VIP list", query: "tag=tag-1", shared: true, isOwn: true, ownerName: null, stale: false },
  { id: "v3", name: "Late walk-ins", query: "tag=tag-gone", shared: true, isOwn: false, ownerName: "Alex Sample", stale: true },
];
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(SavedViewsPanel, { eventId: "event-1", views, currentQuery: "payment=UNPAID", canSave: true, canShare: true, ...props } as never));

describe("Saved views panel (#1511)", () => {
  it("links a view to the list with its filters and the event", () => {
    expect(savedViewHref("event-1", "payment=UNPAID")).toBe("/people?payment=UNPAID&event=event-1");
    expect(render()).toContain('href="/people?payment=UNPAID&amp;event=event-1"');
  });

  it("groups own views and views shared by others, naming who shared", () => {
    const html = render();
    expect(html).toContain("Your views");
    expect(html).toContain("Shared with event staff");
    expect(html).toContain("Shared by Alex Sample");
  });

  it("marks the view that matches the current filters", () => {
    const html = render();
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("Current view");
    expect(html).not.toContain("Showing");
  });

  it("says plainly when a view uses a filter that is gone or not available, and still links and deletes it", () => {
    const html = render();
    expect(html).toContain("Uses a filter that no longer exists or isn&#x27;t available to you.");
    expect(html).toContain("tag=tag-gone");
    expect(html).toMatch(/Delete<span class="sr-only"> Late walk-ins<\/span>/);
  });

  it("offers sharing only to staff who can share, and only on their own views", () => {
    const withShare = render();
    expect(withShare).toContain("Share with event staff");
    expect(withShare).toContain("Stop sharing");
    const withoutShare = render({ canShare: false });
    // The owner of a shared view may still take it down; nobody without the permission is offered to share.
    expect(withoutShare).toMatch(/Stop sharing<span class="sr-only">: VIP list/);
    expect(withoutShare).not.toMatch(/Stop sharing<span class="sr-only">: Late walk-ins/);
    expect(withoutShare).not.toContain("Share with event staff");
    // A reader cannot delete someone else's shared view; an owner can delete their own.
    expect(withoutShare).not.toMatch(/Delete<span class="sr-only"> Late walk-ins/);
    expect(withoutShare).toMatch(/Delete<span class="sr-only"> Unpaid/);
  });

  it("shows Save these filters, with a visible label, only when there is something to save", () => {
    expect(render()).toContain("Save these filters");
    expect(render()).toContain("Name for these filters");
    expect(render({ canSave: false })).not.toContain("Save these filters");
  });

  it("folds a group of more than 8 views behind a native Show all", () => {
    const many: SavedViewItem[] = Array.from({ length: 10 }, (_, index) => ({ id: `m${index}`, name: `View ${index}`, query: `tag=t${index}`, shared: false, isOwn: true, ownerName: null, stale: false }));
    const html = render({ views: many });
    expect(html).toContain("<details");
    expect(html).toContain("Show all 10");
    expect(render({ views: many.slice(0, 8) })).not.toContain("Show all");
  });

  it("uses the shared status chip, keeps buttons focusable and wires focus and the unsaved guard in source", () => {
    const source = readFileSync("components/saved-views-panel.tsx", "utf8");
    expect(source).toContain("status-chip");
    expect(source).not.toMatch(/\sdisabled=\{/);
    expect(source).toContain("aria-disabled");
    expect(source).toContain("useUnsavedChangesGuard(name.trim() !== \"\")");
    expect(source).toContain("aria-invalid");
    expect(source).toContain("nameRef.current?.focus()");
    expect(source).toContain("headingRef.current?.focus()");
    expect(source).toContain("tabIndex={-1}");
    expect(source).toContain('"Deleting…"');
  });

  it("offers Save only when the page read every filter, in source", () => {
    const page = readFileSync("app/(workspace)/people/page.tsx", "utf8");
    expect(page).toContain("searchParseIssues.length === 0 && retiredAnswerParams.length === 0}");
  });

  it("shows the Archived views group only to someone who can share", () => {
    const archived: SavedViewItem[] = [{ id: "a1", name: "Old walk-ins", query: "tag=t1", shared: true, isOwn: false, ownerName: "Sam Departed", stale: false }];
    const html = render({ archivedViews: archived });
    expect(html).toContain("Archived views (1)");
    expect(html).toContain("Made by Sam Departed, who is no longer on this event&#x27;s staff");
    expect(html).toContain("Restore<span");
    expect(html).not.toContain('href="/people?tag=t1');
    const reader = render({ archivedViews: archived, canShare: false });
    expect(reader).not.toContain("Archived views");
    expect(reader).not.toContain("Sam Departed");
    expect(render()).not.toContain("Archived views");
  });

  it("says one plain sentence when there are no views", () => {
    expect(render({ views: [], canSave: false })).toContain("No saved views yet.");
  });

  it("keeps its styles in a module with tokens, 44px targets and the 14px label floor", () => {
    const css = readFileSync("components/saved-views-panel.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain("var(--touch-target, 44px)");
    expect(css).toContain("max(var(--type-staff-floor, 0px), 0.875rem)");
    expect(readFileSync("app/(workspace)/people/page.tsx", "utf8")).toContain("<SavedViewsPanel");
  });
});

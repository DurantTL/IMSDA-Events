import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/finance",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { EventAutoSelectNotice } from "@/components/event-auto-select-notice";
import { StaffTabRow } from "@/components/staff-tab-row";
import { StaffViewStrip } from "@/components/staff-view-strip";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const shellCss = read("components/staff-shell.module.css");
const phoneBlock = (() => {
  const at = shellCss.indexOf("~ .shellViews");
  const start = shellCss.lastIndexOf("@media (max-width: 800px)", at);
  return shellCss.slice(start, shellCss.indexOf("\n}\n", at));
})();

/** Phones put the task first inside an event (#2023): the title starts within 200px of the top. */
describe("the menu line names the current view", () => {
  const views = [
    { key: "payments", label: "Payments", href: "/finance", current: true },
    { key: "invoices", label: "Invoices", href: "/finance/invoices" },
  ];
  const tabs = [
    { key: "home", label: "Event home", href: "/overview" },
    { key: "money", label: "Money", href: "/finance", current: true, views },
  ];

  it("shows the tab, then the current view, in the menu line", () => {
    const markup = renderToStaticMarkup(createElement(StaffTabRow, { label: "Event", menuLabel: "Event menu", title: "Event menu", tabs }));
    expect(markup).toMatch(/>Money<\/span><\/span><span class="[^"]*currentView[^"]*"><span aria-hidden="true">› <\/span>Payments<\/span>/);
  });

  it("names no view when the tab has a single view or none", () => {
    const single = [{ ...tabs[1], views: [views[0]] }];
    const markup = renderToStaticMarkup(createElement(StaffTabRow, { label: "Event", menuLabel: "Event menu", title: "Event menu", tabs: single }));
    expect(markup).not.toContain("currentView");
  });
});

describe("the shell's views strip on a phone", () => {
  it("marks only the shell's own strip, so a page's strip stays", () => {
    const views = [
      { key: "a", label: "A", href: "/a", current: true },
      { key: "b", label: "B", href: "/b" },
    ];
    expect(renderToStaticMarkup(createElement(StaffViewStrip, { label: "Shell", views, shell: true }))).toMatch(/class="[^"]*shellViews/);
    expect(renderToStaticMarkup(createElement(StaffViewStrip, { label: "Page", views }))).not.toContain("shellViews");
    expect(read("components/app-shell.tsx")).toContain("<StaffViewStrip shell label=");
  });

  it("hides the strip until the row is measured and fits, and keeps the line to two short lines", () => {
    expect(phoneBlock).toContain(".tabline:not([data-measured][data-fit=\"ok\"]) ~ .shellViews { display: none; }");
    expect(phoneBlock).toContain(".tabline[data-fit=\"tight\"] .currentView { display: block; }");
    expect(phoneBlock).toMatch(/:is\(\.currentName, \.currentView\) \{[^}]*text-overflow: ellipsis/);
    // Wider screens never show the view's name in the menu line; the strip shows it.
    expect(shellCss).toMatch(/^\.currentView \{ display: none;/m);
  });

  it("drops the page-stack's top padding only under the event bar", () => {
    expect(phoneBlock).toContain(".eventBar ~ :global(.workspace-content) > :global(.page-stack) { padding-top: 0; }");
  });

  it("drops an Events Administrator's repeated section name only under the event bar, as wider screens already do", () => {
    expect(phoneBlock).toContain(':global([data-testid="admin-section-header"][data-section="events"] > .eyebrow) { display: none; }');
    expect(read("components/admin-section-header.module.css")).toMatch(/@media \(min-width: 801px\) \{[\s\S]*?\.header \.name \{ display: none; \}/);
  });
});

describe("the Continuing with notice and page Help", () => {
  it("hides the notice on a phone only when the event bar is shown", () => {
    const withBar = renderToStaticMarkup(createElement(EventAutoSelectNotice, { eventName: "Camp", withEventBar: true }));
    const alone = renderToStaticMarkup(createElement(EventAutoSelectNotice, { eventName: "Camp" }));
    expect(withBar).toMatch(/class="[^"]*withEventBar/);
    expect(alone).not.toContain("withEventBar");
    const css = read("components/event-auto-select-notice.module.css");
    expect(css.slice(css.indexOf("@media (max-width: 800px)"))).toContain(".withEventBar { display: none; }");
    expect(read("components/app-shell.tsx")).toContain("withEventBar={eventBarShown}");
  });

  it("puts Communications' Help in the page header, not above the title", () => {
    const page = read("app/(workspace)/communications/page.tsx");
    expect(page).toContain("help={<StaffContextualHelp guideId=\"resolve-email-problem\" event={requested} />}");
    expect(page).not.toMatch(/^\s*<StaffContextualHelp/m);
    expect(read("components/communications-workspace.tsx")).toContain("extra={help ? <div className={styles.helpSlot}>{help}</div> : undefined}");
  });
});

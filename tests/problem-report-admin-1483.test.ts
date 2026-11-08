// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1483: the Problem reports page (empty state, one page-level live region) and the completed button. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  usePathname: () => "/admin/problem-reports",
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/support/problem-reports", () => ({ listProblemReports: mocks.list, countOpenProblemReports: mocks.count }));
vi.mock("@/components/admin-section-header", () => ({ AdminSectionHeaderFor: () => null }));

import ProblemReportsPage from "@/app/(workspace)/admin/problem-reports/page";
import { ProblemReportResolveButton } from "@/components/problem-report-resolve-button";
import { ProblemReportsStatusProvider } from "@/components/problem-reports-status";
import { click, flush, mount } from "./helpers/dom-render";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  mocks.list.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
});

const row = { id: "pr-1", reference: "P-1", message: "It froze.", email: null, status: "OPEN", createdAt: new Date("2026-11-08T15:00:00Z"), resolvedAt: null, details: null, appVersion: undefined };

describe("the Problem reports page", () => {
  it("says why the list is empty and offers the next step", async () => {
    const html = renderToStaticMarkup(await ProblemReportsPage());
    expect(html).toContain("No problem reports yet");
    expect(html).toContain("Forms help popup");
    expect(html).toMatch(/<a[^>]*href="\/admin\/system-report"[^>]*>Open the System report<\/a>/);
    expect(html).toContain("Nothing open");
  });

  it("counts open reports from the full count, not the rows listed", async () => {
    mocks.list.mockResolvedValue([row]);
    mocks.count.mockResolvedValue(412);
    expect(renderToStaticMarkup(await ProblemReportsPage())).toContain("412 open");
  });

  it("has one polite status region outside the list", async () => {
    mocks.list.mockResolvedValue([row]);
    mocks.count.mockResolvedValue(1);
    const html = renderToStaticMarkup(await ProblemReportsPage());
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.indexOf('role="status"')).toBeGreaterThan(html.indexOf("</ul>"));
  });

  it("refuses anyone but a system administrator", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: null } });
    await expect(ProblemReportsPage()).rejects.toThrow("redirect:/no-access?from=system");
  });
});

describe("Mark completed", () => {
  it("announces in the page-level region, which is still there after the button is gone, and focuses the heading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "pr-1", status: "RESOLVED" })));
    const heading = document.createElement("h2");
    heading.id = "problem-reports-heading";
    heading.tabIndex = -1;
    document.body.appendChild(heading);
    const tree = (withButton: boolean) => createElement(ProblemReportsStatusProvider, null, withButton ? createElement(ProblemReportResolveButton, { id: "pr-1", reference: "P-1" }) : null);
    const mounted = await mount(tree(true));
    await click(mounted.container.querySelector("button")!);
    await flush(10);
    const region = mounted.container.querySelector('[role="status"]')!;
    expect(region.textContent).toBe("P-1 marked completed.");
    expect(document.activeElement).toBe(heading);
    // The refresh removes the row's button: the message stays.
    await mounted.root.render(tree(false));
    await flush(10);
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toBe("P-1 marked completed.");
    expect(mocks.refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
    heading.remove();
    await mounted.unmount();
  });
});

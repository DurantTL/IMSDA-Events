import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: () => undefined }));
vi.mock("@/components/search-as-you-type", () => ({
  SearchAsYouTypeForm: ({ children }: { children?: unknown }) => createElement("form", null, children as never),
  SearchResultStatus: () => null,
}));

import { LeaderDirectory } from "@/components/leader-directory";
import { LeaderDirectorySwitch } from "@/components/leader-directory-switch";

describe("leader directory components (#1707)", () => {
  it("renders the switch with a saved change time without throwing, labeled Central", () => {
    const html = renderToStaticMarkup(createElement(LeaderDirectorySwitch, { initial: { enabled: true, setAt: "2026-11-12T15:30:00.000Z" } }));
    expect(html).toContain("Last changed");
    expect(html).toMatch(/Nov 12, 2026/);
    expect(html).toMatch(/CST|CDT/);
  });

  it("explains an empty directory and links to the profile", () => {
    const slice = { items: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0 };
    const html = renderToStaticMarkup(createElement(LeaderDirectory, { slice, total: 0, filters: { q: "", role: "" } }));
    expect(html).toContain('href="/account/profile"');
  });

  it("protects names, emails and phones from translation", () => {
    const entry = { name: "Casey Rivera", clubId: "c", clubName: "Alpha Adventurers", roles: ["DIRECTOR" as const], roleLabel: "Director", email: "casey@example.org", phone: "(515) 555-0100" };
    const slice = { items: [entry], page: 1, pageCount: 1, total: 1, from: 1, to: 1 };
    const html = renderToStaticMarkup(createElement(LeaderDirectory, { slice, total: 1, filters: { q: "", role: "" } }));
    for (const value of ["Casey Rivera", "casey@example.org", "(515) 555-0100"]) expect(html).toContain(`translate="no">${value}<`);
  });
});

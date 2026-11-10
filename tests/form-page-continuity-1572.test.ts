import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/information-forms/responses", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));

import { BUILDER_SETTINGS_HASH, informationFormPageViews, LIVE_PREVIEW_HASH } from "@/components/form-page-views";
import { InformationFormResponsesView } from "@/components/information-form-responses-view";
import { eventInformationConfig, generalInformationConfig } from "@/components/registration-builder/information-mode";
import { hashAction } from "@/components/registration-builder/shell-keys";

const read = (path: string) => readFileSync(path, "utf8");
const event = { id: "ev 1", slug: "camp", name: "Sample Camp" };

describe("informationFormPageViews (#1572)", () => {
  it("gives an event form its four pages, in the builder's words, with the event's addresses", () => {
    const views = informationFormPageViews(eventInformationConfig(event), "f/1", "responses");
    expect(views.map((view) => view.label)).toEqual(["Editor", "Preview", "Responses", "Form settings"]);
    expect(views.map((view) => view.href)).toEqual([
      "/information-forms?event=ev%201&form=f%2F1",
      "/information-forms?event=ev%201&form=f%2F1#live-form-preview",
      "/information-forms/responses?event=ev%201&form=f%2F1",
      "/information-forms?event=ev%201&form=f%2F1#builder-settings",
    ]);
    expect(views.filter((view) => view.current).map((view) => view.key)).toEqual(["responses"]);
  });

  it("gives a general form the system administrator addresses", () => {
    const views = informationFormPageViews(generalInformationConfig(), "f1", "editor");
    expect(views.map((view) => view.href)).toEqual([
      "/admin/information-forms/f1",
      "/admin/information-forms/f1#live-form-preview",
      "/admin/information-forms/f1/responses",
      "/admin/information-forms/f1#builder-settings",
    ]);
    expect(views.filter((view) => view.current).map((view) => view.key)).toEqual(["editor"]);
  });

  it("marks nothing current without a key, and shares its hashes with the builder", () => {
    expect(informationFormPageViews(generalInformationConfig(), "f1").some((view) => view.current)).toBe(false);
    expect(BUILDER_SETTINGS_HASH).toBe("#builder-settings");
    expect(LIVE_PREVIEW_HASH).toBe("#live-form-preview");
    expect(read("components/registration-builder/builder-editor-shell.tsx")).toContain("href={BUILDER_SETTINGS_HASH}");
  });
});

describe("hashAction (#1572)", () => {
  const base = { hasFocusTarget: false, formOpen: true };
  it("opens Form settings or the preview for their hashes", () => {
    expect(hashAction({ ...base, hash: "#builder-settings" })).toBe("settings");
    expect(hashAction({ ...base, hash: "#live-form-preview" })).toBe("preview");
  });
  it("does nothing with no hash, another hash, no open form, or a setup warning's question", () => {
    expect(hashAction({ ...base, hash: "" })).toBeNull();
    expect(hashAction({ ...base, hash: "#builder-notifications" })).toBeNull();
    expect(hashAction({ hash: "#builder-settings", hasFocusTarget: false, formOpen: false })).toBeNull();
    expect(hashAction({ hash: "#builder-settings", hasFocusTarget: true, formOpen: true })).toBeNull();
    // At phone width the preview hash does nothing (focus would land off screen); Form settings still opens.
    expect(hashAction({ ...base, hash: "#live-form-preview", phone: true })).toBeNull();
    expect(hashAction({ ...base, hash: "#builder-settings", phone: true })).toBe("settings");
  });
});

describe("the responses view and pages (#1572)", () => {
  const views = informationFormPageViews(eventInformationConfig(event), "f1", "responses");
  const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(InformationFormResponsesView, {
    views, formName: "Camp survey", total: 1, rows: [], selected: null, exportHref: "/x", membersExportHref: "/x?format=members", rowHref: (id: string) => `/r?${id}`, closeHref: "/r", nextHref: null, ...props,
  } as never));

  it("draws the titled header, the Form pages strip and both downloads", () => {
    const html = render();
    expect(html).toContain("<h1");
    expect(html).toContain("Form responses");
    expect(html).toContain('aria-label="Form pages"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Download CSV");
    expect(html).toContain("Download members CSV");
  });

  it("draws one back link only when it is given one", () => {
    expect(render({ back: { href: "/information-forms?event=e", label: "Back to information forms" } })).toContain("Back to information forms");
    expect(render()).not.toContain("Back to");
  });

  it("wires the pages: the event page gives a back link and strip, the admin page leaves the back link to its section header", () => {
    const event = read("app/(workspace)/information-forms/responses/page.tsx");
    expect(event).toContain('informationFormPageViews(config, formId, "responses")');
    expect(event).toContain('label: "Back to information forms"');
    expect(event).toContain("<PageHeader title={staffPageTitles.formResponses} />");
    const admin = read("app/(workspace)/admin/information-forms/[formId]/responses/page.tsx");
    expect(admin).toContain('informationFormPageViews(generalInformationConfig(), formId, "responses")');
    expect(admin).toContain("AdminSectionHeaderFor");
    expect(admin).not.toContain("back={");
  });

  it("draws the list title on both list pages, and on every state of the event page", () => {
    const list = read("app/(workspace)/information-forms/page.tsx");
    expect((list.match(/<PageHeader title="Information forms" \/>/g) ?? []).length).toBe(2);
    expect(list).toContain("<ListPage");
    const admin = read("app/(workspace)/admin/information-forms/page.tsx");
    expect(admin).toContain("<ListPage");
    expect(admin).toContain("AdminSectionHeaderFor");
  });
});

describe("the Registrations link (#1572)", () => {
  const shell = read("components/registration-builder/builder-editor-shell.tsx");
  it("shows only with the prop, and goes to the event's people", () => {
    expect(shell).toContain("canViewRegistrations && !information && <Link href={`/people?event=${encodeURIComponent(eventId)}`}>Registrations</Link>");
    expect(read("components/registration-builder/use-builder-model.ts")).toContain("canViewRegistrations = false");
    expect(read("app/(workspace)/registration-builder/page.tsx")).toContain('canViewRegistrations={permissions.includes("VIEW_SENSITIVE_DATA")}');
  });
});

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { eventTemplateRowModel, templateVersionChip } from "@/components/event-template-list-model";
import { TemplateLibrariesGuide, templateLibraries } from "@/components/template-libraries-guide";
import type { EventTemplateRecord } from "@/modules/event-templates/repository";

// #1593: the three library pages tell the libraries apart, link to the other two, and say what a copy does. Synthetic data only.
const read = (path: string) => readFileSync(path, "utf8");

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1", versionNumber: 1, status: "DRAFT", payload: {}, payloadIssues: [], publishedAt: null,
    createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z", createdBy: "Synthetic Author", source: null,
    ...overrides,
  };
}

function record(overrides: Partial<EventTemplateRecord> = {}): EventTemplateRecord {
  return {
    id: "t1", name: "Synthetic Retreat", description: "", audience: "GENERAL", status: "PUBLISHED", canApply: true,
    createdBy: "Synthetic Author", createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z", versions: [],
    ...overrides,
  } as EventTemplateRecord;
}

describe("the three template libraries guide (#1593)", () => {
  for (const current of ["event", "form", "question"] as const) {
    it(`on the ${current} page links to the other two libraries and not to itself`, () => {
      const markup = renderToStaticMarkup(createElement(TemplateLibrariesGuide, { current }));
      const own = templateLibraries.find((library) => library.key === current)!;
      expect(markup).not.toContain(`href="${own.href}"`);
      for (const other of templateLibraries.filter((library) => library.key !== current)) expect(markup).toContain(`href="${other.href}"`);
      expect(markup).toContain("(this page)");
      expect((markup.match(/aria-current="page"/g) ?? []).length).toBe(1);
    });
  }

  it("says what a copy does and never implies later edits reach existing forms or events", () => {
    const markup = renderToStaticMarkup(createElement(TemplateLibrariesGuide, { current: "event" }));
    expect(markup).toContain("makes a copy");
    expect(markup).toContain("does not change events or forms already made from it");
    expect(markup).not.toMatch(/updates? (every|all|existing)/i);
  });

  it("is on all three library list pages, each naming itself", () => {
    expect(read("app/(workspace)/admin/event-templates/page.tsx")).toContain('<TemplateLibrariesGuide current="event" />');
    expect(read("app/(workspace)/admin/form-templates/page.tsx")).toContain('<TemplateLibrariesGuide current="form" />');
    expect(read("app/(workspace)/admin/question-library/page.tsx")).toContain('<TemplateLibrariesGuide current="question" />');
  });
});

describe("an event template row (#1593)", () => {
  it("shows a draft with no published version as gold Draft and not offered in Create event", () => {
    const row = eventTemplateRowModel(record({ status: "DRAFT", canApply: false, versions: [version()] as never }));
    expect(row.statusChip).toEqual({ label: "Draft", tone: "gold" });
    expect(row.versionLine).toBe("Version 1 is a draft");
    expect(row.availabilityLine).toContain("until a version is published");
  });

  it("shows a published template with a newer draft, and says new events copy the published version", () => {
    const row = eventTemplateRowModel(record({ versions: [version({ id: "v2", versionNumber: 2 }), version({ id: "v1", status: "PUBLISHED" })] as never }));
    expect(row.statusChip).toEqual({ label: "Published", tone: "green" });
    expect(row.versionLine).toBe("Version 1 published; version 2 is a draft");
    expect(row.availabilityLine).toContain("copy of the published version");
  });

  it("flags a published version that no longer passes validation as coral", () => {
    const row = eventTemplateRowModel(record({ canApply: false, versions: [version({ status: "PUBLISHED", payloadIssues: ["audience: bad"] })] as never }));
    expect(row.statusChip).toEqual({ label: "Needs repair", tone: "coral" });
    expect(row.availabilityLine).toContain("no longer passes validation");
  });

  it("shows an archived template as neutral and not offered", () => {
    const row = eventTemplateRowModel(record({ status: "ARCHIVED", canApply: false, versions: [version({ status: "PUBLISHED" })] as never }));
    expect(row.statusChip).toEqual({ label: "Archived", tone: "neutral" });
    expect(row.availabilityLine).toContain("while archived");
  });

  it("names the event a version was saved from, including one that was deleted, else who created the template", () => {
    const source = { sourceEventId: "e1", sourceEventName: "Synthetic Weekend", releaseNote: "n", savedBy: "A", savedAt: "2027-01-01T00:00:00.000Z", provenance: {} };
    expect(eventTemplateRowModel(record({ versions: [version({ versionNumber: 3, source })] as never })).provenanceLine).toBe("Version 3 saved from Synthetic Weekend");
    expect(eventTemplateRowModel(record({ versions: [version({ source: { ...source, sourceEventId: null } })] as never })).provenanceLine).toContain("(deleted event)");
    expect(eventTemplateRowModel(record({ versions: [version()] as never })).provenanceLine).toBe("Created by Synthetic Author");
  });

  it("labels club and general audiences in words", () => {
    expect(eventTemplateRowModel(record({ audience: "CLUB" })).audienceLabel).toBe("Club events");
    expect(eventTemplateRowModel(record()).audienceLabel).toBe("General events");
  });

  it("keeps older published versions as history", () => {
    expect(templateVersionChip("DRAFT").tone).toBe("gold");
    expect(templateVersionChip("PUBLISHED").tone).toBe("green");
    expect(templateVersionChip("ARCHIVED")).toEqual({ label: "Earlier version", tone: "neutral" });
  });
});

describe("the six library pages (#1593)", () => {
  const pages = [
    "app/(workspace)/admin/event-templates/page.tsx",
    "app/(workspace)/admin/event-templates/[templateId]/page.tsx",
    "app/(workspace)/admin/event-templates/from-event/page.tsx",
    "app/(workspace)/admin/form-templates/page.tsx",
    "app/(workspace)/admin/form-templates/[templateKey]/page.tsx",
    "app/(workspace)/admin/question-library/page.tsx",
  ];

  it("draw no heading of their own, because the shell holds the one h1 (D1)", () => {
    for (const page of pages) {
      const source = read(page);
      expect(source, page).not.toMatch(/<h[12]\b/);
      expect(source, page).toContain("StaffPageHeader");
    }
  });

  it("keep every page for system administrators only", () => {
    for (const page of pages) expect(read(page), page).toContain('globalRole !== "SYSTEM_ADMIN"');
  });

  it("protect unsaved edits in the event template editor", () => {
    expect(read("components/event-template-editor.tsx")).toContain("useUnsavedChangesGuard(hasUnsavedEdits && !isArchived)");
  });

  it("show the form builder's library links only to people who can open them", () => {
    const source = read("components/registration-builder/builder-template-panels.tsx");
    expect(source).toMatch(/if \(!canSaveAsTemplate\) return null;/);
    expect(source).toContain('href="/admin/form-templates"');
    expect(source).toContain('href="/admin/question-library"');
  });
});

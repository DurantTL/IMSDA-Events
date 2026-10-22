import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { FormTemplateCopy } from "@/components/form-template-copy";
import { FormTemplateEditor } from "@/components/form-template-editor";
import { bundledSeededFormTemplates } from "@/modules/forms/seeded-template-data";
import { moduleOwnedFields } from "@/modules/forms/template-module-fields";

/** The form template editor reuses the registration builder's pieces on a template with no event (#1064). Synthetic data only. */

const retreat = bundledSeededFormTemplates.find((seed) => seed.key === "womens_retreat_export")!;

describe("the form template editor", () => {
  const markup = renderToStaticMarkup(createElement(FormTemplateEditor, {
    templateKey: retreat.key,
    name: retreat.name,
    description: retreat.description,
    audience: retreat.audience,
    version: 4,
    source: "APP",
    appCreated: false,
    definition: retreat.definition,
    repairingUnreadable: false,
    usedByForms: 3,
    versions: [
      { version: 4, source: "APP", createdAt: "2026-10-22T12:00:00.000Z", createdBy: "Synthetic Admin" },
      { version: 3, source: "CODE", createdAt: "2026-10-01T12:00:00.000Z", createdBy: null },
    ],
  }));

  it("shows the version chip, where the version came from, and how many forms use the template", () => {
    expect(markup).toContain("Version 4");
    expect(markup).toContain("Edited in the app");
    expect(markup).toContain("Used by 3 forms");
    expect(markup).toContain("code updates no longer apply");
  });

  it("opens the shared builder's sections and fields, without publish, test or event controls", () => {
    expect(markup).toContain("Add another section");
    expect(markup).toContain(retreat.definition.sections[0]!.title);
    expect(markup).toContain("Save new version");
    expect(markup).not.toContain("Publish version");
    expect(markup).not.toContain("Run test submission");
  });

  it("says a template version holds the form definition only, and lists the earlier versions", () => {
    expect(markup).toContain("does not include meal plans, lodging inventory, cancellation policies, messages, people, answers or registrations");
    expect(markup).toContain("Synthetic Admin");
    expect(markup).toContain("2026-10-01 12:00 UTC");
  });

  it("names the module-owned fields that keep fixed keys", () => {
    const owned = moduleOwnedFields(retreat.definition);
    for (const field of owned) expect(markup).toContain(`key <code>${field.fieldKey}</code>`);
    if (owned.length > 0) expect(markup).toContain("keep fixed keys");
  });

  it("renders the copy form", () => {
    const copy = renderToStaticMarkup(createElement(FormTemplateCopy, { templates: [{ key: "simple_rsvp", name: "Simple RSVP" }] }));
    expect(copy).toContain("Create template");
    expect(copy).toContain("Simple RSVP");
  });
});

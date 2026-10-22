import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegistrationBuilderWorkspace } from "@/components/registration-builder-workspace";
import { formTemplates, type RegistrationFormDefinition } from "@/modules/forms/definition";
import type { BuilderWorkspaceProps, TemplateNoticeView } from "@/components/registration-builder/builder-types";

/** The "template changed" notice and the Save as template control in the builder (#1065). Synthetic data only. */

const notice: TemplateNoticeView = { templateKey: "synthetic_template", templateName: "Synthetic Bible Experience", appliedVersion: 1, latestVersion: 2, latestVersionId: "tpl-version-2" };

function render(options: { templateNotice?: TemplateNoticeView | null; canSaveAsTemplate?: boolean } = {}) {
  const definition = structuredClone(formTemplates[0].definition) as RegistrationFormDefinition;
  const version = {
    id: "version-1", versionNumber: 1, status: "DRAFT", definition, publishedAt: null, createdAt: "2028-08-01T00:00:00.000Z",
    updatedAt: "2028-08-01T00:00:00.000Z", createdBy: "Synthetic Staff", testSubmissionCount: 0, choiceUsage: {}, testSubmissions: [],
  };
  const props: BuilderWorkspaceProps = {
    eventId: "event-1", eventSlug: "fall-camporee-2028", eventName: "Fall Camporee 2028", templates: [],
    initialForms: [{
      id: "form-1", eventId: "event-1", name: definition.title, slug: "synthetic-form", status: "DRAFT", createdAt: version.createdAt,
      updatedAt: version.updatedAt, createdBy: "Synthetic Staff", activeVersion: version, versions: [version],
      ...(options.templateNotice !== undefined ? { templateNotice: options.templateNotice } : {}),
    }],
    ...(options.canSaveAsTemplate !== undefined ? { canSaveAsTemplate: options.canSaveAsTemplate } : {}),
  };
  return renderToStaticMarkup(createElement(RegistrationBuilderWorkspace, props));
}

describe("the template changed notice", () => {
  it("names the template, offers Update draft from a template and Dismiss for this version, and explains nothing changes by itself", () => {
    const markup = render({ templateNotice: notice });
    expect(markup).toContain("The Synthetic Bible Experience template has changed since this form was made");
    expect(markup).toContain("version 1");
    expect(markup).toContain("version 2");
    expect(markup).toContain("Dismiss for this version");
    expect(markup).toContain("Nothing on this form has changed, and nothing will change unless you choose to update the draft.");
    expect(markup).toMatch(/data-testid="template-changed-notice"[\s\S]*Update draft from a template/);
  });

  it("puts the status on the text only, not around the action buttons", () => {
    const markup = render({ templateNotice: notice });
    const section = markup.match(/<section[^>]*data-testid="template-changed-notice"[^>]*>/)![0];
    expect(section).not.toContain("role=");
    expect(markup).toMatch(/<p class="field-help" role="status">This form was made/);
  });

  it("shows nothing for a form with no source or a null notice", () => {
    expect(render()).not.toContain("template-changed-notice");
    expect(render({ templateNotice: null })).not.toContain("template-changed-notice");
  });
});

describe("Save as template", () => {
  it("is offered to system administrators", () => {
    expect(render({ canSaveAsTemplate: true })).toContain("Save as template");
  });

  it("is not offered to anyone else", () => {
    expect(render()).not.toContain("Save as template");
    expect(render({ canSaveAsTemplate: false })).not.toContain("Save as template");
  });
});

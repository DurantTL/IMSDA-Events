import "server-only";

import { getPrisma } from "@/lib/prisma";
import { loadAllFormTemplates } from "@/modules/forms/seeded-templates";
import { informationFormDefinitionIssues } from "@/modules/information-forms/definition";
import { informationTemplates } from "@/modules/forms/information-audience";
import type { InformationFormTarget } from "@/modules/information-forms/domain";
import { InformationFormError } from "@/modules/information-forms/errors";
import { getInformationForm, listInformationForms } from "@/modules/information-forms/repository";
import { informationFormToView, type InformationFormApi } from "@/components/registration-builder/information-mode";
import type { FormView } from "@/components/registration-builder/builder-types";
import type { InformationFormListItem, InformationFormTemplateChoice } from "@/components/information-forms-home";

/** What the list page shows for a scope. The caller has already checked who may see it. */
export async function loadInformationFormsHome(target: InformationFormTarget): Promise<{ forms: InformationFormListItem[]; templates: InformationFormTemplateChoice[] }> {
  const [forms, loaded] = await Promise.all([listInformationForms(target), loadAllFormTemplates(getPrisma())]);
  // Only templates the server would accept for an information form: the same refusal check, so a choice never fails on create.
  const templates = informationTemplates(loaded).filter((template) => informationFormDefinitionIssues(template.definition).length === 0);
  return {
    forms: forms.map((form) => ({
      id: form.id, name: form.name, slug: form.slug, status: form.status, fillAccess: form.fillAccess, responseCount: form.responseCount,
      published: form.versions.some((version) => version.status === "PUBLISHED"), updatedAt: form.updatedAt.toISOString(),
    })),
    templates: templates.map((template) => ({ key: template.key, name: template.name, description: template.description })),
  };
}

/** One form as the builder opens it, or null when it is not in this scope (never another scope's form). */
export async function loadInformationFormView(target: InformationFormTarget, formId: string): Promise<FormView | null> {
  try {
    return informationFormToView(await getInformationForm(target, formId) as InformationFormApi);
  } catch (error) {
    if (error instanceof InformationFormError && error.code === "FORM_NOT_FOUND") return null;
    throw error;
  }
}

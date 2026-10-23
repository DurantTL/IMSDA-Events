import "server-only";

import { listFormTemplates } from "@/modules/forms/repository";
import { informationTemplates } from "@/modules/forms/information-audience";
import type { InformationFormTarget } from "@/modules/information-forms/domain";
import { InformationFormError } from "@/modules/information-forms/errors";
import { getInformationForm, listInformationForms } from "@/modules/information-forms/repository";
import { informationFormToView, type InformationFormApi } from "@/components/registration-builder/information-mode";
import type { FormView } from "@/components/registration-builder/builder-types";
import type { InformationFormListItem, InformationFormTemplateChoice } from "@/components/information-forms-home";

/** What the list page shows for a scope. The caller has already checked who may see it. */
export async function loadInformationFormsHome(target: InformationFormTarget): Promise<{ forms: InformationFormListItem[]; templates: InformationFormTemplateChoice[] }> {
  const [forms, templates] = await Promise.all([listInformationForms(target), listFormTemplates()]);
  return {
    forms: forms.map((form) => ({
      id: form.id, name: form.name, slug: form.slug, status: form.status, fillAccess: form.fillAccess, responseCount: form.responseCount,
      published: form.versions.some((version) => version.status === "PUBLISHED"), updatedAt: form.updatedAt.toISOString(),
    })),
    templates: informationTemplates(templates).map((template) => ({ key: template.key, name: template.name, description: template.description })),
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

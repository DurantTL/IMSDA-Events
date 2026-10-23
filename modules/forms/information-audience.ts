/**
 * Form templates for information forms (#1149). `SeededFormTemplate.audience` is free text, so an information template is
 * one whose audience reads "Information"; no migration is needed. Registration pickers leave these out, and the
 * information form builder shows only these.
 */
export const INFORMATION_TEMPLATE_AUDIENCE = "Information";

export function isInformationTemplateAudience(audience: string | null | undefined): boolean {
  return (audience ?? "").trim().toLowerCase() === INFORMATION_TEMPLATE_AUDIENCE.toLowerCase();
}

/** The templates an information form can start from. */
export function informationTemplates<T extends { audience: string }>(templates: readonly T[]): T[] {
  return templates.filter((template) => isInformationTemplateAudience(template.audience));
}

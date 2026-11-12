import { TLT_FORM_TEMPLATE_KEYS } from "@/modules/club-forms/domain";

/** The TLT forms inbox's address filters (#1686). Pure, so the page, the audit row and the tests share one reading. */
export const TLT_FORMS_PAGE_SIZE = 25;

export type TltFormsFilters = { q: string; form: string; clubId: string; personId: string };

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Reads the address. An unknown form key is dropped, so the inbox never asks for a form outside the three. */
export function parseTltFormsFilters(query: Record<string, string | string[] | undefined>): TltFormsFilters {
  const form = first(query.form).trim();
  return {
    q: first(query.q).trim().slice(0, 80),
    form: (TLT_FORM_TEMPLATE_KEYS as readonly string[]).includes(form) ? form : "",
    clubId: first(query.club).trim().slice(0, 64),
    personId: first(query.person).trim().slice(0, 64),
  };
}

/** Which filters are in use, by name only (for the audit row). */
export function tltFormsFilterKeys(filters: TltFormsFilters): string[] {
  return [filters.q && "q", filters.form && "form", filters.clubId && "club", filters.personId && "person"].filter((key): key is string => Boolean(key));
}

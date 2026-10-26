import "server-only";

import type { InformationFormTarget } from "@/modules/information-forms/domain";
import { parseStoredInformationFormDefinition } from "@/modules/information-forms/definition";
import { InformationFormError } from "@/modules/information-forms/errors";
import { getInformationForm } from "@/modules/information-forms/repository";
import { getInformationFormResponse, listInformationFormResponses, memberListFieldKeys } from "@/modules/information-forms/responses";

export const RESPONSES_PAGE_SIZE = 50;

/**
 * Everything the staff responses pages show (#1150), read through the same target-scoped queries as the staff APIs, so
 * a form or response from another scope or event is "not found" (null here). The caller has already authorized staff.
 */
export async function loadInformationFormResponsesPage(target: InformationFormTarget, formId: string, options: { responseId?: string; cursor?: string }) {
  try {
    const form = await getInformationForm(target, formId);
    const page = await listInformationFormResponses(target, formId, { limit: RESPONSES_PAGE_SIZE, ...(options.cursor ? { cursor: options.cursor } : {}) });
    const selected = options.responseId
      ? await getInformationFormResponse(target, formId, options.responseId).catch((error: unknown) => {
        if (error instanceof InformationFormError && error.code === "RESPONSE_NOT_FOUND") return null;
        throw error;
      })
      : null;
    const hasMemberList = form.versions.some((version) => version.status !== "DRAFT" && memberListFieldKeys(parseStoredInformationFormDefinition(version.definition)).length > 0);
    return { name: form.name, hasMemberList, total: page.total, rows: page.responses, nextCursor: page.nextCursor, selected };
  } catch (error) {
    if (error instanceof InformationFormError && error.code === "FORM_NOT_FOUND") return null;
    throw error;
  }
}

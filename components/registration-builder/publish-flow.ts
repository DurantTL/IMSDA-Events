// Save-then-publish for the editor's Publish button (#1137). Kept free of React
// so the order of the two requests and the failure messages can be tested.
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { withExplicitSensitiveFlags } from "@/modules/forms/field-flags";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import type { FormView } from "./builder-types";

export type PublishFlowInput = {
  eventId: string;
  formId: string;
  /** True when the open version has unsaved edits: save them (the same PATCH as Save draft) before publishing. */
  saveFirst: boolean;
  definition: RegistrationFormDefinition;
  expectedUpdatedAt: string;
  fetchImpl?: typeof fetch;
};

export type PublishFlowResult =
  | { ok: true; form: FormView }
  | { ok: false; stage: "save"; message: string; unavailable?: boolean }
  | { ok: false; stage: "publish"; message: string; savedForm: FormView | null; unavailable?: boolean };

export async function runPublishFlow({ eventId, formId, saveFirst, definition, expectedUpdatedAt, fetchImpl = fetch }: PublishFlowInput): Promise<PublishFlowResult> {
  let savedForm: FormView | null = null;
  if (saveFirst) {
    try {
      // A restart answers "unavailable" (#1263): the edits stay in the editor and nothing was published.
      const response = await submitJson(`/api/events/${eventId}/forms/${formId}`, { definition: withExplicitSensitiveFlags(definition), expectedUpdatedAt }, { method: "PATCH", fetchImpl });
      if (response.unavailable) return { ok: false, stage: "save", message: unavailableMessage(response), unavailable: true };
      const result = response.body as { message?: string; form?: unknown };
      if (!response.ok) throw new Error(result.message ?? "Unable to save this draft.");
      savedForm = result.form as FormView;
    } catch (caught) {
      return { ok: false, stage: "save", message: caught instanceof Error ? caught.message : "Unable to save this draft." };
    }
  }
  try {
    const response = await submitJson(`/api/events/${eventId}/forms/${formId}/publish`, undefined, { method: "POST", fetchImpl });
    if (response.unavailable) return { ok: false, stage: "publish", message: unavailableMessage(response), savedForm, unavailable: true };
    const result = response.body as { message?: string; form?: unknown };
    if (!response.ok) throw new Error(result.message ?? "Unable to publish this form.");
    return { ok: true, form: result.form as FormView };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unable to publish this form.";
    return { ok: false, stage: "publish", message, savedForm };
  }
}

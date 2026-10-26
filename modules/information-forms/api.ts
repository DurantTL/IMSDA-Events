import "server-only";

import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import {
  createInformationFormSchema,
  informationFormSettingsSchema,
  publishInformationFormSchema,
  informationFormStatusSchema,
  responseListQuerySchema,
  saveInformationFormDraftSchema,
  type InformationFormTarget,
} from "@/modules/information-forms/domain";
import { InformationFormError } from "@/modules/information-forms/errors";
import {
  createInformationForm,
  getInformationForm,
  listInformationForms,
  publishInformationForm,
  saveInformationFormDraft,
  setInformationFormStatus,
  updateInformationFormSettings,
} from "@/modules/information-forms/repository";
import { buildInformationFormMembersCsv, buildInformationFormResponsesCsv, getInformationFormResponse, listInformationFormResponses } from "@/modules/information-forms/responses";
import { logError } from "@/lib/logger";

/**
 * The staff route handlers for information forms (#1148), shared by the system-admin routes (GENERAL forms) and the
 * event routes (EVENT forms, MANAGE_FORMS). A route supplies only `authorize`, which throws AccessDeniedError for a
 * caller who may not manage forms in that scope and otherwise returns the acting user and the scope's target. Nothing
 * here runs before `authorize` succeeds, and every query is limited to that target.
 */

export type InformationFormAuthorization = { userId: string; target: InformationFormTarget };

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function failure(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_FORM", message: error.issues[0]?.message ?? "The request is not valid.", issues: error.issues }, { status: 400, headers: noStore });
  }
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  if (error instanceof InformationFormError) {
    return Response.json({ error: error.code, message: error.message, ...(error.issues ? { issues: error.issues } : {}) }, { status: error.status, headers: noStore });
  }
  logError("Information form request failed", error);
  return Response.json({ error: "INFORMATION_FORM_REQUEST_FAILED", message: "The information form request could not be completed." }, { status: 500, headers: noStore });
}

async function readJson(request: Request, optional = false) {
  try {
    if (optional && (await request.clone().text()).trim() === "") return undefined;
    return await request.json();
  } catch {
    throw new InformationFormError("INVALID_REQUEST", "The request body must be valid JSON.");
  }
}

export function informationFormHandlers<P>(authorize: (params: P) => Promise<InformationFormAuthorization>) {
  type FormParams = P & { formId: string };
  type ResponseParams = FormParams & { responseId: string };

  async function read(params: P, work: (access: InformationFormAuthorization) => Promise<Response>) {
    try {
      return await work(await authorize(params));
    } catch (error) {
      return failure(error);
    }
  }

  async function write(request: Request, params: P, work: (access: InformationFormAuthorization, body: unknown) => Promise<Response>, optionalBody = false) {
    const originError = rejectCrossOriginRequest(request);
    if (originError) return originError;
    try {
      const access = await authorize(params);
      return await work(access, await readJson(request, optionalBody));
    } catch (error) {
      return failure(error);
    }
  }

  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

  return {
    list: (request: Request, params: P) => read(params, async ({ target }) => json({ forms: await listInformationForms(target) })),
    create: (request: Request, params: P) => write(request, params, async ({ userId, target }, body) => {
      const input = createInformationFormSchema.parse(body);
      return json({ form: await createInformationForm(target, userId, input) }, 201);
    }),
    get: (request: Request, params: FormParams) => read(params, async ({ target }) => json({ form: await getInformationForm(target, params.formId) })),
    saveDraft: (request: Request, params: FormParams) => write(request, params, async ({ userId, target }, body) => {
      const input = saveInformationFormDraftSchema.parse(body);
      return json({ form: await saveInformationFormDraft(target, params.formId, userId, input) });
    }),
    publish: (request: Request, params: FormParams) => write(request, params, async ({ userId, target }, body) => {
      const input = publishInformationFormSchema.parse(body ?? {});
      return json({ form: await publishInformationForm(target, params.formId, userId, input.expectedUpdatedAt) });
    }, true),
    setStatus: (request: Request, params: FormParams) => write(request, params, async ({ userId, target }, body) => {
      const input = informationFormStatusSchema.parse(body);
      return json({ form: await setInformationFormStatus(target, params.formId, userId, input.status) });
    }),
    updateSettings: (request: Request, params: FormParams) => write(request, params, async ({ userId, target }, body) => {
      const input = informationFormSettingsSchema.parse(body);
      return json({ form: await updateInformationFormSettings(target, params.formId, userId, input) });
    }),
    listResponses: (request: Request, params: FormParams) => read(params, async ({ target }) => {
      const query = responseListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      return json(await listInformationFormResponses(target, params.formId, query));
    }),
    getResponse: (request: Request, params: ResponseParams) => read(params, async ({ target }) => json({ response: await getInformationFormResponse(target, params.formId, params.responseId) })),
    exportResponses: (request: Request, params: FormParams) => read(params, async ({ userId, target }) => {
      // `?format=members` is one row per member of a form's member list (#1222); otherwise one row per response.
      const members = new URL(request.url).searchParams.get("format") === "members";
      const file = members ? await buildInformationFormMembersCsv(target, params.formId, userId) : await buildInformationFormResponsesCsv(target, params.formId, userId);
      return new Response(file.csv, { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        ...noStore,
      } });
    }),
  };
}

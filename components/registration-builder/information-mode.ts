// The builder's information mode (#1149): the same editor, opened on an information form (a survey, interest or
// post-event form that gathers answers only). Everything here is pure, so the rules are testable without a browser:
// the adapter from the information-forms API to the builder's form view, the API addresses, the public and
// responses paths, the refusal check applied to the palette, and the server's refusal shown beside the offending
// section or question. The registration endpoints are never called in this mode.
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import { informationFormDefinitionIssues, parseStoredInformationFormDefinition } from "@/modules/information-forms/definition";
import { sensitiveFieldPattern } from "@/modules/forms/sensitive-fields";
import type { FormVersionView, FormView } from "./builder-types";

export type InformationScope = "GENERAL" | "EVENT";

/** Serializable (it crosses from a server page to the client builder). */
export type InformationBuilderConfig = {
  scope: InformationScope;
  eventId: string | null;
  eventSlug: string | null;
  /** What the form belongs to, shown in the preview: the event's name, or "General forms". */
  ownerLabel: string;
};

export type InformationFillAccess = "ANYONE_WITH_LINK" | "SIGNED_IN";
export type InformationFormStatus = "DRAFT" | "OPEN" | "CLOSED";

/** What the form view carries beyond a registration form's. */
export type InformationFormExtras = {
  status: InformationFormStatus;
  fillAccess: InformationFillAccess;
  opensAt: string | null;
  closesAt: string | null;
  /** Addresses emailed when a response arrives (#1222). */
  submissionNotifyEmails: string[];
};

type DateLike = string | Date;

/** An information form as the API (or the repository, on a server page) returns it. */
export type InformationFormApi = {
  id: string;
  name: string;
  slug: string;
  status: InformationFormStatus;
  fillAccess: InformationFillAccess;
  opensAt: DateLike | null;
  closesAt: DateLike | null;
  submissionNotifyEmails?: string[];
  createdAt: DateLike;
  updatedAt: DateLike;
  versions: Array<{
    id: string;
    versionNumber: number;
    status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
    definition: unknown;
    publishedAt: DateLike | null;
    createdAt: DateLike;
    updatedAt: DateLike;
  }>;
};

export function generalInformationConfig(): InformationBuilderConfig {
  return { scope: "GENERAL", eventId: null, eventSlug: null, ownerLabel: "General forms" };
}

export function eventInformationConfig(event: { id: string; slug: string; name: string }): InformationBuilderConfig {
  return { scope: "EVENT", eventId: event.id, eventSlug: event.slug, ownerLabel: event.name };
}

// ---------------------------------------------------------------------------
// Addresses.

export function informationApiBase(config: InformationBuilderConfig) {
  return config.scope === "EVENT" ? `/api/events/${encodeURIComponent(config.eventId ?? "")}/information-forms` : "/api/admin/information-forms";
}

export function informationFormApiPath(config: InformationBuilderConfig, formId: string, suffix = "") {
  return `${informationApiBase(config)}/${encodeURIComponent(formId)}${suffix}`;
}

/** The public link: /forms/[slug] for a general form, /events/[eventSlug]/forms/[slug] for an event's. The page itself is built separately. */
export function informationPublicPath(config: InformationBuilderConfig, slug: string) {
  return config.scope === "EVENT" ? `/events/${config.eventSlug ?? ""}/forms/${slug}` : `/forms/${slug}`;
}

export function informationListHref(config: InformationBuilderConfig) {
  return config.scope === "EVENT" ? `/information-forms?event=${encodeURIComponent(config.eventId ?? "")}` : "/admin/information-forms";
}

export function informationBuilderHref(config: InformationBuilderConfig, formId: string) {
  return config.scope === "EVENT"
    ? `/information-forms?event=${encodeURIComponent(config.eventId ?? "")}&form=${encodeURIComponent(formId)}`
    : `/admin/information-forms/${encodeURIComponent(formId)}`;
}

/** The responses page, a sibling of the builder's page (built separately). */
export function informationResponsesHref(config: InformationBuilderConfig, formId: string) {
  return config.scope === "EVENT"
    ? `/information-forms/responses?event=${encodeURIComponent(config.eventId ?? "")}&form=${encodeURIComponent(formId)}`
    : `/admin/information-forms/${encodeURIComponent(formId)}/responses`;
}

// ---------------------------------------------------------------------------
// The adapter: information-forms API -> the builder's form view.

function iso(value: DateLike): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isoOrNull(value: DateLike | null): string | null {
  return value === null ? null : iso(value);
}

/** The builder's version status words: a superseded version is the registration builder's "ARCHIVED". */
function versionStatus(status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"): string {
  return status === "SUPERSEDED" ? "ARCHIVED" : status;
}

export function informationFormToView(form: InformationFormApi): FormView {
  const versions: FormVersionView[] = [...form.versions]
    .sort((a, b) => b.versionNumber - a.versionNumber)
    .map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      status: versionStatus(version.status),
      definition: parseStoredInformationFormDefinition(version.definition),
      publishedAt: isoOrNull(version.publishedAt),
      createdAt: iso(version.createdAt),
      updatedAt: iso(version.updatedAt),
      createdBy: "",
      testSubmissionCount: 0,
      choiceUsage: {},
      testSubmissions: [],
    }));
  // The same choice as the registration builder: the draft, else the live version, else the newest.
  const activeVersion = versions.find((version) => version.status === "DRAFT") ?? versions.find((version) => version.status === "PUBLISHED") ?? versions[0];
  if (!activeVersion) throw new Error("This information form has no version to open.");
  return {
    id: form.id,
    // Empty on purpose: the builder's registration lookups (answer counts) key on an event id, and an information form has none of those answers.
    eventId: "",
    name: form.name,
    slug: form.slug,
    status: form.status,
    createdAt: iso(form.createdAt),
    updatedAt: iso(form.updatedAt),
    createdBy: "",
    activeVersion,
    versions,
    information: { status: form.status, fillAccess: form.fillAccess, opensAt: isoOrNull(form.opensAt), closesAt: isoOrNull(form.closesAt), submissionNotifyEmails: form.submissionNotifyEmails ?? [] },
  };
}

/**
 * After a settings or status change: take only the form-level fields. The versions (and so the draft's updatedAt, the
 * stale-save token) stay as the editor has them, so a settings save never makes the next draft save look stale.
 */
export function mergeSettingsForm(current: FormView, fresh: FormView): FormView {
  return { ...current, name: fresh.name, status: fresh.status, updatedAt: fresh.updatedAt, information: fresh.information };
}

// ---------------------------------------------------------------------------
// Open and close times, edited in the browser's own time zone.

function two(value: number) {
  return String(value).padStart(2, "0");
}

/** An ISO time as the value of a `datetime-local` input (the browser's time zone); empty for none or an unreadable time. */
export function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The ISO time a `datetime-local` value means in the browser's time zone; null for empty. Undefined when it cannot be read. */
export function localInputToIso(value: string): string | null | undefined {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// ---------------------------------------------------------------------------
// The refusal check, applied to the palette and the field types.

function probeDefinition(fields: RegistrationFormField[]): RegistrationFormDefinition {
  return { title: "Probe", description: "", confirmationMessage: "", sections: [{ id: "probe_section", title: "Questions", description: "", fields }] } as RegistrationFormDefinition;
}

/** Whether these fields would pass the information-form refusal check: the server's own function, so there is no second list. */
export function informationFieldsAllowed(fields: RegistrationFormField[]): boolean {
  return informationFormDefinitionIssues(probeDefinition(fields)).length === 0;
}

/** Whether a question type can be used in an information form (an automatic fee cannot). */
export function informationFieldTypeAllowed(type: RegistrationFormField["type"]): boolean {
  return informationFieldsAllowed([{ id: "probe_field", key: "probe_field", label: "Question", helpText: "", type, scope: "REGISTRATION", required: false, options: [] }]);
}

// ---------------------------------------------------------------------------
// The server's refusal, shown beside the offending section or question.

export type InformationIssueMap = {
  /** Refusals about the form as a whole (its description, payment, roster). */
  form: string[];
  /** By section id. */
  sections: Record<string, string[]>;
  /** By field id. */
  fields: Record<string, string[]>;
};

export const noInformationIssues: InformationIssueMap = { form: [], sections: {}, fields: {} };

export function hasInformationIssues(issues: InformationIssueMap) {
  return issues.form.length > 0 || Object.keys(issues.sections).length > 0 || Object.keys(issues.fields).length > 0;
}

const SENSITIVE_PATTERN = sensitiveFieldPattern();

/** The whole word the shared sensitive-wording list matched in `text`, or null. */
export function matchedSensitiveWord(text: string): string | null {
  const match = SENSITIVE_PATTERN.exec(text.replaceAll("_", " "));
  if (!match) return null;
  const word = /^[A-Za-z0-9'’-]+/.exec(text.replaceAll("_", " ").slice(match.index));
  return word?.[0] ?? match[0];
}

function firstWordIn(parts: Array<{ where: string; text: string }>): string {
  for (const part of parts) {
    const word = matchedSensitiveWord(part.text);
    if (word) return ` The word "${word}" appears in its ${part.where}. Reword it, or remove it.`;
  }
  return "";
}

function wordNote(message: string, parts: Array<{ where: string; text: string }>) {
  return message.includes("sensitive") ? firstWordIn(parts) : "";
}

function add(target: Record<string, string[]>, key: string, message: string) {
  const list = target[key] ?? (target[key] = []);
  if (!list.includes(message)) list.push(message);
}

/**
 * Turns the server's refusal into messages by location. The server answers `issues` with a path into the definition
 * (`["sections", 0, "fields", 2]`), so each message lands on that section or question; one without a usable path
 * stays with the form. `definition` is the one that was sent, so the path means the same sections now.
 */
export function informationIssuesFromResponse(result: unknown, definition: RegistrationFormDefinition): InformationIssueMap {
  const issues: InformationIssueMap = { form: [], sections: {}, fields: {} };
  const body = (result ?? {}) as { message?: unknown; issues?: unknown };
  const list = Array.isArray(body.issues) ? body.issues : [];
  for (const raw of list) {
    const issue = raw as { path?: unknown; message?: unknown; key?: unknown };
    if (typeof issue.message !== "string") continue;
    const path = Array.isArray(issue.path) ? issue.path : [];
    const sectionIndex = path[0] === "sections" && typeof path[1] === "number" ? path[1] : null;
    const section = sectionIndex === null ? null : definition.sections[sectionIndex] ?? null;
    if (section && path[2] === "fields" && typeof path[3] === "number") {
      const field = section.fields[path[3]];
      if (field) {
        add(issues.fields, field.id, issue.message + wordNote(issue.message, [
          { where: "label", text: field.label }, { where: "help text", text: field.helpText ?? "" }, { where: "placeholder", text: field.placeholder ?? "" },
          { where: "choices", text: field.options.join(" ") }, { where: "choice descriptions", text: Object.values(field.optionDescriptions ?? {}).join(" ") }, { where: "key", text: field.key },
        ]));
        continue;
      }
    }
    if (section) {
      add(issues.sections, section.id, issue.message + wordNote(issue.message, [
        { where: "title", text: section.title }, { where: "description", text: section.description }, { where: "progress label", text: section.stepLabel ?? "" },
      ]));
      continue;
    }
    const formMessage = issue.message + (path[0] === "description" ? wordNote(issue.message, [{ where: "description", text: definition.description }]) : "");
    if (!issues.form.includes(formMessage)) issues.form.push(formMessage);
  }
  // The message of a refusal that named no location is still shown, once, with the form.
  if (!hasInformationIssues(issues) && typeof body.message === "string" && body.message) issues.form.push(body.message);
  return issues;
}

// ---------------------------------------------------------------------------
// API calls (pure over `fetchImpl`, so the order of requests and the messages are testable).

export type InformationCallResult<T> = { ok: true; value: T } | { ok: false; message: string; body: unknown };

async function call(fetchImpl: typeof fetch, url: string, method: string, body?: unknown): Promise<InformationCallResult<InformationFormApi>> {
  try {
    const response = await fetchImpl(url, {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const result = await response.json().catch(() => ({})) as { form?: InformationFormApi; message?: unknown };
    if (!response.ok || !result.form) return { ok: false, message: typeof result.message === "string" && result.message ? result.message : "The request could not be completed.", body: result };
    return { ok: true, value: result.form };
  } catch (caught) {
    return { ok: false, message: caught instanceof Error ? caught.message : "The request could not be completed.", body: {} };
  }
}

export function saveInformationDraftRequest(config: InformationBuilderConfig, formId: string, definition: RegistrationFormDefinition, expectedUpdatedAt: string, fetchImpl: typeof fetch = fetch) {
  // The registration builder marks health-type questions sensitive on save; an information form refuses those, so it saves the definition as written.
  return call(fetchImpl, informationFormApiPath(config, formId), "PATCH", { definition, expectedUpdatedAt });
}

export function publishInformationDraftRequest(config: InformationBuilderConfig, formId: string, expectedUpdatedAt: string, fetchImpl: typeof fetch = fetch) {
  // The server refuses the publish when the draft changed since the editor last saw it.
  return call(fetchImpl, informationFormApiPath(config, formId, "/publish"), "POST", { expectedUpdatedAt });
}

export function saveInformationSettingsRequest(config: InformationBuilderConfig, formId: string, settings: { fillAccess?: InformationFillAccess; opensAt?: string | null; closesAt?: string | null; submissionNotifyEmails?: string[] }, fetchImpl: typeof fetch = fetch) {
  return call(fetchImpl, informationFormApiPath(config, formId, "/settings"), "PATCH", settings);
}

export function setInformationStatusRequest(config: InformationBuilderConfig, formId: string, status: "OPEN" | "CLOSED", fetchImpl: typeof fetch = fetch) {
  return call(fetchImpl, informationFormApiPath(config, formId, "/status"), "POST", { status });
}

export type InformationPublishResult =
  | { ok: true; form: FormView }
  | { ok: false; stage: "save"; message: string; body: unknown }
  | { ok: false; stage: "publish"; message: string; body: unknown; savedForm: FormView | null };

/** Save (when there are unsaved edits) and then publish: Publish is one click, and a refused save publishes nothing. */
export async function runInformationPublishFlow({ config, formId, saveFirst, definition, expectedUpdatedAt, fetchImpl = fetch }: {
  config: InformationBuilderConfig;
  formId: string;
  saveFirst: boolean;
  definition: RegistrationFormDefinition;
  expectedUpdatedAt: string;
  fetchImpl?: typeof fetch;
}): Promise<InformationPublishResult> {
  let savedForm: FormView | null = null;
  if (saveFirst) {
    const saved = await saveInformationDraftRequest(config, formId, definition, expectedUpdatedAt, fetchImpl);
    if (!saved.ok) return { ok: false, stage: "save", message: saved.message, body: saved.body };
    savedForm = informationFormToView(saved.value);
  }
  const published = await publishInformationDraftRequest(config, formId, savedForm ? savedForm.activeVersion.updatedAt : expectedUpdatedAt, fetchImpl);
  if (!published.ok) return { ok: false, stage: "publish", message: published.message, body: published.body, savedForm };
  return { ok: true, form: informationFormToView(published.value) };
}

import { isSensitiveField } from "@/modules/forms/sensitive-fields";
import { isFieldVisible, type RegistrationFormDefinition } from "@/modules/forms/definition";
import {
  draftExcludedKeys,
  getBrowserDraftStorage,
  isPlainValue,
  PUBLIC_DRAFT_TTL_MS,
  type DraftStorage,
} from "@/modules/forms/public-draft";

/**
 * Browser-only drafts for the flat-answer forms: club forms (#610) and information forms (#1150) (#1263).
 *
 * Same promise as `public-draft.ts`: answers live only in this browser's localStorage, are written only
 * after the person edits the form, are cleared on a successful submit, expire after 14 days, and every
 * storage call is wrapped. What is never written follows the public rule (`isDraftExcludedField`:
 * long text, address, consent, payment, birth-date and anything that reads as medical, health,
 * insurance, care, custody or notes, plus conditional follow-ups to those), and also:
 *  - every field the form marks sensitive (`sensitive`, or the template's sealed `sensitiveFieldKeys`)
 *    or whose key, label, help or choices read as sensitive;
 *  - member lists (rows hold other people's details) and any non-plain value;
 *  - idempotency keys (they live only in the page session).
 * A restored draft is cut down by the same rules again, so a tampered one cannot inject a key.
 */

export const ANSWER_DRAFT_RESTORED_NOTICE = "We restored your answers from earlier.";
export const ANSWER_DRAFT_VERSION_CHANGED_NOTICE = "The form changed since you started. Please re-enter your answers.";

const KEY_PREFIX = "imsda-events:answers-draft:v1";
const FORMAT = 1;
const MAX_EXTRA_LENGTH = 200;

export type AnswerDraftIdentity = { scope: string; formId: string };
export type AnswerDraftContent = { answers: Record<string, unknown>; extras: Record<string, string> };
export type AnswerDraftLoad =
  | { status: "none" }
  | { status: "restored"; draft: AnswerDraftContent }
  | { status: "version-changed" };

/** Quick, non-secret fingerprint (djb2) so an identity can carry a token without storing it. */
export function shortHash(text: string) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

/** Changes whenever a field is added, removed, retyped or moved, so an old draft is not poured into a new form. */
export function answerDraftFingerprint(definition: RegistrationFormDefinition) {
  return shortHash(definition.sections.flatMap((section) => section.fields.map((field) => `${field.key}:${field.type}`)).join("|"));
}

export function answerDraftKey(identity: AnswerDraftIdentity) {
  return `${KEY_PREFIX}:${encodeURIComponent(identity.scope)}:${encodeURIComponent(identity.formId)}`;
}

/** Keys of every field that must not be written to a draft. */
export function answerDraftExcludedKeys(definition: RegistrationFormDefinition, sealedKeys: Iterable<string> = []) {
  const excluded = new Set<string>(draftExcludedKeys(definition));
  for (const key of sealedKeys) excluded.add(key);
  for (const field of definition.sections.flatMap((section) => section.fields)) {
    if (field.sensitive || field.type === "MEMBER_LIST" || isSensitiveField(field)) excluded.add(field.key);
  }
  return excluded;
}

/** Keeps only answers to saveable fields, with plain values, whose question is visible. */
export function sanitizeAnswerDraft(
  definition: RegistrationFormDefinition,
  answers: unknown,
  sealedKeys: Iterable<string> = [],
): Record<string, unknown> {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  const excluded = answerDraftExcludedKeys(definition, sealedKeys);
  const fields = new Map(definition.sections.flatMap((section) => section.fields).map((field) => [field.key, field] as const));
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (fields.has(key) && !excluded.has(key) && isPlainValue(value)) picked[key] = value;
  }
  for (let pass = 0; pass < fields.size; pass += 1) {
    let removed = false;
    for (const key of Object.keys(picked)) {
      const field = fields.get(key)!;
      if (!isFieldVisible(field, picked)) {
        delete picked[key];
        removed = true;
      }
    }
    if (!removed) break;
  }
  return picked;
}

function cleanExtras(extras: unknown) {
  const clean: Record<string, string> = {};
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return clean;
  for (const [key, value] of Object.entries(extras)) {
    if (typeof value === "string" && value.length <= MAX_EXTRA_LENGTH) clean[key] = value;
  }
  return clean;
}

function hasContent(content: AnswerDraftContent) {
  const filled = (value: unknown) => (typeof value === "boolean" ? value : Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : Boolean(value));
  return Object.values(content.answers).some(filled) || Object.values(content.extras).some(filled);
}

export { getBrowserDraftStorage };

export function clearAnswerDraft(storage: DraftStorage | null, identity: AnswerDraftIdentity) {
  if (!storage) return;
  try {
    storage.removeItem(answerDraftKey(identity));
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

export function saveAnswerDraft(
  storage: DraftStorage | null,
  identity: AnswerDraftIdentity,
  definition: RegistrationFormDefinition,
  content: { answers: Record<string, unknown>; extras?: Record<string, string> },
  options: { sealedKeys?: Iterable<string>; now?: Date } = {},
) {
  if (!storage) return;
  try {
    const safe: AnswerDraftContent = {
      answers: sanitizeAnswerDraft(definition, content.answers, options.sealedKeys),
      extras: cleanExtras(content.extras),
    };
    if (!hasContent(safe)) {
      storage.removeItem(answerDraftKey(identity));
      return;
    }
    storage.setItem(answerDraftKey(identity), JSON.stringify({
      format: FORMAT,
      fingerprint: answerDraftFingerprint(definition),
      savedAt: (options.now ?? new Date()).getTime(),
      ...safe,
    }));
  } catch {
    // Storage blocked or full: the form works without a draft.
  }
}

export function loadAnswerDraft(
  storage: DraftStorage | null,
  identity: AnswerDraftIdentity,
  definition: RegistrationFormDefinition,
  options: { sealedKeys?: Iterable<string>; now?: Date } = {},
): AnswerDraftLoad {
  if (!storage) return { status: "none" };
  const now = (options.now ?? new Date()).getTime();
  try {
    const key = answerDraftKey(identity);
    const raw = storage.getItem(key);
    if (!raw) return { status: "none" };
    let parsed: { format?: unknown; fingerprint?: unknown; savedAt?: unknown; answers?: unknown; extras?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const fresh = parsed && typeof parsed === "object" && parsed.format === FORMAT
      && typeof parsed.savedAt === "number" && parsed.savedAt <= now + 60_000 && now - parsed.savedAt < PUBLIC_DRAFT_TTL_MS;
    if (!parsed || !fresh) {
      storage.removeItem(key);
      return { status: "none" };
    }
    if (parsed.fingerprint !== answerDraftFingerprint(definition)) {
      storage.removeItem(key);
      return { status: "version-changed" };
    }
    const draft = { answers: sanitizeAnswerDraft(definition, parsed.answers, options.sealedKeys), extras: cleanExtras(parsed.extras) };
    if (!hasContent(draft)) {
      storage.removeItem(key);
      return { status: "none" };
    }
    return { status: "restored", draft };
  } catch {
    return { status: "none" };
  }
}

import { createHash } from "node:crypto";
import {
  isFieldVisible,
  type RegistrationFormDefinition,
  type RegistrationFormField,
} from "@/modules/forms/definition";
import { signatureFields } from "@/modules/signatures/fields";

export { signatureFields } from "@/modules/signatures/fields";

/**
 * Typed-name signature evidence (#1265): the pure rules, free of the database so they are unit-tested on their own.
 *
 * A SIGNATURE field stores the typed name as its answer. At submission one append-only evidence row is written per visible,
 * non-blank signature: the name, the exact statement shown, the moment, the trusted client IP (null when it cannot be
 * resolved) and a hash of the user agent. Only the registrant's own online submission records one.
 */

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** The signer's name as recorded: the typed answer, trimmed. Empty when nothing usable was typed. */
export function signerNameFrom(answer: unknown) {
  return typeof answer === "string" ? answer.trim() : "";
}

export type PlannedSignature = {
  field: RegistrationFormField;
  /** Null for a registration-level signature; otherwise the attendee's client id. */
  attendeeClientId: string | null;
  signerName: string;
};

/**
 * The signatures a validated submission actually gives: a visible field with a typed name. A field hidden by its condition,
 * or an optional one left blank, gives none. Repeating attendee sections give one per attendee, evaluated against the
 * shared registration answers plus that attendee's own.
 */
export function planSignatures(
  definition: RegistrationFormDefinition,
  input: {
    registrationResponses: Record<string, unknown>;
    attendees: ReadonlyArray<{ clientId: string; responses: Record<string, unknown> }>;
  },
): PlannedSignature[] {
  const planned: PlannedSignature[] = [];
  for (const field of signatureFields(definition)) {
    if (field.scope === "REGISTRATION") {
      const signerName = signerNameFrom(input.registrationResponses[field.key]);
      if (signerName && isFieldVisible(field, input.registrationResponses)) planned.push({ field, attendeeClientId: null, signerName });
      continue;
    }
    for (const attendee of input.attendees) {
      const merged = { ...input.registrationResponses, ...attendee.responses };
      const signerName = signerNameFrom(attendee.responses[field.key]);
      if (signerName && isFieldVisible(field, merged)) planned.push({ field, attendeeClientId: attendee.clientId, signerName });
    }
  }
  return planned;
}

/**
 * The key a registration form submission gives each signature it records, stable across a retried submission. It names the
 * registration too, so a client key reused for another registration can never collide with, and so silently drop, its evidence.
 */
export function signatureEvidenceKey(registrationId: string, submissionKey: string, fieldId: string, attendeeClientId: string | null) {
  return `submission:${registrationId}:${submissionKey}:${fieldId}:${attendeeClientId ?? "registration"}`;
}

/**
 * An amendment can neither give nor change a signature: staff cannot sign for someone. Each signature answer is kept exactly
 * as stored (a new attendee gets none), and the keys must not be required while the amendment is checked.
 */
export function holdSignatureAnswers<
  Input extends { responses: Record<string, unknown>; attendees: ReadonlyArray<{ attendeeId?: string | null; responses: Record<string, unknown> }> },
>(
  definition: RegistrationFormDefinition,
  input: Input,
  stored: { registration: Record<string, unknown>; attendee: (attendeeId: string) => Record<string, unknown> | null },
): { input: Input; keys: string[] } {
  const fields = signatureFields(definition);
  if (fields.length === 0) return { input, keys: [] };
  const hold = (answers: Record<string, unknown>, original: Record<string, unknown> | null, scope: "REGISTRATION" | "ATTENDEE") => {
    const next = { ...answers };
    for (const field of fields) {
      if (field.scope !== scope) continue;
      if (original && Object.hasOwn(original, field.key)) next[field.key] = original[field.key];
      else delete next[field.key];
    }
    return next;
  };
  return {
    input: {
      ...input,
      responses: hold(input.responses, stored.registration, "REGISTRATION"),
      attendees: input.attendees.map((attendee) => ({
        ...attendee,
        responses: hold(attendee.responses, attendee.attendeeId ? stored.attendee(attendee.attendeeId) : null, "ATTENDEE"),
      })),
    },
    keys: fields.map((field) => field.key),
  };
}

// ---------------------------------------------------------------------------------------------
// What staff see
// ---------------------------------------------------------------------------------------------

/** Always shown to staff who can see the registration: who signed, which field and when. */
export type SignatureSummary = {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  registrationAttendeeId: string | null;
  signerName: string;
  signedAt: string;
};

/** Shown only with VIEW_SENSITIVE_DATA: the statement that was signed and the IP address it was signed from. */
export type SignatureRecordView = SignatureSummary & {
  signedText: string;
  contentHash: string;
  ipAddress: string | null;
};

export type RegistrationSignatures = { canViewRecord: boolean; signatures: Array<SignatureSummary | SignatureRecordView> };

type SignatureRow = {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  registrationAttendeeId: string | null;
  signerName: string;
  signedAt: Date;
  signedText: string;
  contentHash: string;
  ipAddress: string | null;
};

/** The one place a stored row becomes what staff may read; the signed text and IP leave only when `canViewRecord`. */
export function presentSignatures(rows: readonly SignatureRow[], canViewRecord: boolean): RegistrationSignatures {
  return {
    canViewRecord,
    signatures: rows.map((row) => {
      const summary: SignatureSummary = {
        id: row.id,
        fieldKey: row.fieldKey,
        fieldLabel: row.fieldLabel,
        registrationAttendeeId: row.registrationAttendeeId,
        signerName: row.signerName,
        signedAt: row.signedAt.toISOString(),
      };
      return canViewRecord ? { ...summary, signedText: row.signedText, contentHash: row.contentHash, ipAddress: row.ipAddress } : summary;
    }),
  };
}

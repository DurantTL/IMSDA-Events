import "server-only";

import { isDataEncryptionAvailable, isDataKeyUnavailable, openData, sealData } from "@/lib/secret-box";
import { ClubFormError } from "@/modules/club-forms/errors";

/**
 * The only place a club form's sensitive answers are sealed or opened
 * (#610), the same way `modules/club-rosters/birth-dates.ts` seals birth
 * dates. The key purpose includes the submission's own id, so a sealed value
 * copied to another row cannot be opened there. They use the personal-data key (#1652).
 */
function purposeFor(submissionId: string) {
  return `club-form:sensitive-answers:${submissionId}`;
}

export function sealSensitiveAnswers(submissionId: string, answers: Record<string, unknown>) {
  return sealData(JSON.stringify(answers), purposeFor(submissionId));
}

export function openSensitiveAnswers(submissionId: string, sealed: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(openData(sealed, purposeFor(submissionId)));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** What a person is told when protected answers can't be sealed or opened because the personal-data key is not loaded. */
export const DATA_KEY_LOCKED_MESSAGE = "Protected answers are locked right now, so this can't be saved. Please try again in a few minutes.";

/**
 * Throws unless sensitive answers can be sealed now. A key that is configured but not loaded gets its own error
 * (`DATA_KEY_UNAVAILABLE`, answered 503) apart from a server with no key at all.
 */
export function requireSensitiveSealing(notConfiguredMessage: string) {
  if (isDataEncryptionAvailable()) return;
  if (isDataKeyUnavailable()) throw new ClubFormError("DATA_KEY_UNAVAILABLE", DATA_KEY_LOCKED_MESSAGE);
  throw new ClubFormError("ENCRYPTION_NOT_CONFIGURED", notConfiguredMessage);
}

import "server-only";

import type { Prisma } from "@prisma/client";
import { isSecretEncryptionConfigured } from "@/lib/secret-box";
import {
  fillDefinition,
  sanitizeClubFormAnswers,
  splitAnswers,
  validateClubFormAnswers,
  withAutoDates,
  type ClubFormTemplateRecord,
} from "@/modules/club-forms/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import { sealSensitiveAnswers } from "@/modules/club-forms/sealed-answers";
import { lockClubFormTemplateForWrite } from "@/modules/club-forms/template-lock";
import { assertAnswersSize } from "@/modules/club-forms/submissions";
import { withLiveDirectory } from "@/modules/club-forms/templates";

/**
 * What a no-account filler's submit does to the answers, shared by the private link (`links.ts`) and the public open
 * application (`open-applications.ts`) so the two cannot drift: the same sanitising, server-set dates, validation,
 * staff-only exclusion, and sealing under the template's share lock.
 */

/** Sanitises and validates what a no-account filler sent. Throws VALIDATION_FAILED; returns the clean answers. */
export async function prepareFillerAnswers(template: ClubFormTemplateRecord, rawAnswers: Record<string, unknown>, now: Date) {
  assertAnswersSize(rawAnswers);
  // Fields hidden from new versions (#712) are not offered, so they cannot be written either.
  const definition = await withLiveDirectory(fillDefinition(template));
  // Office-use fields are not the filler's to write, even by hand-crafted request.
  // Signing and application dates are the server's to set (#719): same Chicago day, whatever the client sent.
  const answers = withAutoDates(definition, sanitizeClubFormAnswers(definition, rawAnswers, template.staffOnlyFieldKeys), template.staffOnlyFieldKeys, now);
  const issues = validateClubFormAnswers(definition, answers, { excludeKeys: template.staffOnlyFieldKeys });
  if (issues.length > 0) throw new ClubFormError("VALIDATION_FAILED", issues[0].message, issues);
  return answers;
}

/**
 * Inside the saving transaction: decides which answers are sensitive under a share lock on the template row (so a
 * concurrent re-seal cannot leave this save in plaintext), and seals them.
 */
export async function sealFillerAnswers(
  tx: Prisma.TransactionClient,
  template: ClubFormTemplateRecord,
  submissionId: string,
  answers: Record<string, unknown>,
) {
  const keys = await lockClubFormTemplateForWrite(tx, template);
  const { plain, sensitive } = splitAnswers({ sensitiveFieldKeys: keys.sensitiveFieldKeys }, answers);
  const hasSensitive = Object.keys(sensitive).length > 0;
  if (hasSensitive && !isSecretEncryptionConfigured()) {
    throw new ClubFormError("ENCRYPTION_NOT_CONFIGURED", "This form can't be saved right now. Please try again later.");
  }
  return { plain, sealed: hasSensitive ? sealSensitiveAnswers(submissionId, sensitive) : null, hasSensitive };
}

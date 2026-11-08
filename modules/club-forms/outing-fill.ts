import "server-only";

import {
  allFields,
  fillDefinition,
  sanitizeClubFormAnswers,
  validateClubFormAnswers,
  withAutoDates,
  type ClubFormTemplateRecord,
} from "@/modules/club-forms/domain";
import { ClubFormError } from "@/modules/club-forms/errors";
import { definitionForOutingFill, outingPresetAnswers, withOutingQuestions, type OutingInput } from "@/modules/club-forms/outing-domain";
import { assertAnswersSize } from "@/modules/club-forms/submissions";
import { withLiveDirectory } from "@/modules/club-forms/templates";

/**
 * What a parent's submit does to the answers on an outing's private link (#1672). Like `prepareFillerAnswers`, but the
 * slip's activity, date and ride-with answers are set from the outing and never read from the request, and the club's
 * questions are asked in their own section. The whole slip, with those three answers in place, is validated, so every
 * required section of the conference slip is still required.
 */
export async function prepareOutingAnswers(
  template: ClubFormTemplateRecord,
  outing: OutingInput,
  clubName: string,
  rawAnswers: Record<string, unknown>,
  now: Date,
) {
  assertAnswersSize(rawAnswers);
  const base = await withLiveDirectory(fillDefinition(template));
  const full = withOutingQuestions(base, outing.questions, clubName);
  // The parent's form has no preset fields, so a hand-made request cannot write them.
  const fillable = definitionForOutingFill(base, outing.questions, clubName);
  const sanitized = sanitizeClubFormAnswers(fillable, rawAnswers, template.staffOnlyFieldKeys);
  const dated = withAutoDates(fillable, sanitized, template.staffOnlyFieldKeys, now);
  const offered = new Set(allFields(full).map((field) => field.key));
  const presets = Object.fromEntries(Object.entries(outingPresetAnswers(outing.details)).filter(([key]) => offered.has(key)));
  const answers = { ...dated, ...presets };
  const issues = validateClubFormAnswers(full, answers, { excludeKeys: template.staffOnlyFieldKeys });
  if (issues.length > 0) throw new ClubFormError("VALIDATION_FAILED", issues[0].message, issues);
  return answers;
}

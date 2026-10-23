// The "Show this question when" editor and the Rule summary (#1072): pure rules, so they are testable without a browser.
// Nothing here saves anything. Storage and evaluation live in modules/forms/visibility-rule.ts; this file only decides
// what the editor offers and what the summary says, using the same validation the schema and the server use.
import { isChoiceFieldType, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import {
  BROKEN_RULE_KINDS,
  conditionPhrase,
  fieldVisibilityRule,
  visibilityRulePatch,
  visibilityRuleProblems,
  type RuleCondition,
  type RuleMatch,
  type RuleProblem,
  type VisibilityRule,
} from "@/modules/forms/visibility-rule";

/** The most conditions one question can have. Matches the definition schema. */
export const MAX_RULE_CONDITIONS = 10;

/** The questions a rule on `field` can look at: not itself, and a registration-level question never looks at an attendee answer. */
export function ruleControllerChoices(field: RegistrationFormField, allFields: readonly RegistrationFormField[]): RegistrationFormField[] {
  return allFields.filter((candidate) => candidate.id !== field.id && (field.scope === "ATTENDEE" || candidate.scope === "REGISTRATION"));
}

/** A condition on a question, set up with its first answer so the row is never a blank. */
export function newCondition(controller: RegistrationFormField): RuleCondition {
  return { fieldKey: controller.key, operator: "EQUALS", value: controller.options[0] ?? "" };
}

/** The rule with the editor's first row: used when "Show this question only when..." is switched on. Null when there is nothing to look at. */
export function startRule(field: RegistrationFormField, allFields: readonly RegistrationFormField[]): VisibilityRule | null {
  const controller = ruleControllerChoices(field, allFields)[0];
  return controller ? { match: "ALL", conditions: [newCondition(controller)] } : null;
}

/** The patch that stores a rule edit (one condition stays a single `conditional`, two or more become a group, none clears both). */
export function ruleEditPatch(rule: VisibilityRule | null): Pick<RegistrationFormField, "conditional" | "conditionalGroup"> {
  return visibilityRulePatch(rule);
}

/** A row that still needs its answer (Equals or Includes with nothing to look for). */
export function conditionIncomplete(condition: RuleCondition): boolean {
  return (condition.operator === "EQUALS" || condition.operator === "INCLUDES") && condition.value.trim() === "";
}

/**
 * Adds a row, looking at a question the rule does not use yet when there is one. Null when the rule is full, there is
 * nothing to add, or the last row is not finished (a new row is never added next to an incomplete one, so the rule is never
 * saved in a state the form would refuse). `match` is the group's remembered All/Any: a single condition stores no match,
 * so the editor passes the last one chosen and a rule that goes from one condition back to two keeps it.
 */
export function withAddedCondition(rule: VisibilityRule, field: RegistrationFormField, allFields: readonly RegistrationFormField[], match: RuleMatch = rule.match): VisibilityRule | null {
  if (rule.conditions.length >= MAX_RULE_CONDITIONS) return null;
  const last = rule.conditions.at(-1);
  if (last && conditionIncomplete(last)) return null;
  const choices = ruleControllerChoices(field, allFields);
  const used = new Set(rule.conditions.map((condition) => condition.fieldKey));
  const controller = choices.find((candidate) => !used.has(candidate.key)) ?? choices[0];
  if (!controller) return null;
  return { match, conditions: [...rule.conditions, newCondition(controller)] };
}

/** The rule without row `index`. Removing the last row removes the rule (the question then always shows). */
export function withoutCondition(rule: VisibilityRule, index: number): VisibilityRule | null {
  const conditions = rule.conditions.filter((_, position) => position !== index);
  return conditions.length === 0 ? null : { ...rule, conditions };
}

export function withCondition(rule: VisibilityRule, index: number, condition: RuleCondition): VisibilityRule {
  return { ...rule, conditions: rule.conditions.map((existing, position) => (position === index ? condition : existing)) };
}

export function withMatch(rule: VisibilityRule, match: RuleMatch): VisibilityRule {
  return { ...rule, match };
}

/** Changing the question of a row picks that question's first answer, as the single-condition editor always did. */
export function withControllerChanged(condition: RuleCondition, controller: RegistrationFormField | undefined, fieldKey: string): RuleCondition {
  return { ...condition, fieldKey, value: controller?.options[0] ?? "" };
}

/** Whether a row's Answer is a choice from the controller's own options, rather than typed text. */
export function answerIsChoice(controller: RegistrationFormField | undefined): controller is RegistrationFormField {
  return Boolean(controller && isChoiceFieldType(controller.type) && controller.options.length > 0);
}

/** "Reads as: shown when Traveling by club bus is Yes and Club size is 10." */
export function readsAs(field: RegistrationFormField, allFields: readonly RegistrationFormField[]): string | null {
  const rule = fieldVisibilityRule(field);
  if (!rule || rule.conditions.length === 0) return null;
  const labelOf = (key: string) => allFields.find((candidate) => candidate.key === key)?.label;
  const joiner = rule.match === "ANY" ? "or" : "and";
  return `Reads as: shown when ${rule.conditions.map((condition) => conditionPhrase(condition, labelOf)).join(` ${joiner} `)}.`;
}

/** The problems of one rule, with the checks the schema and server run, plus order and unfinished rows. */
export function ruleProblems(field: RegistrationFormField, allFields: readonly RegistrationFormField[]): RuleProblem[] {
  return visibilityRuleProblems(field, allFields, { strict: true });
}

/** The problems that belong to row `index` (the ones that name its question), for the message under that row. */
export function rowProblems(problems: readonly RuleProblem[], rule: VisibilityRule, index: number): RuleProblem[] {
  void rule;
  return problems.filter((problem) => problem.index === index);
}

/** Problems that name no row (an empty rule, a cycle). */
export function ruleWideProblems(problems: readonly RuleProblem[]): RuleProblem[] {
  return problems.filter((problem) => problem.index === undefined);
}

export type RuleSummaryEntry = {
  fieldId: string;
  label: string;
  sectionIndex: number;
  stepTitle: string;
  match: RuleMatch;
  /** One plain-language line per condition, in order. */
  phrases: string[];
  /** True when the rule cannot work as written: it names a removed question, itself, the wrong scope or a loop. */
  needsFix: boolean;
  /** What is wrong, in words, for a rule that needs a fix. Removed questions are named by their key, since the label is gone. */
  fixMessage: string | null;
  /** Smaller things to tidy (order, an unfinished answer); the rule still evaluates. */
  notes: string[];
};

/**
 * Every question that only shows sometimes, in form order, with what its rule says and whether it needs a fix. A rule that
 * depends on a removed question is "Needs a fix": at registration time that condition can never be true, so the question
 * is hidden (All) or relies on its other conditions (Any) until someone repairs it.
 */
export function ruleSummary(definition: RegistrationFormDefinition): RuleSummaryEntry[] {
  const all = definition.sections.flatMap((section) => section.fields);
  const entries: RuleSummaryEntry[] = [];
  definition.sections.forEach((section, sectionIndex) => {
    for (const field of section.fields) {
      const rule = fieldVisibilityRule(field);
      if (!rule) continue;
      const problems = ruleProblems(field, all);
      // A group the form would refuse to save (order, an unfinished answer) is a fix, not a note: the schema checks groups strictly.
      const isGroup = Boolean(field.conditionalGroup);
      const broken = problems.filter((problem) => isGroup || BROKEN_RULE_KINDS.has(problem.kind));
      const removed = broken.filter((problem) => problem.kind === "missing");
      const labelOf = (key: string) => all.find((candidate) => candidate.key === key)?.label;
      let fixMessage: string | null = null;
      if (removed.length > 0) {
        const names = [...new Set(removed.map((problem) => `“${problem.fieldKey}”`))];
        fixMessage = `Needs a fix: it depends on ${names.join(" and ")}, which ${names.length === 1 ? "was" : "were"} removed.`;
      } else if (broken.length > 0) {
        fixMessage = `${BROKEN_RULE_KINDS.has(broken[0]!.kind) ? "Needs a fix" : "Fix before saving"}: ${broken[0]!.message}`;
      }
      entries.push({
        fieldId: field.id,
        label: field.label || "Untitled question",
        sectionIndex,
        stepTitle: section.title || "Untitled step",
        match: rule.match,
        phrases: rule.conditions.map((condition) => conditionPhrase(condition, labelOf)),
        needsFix: broken.length > 0,
        fixMessage,
        notes: problems.filter((problem) => !isGroup && !BROKEN_RULE_KINDS.has(problem.kind)).map((problem) => problem.message),
      });
    }
  });
  return entries;
}

// "Show this question when ..." as one flat All/Any group (#1072).
//
// Storage keeps both shapes, so nothing already saved is rewritten:
//   - `conditional`: the original single condition. Every form and published
//     version saved before groups exist uses only this, and it is read as an
//     "All" group of one at read time (`fieldVisibilityRule`).
//   - `conditionalGroup`: two or more conditions joined by All or Any. The
//     builder writes this only when a question has more than one condition,
//     and writes the single `conditional` back when only one is left.
// A field never carries both (the definition schema rejects it). Rules are
// flat: a group's members are conditions, never other groups.
//
// This file is pure and imports nothing at runtime, so the schema, the
// server, the builder, the preview and reports all read a rule the same way.

export type RuleOperator = "EQUALS" | "NOT_EQUALS" | "INCLUDES" | "NOT_EMPTY";

export type RuleCondition = { fieldKey: string; operator: RuleOperator; value: string };

export type RuleMatch = "ALL" | "ANY";

export type VisibilityRule = { match: RuleMatch; conditions: RuleCondition[] };

/** The structural slice of a form field this file reads and writes. */
export type RuleBearer = {
  conditional?: RuleCondition | undefined;
  conditionalGroup?: VisibilityRule | undefined;
};

/** The field's show-when rule as a group, or null when it always shows. A single `conditional` is an All group of one. */
export function fieldVisibilityRule(field: RuleBearer): VisibilityRule | null {
  if (field.conditionalGroup) return { match: field.conditionalGroup.match, conditions: field.conditionalGroup.conditions };
  if (field.conditional) return { match: "ALL", conditions: [field.conditional] };
  return null;
}

/** Whether a question has a show-when rule of any shape. Use this instead of reading `conditional` directly. */
export function hasVisibilityRule(field: RuleBearer): boolean {
  return Boolean(field.conditional || field.conditionalGroup);
}

/** Every condition of the show-when rule, in order. */
export function visibilityConditions(field: RuleBearer): RuleCondition[] {
  return fieldVisibilityRule(field)?.conditions ?? [];
}

/** The keys of every question the show-when rule depends on (each once, in order). */
export function visibilityControllerKeys(field: RuleBearer): string[] {
  return [...new Set(visibilityConditions(field).map((condition) => condition.fieldKey))];
}

/**
 * Evaluate a rule. `matches` decides one condition against the answers.
 * All needs every member, Any needs one. A rule with no members (which the
 * schema rejects) fails open, so a damaged rule never hides a question.
 */
export function evaluateVisibilityRule(rule: VisibilityRule, matches: (condition: RuleCondition) => boolean): boolean {
  if (rule.conditions.length === 0) return true;
  return rule.match === "ANY" ? rule.conditions.some(matches) : rule.conditions.every(matches);
}

/** The patch that stores a rule: one condition goes back to the single `conditional`, two or more to a group, none clears both. */
export function visibilityRulePatch(rule: VisibilityRule | null): { conditional: RuleCondition | undefined; conditionalGroup: VisibilityRule | undefined } {
  if (!rule || rule.conditions.length === 0) return { conditional: undefined, conditionalGroup: undefined };
  if (rule.conditions.length === 1) return { conditional: rule.conditions[0], conditionalGroup: undefined };
  return { conditional: undefined, conditionalGroup: { match: rule.match, conditions: rule.conditions } };
}

/**
 * Apply `change` to every member; returning null drops that member. Used by
 * retargeting and remove-question code. A single `conditional` stays one (and
 * goes away when its member is dropped); a group that loses members is stored
 * as a group or a single condition by `visibilityRulePatch`. A field with no
 * rule is returned as it is.
 */
export function mapVisibilityConditions<T extends RuleBearer>(field: T, change: (condition: RuleCondition) => RuleCondition | null): T {
  const rule = fieldVisibilityRule(field);
  if (!rule) return field;
  const conditions = rule.conditions.flatMap((condition) => {
    const next = change(condition);
    return next ? [next] : [];
  });
  return { ...field, ...visibilityRulePatch({ match: rule.match, conditions }) };
}

const OPERATOR_PHRASES: Record<RuleOperator, string> = { EQUALS: "is", NOT_EQUALS: "is not", INCLUDES: "includes", NOT_EMPTY: "is answered" };

/** "Traveling by club bus is Yes". `labelOf` turns a key into the question's label. */
export function conditionPhrase(condition: RuleCondition, labelOf: (key: string) => string | undefined): string {
  const label = labelOf(condition.fieldKey) || condition.fieldKey;
  return condition.operator === "NOT_EMPTY" ? `${label} ${OPERATOR_PHRASES.NOT_EMPTY}` : `${label} ${OPERATOR_PHRASES[condition.operator]} ${condition.value}`;
}

// ---------------------------------------------------------------------------
// Validation: one set of checks for the schema, the builder and the summary.
// ---------------------------------------------------------------------------

export type RuleField = RuleBearer & {
  key: string;
  type?: string;
  scope: "REGISTRATION" | "ATTENDEE";
};

export type RuleProblemKind = "empty" | "missing" | "self" | "scope" | "order" | "cycle" | "operator" | "answer";

/** `index` is the member (row) the problem belongs to; rule-wide problems (empty, cycle) have none. */
export type RuleProblem = { kind: RuleProblemKind; message: string; fieldKey?: string; index?: number };

const VALID_OPERATORS: ReadonlySet<string> = new Set<RuleOperator>(["EQUALS", "NOT_EQUALS", "INCLUDES", "NOT_EMPTY"]);

/** Controllers whose answer is not a plain value: only "is answered" can be asked of them. */
const ANSWERED_ONLY_TYPES: ReadonlySet<string> = new Set(["CALCULATED", "ADDRESS"]);

/** The problems that stop a rule working, as opposed to a form-order tidy-up or an unfinished row. */
export const BROKEN_RULE_KINDS: ReadonlySet<RuleProblemKind> = new Set<RuleProblemKind>(["empty", "missing", "self", "scope", "cycle", "operator"]);

function reachesKey(from: string, target: string, byKey: ReadonlyMap<string, RuleField>): boolean {
  const seen = new Set<string>();
  const pending = [from];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (key === target) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    const controller = byKey.get(key);
    if (controller) pending.push(...visibilityControllerKeys(controller));
  }
  return false;
}

/**
 * Everything wrong with one question's show-when rule, checking every member.
 * `ordered` is every question of the form in form order (a dependent stays
 * after every controller).
 *
 * `strict` is for rules written since groups exist. A single `conditional`
 * saved before then is held to the checks it always had (a real question
 * that is not itself, and the registration/attendee scope rule), so a form
 * that parsed before still parses and still evaluates; the builder and the
 * rule summary use strict for every rule so a person can see and fix it.
 */
export function visibilityRuleProblems(field: RuleField, ordered: readonly RuleField[], options: { strict: boolean }): RuleProblem[] {
  const rule = fieldVisibilityRule(field);
  if (!rule) return [];
  if (rule.conditions.length === 0) return [{ kind: "empty", message: "A show-when rule needs at least one condition." }];
  const problems: RuleProblem[] = [];
  const byKey = new Map(ordered.map((candidate) => [candidate.key, candidate]));
  const ownIndex = ordered.findIndex((candidate) => candidate.key === field.key);
  for (const [index, condition] of rule.conditions.entries()) {
    if (condition.fieldKey === field.key) {
      problems.push({ kind: "self", fieldKey: condition.fieldKey, index, message: "Conditional logic must reference another configured field." });
      continue;
    }
    const controller = byKey.get(condition.fieldKey);
    if (!controller) {
      problems.push({ kind: "missing", fieldKey: condition.fieldKey, index, message: "Conditional logic must reference another configured field." });
      continue;
    }
    if (field.scope === "REGISTRATION" && controller.scope === "ATTENDEE") {
      problems.push({ kind: "scope", fieldKey: condition.fieldKey, index, message: "A registration-level field cannot depend on an attendee answer." });
    }
    if (!options.strict) continue;
    if (!VALID_OPERATORS.has(condition.operator)) {
      problems.push({ kind: "operator", fieldKey: condition.fieldKey, index, message: "Choose a condition this form understands." });
    } else if (condition.operator !== "NOT_EMPTY" && controller.type && ANSWERED_ONLY_TYPES.has(controller.type)) {
      problems.push({ kind: "operator", fieldKey: condition.fieldKey, index, message: `${controller.type === "ADDRESS" ? "An address" : "A calculated total"} can only be checked as answered.` });
    }
    if ((condition.operator === "EQUALS" || condition.operator === "INCLUDES") && condition.value.trim() === "") {
      problems.push({ kind: "answer", fieldKey: condition.fieldKey, index, message: "Choose or enter the answer this condition looks for." });
    }
    if (ownIndex >= 0 && ordered.indexOf(controller) > ownIndex) {
      problems.push({ kind: "order", fieldKey: condition.fieldKey, index, message: "A question that is shown only when another is answered has to stay after that question." });
    }
  }
  if (options.strict && visibilityControllerKeys(field).some((key) => key !== field.key && reachesKey(key, field.key, byKey))) {
    problems.push({ kind: "cycle", message: "This rule depends on itself through other questions' rules." });
  }
  return problems;
}

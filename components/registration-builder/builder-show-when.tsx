// "Show this question when" (#1072): a flat All/Any group of Question / Condition / Answer rows. Question settings shows it
// in its own section; the older inline field settings (templates) show it where the single condition used to be.
// Required unless (optionalWhen) is separate and unchanged. Nothing here saves: edits go through updateField like every other setting.
import { useEffect, useRef } from "react";
import { conditionOperators, type RegistrationFormField } from "@/modules/forms/definition";
import { fieldVisibilityRule, type RuleMatch, type VisibilityRule } from "@/modules/forms/visibility-rule";
import { conditionLabels } from "./builder-types";
import { useLoadedBuilder } from "./builder-context";
import {
  MAX_RULE_CONDITIONS,
  answerIsChoice,
  conditionIncomplete,
  readsAs,
  ruleControllerChoices,
  ruleEditPatch,
  rowProblems,
  ruleProblems,
  ruleWideProblems,
  startRule,
  withAddedCondition,
  withCondition,
  withControllerChanged,
  withMatch,
  withoutCondition,
} from "./rule-editor";

export const ruleHeadingId = (fieldId: string) => `fb-rule-heading-${fieldId}`;

export function BuilderShowWhen({ field, sectionIndex, fieldIndex }: { field: RegistrationFormField; sectionIndex: number; fieldIndex: number }) {
  const { allFields, canEdit, updateField } = useLoadedBuilder();
  const rule = fieldVisibilityRule(field);
  const choices = ruleControllerChoices(field, allFields);
  const problems = rule ? ruleProblems(field, allFields) : [];
  // A single condition stores no All/Any, so the last one chosen is kept here and comes back when a second row is added.
  const lastMatch = useRef<RuleMatch>(rule && rule.conditions.length > 1 ? rule.match : "ALL");
  const groupMatch = rule && rule.conditions.length > 1 ? rule.match : null;
  useEffect(() => { if (groupMatch) lastMatch.current = groupMatch; }, [groupMatch]);
  // After Remove or Add, focus moves to the row or control named here, once the new rows have rendered.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  const save = (next: VisibilityRule | null) => updateField(sectionIndex, fieldIndex, ruleEditPatch(next));
  const sentence = readsAs(field, allFields);
  const toggleId = `fb-rule-on-${field.id}`;
  const rowId = (index: number) => `fb-rule-${field.id}-${index}`;
  const isGroup = Boolean(field.conditionalGroup);
  const single = rule !== null && rule.conditions.length === 1;
  // A group the form would refuse to save says so in plain words; a single condition keeps the message as is.
  const say = (message: string) => (isGroup ? `Fix before saving: ${message}` : message);
  const last = rule?.conditions.at(-1);
  const addBlocked = !rule || rule.conditions.length >= MAX_RULE_CONDITIONS || choices.length === 0 || Boolean(last && conditionIncomplete(last));
  const addHintId = `fb-rule-add-hint-${field.id}`;

  function chooseMatch(match: RuleMatch) {
    if (!rule || single) return;
    lastMatch.current = match;
    save(withMatch(rule, match));
  }

  function remove(index: number) {
    if (!rule) return;
    const next = withoutCondition(rule, index);
    pendingFocus.current = !next ? toggleId : `${rowId(index < next.conditions.length ? index : index - 1)}-question`;
    save(next);
  }

  function add() {
    if (!rule) return;
    const next = withAddedCondition(rule, field, allFields, rule.conditions.length > 1 ? rule.match : lastMatch.current);
    if (!next) return;
    pendingFocus.current = `${rowId(rule.conditions.length)}-question`;
    save(next);
  }

  return (
    <section className="fb-rule" aria-labelledby={ruleHeadingId(field.id)} data-testid="show-when">
      <h3 id={ruleHeadingId(field.id)} tabIndex={-1} className="fb-rule-heading">Show this question when</h3>
      <label className="required-toggle fb-rule-switch" htmlFor={toggleId}>
        <input id={toggleId} disabled={!canEdit || (!rule && choices.length === 0)} type="checkbox" checked={Boolean(rule)} onChange={(event) => save(event.target.checked ? startRule(field, allFields) : null)} /> Show this question only when…
      </label>
      {!rule && choices.length === 0 && <p className="fb-hint">Add another question first. A rule needs a question to look at.</p>}
      {rule && (
        <>
          <div role="group" aria-label="Match" aria-describedby={single ? `fb-rule-match-hint-${field.id}` : undefined} className="fb-rule-match">
            <button type="button" className="fb-rule-toggle" disabled={!canEdit} aria-disabled={single ? "true" : undefined} aria-pressed={single ? undefined : rule.match === "ALL"} onClick={() => chooseMatch("ALL")}>All of these are true</button>
            <button type="button" className="fb-rule-toggle" disabled={!canEdit} aria-disabled={single ? "true" : undefined} aria-pressed={single ? undefined : rule.match === "ANY"} onClick={() => chooseMatch("ANY")}>Any of these is true</button>
          </div>
          {single && <p className="fb-hint" id={`fb-rule-match-hint-${field.id}`}>Add a second condition to choose All or Any</p>}
          <ol className="fb-rule-rows">
            {rule.conditions.map((condition, index) => {
              const controller = allFields.find((candidate) => candidate.key === condition.fieldKey);
              const rowIssues = rowProblems(problems, rule, index);
              const answerIssues = rowIssues.filter((issue) => issue.kind === "answer");
              const questionIssues = rowIssues.filter((issue) => issue.kind !== "answer");
              const id = rowId(index);
              const describedBy = (issues: typeof rowIssues) => (issues.length > 0 ? issues.map((issue) => `${id}-${issue.kind}`).join(" ") : undefined);
              const inChoices = choices.some((candidate) => candidate.key === condition.fieldKey);
              return (
                <li key={index}>
                  <fieldset className="fb-rule-row" data-invalid={rowIssues.length > 0 ? "true" : undefined}>
                    <legend>Condition {index + 1}</legend>
                    <label htmlFor={`${id}-question`}>Question</label>
                    <select id={`${id}-question`} disabled={!canEdit} value={condition.fieldKey} aria-invalid={questionIssues.length > 0 ? "true" : undefined} aria-describedby={describedBy(questionIssues)} onChange={(event) => save(withCondition(rule, index, withControllerChanged(condition, allFields.find((candidate) => candidate.key === event.target.value), event.target.value)))}>
                      {!inChoices && <option value={condition.fieldKey}>{controller ? `${controller.label || "Untitled question"} (not allowed here)` : `Removed question (${condition.fieldKey})`}</option>}
                      {choices.map((candidate) => <option key={candidate.id} value={candidate.key}>{candidate.label || "Untitled question"}</option>)}
                    </select>
                    {questionIssues.map((issue) => <p className="fb-rule-problem" id={`${id}-${issue.kind}`} key={`${issue.kind}-${index}`}>{say(issue.message)}</p>)}
                    <div className="fb-rule-pair">
                      <div>
                        <label htmlFor={`${id}-condition`}>Condition</label>
                        <select id={`${id}-condition`} disabled={!canEdit} value={condition.operator} onChange={(event) => save(withCondition(rule, index, { ...condition, operator: event.target.value as typeof conditionOperators[number] }))}>
                          {conditionOperators.map((operator) => <option key={operator} value={operator}>{conditionLabels[operator]}</option>)}
                        </select>
                      </div>
                      {condition.operator !== "NOT_EMPTY" && (
                        <div>
                          <label htmlFor={`${id}-answer`}>Answer</label>
                          {answerIsChoice(controller)
                            ? <select id={`${id}-answer`} disabled={!canEdit} value={condition.value} aria-invalid={answerIssues.length > 0 ? "true" : undefined} aria-describedby={describedBy(answerIssues)} onChange={(event) => save(withCondition(rule, index, { ...condition, value: event.target.value }))}><option value="">Choose…</option>{controller.options.map((option) => <option key={option} value={option}>{controller.optionLabels?.[option] ?? option}</option>)}</select>
                            : <input id={`${id}-answer`} autoComplete="off" name="builder-rule-answer" disabled={!canEdit} value={condition.value} maxLength={120} placeholder="Expected answer" aria-invalid={answerIssues.length > 0 ? "true" : undefined} aria-describedby={describedBy(answerIssues)} onChange={(event) => save(withCondition(rule, index, { ...condition, value: event.target.value }))} />}
                        </div>
                      )}
                    </div>
                    {answerIssues.map((issue) => <p className="fb-rule-problem" id={`${id}-${issue.kind}`} key={`${issue.kind}-${index}`}>{say(issue.message)}</p>)}
                    {canEdit && <button type="button" className="fb-btn outline fb-rule-remove" aria-label={`Remove condition ${index + 1}`} onClick={() => remove(index)}>Remove</button>}
                  </fieldset>
                </li>
              );
            })}
          </ol>
          {ruleWideProblems(problems).map((issue) => <p className="fb-rule-problem" key={issue.kind}>{say(issue.message)}</p>)}
          {canEdit && <button type="button" className="fb-btn outline fb-rule-add" aria-disabled={addBlocked ? "true" : undefined} aria-describedby={addBlocked && last && conditionIncomplete(last) ? addHintId : undefined} onClick={() => { if (!addBlocked) add(); }}>+ Add condition</button>}
          {last && conditionIncomplete(last) && <p className="fb-hint" id={addHintId}>Finish the answer in condition {rule.conditions.length} before adding another.</p>}
          {sentence && <p className="fb-rule-reads">{sentence}</p>}
        </>
      )}
      <p className="fb-hint">When this question is hidden, its answer is not kept, not required and not priced.</p>
    </section>
  );
}

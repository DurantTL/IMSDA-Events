// "Show this question when" (#1072): a flat All/Any group of Question / Condition / Answer rows. Question settings shows it
// in its own section; the older inline field settings (templates) show it where the single condition used to be.
// Required unless (optionalWhen) is separate and unchanged. Nothing here saves: edits go through updateField like every other setting.
import { conditionOperators, type RegistrationFormField } from "@/modules/forms/definition";
import { fieldVisibilityRule } from "@/modules/forms/visibility-rule";
import { conditionLabels } from "./builder-types";
import { useLoadedBuilder } from "./builder-context";
import {
  MAX_RULE_CONDITIONS,
  answerIsChoice,
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
  const save = (next: ReturnType<typeof fieldVisibilityRule>) => updateField(sectionIndex, fieldIndex, ruleEditPatch(next));
  const sentence = readsAs(field, allFields);
  const toggleId = `fb-rule-on-${field.id}`;

  return (
    <section className="fb-rule" aria-labelledby={ruleHeadingId(field.id)} data-testid="show-when">
      <h3 id={ruleHeadingId(field.id)} tabIndex={-1} className="fb-rule-heading">Show this question when</h3>
      <label className="required-toggle fb-rule-switch" htmlFor={toggleId}>
        <input id={toggleId} disabled={!canEdit || choices.length === 0} type="checkbox" checked={Boolean(rule)} onChange={(event) => save(event.target.checked ? startRule(field, allFields) : null)} /> Show this question only when…
      </label>
      {!rule && choices.length === 0 && <p className="fb-hint">Add another question first. A rule needs a question to look at.</p>}
      {rule && (
        <>
          <div role="group" aria-label="Match" className="fb-rule-match">
            <button type="button" className="fb-rule-toggle" disabled={!canEdit} aria-pressed={rule.match === "ALL"} onClick={() => save(withMatch(rule, "ALL"))}>All of these are true</button>
            <button type="button" className="fb-rule-toggle" disabled={!canEdit} aria-pressed={rule.match === "ANY"} onClick={() => save(withMatch(rule, "ANY"))}>Any of these is true</button>
          </div>
          <ol className="fb-rule-rows">
            {rule.conditions.map((condition, index) => {
              const controller = allFields.find((candidate) => candidate.key === condition.fieldKey);
              const rowIssues = rowProblems(problems, rule, index);
              const number = index + 1;
              const id = `fb-rule-${field.id}-${index}`;
              return (
                <li className="fb-rule-row" key={index} data-invalid={rowIssues.length > 0 ? "true" : undefined}>
                  <label htmlFor={`${id}-question`}>Question</label>
                  <select id={`${id}-question`} disabled={!canEdit} value={condition.fieldKey} aria-invalid={rowIssues.length > 0 ? "true" : undefined} onChange={(event) => save(withCondition(rule, index, withControllerChanged(condition, allFields.find((candidate) => candidate.key === event.target.value), event.target.value)))}>
                    {!controller && <option value={condition.fieldKey}>Removed question ({condition.fieldKey})</option>}
                    {choices.map((candidate) => <option key={candidate.id} value={candidate.key}>{candidate.label || "Untitled question"}</option>)}
                  </select>
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
                          ? <select id={`${id}-answer`} disabled={!canEdit} value={condition.value} aria-invalid={rowIssues.some((issue) => issue.kind === "answer") ? "true" : undefined} onChange={(event) => save(withCondition(rule, index, { ...condition, value: event.target.value }))}><option value="">Choose…</option>{controller.options.map((option) => <option key={option} value={option}>{controller.optionLabels?.[option] ?? option}</option>)}</select>
                          : <input id={`${id}-answer`} autoComplete="off" name={`builder-rule-answer-${index}`} disabled={!canEdit} value={condition.value} maxLength={120} placeholder="Expected answer" aria-invalid={rowIssues.some((issue) => issue.kind === "answer") ? "true" : undefined} onChange={(event) => save(withCondition(rule, index, { ...condition, value: event.target.value }))} />}
                      </div>
                    )}
                  </div>
                  {rowIssues.map((issue) => <p className="fb-rule-problem" role="alert" key={issue.kind + issue.message}>{issue.message}</p>)}
                  {canEdit && <button type="button" className="fb-btn outline fb-rule-remove" aria-label={`Remove condition ${number}`} onClick={() => save(withoutCondition(rule, index))}>Remove</button>}
                </li>
              );
            })}
          </ol>
          {ruleWideProblems(problems).map((issue) => <p className="fb-rule-problem" role="alert" key={issue.kind}>{issue.message}</p>)}
          {canEdit && <button type="button" className="fb-btn outline fb-rule-add" disabled={rule.conditions.length >= MAX_RULE_CONDITIONS || choices.length === 0} onClick={() => { const next = withAddedCondition(rule, field, allFields); if (next) save(next); }}>+ Add condition</button>}
          {sentence && <p className="fb-rule-reads" role="status">{sentence}</p>}
        </>
      )}
      <p className="fb-hint">When this question is hidden, its answer is not kept, not required and not priced.</p>
    </section>
  );
}

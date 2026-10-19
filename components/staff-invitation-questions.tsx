"use client";

import { isFieldRequired, isFieldVisible, type RegistrationFormField } from "@/modules/forms/definition";
import type { StaffQuestion } from "@/modules/staff-invitations/event-questions";

export type StaffAnswers = Record<string, unknown>;

type Props = {
  /** Distinguishes one person's controls from another's. */
  idPrefix: string;
  /** Who the questions are for, as a phrase: "you", "your spouse", "child 1 (Kit)". Names the group for screen readers. */
  personLabel: string;
  questions: StaffQuestion[];
  answers: StaffAnswers;
  onChange: (next: StaffAnswers) => void;
};

function asField(question: StaffQuestion): RegistrationFormField {
  // Only what the visibility and required rules read; the server holds the real definition.
  return { ...question, scope: "ATTENDEE" } as RegistrationFormField;
}

function optionLabel(question: StaffQuestion, option: string) {
  return question.optionLabels?.[option] ?? option;
}

/**
 * The event's own attendee questions for one person on the staff link form (#1027). It only asks: which questions exist, which
 * are required and what is accepted are the server's decisions. A conditional question appears when its answer matches.
 */
export function StaffInvitationQuestions({ idPrefix, personLabel, questions, answers, onChange }: Props) {
  if (questions.length === 0) return null;
  const set = (key: string, value: unknown) => onChange({ ...answers, [key]: value });
  return (
    <fieldset className="form-stack" data-person-questions={idPrefix}>
      <legend>Questions for {personLabel}</legend>
      {questions.map((question) => {
        const field = asField(question);
        if (!isFieldVisible(field, answers)) return null;
        const required = isFieldRequired(field, answers);
        const id = `${idPrefix}-${question.key}`;
        const value = answers[question.key];
        const label = `${question.group ? `${question.group}: ` : ""}${question.label}`;
        const help = question.helpText ? <small className="field-help" id={`${id}-help`}>{question.helpText}</small> : null;
        const describedBy = question.helpText ? `${id}-help` : undefined;

        if (question.type === "CHECKBOX") {
          return (
            <div key={question.key}>
              <label className="checkbox-label" htmlFor={id}>
                <input aria-describedby={describedBy} checked={value === true} id={id} onChange={(changeEvent) => set(question.key, changeEvent.target.checked)} type="checkbox" /> {label}{required ? " (required)" : ""}
              </label>
              {help}
            </div>
          );
        }
        if (question.type === "RADIO") {
          return (
            <fieldset aria-describedby={describedBy} aria-required={required || undefined} className="form-stack" key={question.key} role="radiogroup">
              <legend>{label}{required ? " (required)" : ""}</legend>
              {question.options.map((option) => (
                <label className="checkbox-label" key={option}>
                  <input checked={value === option} name={id} onChange={() => set(question.key, option)} type="radio" /> {optionLabel(question, option)}
                </label>
              ))}
              {help}
            </fieldset>
          );
        }
        if (question.type === "MULTISELECT" || question.type === "RANKED_CHOICE") {
          const selected = Array.isArray(value) ? value.map(String) : [];
          const ranked = question.type === "RANKED_CHOICE";
          const toggle = (option: string, on: boolean) => set(question.key, on ? [...selected, option] : selected.filter((entry) => entry !== option));
          return (
            <fieldset aria-describedby={describedBy} className="form-stack" key={question.key}>
              <legend>{label}{required ? " (required)" : ""}</legend>
              {ranked && <small className="field-help">Choose in order of preference: the first one you tick is your first choice.</small>}
              {question.options.map((option) => (
                <label className="checkbox-label" key={option}>
                  <input checked={selected.includes(option)} onChange={(changeEvent) => toggle(option, changeEvent.target.checked)} type="checkbox" />
                  {" "}{optionLabel(question, option)}{ranked && selected.includes(option) ? ` (choice ${selected.indexOf(option) + 1})` : ""}
                </label>
              ))}
              {help}
            </fieldset>
          );
        }
        if (question.type === "SELECT") {
          return (
            <div key={question.key}>
              <label htmlFor={id}>
                {label}{required ? " (required)" : ""}
                <select aria-describedby={describedBy} id={id} onChange={(changeEvent) => set(question.key, changeEvent.target.value)} required={required} value={typeof value === "string" ? value : ""}>
                  <option value="">Choose…</option>
                  {question.options.map((option) => <option key={option} value={option}>{optionLabel(question, option)}</option>)}
                </select>
              </label>
              {help}
            </div>
          );
        }
        if (question.type === "LONG_TEXT") {
          return (
            <div key={question.key}>
              <label htmlFor={id}>
                {label}{required ? " (required)" : ""}
                <textarea aria-describedby={describedBy} id={id} maxLength={5000} onChange={(changeEvent) => set(question.key, changeEvent.target.value)} placeholder={question.placeholder} required={required} rows={3} value={typeof value === "string" ? value : ""} />
              </label>
              {help}
            </div>
          );
        }
        const inputType = question.type === "EMAIL" ? "email" : question.type === "PHONE" ? "tel" : question.type === "DATE" ? "date" : question.type === "NUMBER" ? "number" : "text";
        return (
          <div key={question.key}>
          <label htmlFor={id}>
            {label}{required ? " (required)" : ""}
            <input
              aria-describedby={describedBy}
              id={id}
              inputMode={question.type === "NUMBER" ? "numeric" : undefined}
              maxLength={question.type === "TEXT" ? 500 : undefined}
              onChange={(changeEvent) => {
                const raw = changeEvent.target.value;
                set(question.key, question.type === "NUMBER" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw);
              }}
              placeholder={question.placeholder}
              required={required}
              type={inputType}
              value={value === undefined || value === null ? "" : String(value)}
            />
          </label>
          {help}
          </div>
        );
      })}
    </fieldset>
  );
}

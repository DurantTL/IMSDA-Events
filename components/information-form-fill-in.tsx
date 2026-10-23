"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { FieldInput } from "@/components/club-form-fill-in";
import { ClubFormSectionTitle } from "@/components/club-form-section-title";
import { fieldRuns, isFieldVisible, typedAnswerProblem, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";

type Issue = { key?: string; message: string };

/**
 * The public fill page's form (#1150): the club form field renderer without pricing, roster or checkout. The page has
 * already decided the visitor may answer; the server checks everything again against the published version, and the
 * same idempotency key is sent on every retry so a double tap stores once.
 */
export function InformationFormFillIn({ definition, slug, eventSlug }: { definition: RegistrationFormDefinition; slug: string; eventSlug?: string }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [doneMessage, setDoneMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const problemFor = (field: RegistrationFormField) => {
    const raw = typedAnswerProblem(field, answers[field.key]);
    return raw && (attempted || touched[field.key]) ? raw : "";
  };
  const blocking = definition.sections.flatMap((section) => section.fields)
    .filter((field) => isFieldVisible(field, answers) && typedAnswerProblem(field, answers[field.key]));

  async function submit() {
    setAttempted(true);
    if (blocking.length > 0) {
      setError("Check the highlighted answers and try again.");
      setIssues([]);
      return;
    }
    setSaving(true);
    setError("");
    setIssues([]);
    try {
      const response = await fetch("/api/public/information-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...(eventSlug ? { eventSlug } : {}), idempotencyKey, answers }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; issues?: Issue[]; confirmationMessage?: string };
      if (!response.ok) {
        setError(result.message ?? "Your answers could not be sent.");
        setIssues(result.issues ?? []);
        return;
      }
      setDoneMessage(result.confirmationMessage || "Thank you. Your answers have been received.");
    } catch {
      setError("Your answers could not be sent. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (doneMessage) {
    return (
      <div className="inline-notice success information-form-done" role="status">
        <strong>{doneMessage}</strong>
      </div>
    );
  }

  return (
    <form className="club-form-fill information-form-fill" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {definition.sections.map((section) => {
        const fields = section.fields.filter((field) => isFieldVisible(field, answers));
        if (fields.length === 0) return null;
        return (
          <fieldset className="public-manage-card form-stack" disabled={saving} key={section.id}>
            <ClubFormSectionTitle>{section.title}</ClubFormSectionTitle>
            {section.description && <p className="field-help">{section.description}</p>}
            {fieldRuns(fields).map((run, runIndex) => {
              const inputs = run.fields.map((field) => (
                <FieldInput
                  answers={answers}
                  field={field}
                  isSensitive={false}
                  key={field.id}
                  lockedDate={false}
                  onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                  onChange={(value) => setAnswers((current) => ({ ...current, [field.key]: value }))}
                  problem={problemFor(field)}
                  value={answers[field.key]}
                />
              ));
              return run.group
                ? (
                  <div className="club-form-field-group" key={`${run.group}-${runIndex}`} role="group" aria-label={run.group}>
                    <p aria-hidden="true" className="club-form-field-group-heading">{run.group}</p>
                    <div className="form-grid club-form-group-row">{inputs}</div>
                  </div>
                )
                : <div className="form-grid two-column" key={`plain-${runIndex}`}>{inputs}</div>;
            })}
          </fieldset>
        );
      })}
      {error && (
        <div className="inline-notice error" role="alert">
          {error}
          {issues.length > 1 && <ul>{issues.slice(0, 8).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
        </div>
      )}
      <div className="intro-actions">
        <SubmitButton className="primary-button" label="Submit" submitting={saving} submittingLabel="Sending…" />
      </div>
    </form>
  );
}

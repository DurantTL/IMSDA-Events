"use client";

import { useRef, useState } from "react";
import { SecurityCheck, type SecurityCheckConfig, type SecurityCheckHandle } from "@/components/security-check/security-check";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { DraftRestoredNotice } from "@/components/draft-restored-notice";
import { useAnswerDraft } from "@/components/use-answer-draft";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { SubmitButton } from "@/components/submit-button";
import { FieldInput } from "@/components/club-form-fill-in";
import { ClubFormSectionTitle } from "@/components/club-form-section-title";
import { InformationMemberListInput, withoutBlankMemberRows } from "@/components/information-member-list-input";
import { fieldRuns, isFieldVisible, memberListProblems, typedAnswerProblem, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";

type Issue = { key?: string; message: string };

/**
 * The public fill page's form (#1150): the club form field renderer without pricing, roster or checkout. The page has
 * already decided the visitor may answer; the server checks everything again against the published version, and the
 * same idempotency key is sent on every retry so a double tap stores once.
 */
export function InformationFormFillIn({ definition, slug, eventSlug, disableDrafts = false, securityCheck = null }: { securityCheck?: SecurityCheckConfig; definition: RegistrationFormDefinition; slug: string; eventSlug?: string; /** True for a signed-in visitor: no browser draft is read or written (#1263). */ disableDrafts?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());
  const check = useRef<SecurityCheckHandle>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [doneMessage, setDoneMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // The site was restarting (#1263): answers stay, and Try again re-sends them with the same key.
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);
  // A local draft (#1263): the public rules apply, so sensitive, medical, member-list and long-text answers are never written.
  const [edited, setEdited] = useState(false);
  const answerDraft = useAnswerDraft({
    enabled: !disableDrafts,
    identity: { scope: "information-form", formId: `${eventSlug ?? ""}/${slug}` },
    definition,
    answers,
    dirty: edited,
    done: Boolean(doneMessage),
    onRestore: (draft) => setAnswers((current) => ({ ...current, ...draft.answers })),
  });

  const problemFor = (field: RegistrationFormField) => {
    const raw = field.type === "MEMBER_LIST" ? (memberListProblems(field, withoutBlankMemberRows(answers[field.key]))[0] ?? "") : typedAnswerProblem(field, answers[field.key]);
    if (raw && (attempted || touched[field.key])) return raw;
    // A server refusal tied to this field (cleared once the answer is edited).
    return issues.find((issue) => issue.key === field.key && !touched[field.key])?.message ?? "";
  };
  const blocking = definition.sections.flatMap((section) => section.fields)
    .filter((field) => isFieldVisible(field, answers) && (field.type === "MEMBER_LIST" ? memberListProblems(field, withoutBlankMemberRows(answers[field.key])).length > 0 : typedAnswerProblem(field, answers[field.key])));

  /** The answers as sent: a member list without its blank spare rows, and not at all when nothing was entered. */
  function cleanedAnswers() {
    const next = { ...answers };
    for (const field of definition.sections.flatMap((section) => section.fields)) {
      if (field.type !== "MEMBER_LIST") continue;
      const rows = withoutBlankMemberRows(next[field.key]);
      if (rows.length > 0) next[field.key] = rows; else delete next[field.key];
    }
    return next;
  }

  async function submit() {
    setAttempted(true);
    if (blocking.length > 0) {
      setError("Check the highlighted answers and try again.");
      setIssues([]);
      return;
    }
    if (saving) return;
    if (!check.current?.require("Submit")) return;
    setSaving(true);
    setError("");
    setIssues([]);
    setSiteUpdating(false);
    try {
      const response = await submitJson("/api/public/information-forms", {
        slug, ...(eventSlug ? { eventSlug } : {}), idempotencyKey, answers: cleanedAnswers(),
      }, { idempotent: true, init: { headers: check.current?.headers() } });
      if (response.unavailable) {
        check.current?.settle();
        setSiteUpdating(unavailableMessage(response));
        return;
      }
      const result = response.body as { message?: string; issues?: Issue[]; confirmationMessage?: string };
      check.current?.settle(response.body);
      if (!response.ok && check.current?.isRejection(response.body)) return;
      if (!response.ok) {
        setError(result.message ?? "Your answers could not be sent.");
        setIssues(result.issues ?? []);
        setTouched((current) => {
          const next = { ...current };
          for (const issue of result.issues ?? []) if (issue.key) delete next[issue.key];
          return next;
        });
        return;
      }
      answerDraft.clear();
      setDoneMessage(result.confirmationMessage || "Thank you. Your answers have been received.");
    } catch {
      check.current?.settle();
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
      {answerDraft.notice && (
        <DraftRestoredNotice
          kind={answerDraft.notice}
          onDismiss={answerDraft.dismissNotice}
          onDiscard={() => { answerDraft.clear(); answerDraft.dismissNotice(); setAnswers({}); setEdited(false); }}
        />
      )}
      {definition.sections.map((section) => {
        const fields = section.fields.filter((field) => isFieldVisible(field, answers));
        if (fields.length === 0) return null;
        return (
          <fieldset className="public-manage-card form-stack" disabled={saving} key={section.id}>
            <ClubFormSectionTitle>{section.title}</ClubFormSectionTitle>
            {section.description && <p className="field-help">{section.description}</p>}
            {fieldRuns(fields).map((run, runIndex) => {
              const inputs = run.fields.map((field) => field.type === "MEMBER_LIST" ? (
                <InformationMemberListInput
                  field={field}
                  key={field.id}
                  onChange={(rows) => { setEdited(true); setAnswers((current) => ({ ...current, [field.key]: rows })); }}
                  problem={problemFor(field)}
                  value={answers[field.key]}
                />
              ) : (
                <FieldInput
                  answers={answers}
                  field={field}
                  isSensitive={false}
                  key={field.id}
                  lockedDate={false}
                  onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                  onChange={(value) => {
                    setEdited(true);
                    setAnswers((current) => ({ ...current, [field.key]: value }));
                    // Editing clears the server's message for this field; format errors still wait for blur.
                    setIssues((current) => current.filter((issue) => issue.key !== field.key));
                  }}
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
      {siteUpdating && <SubmitRetryNotice message={siteUpdating} busy={saving} onRetry={() => void submit()} />}
      <SecurityCheck config={securityCheck} action="information-form" handleRef={check} />
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

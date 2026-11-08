"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateInput } from "@/components/club-form-date-input";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, useFormErrorSummary } from "@/components/form-error-summary";
import { SubmitButton } from "@/components/submit-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { OUTING_MAX_QUESTIONS, type OutingInput, type OutingQuestionType } from "@/modules/club-forms/outing-domain";
import styles from "./club-outing-form.module.css";

type QuestionDraft = { label: string; type: OutingQuestionType; required: boolean; options: string };
type Problems = Record<string, string>;

const blankDetails = { activity: "", startDate: "", endDate: "", departureTime: "", returnTime: "", transportation: "", cost: "", whatToBring: "", note: "" };
const questionTypeLabel: Record<OutingQuestionType, string> = { TEXT: "Short answer", YES_NO: "Yes or no", CHOICE: "Choose one" };

const fieldId = (key: string) => `outing-${key}`;
const errorId = (key: string) => `outing-${key}-error`;

/**
 * A director's outing permission slip (#1672): the details a parent will see read-only, and up to five club questions.
 * Birth-date and medical questions are refused by the server; its message lands next to the question.
 * The slip's own sections (child, permission, medical and emergency, signature) are not editable here.
 */
export function ClubOutingForm({ organizationId, initial, formsHref }: { organizationId: string; initial?: OutingInput; formsHref: string }) {
  const router = useRouter();
  const [details, setDetails] = useState({ ...blankDetails, ...(initial?.details ?? {}) });
  const [questions, setQuestions] = useState<QuestionDraft[]>(
    (initial?.questions ?? []).map((question) => ({ label: question.label, type: question.type, required: question.required, options: question.options.join("\n") })),
  );
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary } = useFormErrorSummary();
  const dirty = !done && (JSON.stringify(details) !== JSON.stringify({ ...blankDetails, ...(initial?.details ?? {}) }) || questions.length !== (initial?.questions.length ?? 0) || questions.some((question) => question.label.trim() !== ""));
  const allowNavigation = useUnsavedChangesGuard(dirty, "You have not saved this outing yet. Leave this page and discard it?");

  const set = (key: keyof typeof blankDetails, value: string) => setDetails((current) => ({ ...current, [key]: value }));
  const setQuestion = (index: number, patch: Partial<QuestionDraft>) => setQuestions((current) => current.map((question, at) => (at === index ? { ...question, ...patch } : question)));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setProblems({});
    clearSummary();
    try {
      const response = await fetch(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/forms/outings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          details,
          questions: questions.map((question) => ({
            label: question.label,
            type: question.type,
            required: question.required,
            options: question.type === "CHOICE" ? question.options.split("\n").map((option) => option.trim()).filter(Boolean) : [],
          })),
        }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; issues?: Array<{ key: string; message: string }>; outing?: { id: string } };
      if (!response.ok || !result.outing) {
        const issues = result.issues ?? [];
        if (issues.length > 0) {
          setProblems(Object.fromEntries(issues.map((issue) => [issue.key, issue.message])));
          showSummary(issues.map((issue) => ({ targetId: fieldId(issue.key.replace(":", "-")), message: issue.message })));
        } else {
          setError(result.message ?? "The outing could not be saved.");
        }
        return;
      }
      setDone(true);
      allowNavigation();
      router.push(`${formsHref}/outings/${encodeURIComponent(result.outing.id)}`);
    } catch {
      setError("The outing could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const control = (key: keyof typeof blankDetails) => ({ id: fieldId(key), ...fieldErrorProps(errorId(key), problems[key]) });
  const fieldError = (key: string) => <FieldError id={errorId(key)}>{problems[key]}</FieldError>;

  return (
    <form className="public-manage-card form-stack" noValidate onSubmit={save}>
      {summaryItems.length > 0 && <FormErrorSummary action="saving" items={summaryItems} ref={summaryRef} />}
      <h2>Outing details</h2>
      <p className="field-help">Parents see these read-only on the slip. They don&apos;t type them again.</p>
      <div className="form-grid two-column">
        <label>Activity
          <input {...control("activity")} maxLength={120} onChange={(event) => set("activity", event.target.value)} required value={details.activity} />
          {fieldError("activity")}
        </label>
        <label>Transportation and who the children ride with
          <input {...control("transportation")} maxLength={200} onChange={(event) => set("transportation", event.target.value)} required value={details.transportation} />
          {fieldError("transportation")}
        </label>
        <div>
          <DateInput describedBy={problems.startDate ? errorId("startDate") : undefined} fieldId={fieldId("startDate")} invalid={Boolean(problems.startDate)} label="Date" labelText="Date" onChange={(value) => set("startDate", value)} required value={details.startDate} />
          {fieldError("startDate")}
        </div>
        <div>
          <DateInput describedBy={problems.endDate ? errorId("endDate") : undefined} fieldId={fieldId("endDate")} invalid={Boolean(problems.endDate)} label="Last date, if more than one day" labelText="Last date" onChange={(value) => set("endDate", value)} value={details.endDate} />
          {fieldError("endDate")}
        </div>
        <label>Leaving at
          <input {...control("departureTime")} onChange={(event) => set("departureTime", event.target.value)} type="time" value={details.departureTime} />
          {fieldError("departureTime")}
        </label>
        <label>Back at
          <input {...control("returnTime")} onChange={(event) => set("returnTime", event.target.value)} type="time" value={details.returnTime} />
          {fieldError("returnTime")}
        </label>
        <label>Cost, if any
          <input {...control("cost")} maxLength={80} onChange={(event) => set("cost", event.target.value)} value={details.cost} />
          {fieldError("cost")}
        </label>
      </div>
      <label>What to bring
        <textarea {...control("whatToBring")} className={styles.textarea} maxLength={600} onChange={(event) => set("whatToBring", event.target.value)} value={details.whatToBring} />
        {fieldError("whatToBring")}
      </label>
      <label>Short note for parents
        <textarea {...control("note")} className={styles.textarea} maxLength={600} onChange={(event) => set("note", event.target.value)} value={details.note} />
        {fieldError("note")}
      </label>

      <h2>Questions for parents</h2>
      <p className={`field-help ${styles.help}`}>
        Up to {OUTING_MAX_QUESTIONS} questions, for example &ldquo;T-shirt size&rdquo; or &ldquo;Can your child swim?&rdquo;. Questions can&apos;t ask for birth dates or medical details: the slip already has its own medical and emergency section.
      </p>
      <div className={styles.questions}>
        {questions.map((question, index) => {
          const key = `question:${index + 1}`;
          const id = fieldId(`question-${index + 1}`);
          return (
            <fieldset className={styles.question} key={index}>
              <legend className={styles.questionHeading}>Question {index + 1}</legend>
              <label>Question
                <input aria-describedby={problems[key] ? errorId(`question-${index + 1}`) : undefined} aria-invalid={problems[key] ? true : undefined} id={id} maxLength={120} onChange={(event) => setQuestion(index, { label: event.target.value })} required value={question.label} />
                <FieldError id={errorId(`question-${index + 1}`)}>{problems[key]}</FieldError>
              </label>
              <div className={styles.questionRow}>
                <label>Answer type
                  <select onChange={(event) => setQuestion(index, { type: event.target.value as OutingQuestionType })} value={question.type}>
                    {(Object.keys(questionTypeLabel) as OutingQuestionType[]).map((type) => <option key={type} value={type}>{questionTypeLabel[type]}</option>)}
                  </select>
                </label>
                <label className="checkbox-label">
                  <input checked={question.required} onChange={(event) => setQuestion(index, { required: event.target.checked })} type="checkbox" />
                  Parent must answer
                </label>
              </div>
              {question.type === "CHOICE" && (
                <label>Choices, one per line
                  <textarea className={styles.textarea} onChange={(event) => setQuestion(index, { options: event.target.value })} value={question.options} />
                </label>
              )}
              <button className="text-button" onClick={() => setQuestions((current) => current.filter((_, at) => at !== index))} type="button">
                <Trash2 aria-hidden="true" size={14} /> Remove question {index + 1}
              </button>
            </fieldset>
          );
        })}
      </div>
      {questions.length < OUTING_MAX_QUESTIONS && (
        <div>
          <button className="secondary-button" onClick={() => setQuestions((current) => [...current, { label: "", type: "TEXT", required: false, options: "" }])} type="button">
            <Plus aria-hidden="true" size={14} /> Add a question
          </button>
        </div>
      )}

      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <div className="intro-actions">
        <SubmitButton className="primary-button" label="Save outing" submitting={saving} submittingLabel="Saving…" />
      </div>
    </form>
  );
}

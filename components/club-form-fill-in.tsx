"use client";

import { SubmitButton } from "@/components/submit-button";
import { useMemo, useRef, useState } from "react";
import { SecurityCheck, type SecurityCheckConfig, type SecurityCheckHandle } from "@/components/security-check/security-check";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { DraftRestoredNotice } from "@/components/draft-restored-notice";
import { useAnswerDraft } from "@/components/use-answer-draft";
import { shortHash } from "@/modules/forms/answer-draft";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { clubFormIsDirty, dropStaleRankedChoices, clubFormUnsavedMessage, rankLabel, rankedMaximum, toggleRankedChoice, withAutoDateAnswers } from "@/components/club-form-state";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { LockKeyhole } from "lucide-react";
import { ClubFormSectionTitle } from "@/components/club-form-section-title";
import { DateInput } from "@/components/club-form-date-input";
import { inputAttributesFor } from "@/lib/field-validation";
import { addressComponentKeys, addressComponentLabels } from "@/modules/forms/address";
import { savedMessage } from "@/components/form-message";
import {
  dateFieldBounds,
  fieldRuns,
  isFieldRequired,
  isFieldVisible,
  todayDateValue,
  typedAnswerProblem,
  type RegistrationFormDefinition,
  type RegistrationFormField,
} from "@/modules/forms/definition";

type Answers = Record<string, unknown>;

type Props = {
  definition: RegistrationFormDefinition;
  sectionNotes: Record<string, string[]>;
  sensitiveFieldKeys: string[];
  initialAnswers?: Answers;
  /** Today in the conference zone (Chicago), from the server, so signing dates fill in the same day on both sides (#719). */
  todayDate?: string;
  /** Public open application only (#1399): from `securityCheckConfigForPage()`; null while Turnstile is off. */
  securityCheck?: SecurityCheckConfig;
} & (
  | {
    mode: "club";
    organizationId: string;
    templateKey: string;
    submissionId?: string;
    rosterMembers: Array<{ id: string; name: string }>;
    /** Whether this form is filled in for a roster member (a picker) or for no one (a typed label). */
    initialRosterMemberId?: string | null;
    initialSubjectName?: string;
    doneHref: string;
  }
  | { mode: "link"; token: string }
  /** A public open application (#1229): anyone with the link, who picks their club (id and name only) or "Not listed". */
  | { mode: "open"; templateKey: string; clubs: Array<{ id: string; name: string }> }
);

type Issue = { key?: string; message: string };

function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

function textOf(value: unknown) {
  return typeof value === "string" ? value : "";
}

/**
 * Fills in one club form from its definition (#610), for a director filling
 * it in for a member or for the person who opened a private link. The
 * definition's own rules decide what shows and what is required; the server
 * checks everything again.
 */
export function ClubFormFillIn(props: Props) {
  const { definition, sectionNotes, sensitiveFieldKeys } = props;
  // Saved ranked choices no longer offered are dropped up front; the saved baseline matches, so this is not a change.
  // Signing and application dates (#719): a link always shows today's date (the server sets it again on submit); a director's new form starts with it but can change it.
  const today = props.todayDate ?? todayDateValue();
  const [initialAnswers] = useState<Answers>(() => {
    const cleaned = dropStaleRankedChoices(props.definition, props.initialAnswers ?? {});
    if (props.mode !== "club") return withAutoDateAnswers(props.definition, cleaned, today, true);
    return props.submissionId ? cleaned : withAutoDateAnswers(props.definition, cleaned, today);
  });
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [rosterMemberId, setRosterMemberId] = useState(props.mode === "club" ? props.initialRosterMemberId ?? "" : "");
  const [subjectName, setSubjectName] = useState(props.mode === "club" ? props.initialSubjectName ?? "" : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [notice, setNotice] = useState("");
  const [doneMessage, setDoneMessage] = useState("");
  // Open applications: the club choice, and one key per fill so a repeated submit returns the first result (#1229).
  const [clubChoice, setClubChoice] = useState("");
  const [unlistedClubName, setUnlistedClubName] = useState("");
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [savedId, setSavedId] = useState(props.mode === "club" ? props.submissionId : undefined);
  const sensitive = useMemo(() => new Set(sensitiveFieldKeys), [sensitiveFieldKeys]);
  // Last saved state (#703): the guard is on only while the form differs from it.
  const [saved, setSaved] = useState({
    answers: initialAnswers,
    rosterMemberId: props.mode === "club" ? props.initialRosterMemberId ?? "" : "",
    subjectName: props.mode === "club" ? props.initialSubjectName ?? "" : "",
  });
  const current = { answers, rosterMemberId, subjectName };
  const dirty = !doneMessage && clubFormIsDirty(current, saved);
  const allowNavigation = useUnsavedChangesGuard(dirty, clubFormUnsavedMessage);
  // The site was restarting (#1263): the answers stay in the form and Try again re-sends them with the same key.
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);
  const lastSubmitRef = useRef(true);
  const check = useRef<SecurityCheckHandle>(null);
  // A local draft (#1263) for the anonymous modes only: a signed-in director's form and any page that
  // starts from saved answers never write one, the same rule as the public registration drafts.
  const draftIdentity = props.mode === "link"
    ? { scope: "club-link", formId: shortHash(props.token) }
    : { scope: props.mode === "open" ? "club-open" : "club-form", formId: props.templateKey };
  const hasPrefill = Object.keys(props.initialAnswers ?? {}).length > 0;
  const answerDraft = useAnswerDraft({
    enabled: props.mode !== "club" && !hasPrefill,
    identity: draftIdentity,
    definition,
    sealedKeys: sensitiveFieldKeys,
    answers,
    extras: { clubChoice, unlistedClubName },
    dirty: dirty || clubChoice !== "" || unlistedClubName !== "",
    done: Boolean(doneMessage),
    onRestore: (draft) => {
      setAnswers((currentAnswers) => ({ ...currentAnswers, ...draft.answers }));
      setClubChoice(draft.extras.clubChoice ?? "");
      setUnlistedClubName(draft.extras.unlistedClubName ?? "");
    },
  });
  // Inline checks (#855): the same validators the server runs. An old answer that fails and was not changed is
  // flagged for correction but never blocks saving the rest of the form.
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const problemFor = (field: RegistrationFormField) => {
    const raw = typedAnswerProblem(field, answers[field.key]);
    if (!raw) return "";
    const legacy = typedAnswerProblem(field, answers[field.key], initialAnswers[field.key]) === null;
    if (!legacy && !attempted && !touched[field.key]) return "";
    return legacy ? `${raw} This saved answer needs correcting.` : raw;
  };
  const blockingProblems = definition.sections.flatMap((section) => section.fields)
    .filter((field) => isFieldVisible(field, answers) && !(props.mode !== "club" && field.autoDate === "TODAY"))
    .filter((field) => typedAnswerProblem(field, answers[field.key]) && typedAnswerProblem(field, answers[field.key], initialAnswers[field.key]));

  function set(key: string, value: unknown) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  async function send(submit: boolean) {
    setAttempted(true);
    if (props.mode === "open" && (!clubChoice || (clubChoice === "NOT_LISTED" && !unlistedClubName.trim()))) {
      setError(clubChoice ? "Type your club's name." : "Choose your club, or choose Not listed.");
      setIssues([]);
      return;
    }
    if (blockingProblems.length > 0) {
      setError("Check the highlighted answers and try again.");
      setIssues([]);
      return;
    }
    if (saving) return;
    if (props.mode === "open" && !check.current?.require("Submit form")) return;
    setSaving(true);
    setError("");
    setIssues([]);
    setNotice("");
    setSiteUpdating(false);
    lastSubmitRef.current = submit;
    try {
      const response = props.mode === "club"
        ? await submitJson(`/api/attendee/clubs/${encodeURIComponent(props.organizationId)}/forms/submissions`, {
          templateKey: props.templateKey,
          submissionId: savedId,
          rosterMemberId: rosterMemberId || null,
          subjectName: rosterMemberId ? undefined : subjectName || undefined,
          answers,
          submit,
        })
        : props.mode === "open"
          // The open application carries a key the server dedupes on, so a quiet retry is safe.
          ? await submitJson(`/api/public/club-form-applications/${encodeURIComponent(props.templateKey)}`, {
            organizationId: clubChoice,
            unlistedClubName: clubChoice === "NOT_LISTED" ? unlistedClubName.trim() : undefined,
            idempotencyKey,
            answers,
          }, { idempotent: true, init: { headers: check.current?.headers() } })
          : await submitJson(`/api/public/club-forms/${encodeURIComponent(props.token)}`, { answers });
      if (response.unavailable) {
        if (props.mode === "open") check.current?.settle();
        setSiteUpdating(unavailableMessage(response));
        return;
      }
      if (props.mode === "open") {
        check.current?.settle(response.body);
        if (!response.ok && check.current?.isRejection(response.body)) return;
      }
      const result = response.body as {
        message?: string;
        issues?: Issue[];
        submission?: { id: string; status: string };
        confirmationMessage?: string;
      };
      if (!response.ok) {
        // A single-use link that is already used or withdrawn (404): the saved answers have nowhere to go.
        if (props.mode === "link" && response.status === 404) answerDraft.clear();
        setError(result.message ?? "The form could not be saved.");
        setIssues(result.issues ?? []);
        return;
      }
      setSaved(current);
      answerDraft.clear();
      if (props.mode !== "club") {
        setDoneMessage(result.confirmationMessage ?? "Thank you. Your form has been received.");
        return;
      }
      if (submit) {
        allowNavigation();
        window.location.assign(props.doneHref);
        return;
      }
      setSavedId(result.submission?.id);
      setNotice(savedMessage("Submit it when you are ready."));
    } catch {
      if (props.mode === "open") check.current?.settle();
      setError("The form could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (doneMessage) {
    return (
      <div className="inline-notice success club-form-done" role="status">
        <strong>{doneMessage}</strong>
        {props.mode === "link" && <span> This link has now been used and cannot be opened again.</span>}
      </div>
    );
  }

  return (
    <form
      className="club-form-fill"
      onSubmit={(event) => {
        event.preventDefault();
        void send(true);
      }}
    >
      {props.mode === "club" && (
        <fieldset className="public-manage-card form-stack" disabled={saving || Boolean(savedId)}>
          <ClubFormSectionTitle>Who is this form for?</ClubFormSectionTitle>
          {props.rosterMembers.length > 0 && (
            <label>
              Roster member
              <select value={rosterMemberId} onChange={(event) => setRosterMemberId(event.target.value)}>
                <option value="">Not a roster member (for example a staff applicant)</option>
                {props.rosterMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
          )}
          {!rosterMemberId && (
            <label>
              Label for your list (optional)
              <input maxLength={120} value={subjectName} onChange={(event) => setSubjectName(event.target.value)} />
            </label>
          )}
          {savedId && <small className="field-help">This draft is already tied to a person. Start a new form to change who it is for.</small>}
        </fieldset>
      )}

      {props.mode === "open" && (
        <fieldset className="public-manage-card form-stack" disabled={saving}>
          <ClubFormSectionTitle>Your club</ClubFormSectionTitle>
          <div className="club-form-apply-club">
            <label>
              <span>Club<span aria-hidden="true">{"\u00a0*"}</span></span>
              <select onChange={(event) => setClubChoice(event.target.value)} required value={clubChoice}>
                <option value="">Choose your club…</option>
                {props.clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
                <option value="NOT_LISTED">Not listed</option>
              </select>
            </label>
            {clubChoice === "NOT_LISTED" && (
              <label>
                <span>Your club&apos;s name<span aria-hidden="true">{"\u00a0*"}</span></span>
                <input maxLength={120} onChange={(event) => setUnlistedClubName(event.target.value)} required value={unlistedClubName} />
              </label>
            )}
          </div>
        </fieldset>
      )}

      {definition.sections.map((section) => {
        const fields = section.fields.filter((field) => isFieldVisible(field, answers));
        if (fields.length === 0) return null;
        return (
          <fieldset className="public-manage-card form-stack" disabled={saving} key={section.id}>
            <ClubFormSectionTitle>{section.title}</ClubFormSectionTitle>
            {section.description && <p className="field-help">{section.description}</p>}
            {(sectionNotes[section.id] ?? []).map((note, index) => <p className="club-form-note" key={index}>{note}</p>)}
            {fieldRuns(fields).map((run, runIndex) => {
              const inputs = run.fields.map((field) => (
                <FieldInput
                  answers={answers}
                  field={field}
                  isSensitive={sensitive.has(field.key)}
                  key={field.id}
                  lockedDate={props.mode !== "club" && field.autoDate === "TODAY"}
                  onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                  onChange={(value) => set(field.key, value)}
                  problem={problemFor(field)}
                  value={answers[field.key]}
                />
              ));
              // #856: fields that share a group heading sit in their own row (a card under the heading).
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

      {answerDraft.notice && (
        <DraftRestoredNotice
          kind={answerDraft.notice}
          onDismiss={answerDraft.dismissNotice}
          onDiscard={() => {
            answerDraft.clear();
            answerDraft.dismissNotice();
            setAnswers(initialAnswers);
            setClubChoice("");
            setUnlistedClubName("");
          }}
        />
      )}
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {siteUpdating && <SubmitRetryNotice message={siteUpdating} busy={saving} onRetry={() => void send(lastSubmitRef.current)} />}
      {props.mode === "open" && <SecurityCheck config={props.securityCheck ?? null} action="club-application" handleRef={check} />}
      {error && (
        <div className="inline-notice error" role="alert">
          {error}
          {issues.length > 1 && <ul>{issues.slice(0, 8).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
        </div>
      )}
      <div className="intro-actions">
        {props.mode === "club" && (
          <button className="secondary-button" disabled={saving} onClick={() => void send(false)} type="button">Save draft</button>
        )}
        <SubmitButton className="primary-button" label="Submit form" submitting={saving} submittingLabel="Submitting…" />
      </div>
    </form>
  );
}

export function FieldInput({
  field,
  value,
  answers,
  isSensitive,
  lockedDate,
  onBlur,
  onChange,
  problem,
}: {
  field: RegistrationFormField;
  value: unknown;
  answers: Answers;
  isSensitive: boolean;
  /** An auto-date field on a private link: shown, not editable. */
  lockedDate: boolean;
  onBlur: () => void;
  onChange: (value: unknown) => void;
  /** The inline message for a typed answer that fails its check, or "". */
  problem: string;
}) {
  const required = isFieldRequired(field, answers);
  const label = (
    <span>
      {field.label}
      {required ? <span aria-hidden="true">{"\u00a0*"}</span> : null}
      {isSensitive && <small className="club-form-private"><LockKeyhole aria-hidden="true" size={11} /> Private</small>}
    </span>
  );
  const problemId = `club-form-${field.id}-problem`;
  const help = (
    <>
      {field.helpText ? <small className="field-help">{field.helpText}</small> : null}
      {problem ? <small className="field-error" id={problemId} role="alert">{problem}</small> : null}
    </>
  );
  const invalid = problem ? true : undefined;
  const describedBy = problem ? problemId : undefined;
  const wide = field.type === "LONG_TEXT" || field.type === "ADDRESS" || field.type === "RADIO" || field.type === "MULTISELECT" || field.type === "RANKED_CHOICE" || field.label.length > 60;
  const className = wide ? "club-form-field-wide" : undefined;

  switch (field.type) {
    case "LONG_TEXT":
      return (
        <label className={className}>{label}
          <textarea maxLength={5000} required={required} rows={4} value={textOf(value)} onChange={(event) => onChange(event.target.value)} />
          {help}
        </label>
      );
    case "SELECT":
      return (
        <label className={className}>{label}
          <select required={required} value={textOf(value)} onChange={(event) => onChange(event.target.value)}>
            <option value="">Choose…</option>
            {field.options.map((option) => <option key={option} value={option}>{field.optionLabels?.[option] ?? option}</option>)}
          </select>
          {help}
        </label>
      );
    case "RADIO":
      return (
        <fieldset className={`club-form-choice ${className ?? ""}`}>
          <legend>{label}</legend>
          <div className="club-form-choice-row">
            {field.options.map((option) => (
              <label className="checkbox-label" key={option}>
                <input checked={value === option} name={field.key} onChange={() => onChange(option)} type="radio" />
                {field.optionLabels?.[option] ?? option}
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    case "RANKED_CHOICE": {
      const selected = Array.isArray(value) ? value.map(String).filter((item) => field.options.includes(item)) : [];
      const maximum = rankedMaximum(field);
      const minimum = field.minSelections ?? (required ? Math.min(2, maximum) : 0);
      return (
        <fieldset className={`club-form-choice ${className ?? ""}`}>
          <legend>{label}</legend>
          <small className="field-help">
            {minimum > 0 ? `Choose ${minimum} and rank up to ${maximum}.` : `Optional — rank up to ${maximum} if you'd like.`} Tap choices in preference order; tap a ranked choice again to remove it and re-rank.
          </small>
          <div className="club-form-ranking-list">
            {field.options.map((option) => {
              const rank = selected.indexOf(option);
              return (
                <button
                  aria-pressed={rank >= 0}
                  className={rank >= 0 ? "is-selected" : undefined}
                  disabled={rank < 0 && selected.length >= maximum}
                  key={option}
                  onClick={() => onChange(toggleRankedChoice(selected, option, maximum))}
                  type="button"
                >
                  <span>{field.optionLabels?.[option] ?? option}</span>
                  <b>{rankLabel(rank)}</b>
                </button>
              );
            })}
          </div>
          {help}
        </fieldset>
      );
    }
    case "MULTISELECT": {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <fieldset className={`club-form-choice ${className ?? ""}`}>
          <legend>{label}</legend>
          <div className="club-form-choice-row">
            {field.options.map((option) => (
              <label className="checkbox-label" key={option}>
                <input
                  checked={selected.includes(option)}
                  onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))}
                  type="checkbox"
                />
                {field.optionLabels?.[option] ?? option}
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    }
    case "CHECKBOX":
      return (
        <label className={`checkbox-label ${className ?? "club-form-field-wide"}`}>
          <input checked={value === true} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
          {label}
          {help}
        </label>
      );
    case "ADDRESS": {
      const address = (value && typeof value === "object" ? value : {}) as Record<string, string>;
      return (
        <fieldset className="club-form-choice club-form-field-wide">
          <legend>{label}</legend>
          <div className="form-grid two-column">
            {addressComponentKeys.map((key) => (
              <label key={key}>{addressComponentLabels[key]}
                <input maxLength={200} value={address[key] ?? ""} onChange={(event) => onChange({ ...address, [key]: event.target.value })} />
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    }
    case "DATE":
      return (
        <DateInput
          bounds={dateFieldBounds(field)}
          className={className}
          help={<>{lockedDate ? <small className="field-help">Filled in automatically with today&apos;s date.</small> : null}{help}</>}
          label={label}
          labelText={field.label}
          locked={lockedDate}
          onChange={onChange}
          required={required}
          value={textOf(value)}
        />
      );
    case "NUMBER":
      return (
        <label className={className}>{label}
          <input aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" onBlur={onBlur} required={required} step="any" type="number" value={typeof value === "number" || typeof value === "string" ? String(value) : ""} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />
          {help}
        </label>
      );
    default: {
      const attributes = field.type === "EMAIL" ? inputAttributesFor("email") : field.type === "PHONE" ? inputAttributesFor("phone") : null;
      return (
        <label className={className}>{label}
          <input
            aria-describedby={describedBy}
            aria-invalid={invalid}
            autoComplete={attributes?.autoComplete}
            inputMode={attributes?.inputMode}
            maxLength={field.type === "EMAIL" ? 160 : field.type === "PHONE" ? 40 : 500}
            onBlur={onBlur}
            required={required}
            type={attributes?.type ?? "text"}
            value={textOf(value)}
            onChange={(event) => onChange(event.target.value)}
          />
          {help}
        </label>
      );
    }
  }
}

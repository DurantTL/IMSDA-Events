"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ListChecks, Save } from "lucide-react";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { AddressFieldGroup } from "@/components/address-field-group";
import { SearchableSelect } from "@/components/searchable-select";
import { inlineFieldProblem, inputAttributesFor, isUnchangedEmail, isUnchangedFromStored, isUnchangedPhone, valueTypeForFieldType } from "@/lib/field-validation";
import { dateFieldProblem } from "@/modules/forms/definition";
import type { EditableAttendeeField } from "@/modules/attendee-accounts/registration-answer-policy";
import { formatAddressDisplay, isPlainAddressObject, type AddressValue } from "@/modules/forms/address";
import { evaluateVisibilityRule, fieldVisibilityRule, type RuleCondition } from "@/modules/forms/visibility-rule";

type EditableAttendee = {
  attendeeId: string;
  name: string;
  responses: Record<string, unknown>;
  lockedFieldKeys?: string[];
};

export function fieldIsVisible(
  field: EditableAttendeeField,
  responses: Record<string, unknown>,
) {
  const rule = fieldVisibilityRule({ conditional: field.conditional ?? undefined, conditionalGroup: field.conditionalGroup ?? undefined });
  if (!rule) return true;
  return evaluateVisibilityRule(rule, (condition) => conditionHolds(condition, responses));
}

function conditionHolds(
  condition: RuleCondition,
  responses: Record<string, unknown>,
) {
  const actual = responses[condition.fieldKey];
  if (condition.operator === "NOT_EMPTY") {
    return Array.isArray(actual)
      ? actual.length > 0
      : actual !== null && actual !== undefined && String(actual).trim() !== "";
  }
  if (condition.operator === "INCLUDES") {
    return Array.isArray(actual)
      ? actual.map(String).includes(condition.value)
      : String(actual ?? "").includes(condition.value);
  }
  if (condition.operator === "NOT_EQUALS") {
    return String(actual ?? "") !== condition.value;
  }
  return String(actual ?? "") === condition.value;
}

/** A chosen option longer than this is also shown in full under its select (#711). */
const LONG_OPTION_LENGTH = 38;

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function AttendeeRegistrationAnswersForm({
  registrationId,
  answerEndpoint,
  description = "These low-risk choices can be updated from your verified account.",
  readOnly = false,
  initialExpectedUpdatedAt,
  fields,
  initialAttendees,
}: {
  registrationId?: string;
  answerEndpoint?: string;
  description?: string;
  readOnly?: boolean;
  initialExpectedUpdatedAt: string;
  fields: EditableAttendeeField[];
  initialAttendees: EditableAttendee[];
}) {
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(initialExpectedUpdatedAt);
  const [saved, setSaved] = useState(initialAttendees);
  const [attendees, setAttendees] = useState(initialAttendees);
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);
  const [saving, setSaving] = useState(false);
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Inline checks (#855): an old stored value that fails is flagged but never blocks the save.
  const [attempted, setAttempted] = useState(false);
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const numberRules = { min: 0, max: 100000 };
  const storedAnswer = (attendeeId: string, key: string) => saved.find((attendee) => attendee.attendeeId === attendeeId)?.responses[key];
  // Phone, email, number and date answers share one check (#855, #1193): a changed value must pass, and an old stored
  // value that fails is flagged "needs correcting" without blocking the save. The server compares with what it stored.
  const typedProblem = (field: EditableAttendeeField, attendee: EditableAttendee) => {
    const type = valueTypeForFieldType(field.type);
    if (!type) return { message: "", blocking: false };
    const value = attendee.responses[field.key];
    const stored = storedAnswer(attendee.attendeeId, field.key);
    const shown = attempted || Boolean(touched[`${attendee.attendeeId}:${field.key}`]);
    // The server's own comparisons (#871): a phone only re-spaced, or an email only re-cased, is still the saved one.
    const unchanged = (field.type === "PHONE" && isUnchangedPhone(value, stored)) || (field.type === "EMAIL" && isUnchangedEmail(value, stored));
    const problem = inlineFieldProblem(field.label, type, value, unchanged ? value : stored, shown, type === "number" ? numberRules : {});
    if (problem.message || field.type !== "DATE" || typeof value !== "string" || value === "") return problem;
    // The same date rule as the server (no date before 1900, no future birth date); an old saved date is flagged, never blocked.
    const dateProblem = dateFieldProblem({ type: field.type, key: field.key, label: field.label }, value);
    if (!dateProblem) return problem;
    if (isUnchangedFromStored(value, stored)) return { message: `${dateProblem} This saved answer needs correcting.`, blocking: false };
    return { message: shown ? dateProblem : "", blocking: true };
  };
  const dirty = useMemo(() => !valuesEqual(saved, attendees), [attendees, saved]);
  const endpoint = answerEndpoint
    ?? `/api/attendee/registrations/${encodeURIComponent(registrationId ?? "")}/answers`;

  function updateAnswer(attendeeId: string, key: string, value: unknown) {
    setAttendees((current) => current.map((attendee) => (
      attendee.attendeeId === attendeeId
        ? {
            ...attendee,
            responses: { ...attendee.responses, [key]: value },
          }
        : attendee
    )));
    setError("");
    setNotice("");
  }

  async function save(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;
    setSiteUpdating(false);
    setAttempted(true);
    const blocked = attendees.some((attendee) => fields.some((field) => (
      valueTypeForFieldType(field.type) !== null
      && !(attendee.lockedFieldKeys ?? []).includes(field.key)
      && typedProblem(field, attendee).blocking
    )));
    if (blocked) {
      setError("Check the highlighted answers and try again.");
      return;
    }
    // A phone's picker is a button, which has no native required check: look for a cleared required list here.
    const missing = attendees.flatMap((attendee) => fields
      .filter((field) => (
        field.required
        && !readOnly
        && !(attendee.lockedFieldKeys ?? []).includes(field.key)
        && fieldIsVisible(field, attendee.responses)
        && !["CHECKBOX", "MULTISELECT", "RANKED_CHOICE", "NUMBER", "ADDRESS", "PHONE", "EMAIL", "DATE"].includes(field.type)
        && (typeof attendee.responses[field.key] !== "string" || attendee.responses[field.key] === "")
      ))
      .map((field) => `${attendee.attendeeId}_${field.id}`));
    setMissingIds(missing);
    if (missing.length > 0) {
      setError("Choose an option for each highlighted list and try again.");
      document.getElementById(missing[0])?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      // The request id is kept until the save is answered, so Try again after a restart is replayed (#1263).
      const response = await submitJson(
        endpoint,
        {
          clientRequestId,
          expectedUpdatedAt,
          attendees: attendees.map((attendee) => ({
            attendeeId: attendee.attendeeId,
            responses: attendee.responses,
          })),
        },
        { method: "PUT", idempotent: true },
      );
      if (response.unavailable) {
        setSiteUpdating(unavailableMessage(response));
        return;
      }
      const result = response.body as { message?: string; attendees?: unknown; expectedUpdatedAt?: string };
      if (!response.ok || !Array.isArray(result.attendees)) {
        throw new Error(result.message ?? "The attendee choices could not be saved.");
      }
      const next = result.attendees as EditableAttendee[];
      setAttendees(next);
      setSaved(next);
      setExpectedUpdatedAt(result.expectedUpdatedAt as string);
      setClientRequestId(crypto.randomUUID());
      setNotice("Attendee choices saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The attendee choices could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="attendee-answer-editor" onSubmit={save}>
      <div className="public-manage-card-heading">
        <span className="attendee-answer-icon"><ListChecks size={20} aria-hidden="true" /></span>
        <div>
          <p className="public-registration-eyebrow">Self-service choices</p>
          <h3>Meals, sessions and event details</h3>
          <p>{description}</p>
        </div>
      </div>

      {attendees.map((attendee) => (
        <fieldset className="attendee-answer-person" key={attendee.attendeeId}>
          <legend>{attendee.name}</legend>
          <div className="attendee-answer-grid">
            {fields.filter((field) => fieldIsVisible(field, attendee.responses)).map((field) => {
              const value = attendee.responses[field.key];
              const locked = readOnly || attendee.lockedFieldKeys?.includes(field.key) === true;
              if (field.type === "CHECKBOX") {
                return (
                  <label className="attendee-answer-check" key={field.id}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={value === true}
                      onChange={(event) => updateAnswer(
                        attendee.attendeeId,
                        field.key,
                        event.target.checked,
                      )}
                    />
                    <span><strong>{field.label}</strong>{field.helpText && <small>{field.helpText}</small>}</span>
                  </label>
                );
              }
              if (field.type === "MULTISELECT") {
                const selected = Array.isArray(value) ? value.map(String) : [];
                return (
                  <fieldset className="attendee-answer-options" disabled={locked} key={field.id}>
                    <legend>{field.label}{field.required ? " *" : ""}</legend>
                    {field.options.map((option) => (
                      <label key={option}>
                        <input
                          type="checkbox"
                          checked={selected.includes(option)}
                          onChange={(event) => updateAnswer(
                            attendee.attendeeId,
                            field.key,
                            event.target.checked
                              ? [...selected, option]
                              : selected.filter((entry) => entry !== option),
                          )}
                        />
                        {option}
                      </label>
                    ))}
                    {field.helpText && <small>{field.helpText}</small>}
                    {locked && <small>Contact the event team to change these preferences.</small>}
                  </fieldset>
                );
              }
              if (field.type === "RANKED_CHOICE") {
                const selected = Array.isArray(value) ? value.map(String) : [];
                const slots = field.maxSelections ?? 2;
                return (
                  <fieldset className="attendee-answer-ranking" disabled={locked} key={field.id}>
                    <legend>{field.label}{field.required ? " *" : ""}</legend>
                    {Array.from({ length: slots }, (_, rank) => (
                      <label key={rank}>
                        <span>{rank === 0 ? "First choice" : rank === 1 ? "Second choice" : `Choice ${rank + 1}`}</span>
                        <select
                          aria-describedby={(selected[rank]?.length ?? 0) > LONG_OPTION_LENGTH ? `${attendee.attendeeId}_${field.id}_${rank}_full` : undefined}
                          className={`field-select${selected[rank] ? "" : " is-empty"}`}
                          title={selected[rank] || undefined}
                          value={selected[rank] ?? ""}
                          required={field.required || rank < (field.minSelections ?? 0)}
                          onChange={(event) => {
                            const next = [...selected];
                            if (event.target.value) next[rank] = event.target.value;
                            else next.splice(rank, 1);
                            updateAnswer(attendee.attendeeId, field.key, next.filter(Boolean));
                          }}
                        >
                          <option value="">Choose…</option>
                          {field.options.map((option) => (
                            <option
                              value={option}
                              key={option}
                              disabled={selected.some((entry, index) => index !== rank && entry === option)}
                            >
                              {option}
                            </option>
                          ))}
                        </select>
                        {(selected[rank]?.length ?? 0) > LONG_OPTION_LENGTH && (
                          <small className="field-select-full-name" id={`${attendee.attendeeId}_${field.id}_${rank}_full`}>{selected[rank]}</small>
                        )}
                      </label>
                    ))}
                    {field.helpText && <small>{field.helpText}</small>}
                    {locked && <small>Contact the event team to change these preferences.</small>}
                  </fieldset>
                );
              }
              if (field.type === "NUMBER" || field.type === "PHONE" || field.type === "EMAIL" || field.type === "DATE") {
                const problem = typedProblem(field, attendee);
                const valueType = valueTypeForFieldType(field.type)!;
                const attributes = inputAttributesFor(valueType);
                return (
                  <label key={field.id}>
                    {field.label}
                    <input
                      type={attributes.type}
                      min={field.type === "NUMBER" ? "0" : undefined}
                      max={field.type === "NUMBER" ? "100000" : undefined}
                      disabled={locked}
                      required={field.required}
                      value={typeof value === "number" || typeof value === "string" ? value : ""}
                      aria-describedby={problem.message ? `${attendee.attendeeId}_${field.id}_error` : undefined}
                      aria-invalid={problem.message ? true : undefined}
                      inputMode={attributes.inputMode}
                      autoComplete={attributes.autoComplete}
                      onBlur={() => setTouched((current) => ({ ...current, [`${attendee.attendeeId}:${field.key}`]: true }))}
                      onChange={(event) => updateAnswer(attendee.attendeeId, field.key, event.target.value)}
                    />
                    {field.helpText && <small>{field.helpText}</small>}
                    {problem.message && <small className="field-error" id={`${attendee.attendeeId}_${field.id}_error`} role="alert">{problem.message}</small>}
                  </label>
                );
              }
              if (field.type === "ADDRESS") {
                if (locked) {
                  return (
                    <div className="amendment-locked-field" key={field.id}>
                      <small>{field.label}</small>
                      <strong>{formatAddressDisplay(value) || "Not provided"}</strong>
                    </div>
                  );
                }
                return (
                  <AddressFieldGroup
                    key={field.id}
                    idPrefix={`${attendee.attendeeId}_${field.id}`}
                    legend={<>{field.label}{field.required ? " *" : ""}</>}
                    required={field.required}
                    value={isPlainAddressObject(value) ? value as AddressValue : {}}
                    onChange={(next) => updateAnswer(attendee.attendeeId, field.key, next)}
                    helpText={field.helpText}
                  />
                );
              }
              return (
                <div className="attendee-answer-searchable-select" key={field.id}>
                  <label htmlFor={`${attendee.attendeeId}_${field.id}`}>
                    {field.label}{field.required ? " *" : ""}
                  </label>
                  {locked ? (
                    <input readOnly value={typeof value === "string" ? value : ""} />
                  ) : <SearchableSelect
                    id={`${attendee.attendeeId}_${field.id}`}
                    sheet
                    label={field.label}
                    required={field.required}
                    invalid={missingIds.includes(`${attendee.attendeeId}_${field.id}`) && value === ""}
                    describedBy={missingIds.includes(`${attendee.attendeeId}_${field.id}`) && value === "" ? `${attendee.attendeeId}_${field.id}_missing` : undefined}
                    value={typeof value === "string" ? value : ""}
                    placeholder={`Search ${field.label.toLocaleLowerCase()}…`}
                    options={field.options.map((option) => ({
                      value: option,
                      label: option,
                    }))}
                    onChange={(nextValue) => updateAnswer(
                      attendee.attendeeId,
                      field.key,
                      nextValue,
                    )}
                  />}
                  {missingIds.includes(`${attendee.attendeeId}_${field.id}`) && value === "" && (
                    <small className="form-error" id={`${attendee.attendeeId}_${field.id}_missing`}>Choose an option for {field.label}.</small>
                  )}
                  {field.helpText && <small>{field.helpText}</small>}
                  {locked && <small>Contact the event team to change this selection.</small>}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      {siteUpdating && <SubmitRetryNotice message={siteUpdating} busy={saving} onRetry={() => void save()} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-notice" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {notice}</p>}
      {!readOnly && <div className="form-actions">
        {dirty && <span className="unsaved-dot" role="status">Unsaved choices</span>}
        <button className="primary-button" type="submit" disabled={!dirty || saving}>
          <Save size={16} aria-hidden="true" /> {saving ? "Saving…" : "Save attendee choices"}
        </button>
      </div>}
    </form>
  );
}

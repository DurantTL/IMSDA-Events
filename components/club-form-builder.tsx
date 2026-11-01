"use client";

import { useConfirm } from "@/components/use-confirm";
import { useMemo, useRef, useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { useLocalEditDraft } from "@/components/use-local-edit-draft";
import { editDraftKey, LOCAL_EDIT_DRAFT_RESTORED_NOTICE } from "@/lib/local-edit-draft";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { ArrowDown, ArrowUp, EyeOff, LockKeyhole, Plus, Save, Send, Trash2 } from "lucide-react";
import {
  addField,
  addSection,
  moveField,
  moveSection,
  optionsFromText,
  removeField,
  removeSection,
  renameFieldKey,
  sectionNotesFromText,
  setFieldFlag,
  setSectionNotes,
  specSignature,
  updateField,
  updateSection,
  type FieldFlag,
} from "@/components/club-form-builder-state";
import { ClubFormRosterMapping } from "@/components/club-form-roster-mapping";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { readDraftShape, type BuilderIssue, type ClubFormDraftSpec } from "@/modules/club-forms/builder-domain";
import { conditionPhrase } from "@/modules/forms/visibility-rule";
import { conditionOperators, fieldDisplayLabel, formFieldTypes, isChoiceFieldType, type RegistrationFormField } from "@/modules/forms/definition";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

/**
 * The club form builder (#712): a desktop editor for one club form template,
 * for system administrators. It works on the form's definition only and never
 * receives a submission or an answer. Changes stay in a draft until Publish,
 * which creates the next version; the server validates every save and publish
 * and answers with field-level issues.
 */

export type ClubFormBuilderProps = {
  templateKey: string;
  version: number;
  enabled: boolean;
  submissionCount: number;
  initial: ClubFormDraftSpec;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  /** Problems the stored draft already has: shown inline, and publish refuses until they are fixed. */
  draftWarnings?: BuilderIssue[];
  lockedSensitiveKeys: string[];
  lockedBirthDateKeys: string[];
  /** Keys that existed in the published version: their key text cannot change. */
  publishedKeys: string[];
  versions: Array<{ version: number; recordedAt: string }>;
};

const typeLabels: Record<string, string> = {
  TEXT: "Short text",
  LONG_TEXT: "Long text",
  EMAIL: "Email",
  PHONE: "Phone",
  SELECT: "Drop-down",
  RADIO: "Choose one (buttons)",
  MULTISELECT: "Choose several",
  RANKED_CHOICE: "Ranked choice",
  CHECKBOX: "Checkbox",
  DATE: "Date",
  NUMBER: "Number",
  ADDRESS: "Address",
};
// Club forms do not use calculated fields.
const clubFieldTypes = formFieldTypes.filter((type) => type !== "CALCULATED" && type !== "ACKNOWLEDGMENT" && type !== "SIGNATURE");

const operatorLabels: Record<string, string> = {
  EQUALS: "is",
  NOT_EQUALS: "is not",
  INCLUDES: "includes",
  NOT_EMPTY: "is answered",
};

const sourceLabels: Record<string, string> = {
  "": "Typed choices",
  CHURCHES_DIRECTORY: "Churches directory",
  CLUBS_DIRECTORY: "Clubs directory",
  SCHOOLS_DIRECTORY: "Schools directory",
};

type Mutator = (spec: ClubFormDraftSpec) => ClubFormDraftSpec;

export function ClubFormBuilder(props: ClubFormBuilderProps) {
  const [spec, setSpec] = useState<ClubFormDraftSpec>(props.initial);
  const [saved, setSaved] = useState(() => specSignature(props.initial));
  const [draftStamp, setDraftStamp] = useState(props.hasDraft ? props.draftUpdatedAt : null);
  const [hasDraft, setHasDraft] = useState(props.hasDraft);
  const [issues, setIssues] = useState<BuilderIssue[]>(props.draftWarnings ?? []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const dirty = specSignature(spec) !== saved;
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);
  const retryRef = useRef<(() => void) | null>(null);
  // Unsaved edits are backed up in this browser and come back after a reload (#1263).
  const editBackup = useLocalEditDraft({
    storageKey: editDraftKey("club-form-builder", props.templateKey),
    version: String(props.version),
    value: spec,
    dirty,
    onRestore: (stored) => {
      const restored = readDraftShape(stored);
      if (!restored) return false;
      setSpec(restored);
      return true;
    },
  });
  const allowNavigation = useUnsavedChangesGuard(dirty, "You have unsaved changes to this form. Leave this page and discard them?");
  const lockedSensitive = useMemo(() => new Set(props.lockedSensitiveKeys), [props.lockedSensitiveKeys]);
  const lockedBirth = useMemo(() => new Set(props.lockedBirthDateKeys), [props.lockedBirthDateKeys]);
  const published = useMemo(() => new Set(props.publishedKeys), [props.publishedKeys]);
  const hasSubmissions = props.submissionCount > 0;
  const allFieldList = spec.definition.sections.flatMap((section) => section.fields);

  const issuesFor = (key: string) => issues.filter((issue) => issue.key === key);
  const unplaced = issues.filter((issue) => issue.key === "template" || issue.key.startsWith("removed:"));

  function edit(change: Mutator) {
    setSpec((current) => change(current));
    setMessage("");
  }

  async function call(url: string, init: RequestInit & { method: "PUT" | "POST" | "DELETE" }, retry: () => void) {
    setBusy(true);
    setError("");
    setMessage("");
    setSiteUpdating(false);
    try {
      const response = await submitJson(url, typeof init.body === "string" ? JSON.parse(init.body) : undefined, { method: init.method });
      if (response.unavailable) {
        // The site is restarting: the edits stay as they are, nothing reloads, and Try again re-runs this save (#1263).
        retryRef.current = retry;
        setSiteUpdating(unavailableMessage(response));
        return null;
      }
      const result = response.body as { message?: string; issues?: BuilderIssue[] } & Record<string, unknown>;
      if (!response.ok) {
        setIssues(result.issues ?? []);
        setError(result.message ?? "That could not be completed.");
        return null;
      }
      setIssues([]);
      return result;
    } catch {
      setError("That could not be completed. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/admin/club-forms/${encodeURIComponent(props.templateKey)}`;

  /** Saves the draft, unfinished or not. Returns null when the save failed, else the problems still to fix before publishing. */
  async function saveDraft() {
    setSaving(true);
    const result = await call(`${base}/draft`, {
      method: "PUT",
      body: JSON.stringify({ draft: spec, baseVersion: props.version, expectedDraftUpdatedAt: draftStamp }),
    }, () => void saveDraft()).finally(() => setSaving(false));
    if (!result) {
      setError((current) => (current ? notSavedMessage(current) : current));
      return null;
    }
    const warnings = Array.isArray(result.warnings) ? result.warnings as BuilderIssue[] : [];
    setSaved(specSignature(spec));
    setHasDraft(true);
    // Saved on the server: the "restored" notice and its Discard (back to the loaded spec) no longer apply.
    editBackup.dismiss();
    setIssues(warnings);
    setDraftStamp(typeof result.draftUpdatedAt === "string" ? result.draftUpdatedAt : null);
    setMessage(warnings.length > 0
      ? savedMessage(`${warnings.length} thing${warnings.length === 1 ? "" : "s"} to fix before it can be published. Clubs still see the published version.`)
      : savedMessage("Clubs still see the published version until you publish."));
    return warnings;
  }

  async function publish() {
    if (dirty) {
      const warnings = await saveDraft();
      if (!warnings || warnings.length > 0) return;
    } else if (issues.length > 0) {
      setError("Fix the problems shown before publishing.");
      return;
    }
    if (!(await askConfirm({
      title: `Publish version ${props.version + 1}`,
      body: <p>New fills will use it right away. Forms already filled in keep the version they were filled in on.</p>,
      confirmLabel: `Publish version ${props.version + 1}`,
    }))) return;
    await runPublish();
  }

  async function runPublish() {
    const result = await call(`${base}/publish`, { method: "POST", body: JSON.stringify({ baseVersion: props.version }) }, () => void runPublish());
    if (!result) return;
    allowNavigation();
    window.location.reload();
  }

  async function discard() {
    if (!(await askConfirm({
      title: "Discard this draft",
      body: <p>{`Every unpublished change in this draft is lost. The published version (version ${props.version}) is not changed.`}</p>,
      confirmLabel: "Discard draft",
      destructive: true,
    }))) return;
    const result = await call(`${base}/draft`, { method: "DELETE" }, () => void discard());
    if (!result) return;
    allowNavigation();
    window.location.reload();
  }

  const flagOn = (key: string, flag: FieldFlag) => {
    if (flag === "sensitive") return spec.sensitiveFieldKeys.includes(key);
    if (flag === "birthDate") return spec.birthDateFieldKeys.includes(key);
    if (flag === "staffOnly") return spec.staffOnlyFieldKeys.includes(key);
    return spec.hiddenFieldKeys.includes(key);
  };

  const { confirm: askConfirm, confirmDialog } = useConfirm();
  return (
    <div className="club-form-builder form-stack">
      {confirmDialog}
      <section className="panel form-stack">
        <div className="intro-actions">
          <SubmitButton className="primary-button" disabled={busy || !dirty} icon={<Save aria-hidden="true" size={14} />} iconSize={14} label="Save draft" onClick={() => void saveDraft()} submitting={saving} submittingLabel="Saving…" />
          <button className="secondary-button" disabled={busy || (!hasDraft && !dirty)} onClick={() => void publish()} type="button">
            <Send aria-hidden="true" size={14} /> Publish version {props.version + 1}
          </button>
          {hasDraft && <button className="text-button" disabled={busy} onClick={() => void discard()} type="button">Discard draft</button>}
          <small className="quiet-copy">
            Published version {props.version} · {props.enabled ? "on" : "off"} · {props.submissionCount} filled in
            {dirty ? " · unsaved changes" : hasDraft ? " · saved" : ""}
          </small>
        </div>
        {editBackup.restored && (
          <div className="form-notice draft-restored-notice" role="status">
            <span>{LOCAL_EDIT_DRAFT_RESTORED_NOTICE}</span>
            <button className="secondary-button" type="button" onClick={() => { editBackup.discard(); setSpec(props.initial); }}>Discard</button>
          </div>
        )}
        {siteUpdating && <SubmitRetryNotice message={siteUpdating} busy={busy} onRetry={() => retryRef.current?.()} />}
        {error ? <FormMessage message={error} tone="error" /> : message ? <FormMessage message={message} tone="success" /> : null}
        {unplaced.length > 0 && (
          <ul className="club-report-problem" role="alert">
            {unplaced.map((issue, index) => <li key={`${issue.key}-${index}`}>{issue.message}</li>)}
          </ul>
        )}
      </section>

      <section className="panel form-stack">
        <h3>Form details</h3>
        <div className="form-grid two-column">
          <label>Name
            <input autoComplete="off" name="builder-cb-field-1" maxLength={120} onChange={(event) => edit((s) => ({ ...s, name: event.target.value }))} value={spec.name} />
          </label>
          <label>Title shown on the form
            <input autoComplete="off" name="builder-cb-field-2" maxLength={120} onChange={(event) => edit((s) => ({ ...s, definition: { ...s.definition, title: event.target.value } }))} value={spec.definition.title} />
          </label>
          <label>Description
            <input autoComplete="off" name="builder-cb-field-3" maxLength={300} onChange={(event) => edit((s) => ({ ...s, description: event.target.value }))} value={spec.description} />
          </label>
          <label>Message after a private-link submit
            <input autoComplete="off" name="builder-cb-field-4" maxLength={500} onChange={(event) => edit((s) => ({ ...s, definition: { ...s.definition, confirmationMessage: event.target.value } }))} value={spec.definition.confirmationMessage} />
          </label>
          <label>Sort order
            <input max={10000} min={0} onChange={(event) => edit((s) => ({ ...s, sortOrder: Number(event.target.value) || 0 }))} type="number" value={spec.sortOrder} />
          </label>
          <label>Print layout
            <select onChange={(event) => edit((s) => ({ ...s, printLayout: event.target.value === "PASSENGER_LIST" ? "PASSENGER_LIST" : "STANDARD" }))} value={spec.printLayout}>
              <option value="STANDARD">Standard</option>
              <option value="PASSENGER_LIST">Passenger list (roll call)</option>
            </select>
          </label>
        </div>
      </section>

      {spec.definition.sections.map((section, sectionIndex) => {
        const lockedHere = hasSubmissions && section.fields.some((field) => lockedSensitive.has(field.key) || lockedBirth.has(field.key));
        return (
          <section className="panel form-stack" key={section.id} aria-label={`Section ${sectionIndex + 1}`}>
            <div className="intro-actions">
              <h3>{`Section ${sectionIndex + 1}`}</h3>
              <button aria-label="Move section up" className="text-button" disabled={sectionIndex === 0} onClick={() => edit((s) => moveSection(s, section.id, -1))} type="button"><ArrowUp aria-hidden="true" size={14} /></button>
              <button aria-label="Move section down" className="text-button" disabled={sectionIndex === spec.definition.sections.length - 1} onClick={() => edit((s) => moveSection(s, section.id, 1))} type="button"><ArrowDown aria-hidden="true" size={14} /></button>
              <button
                className="text-button"
                disabled={lockedHere || spec.definition.sections.length === 1}
                onClick={() => edit((s) => removeSection(s, section.id))}
                title={lockedHere ? "This section has a sensitive field that cannot be deleted. Hide the field instead." : undefined}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} /> Remove section
              </button>
            </div>
            {issuesFor(`section:${section.id}`).map((issue, index) => <small className="club-report-problem" key={index} role="alert">{issue.message}</small>)}
            <div className="form-grid two-column">
              <label>Section title
                <input autoComplete="off" name="builder-cb-field-5" maxLength={120} onChange={(event) => edit((s) => updateSection(s, section.id, { title: event.target.value }))} value={section.title} />
              </label>
              <label>Section description
                <input autoComplete="off" name="builder-cb-field-6" maxLength={500} onChange={(event) => edit((s) => updateSection(s, section.id, { description: event.target.value }))} value={section.description} />
              </label>
            </div>
            <label>Notes shown above the questions (separate paragraphs with a blank line)
              <textarea autoComplete="off" name="builder-cb-note-7"
                defaultValue={(spec.sectionNotes[section.id] ?? []).join("\n\n")}
                key={`${section.id}-notes`}
                onBlur={(event) => edit((s) => setSectionNotes(s, section.id, sectionNotesFromText(event.target.value)))}
                rows={4}
              />
            </label>

            <ol className="form-stack">
              {section.fields.map((field, fieldIndex) => (
                <FieldEditor
                  allFields={allFieldList}
                  edit={edit}
                  expanded={expanded === field.id}
                  field={field}
                  fieldIndex={fieldIndex}
                  fieldCount={section.fields.length}
                  flagOn={flagOn}
                  hasSubmissions={hasSubmissions}
                  issues={issuesFor(`field:${field.id}`)}
                  key={field.id}
                  keyLocked={published.has(field.key)}
                  lockedBirth={lockedBirth.has(field.key)}
                  lockedSensitive={lockedSensitive.has(field.key)}
                  onToggle={() => setExpanded(expanded === field.id ? null : field.id)}
                  sectionId={section.id}
                />
              ))}
            </ol>
            <div>
              <button className="secondary-button" onClick={() => edit((s) => addField(s, section.id))} type="button"><Plus aria-hidden="true" size={14} /> Add a question</button>
            </div>
          </section>
        );
      })}

      <div>
        <button className="secondary-button" onClick={() => edit((s) => addSection(s))} type="button"><Plus aria-hidden="true" size={14} /> Add a section</button>
      </div>

      <ClubFormRosterMapping edit={edit} issues={issuesFor("rosterMapping")} spec={spec} />

      <section className="panel">
        <h3>Versions</h3>
        <p className="field-help">Every published version is kept. A form that was filled in shows, prints and exports on the version it was filled in on.</p>
        <ul>
          {props.versions.map((entry) => (
            <li key={entry.version}>{`Version ${entry.version}${entry.version === props.version ? " (current)" : ""} · recorded ${formatInConferenceTime(entry.recordedAt)}`}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FieldEditor({
  field,
  fieldIndex,
  fieldCount,
  sectionId,
  allFields,
  edit,
  expanded,
  onToggle,
  issues,
  flagOn,
  keyLocked,
  lockedSensitive,
  lockedBirth,
  hasSubmissions,
}: {
  field: RegistrationFormField;
  fieldIndex: number;
  fieldCount: number;
  sectionId: string;
  allFields: RegistrationFormField[];
  edit: (change: Mutator) => void;
  expanded: boolean;
  onToggle: () => void;
  issues: BuilderIssue[];
  flagOn: (key: string, flag: FieldFlag) => boolean;
  keyLocked: boolean;
  lockedSensitive: boolean;
  lockedBirth: boolean;
  hasSubmissions: boolean;
}) {
  const sensitive = flagOn(field.key, "sensitive");
  const birth = flagOn(field.key, "birthDate");
  const staffOnly = flagOn(field.key, "staffOnly");
  const hidden = flagOn(field.key, "hidden");
  const choice = isChoiceFieldType(field.type);
  const ranged = field.type === "MULTISELECT" || field.type === "RANKED_CHOICE";
  const cannotDelete = hasSubmissions && (lockedSensitive || lockedBirth);
  const others = allFields.filter((candidate) => candidate.key !== field.key);
  const flag = (name: FieldFlag, on: boolean) => edit((s) => setFieldFlag(s, field.id, name, on));

  return (
    <li className={`panel form-stack${issues.length > 0 ? " has-error" : ""}`}>
      <div className="intro-actions">
        <button aria-expanded={expanded} className="text-button" onClick={onToggle} type="button">
          <strong>{field.label ? fieldDisplayLabel(field) : "(no label)"}</strong>
          <small className="quiet-copy"> · {typeLabels[field.type] ?? field.type}{field.required ? " · required" : ""}</small>
        </button>
        {sensitive && <small className="quiet-copy"><LockKeyhole aria-hidden="true" size={12} /> {birth ? "Birth date, sealed" : "Sensitive, sealed"}</small>}
        {staffOnly && <small className="quiet-copy">Staff only</small>}
        {hidden && <small className="quiet-copy"><EyeOff aria-hidden="true" size={12} /> Hidden from new forms</small>}
        <button aria-label="Move question up" className="text-button" disabled={fieldIndex === 0} onClick={() => edit((s) => moveField(s, sectionId, field.id, -1))} type="button"><ArrowUp aria-hidden="true" size={14} /></button>
        <button aria-label="Move question down" className="text-button" disabled={fieldIndex === fieldCount - 1} onClick={() => edit((s) => moveField(s, sectionId, field.id, 1))} type="button"><ArrowDown aria-hidden="true" size={14} /></button>
        <button
          className="text-button"
          disabled={cannotDelete}
          onClick={() => edit((s) => removeField(s, field.id))}
          title={cannotDelete ? "This field holds sealed answers. Hide it from new forms instead." : undefined}
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} /> Remove
        </button>
      </div>
      {issues.map((issue, index) => <small className="club-report-problem" key={index} role="alert">{issue.message}</small>)}
      {cannotDelete && <small className="quiet-copy">This field was sensitive in a published version and forms have been filled in, so it cannot be deleted. Hide it from new forms instead.</small>}

      {expanded && (
        <div className="form-stack">
          <div className="form-grid two-column">
            <label>Question
              <input autoComplete="off" name="builder-cb-field-8" maxLength={120} onChange={(event) => edit((s) => updateField(s, field.id, { label: event.target.value }))} value={field.label} />
            </label>
            <label>Answer type
              <select onChange={(event) => edit((s) => updateField(s, field.id, { type: event.target.value as RegistrationFormField["type"] }))} value={field.type}>
                {clubFieldTypes.map((type) => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}
              </select>
            </label>
            <label>Help text
              <input autoComplete="off" name="builder-cb-field-9" maxLength={500} onChange={(event) => edit((s) => updateField(s, field.id, { helpText: event.target.value }))} value={field.helpText} />
            </label>
            <label>Field key (letters, numbers, underscores)
              <input autoComplete="off" name="builder-cb-field-10"
                disabled={keyLocked}
                maxLength={60}
                onChange={(event) => edit((s) => renameFieldKey(s, field.id, event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")))}
                title={keyLocked ? "A key that is in a published version cannot change." : undefined}
                value={field.key}
              />
            </label>
          </div>

          {choice && (
            <>
              {(field.type === "SELECT" || field.type === "RADIO") && (
                <label>Where the choices come from
                  <select
                    onChange={(event) => edit((s) => updateField(s, field.id, { optionSource: (event.target.value || undefined) as RegistrationFormField["optionSource"] }))}
                    value={field.optionSource && field.optionSource !== "ATTENDEE_TYPES" ? field.optionSource : ""}
                  >
                    {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              )}
              <label>Choices (one per line)
                <textarea autoComplete="off" name="builder-cb-note-11"
                  defaultValue={field.options.join("\n")}
                  key={`${field.id}-options`}
                  onBlur={(event) => edit((s) => updateField(s, field.id, { options: optionsFromText(event.target.value) }))}
                  rows={5}
                />
              </label>
            </>
          )}
          {ranged && (
            <div className="form-grid two-column">
              <label>{field.type === "RANKED_CHOICE" ? "Fewest choices to rank" : "Fewest choices"}
                <input
                  max={10}
                  min={1}
                  onChange={(event) => edit((s) => updateField(s, field.id, { minSelections: event.target.value ? Number(event.target.value) : undefined }))}
                  type="number"
                  value={field.minSelections ?? ""}
                />
              </label>
              <label>{field.type === "RANKED_CHOICE" ? "Most choices to rank" : "Most choices"}
                <input
                  max={10}
                  min={1}
                  onChange={(event) => edit((s) => updateField(s, field.id, { maxSelections: event.target.value ? Number(event.target.value) : undefined }))}
                  type="number"
                  value={field.maxSelections ?? ""}
                />
              </label>
            </div>
          )}

          <fieldset className="form-stack">
            <legend>Show only when</legend>
            {field.conditionalGroup && (
              <div className="form-stack" data-testid="club-form-group-rule">
                <p>{field.conditionalGroup.match === "ANY" ? "Shown when any of these is true" : "Shown when all of these are true"}: {field.conditionalGroup.conditions.map((condition) => conditionPhrase(condition, (key) => others.find((other) => other.key === key)?.label)).join("; ")}.</p>
                <p className="fb-hint">This rule has several conditions, which are edited in the event form builder. You can remove it here.</p>
                <button className="secondary-button" type="button" onClick={() => edit((s) => updateField(s, field.id, { conditional: undefined, conditionalGroup: undefined }))}>Remove rule</button>
              </div>
            )}
            {!field.conditionalGroup && <div className="form-grid two-column">
              <label>Another question
                <select
                  onChange={(event) => edit((s) => updateField(s, field.id, { conditionalGroup: undefined, conditional: event.target.value ? { fieldKey: event.target.value, operator: field.conditional?.operator ?? "EQUALS", value: field.conditional?.value ?? "" } : undefined }))}
                  value={field.conditional?.fieldKey ?? ""}
                >
                  <option value="">Always show</option>
                  {others.map((other) => <option key={other.id} value={other.key}>{other.label || other.key}</option>)}
                </select>
              </label>
              {field.conditional && (
                <>
                  <label>Condition
                    <select
                      onChange={(event) => edit((s) => updateField(s, field.id, { conditional: field.conditional && { ...field.conditional, operator: event.target.value as typeof conditionOperators[number] } }))}
                      value={field.conditional.operator}
                    >
                      {conditionOperators.map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}
                    </select>
                  </label>
                  {field.conditional.operator !== "NOT_EMPTY" && (
                    <label>Value
                      <input autoComplete="off" name="builder-cb-field-12" maxLength={120} onChange={(event) => edit((s) => updateField(s, field.id, { conditional: field.conditional && { ...field.conditional, value: event.target.value } }))} value={field.conditional.value} />
                    </label>
                  )}
                </>
              )}
            </div>}
          </fieldset>

          <fieldset className="form-stack">
            <legend>Settings</legend>
            <label className="checkbox-row"><input checked={field.required} onChange={(event) => flag("required", event.target.checked)} type="checkbox" /> Required</label>
            {field.type === "DATE" && (
              <label className="checkbox-row">
                <input checked={field.autoDate === "TODAY"} onChange={(event) => edit((s) => updateField(s, field.id, { autoDate: event.target.checked ? "TODAY" : undefined }))} type="checkbox" /> Fill in today&apos;s date automatically (read-only on a private link; a director can change it)
              </label>
            )}
            <label className="checkbox-row">
              <input checked={staffOnly} disabled={lockedSensitive} onChange={(event) => flag("staffOnly", event.target.checked)} type="checkbox" /> Staff only (office use; a private-link filler never sees it)
            </label>
            <label className="checkbox-row">
              <input checked={sensitive} disabled={lockedSensitive} onChange={(event) => flag("sensitive", event.target.checked)} type="checkbox" />
              Sensitive (answers are sealed and left out of exports){lockedSensitive ? " · locked: it was sensitive in a published version" : ""}
            </label>
            <label className="checkbox-row">
              <input checked={birth} disabled={lockedBirth} onChange={(event) => flag("birthDate", event.target.checked)} type="checkbox" />
              Birth date (only the club&apos;s director and deputies and system administrators can read it){lockedBirth ? " · locked: it was a birth date in a published version" : ""}
            </label>
            <label className="checkbox-row">
              <input checked={hidden} onChange={(event) => flag("hidden", event.target.checked)} type="checkbox" /> Hide from new forms (old forms keep their answers)
            </label>
          </fieldset>
        </div>
      )}
    </li>
  );
}

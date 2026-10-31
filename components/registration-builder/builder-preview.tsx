// Preview zone: the live public-form preview, the order summary and the
// Run test submission button.
import { pluralAttendeeLabel } from "@/modules/forms/attendee-label";
import { useEffect, useRef } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ClipboardCheck, Plus, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { AddressFieldGroup } from "@/components/address-field-group";
import { SearchableSelect } from "@/components/searchable-select";
import type { AddressValue } from "@/modules/forms/address";
import { getAvailabilityMode, isFieldVisible, isLatePricingActive, type RegistrationFormField } from "@/modules/forms/definition";
import { type PreviewValue, localId } from "./builder-types";
import { formatCents } from "@/modules/payments/format-cents";
import { useLoadedBuilder } from "./builder-context";
import { fieldlessIssues, lastFailedTestReasons, nextContinueBlock, previewStepIssues } from "./preview-continue";

export function BuilderPreview() {
  const { selectedVersion, definition, responses, setResponses, previewAttendees, setPreviewAttendees, dirty, busy, testIssues, setTestIssues, setTestIssuesRaw, continueBlock, setContinueBlock, pricingPreviewDate, setPreviewStepId, previewRef, policyVersions, roster, calculation, previewSteps, previewStepIndex, previewStep, isHistorical, hasValidTest, testRequired, runTest, eventName, information } = useLoadedBuilder();
  const stepIssues = (step: NonNullable<typeof previewStep>) => previewStepIssues({ definition, roster, responses, attendees: previewAttendees, choiceUsage: selectedVersion.choiceUsage ?? {}, step });
  const currentStepId = previewStep?.id ?? null;
  const blockedRef = useRef(continueBlock);
  const stepIssuesRef = useRef(stepIssues);
  useEffect(() => { blockedRef.current = continueBlock; stepIssuesRef.current = stepIssues; });
  // While Continue is blocked, fixing an answer clears that question's issue; the rest stay until fixed or the step is left.
  // A test run or any reset ends the block (setTestIssues), so this never overwrites a test run's issues.
  useEffect(() => {
    const current = blockedRef.current;
    if (!current) return;
    // Leaving the blocked step any way (including the top bar's test-panel link) ends the block.
    const step = current.stepId === currentStepId
      ? previewSteps.find((candidate) => candidate.id === current.stepId)
      : undefined;
    const remaining = step ? stepIssuesRef.current(step) : [];
    if (remaining.length === 0) setTestIssues([]);
    else setTestIssuesRaw(remaining);
  }, [responses, previewAttendees, previewSteps, currentStepId, setTestIssues, setTestIssuesRaw]);
  function goToPreviewStep(stepId: string) {
    if (continueBlock) setTestIssues([]);
    setPreviewStepId(stepId);
  }
  function continuePreview() {
    if (!previewStep) return;
    const issues = stepIssues(previewStep);
    if (issues.length > 0) {
      setTestIssuesRaw(issues);
      setContinueBlock(nextContinueBlock(continueBlock, previewStep));
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const target = previewRef.current?.querySelector<HTMLElement>(".preview-field.invalid, fieldset.invalid");
        const focusable = target?.matches("input, textarea, select, button") ? target : target?.querySelector<HTMLElement>("input:not([disabled]), textarea, select, button:not([disabled])");
        // No invalid field (for example only the attendee count): focus the alert, which names the problem.
        (focusable ?? previewRef.current?.querySelector<HTMLElement>(".preview-test-alert"))?.focus();
      }));
      return;
    }
    goToPreviewStep(previewSteps[previewStepIndex + 1]!.id);
  }
  function renderPreviewField(
    field: RegistrationFormField,
    options: {
      valueResponses?: Record<string, PreviewValue>;
      idPrefix?: string;
      attendeeIndex?: number | null;
      onChange?: (key: string, value: PreviewValue) => void;
    } = {},
  ) {
    const valueResponses = options.valueResponses ?? responses;
    const attendeeIndex = options.attendeeIndex ?? null;
    const issue = testIssues.find((item) => item.key === field.key && (item.attendeeIndex ?? null) === attendeeIndex);
    const className = issue ? "preview-field invalid" : "preview-field";
    const inputId = `preview_${options.idPrefix ?? "registration"}_${field.id}`;
    const selectedValues = Array.isArray(valueResponses[field.key]) ? valueResponses[field.key] as string[] : [];
    const maximum = field.maxSelections ?? (field.type === "RANKED_CHOICE" ? 2 : field.options.length);
    const setValue = (value: PreviewValue) => {
      if (options.onChange) options.onChange(field.key, value);
      else setResponses((current) => ({ ...current, [field.key]: value }));
    };
    const toggleChoice = (option: string) => {
      if (selectedValues.includes(option)) setValue(selectedValues.filter((value) => value !== option));
      else if (selectedValues.length < maximum) setValue([...selectedValues, option]);
    };
    const fieldHeading = <span>{field.label}{field.required && <b> *</b>}</span>;
    const supportingText = <>{field.helpText && <small>{field.helpText}</small>}{issue && <small className="field-error">{issue.message}</small>}</>;
    const choiceStatus = (option: string) => {
      const stats = selectedVersion?.choiceUsage?.[field.key]?.[option] ?? { total: 0, first: 0, second: 0 };
      const limit = field.choiceLimits?.[option];
      return { stats, limit, full: Boolean(limit && stats.total >= limit) };
    };
    const choiceCount = (option: string, ranked = false) => {
      const { stats, limit, full } = choiceStatus(option);
      const tracksAvailability = getAvailabilityMode(field) !== "NONE";
      const price = isLatePricingActive(field, pricingPreviewDate) ? field.latePricing?.choicePricesCents?.[option] ?? field.choicePricesCents?.[option] : field.choicePricesCents?.[option];
      if (price === undefined && !tracksAvailability) return null;
      return <small className={full ? "choice-availability full" : "choice-availability"}>{price !== undefined && <>{formatCents(price)}{tracksAvailability ? " · " : ""}</>}{tracksAvailability && <>{ranked && <>{stats.first} first · {stats.second} second · </>}{stats.total} interested{limit ? ` · limit ${limit}` : " · unlimited"}</>}</small>;
    };
    const choiceDescription = (option: string) => {
      const description = field.optionDescriptions?.[option]?.trim();
      return description
        ? <small className="choice-description">{description}</small>
        : null;
    };
    const optionLabel = (option: string) => field.optionLabels?.[option] ?? option;

    if (field.type === "RADIO") return <fieldset className={className} key={field.id}><legend>{fieldHeading}</legend><div className="preview-choice-list">{field.options.map((option) => { const { full } = choiceStatus(option); return <label className={full ? "preview-option full" : "preview-option"} key={option}><input name={inputId} type="radio" checked={valueResponses[field.key] === option} disabled={full && valueResponses[field.key] !== option} onChange={() => setValue(option)} /> <span><strong>{optionLabel(option)}</strong>{choiceDescription(option)}{choiceCount(option)}</span></label>; })}</div>{supportingText}</fieldset>;
    if (field.type === "MULTISELECT") return <fieldset className={className} key={field.id}><legend>{fieldHeading}</legend><small>Choose {field.minSelections ? `at least ${field.minSelections} and ` : ""}up to {maximum}</small><div className="preview-choice-list">{field.options.map((option) => { const { full } = choiceStatus(option); return <label className={full ? "preview-option full" : "preview-option"} key={option}><input type="checkbox" checked={selectedValues.includes(option)} disabled={!selectedValues.includes(option) && (selectedValues.length >= maximum || full)} onChange={() => toggleChoice(option)} /> <span><strong>{option}</strong>{choiceDescription(option)}{choiceCount(option)}</span></label>; })}</div>{supportingText}</fieldset>;
    if (field.type === "RANKED_CHOICE") return <fieldset className={className} key={field.id}><legend>{fieldHeading}</legend><small>Choose {field.minSelections ?? (field.required ? Math.min(2, maximum) : 1)} and rank up to {maximum}. The first selected is first choice; the second is second choice.</small><div className="preview-ranking-list">{field.options.map((option) => { const rank = selectedValues.indexOf(option); const { full } = choiceStatus(option); return <button aria-pressed={rank >= 0} className={`${rank >= 0 ? "selected" : ""}${full ? " full" : ""}`.trim()} type="button" key={option} disabled={rank < 0 && (selectedValues.length >= maximum || full)} onClick={() => toggleChoice(option)}><span><strong>{option}</strong>{choiceDescription(option)}{choiceCount(option, true)}</span><b>{rank >= 0 ? (rank === 0 ? "1st choice" : rank === 1 ? "2nd choice" : `#${rank + 1}`) : full ? "Full" : "Choose"}</b></button>; })}</div>{supportingText}</fieldset>;
    if (field.type === "ACKNOWLEDGMENT") {
      const config = field.acknowledgment;
      const shown = config?.source === "POLICY_VERSION" ? policyVersions.versions.find((version) => version.id === config.policyVersionId) : undefined;
      return <fieldset className={className} key={field.id}><legend>{fieldHeading}</legend><div className="preview-acknowledgment-text">{config?.source === "TEXT" ? <p>{config.text || "Enter the wording people acknowledge."}</p> : <p>{shown ? `${shown.policy.name}, version ${shown.versionNumber}: ${shown.title}. Registrants read the full published wording here.` : "Choose a published policy version."}</p>}</div><label className="preview-check"><input id={inputId} type="checkbox" checked={valueResponses[field.key] === true} onChange={(event) => setValue(event.target.checked)} /> <span>I acknowledge this.</span></label><small>Preview only: nothing is recorded.</small>{supportingText}</fieldset>;
    }
    if (field.type === "SIGNATURE") {
      const nameValue = typeof valueResponses[field.key] === "string" ? valueResponses[field.key] as string : "";
      return <fieldset className={className} key={field.id}><legend>{fieldHeading}</legend><div className="preview-acknowledgment-text"><p>{field.signature?.text || "Enter the statement people sign."}</p></div><label className="preview-field">Type your full name to sign<input id={inputId} type="text" autoComplete="name" value={nameValue} onChange={(event) => setValue(event.target.value)} /></label><small>Preview only: nothing is recorded.</small>{supportingText}</fieldset>;
    }
    if (field.type === "CHECKBOX") return <fieldset className={className} key={field.id}><legend>{fieldHeading}</legend><label className="preview-check"><input id={inputId} type="checkbox" checked={valueResponses[field.key] === true} onChange={(event) => setValue(event.target.checked)} /> <span>{field.placeholder || "Yes, I agree"}</span></label>{supportingText}</fieldset>;
    if (field.type === "CALCULATED") return <div className="preview-field preview-calculated-field" key={field.id}><span>{field.label}</span><small>Automatically included in the order total.{field.latePricing ? ` ${field.latePricing.label} begins ${new Date(`${field.latePricing.startsOn}T12:00:00`).toLocaleDateString()}.` : ""}</small></div>;
    if (field.type === "ADDRESS") return <AddressFieldGroup key={field.id} className={className} legend={fieldHeading} idPrefix={inputId} required={field.required} invalid={Boolean(issue)} value={(valueResponses[field.key] as AddressValue | undefined) ?? {}} onChange={(next) => setValue(next)} helpText={field.helpText} supporting={issue && <small className="field-error">{issue.message}</small>} />;
    if (field.type === "SELECT") return <div className={className} key={field.id}><label htmlFor={inputId}>{fieldHeading}</label><SearchableSelect id={inputId} sheet label={field.label} value={typeof valueResponses[field.key] === "string" ? valueResponses[field.key] as string : ""} required={field.required} invalid={Boolean(issue)} placeholder={`Search ${field.label.toLocaleLowerCase()}…`} options={field.options.map((option) => ({ value: option, label: optionLabel(option), disabled: choiceStatus(option).full && valueResponses[field.key] !== option }))} onChange={(value) => setValue(value)} />{supportingText}</div>;

    const common = { id: inputId, value: typeof valueResponses[field.key] === "string" ? valueResponses[field.key] as string : "", placeholder: field.placeholder ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValue(event.target.value) };
    return <label className={className} key={field.id}>{fieldHeading}{field.type === "LONG_TEXT" ? <textarea {...common} rows={4} /> : <input {...common} type={field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : field.type === "DATE" ? "date" : field.type === "NUMBER" ? "number" : "text"} />}{supportingText}</label>;
  }

  function setPreviewAttendeeValue(clientId: string, key: string, value: PreviewValue) {
    setPreviewAttendees((current) => current.map((attendee) => attendee.clientId === clientId
      ? { ...attendee, responses: { ...attendee.responses, [key]: value } }
      : attendee));
  }

  function movePreviewAttendee(index: number, direction: -1 | 1) {
    setPreviewAttendees((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function renderPreviewSections(allowedFieldKeys: ReadonlySet<string>) {
    if (!definition || !previewStep?.sectionId) return null;
    const section = definition.sections.find((candidate) => (
      candidate.id === previewStep.sectionId
    ));
    if (!section) return null;
    const visibleFields = section.fields.filter((field) => (
      allowedFieldKeys.has(field.key)
      && (!roster?.enabled || field.scope === "REGISTRATION")
      && isFieldVisible(field, responses)
    ));
    return visibleFields.length > 0 && (
      <section className="preview-linked-section" aria-label={section.title}>
        {visibleFields.map((field) => renderPreviewField(field))}
      </section>
    );
  }

  function renderPreviewRoster(allowedFieldKeys: ReadonlySet<string>) {
    if (!definition || !roster?.enabled || !previewStep?.sectionId) return null;
    const stepSection = definition.sections.find((section) => (
      section.id === previewStep.sectionId
    ));
    const hasAllowedAttendeeFields = stepSection?.fields.some((field) => (
        field.scope === "ATTENDEE" && allowedFieldKeys.has(field.key)
    ));
    if (!hasAllowedAttendeeFields) return null;

    return <section className="preview-roster">
      <div className="preview-roster-heading">
        <span>
          <h4>{previewStep.managesAttendees ? "Who is attending?" : "Choices for each attendee"}</h4>
          <small>{previewAttendees.length} of {roster.maxAttendees} {pluralAttendeeLabel(roster.attendeeLabel, roster.maxAttendees)}</small>
        </span>
      </div>
      {previewAttendees.map((attendee, attendeeIndex) => {
        const merged = { ...responses, ...attendee.responses };
        const enteredName = `${String(attendee.responses.first_name ?? "")} ${String(attendee.responses.last_name ?? "")}`.trim()
          || String(attendee.responses.attendee_name ?? attendee.responses.guest_name ?? "");
        return <article className="preview-attendee-card" key={attendee.clientId}>
          <header>
            <span><strong>{roster.attendeeLabel} {attendeeIndex + 1}</strong>{enteredName && <small>{enteredName}</small>}</span>
            <div>
              <button type="button" aria-label={`Move ${roster.attendeeLabel} ${attendeeIndex + 1} up`} disabled={attendeeIndex === 0} onClick={() => movePreviewAttendee(attendeeIndex, -1)}><ArrowUp size={13} /></button>
              <button type="button" aria-label={`Move ${roster.attendeeLabel} ${attendeeIndex + 1} down`} disabled={attendeeIndex === previewAttendees.length - 1} onClick={() => movePreviewAttendee(attendeeIndex, 1)}><ArrowDown size={13} /></button>
              <button type="button" aria-label={`Remove ${roster.attendeeLabel} ${attendeeIndex + 1}`} disabled={previewAttendees.length <= roster.minAttendees} onClick={() => setPreviewAttendees((current) => current.filter((candidate) => candidate.clientId !== attendee.clientId))}><Trash2 size={13} /></button>
            </div>
          </header>
          {definition.sections.map((section) => {
            const fields = section.fields.filter((field) => (
              field.scope === "ATTENDEE"
              && allowedFieldKeys.has(field.key)
              && isFieldVisible(field, merged)
            ));
            return fields.length > 0 && (
              <div className="preview-attendee-fields" key={`${attendee.clientId}_${section.id}`}>
                {fields.map((field) => renderPreviewField(field, {
                  valueResponses: attendee.responses,
                  idPrefix: attendee.clientId,
                  attendeeIndex,
                  onChange: (key, value) => setPreviewAttendeeValue(attendee.clientId, key, value),
                }))}
              </div>
            );
          })}
        </article>;
      })}
      {previewStep.managesAttendees && (
        <button className="preview-add-attendee" type="button" disabled={previewAttendees.length >= roster.maxAttendees} onClick={() => setPreviewAttendees((current) => [...current, { clientId: localId("preview_attendee"), responses: {} }])}>
          <Plus size={14} /> {roster.addButtonLabel}
        </button>
      )}
    </section>;
  }

  const failedReasons = lastFailedTestReasons(selectedVersion.testSubmissions, roster?.enabled ? roster.attendeeLabel : null);
  const previewAllowedFieldKeys = new Set(previewStep?.fieldKeys ?? []);
  return (
<aside className="panel builder-preview" data-testid="live-form-preview" id="live-form-preview" ref={previewRef} tabIndex={-1}>
          <div className="section-heading"><div><p className="eyebrow">Live preview</p><h2>{information ? "Preview" : "Preview & test"}</h2></div><span className="live-preview-badge"><span /> Live</span></div>
          <div className="preview-device">
            <div className="preview-browser-bar"><span /><span /><span /></div>
            <div className="preview-form">
              <span className="preview-event">{information ? information.ownerLabel : eventName}</span>
              <h3>{definition.title}</h3>
              <p>{definition.description}</p>
              {previewStep && <nav className="preview-step-progress" aria-label="Public form preview steps">
                <span>Step {previewStepIndex + 1} of {previewSteps.length}</span>
                <div role="list">
                  {previewSteps.map((step, index) => (
                    <button
                      aria-current={step.id === previewStep.id ? "step" : undefined}
                      aria-label={`Preview step ${index + 1}: ${step.shortLabel}`}
                      className={step.id === previewStep.id ? "selected" : ""}
                      type="button"
                      onClick={() => goToPreviewStep(step.id)}
                      key={step.id}
                    >
                      <b>{index + 1}</b>
                      <small>{step.shortLabel}</small>
                    </button>
                  ))}
                </div>
              </nav>}
              {testIssues.length > 0 && <div className="preview-test-alert" role="alert" tabIndex={-1} key={continueBlock ? `block-${continueBlock.attempt}` : "test"}><AlertTriangle size={14} /><span><strong>{continueBlock ? continueBlock.message : `${testIssues.length} test issue${testIssues.length === 1 ? "" : "s"}`}</strong><small>{continueBlock ? `${testIssues.length} answer${testIssues.length === 1 ? "" : "s"} to fix. Fix the highlighted answers to continue.` : "Fix the highlighted answer, then run the test again."}</small>{continueBlock && fieldlessIssues(testIssues).map((issue, index) => <small key={index}>{issue.message}</small>)}</span></div>}
              {previewStep && <section className="preview-current-step" aria-labelledby="preview-current-step-title">
                <span>Step {previewStepIndex + 1}</span>
                <h4 id="preview-current-step-title">{previewStep.title}</h4>
                <p>{previewStep.description}</p>
              </section>}
              {renderPreviewSections(previewAllowedFieldKeys)}
              {renderPreviewRoster(previewAllowedFieldKeys)}
              {previewStep?.isReview && <section className="preview-review-card">
                <h4>Review before submitting</h4>
                <p>{roster?.enabled ? `${previewAttendees.length} ${pluralAttendeeLabel(roster.attendeeLabel, previewAttendees.length)} will be included. ` : ""}The public form shows entered answers here before the registrant submits.</p>
              </section>}
              {!information && calculation && (calculation.lineItems.length > 0 || definition.payment?.enabled) && <section className="preview-order-summary" aria-label="Order summary"><h4>Order summary</h4>{calculation.lineItems.length === 0 ? <p>Select a priced option to see the total.</p> : <>{calculation.lineItems.map((item) => <div key={item.key}><span>{item.label}{item.pricingLabel && <small>{item.pricingLabel}</small>}</span><strong>{formatCents(item.amountCents)}</strong></div>)}<div><span>Subtotal</span><strong>{formatCents(calculation.subtotalCents)}</strong></div>{calculation.processingFeeCents > 0 && <div><span>Card processing</span><strong>{formatCents(calculation.processingFeeCents)}</strong></div>}<div className="preview-total"><span>Total</span><strong>{formatCents(calculation.totalCents)}</strong></div></>}</section>}
              {previewStep && <nav className="preview-step-actions" aria-label="Move through preview">
                <button className="secondary-button" type="button" disabled={previewStepIndex === 0} onClick={() => goToPreviewStep(previewSteps[previewStepIndex - 1]!.id)}>Back</button>
                {!previewStep.isReview && <button className="secondary-button" type="button" onClick={continuePreview}>Continue</button>}
              </nav>}
              {!information && previewStep?.isReview && <>
                <button className="secondary-button full-button" type="button" disabled={busy !== null || isHistorical || dirty} title={isHistorical ? "Historical versions are read-only and cannot be tested." : dirty ? "Save your changes as a draft first, then run the test." : undefined} onClick={runTest}><ClipboardCheck size={16} /> {busy === "test" ? "Testing…" : dirty ? "Save draft to test" : "Run test submission"}</button>
                <small className="preview-boundary"><ShieldCheck size={13} /> Saves a form test only — it does not create a registration, send email, or charge a card</small>
              </>}
            </div>
          </div>
          {information
            ? <p className="fb-hint fb-info-preview-note"><ShieldCheck size={13} aria-hidden="true" /> Preview only: nothing you type here is saved or sent. Publish, then open the form in Form settings to collect answers.</p>
            : <div className="test-summary"><Settings2 size={17} /><span><strong>{selectedVersion.testSubmissionCount} test submission{selectedVersion.testSubmissionCount === 1 ? "" : "s"}</strong><small>{hasValidTest ? "Valid test passed for this version" : testRequired ? "A valid test is required before this form's first publish" : "A test is optional now that this form has been published"}</small>{failedReasons.length > 0 && <small>The last test failed:</small>}{failedReasons.map((reason, index) => <small key={index}>{reason}</small>)}</span>{hasValidTest && <CheckCircle2 className="success-icon" size={18} />}</div>}
        </aside>
  );
}

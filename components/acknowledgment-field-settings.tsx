"use client";

import { useEffect, useRef, useState } from "react";
import { ACKNOWLEDGMENT_TEXT_MAX, type AcknowledgmentConfig, type RegistrationFormField } from "@/modules/forms/definition";

/** One published policy version, as the slim form-builder read returns it: no body text (#129). */
export type PolicyVersionOption = {
  id: string;
  versionNumber: number;
  kind: string;
  title: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  policy: { id: string; kind: string; scope: string; slug: string; name: string };
};

export type PolicyVersionsState =
  | { status: "idle" | "loading"; versions: PolicyVersionOption[] }
  | { status: "ready"; versions: PolicyVersionOption[] }
  | { status: "error"; versions: PolicyVersionOption[]; message: string };

const idle: PolicyVersionsState = { status: "idle", versions: [] };

/**
 * The published policy versions a form builder may point an acknowledgment at (#150), from the slim read under
 * MANAGE_FORMS. Fetched once, and only once something on the form needs it. Published versions only, never a draft.
 */
export function useAcknowledgmentPolicyVersions(eventId: string | null, needed: boolean): PolicyVersionsState {
  const [state, setState] = useState<PolicyVersionsState>(idle);
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!needed || !eventId || started.current) return;
    started.current = true;
    setState({ status: "loading", versions: [] });
    fetch(`/api/events/${eventId}/consent-policy-versions`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "Policy versions could not be loaded.");
        return Array.isArray(body.versions) ? body.versions as PolicyVersionOption[] : [];
      })
      .then((versions) => { if (mounted.current) setState({ status: "ready", versions }); })
      .catch((caught) => { if (mounted.current) setState({ status: "error", versions: [], message: caught instanceof Error ? caught.message : "Policy versions could not be loaded." }); });
  }, [eventId, needed]);
  return state;
}

/**
 * What changes on a field when its type changes to or from an acknowledgment: it starts with typed wording and sheds the
 * choices, price, credit, age range and date automation it cannot carry, and leaving the type drops the wording.
 */
export function acknowledgmentTypePatch(field: RegistrationFormField, nextType: RegistrationFormField["type"]): Partial<RegistrationFormField> {
  if (nextType === "ACKNOWLEDGMENT") {
    return {
      acknowledgment: field.acknowledgment ?? { source: "TEXT", text: "" },
      options: [],
      optionSource: undefined,
      optionLabels: undefined,
      optionDescriptions: undefined,
      minSelections: undefined,
      maxSelections: undefined,
      availabilityMode: undefined,
      choiceLimits: undefined,
      priceCents: undefined,
      choicePricesCents: undefined,
      creditCentsPerUnit: undefined,
      capUnitsAtAttendeeCount: undefined,
      latePricing: undefined,
      ageBounds: undefined,
      autoDate: undefined,
      placeholder: undefined,
    };
  }
  return field.acknowledgment ? { acknowledgment: undefined } : {};
}

/** Only acknowledgment-kind policies can satisfy an acknowledgment: a waiver or consent never stands in for one. */
export function acknowledgmentPolicyChoices(versions: readonly PolicyVersionOption[]) {
  return versions.filter((version) => version.kind === "ACKNOWLEDGMENT");
}

export function policyVersionLabel(version: PolicyVersionOption) {
  return `${version.policy.name} — version ${version.versionNumber}: ${version.title}`;
}

/**
 * The builder's settings for an acknowledgment field: the exact wording, or a published policy version.
 * Nothing here is evidence; it only decides what the form will show and what each acknowledgment will record.
 */
export function AcknowledgmentFieldSettings({
  field,
  canEdit,
  policyVersions,
  allowPolicyVersion = true,
  onChange,
}: {
  field: RegistrationFormField;
  canEdit: boolean;
  policyVersions: PolicyVersionsState;
  /** False in a form template (#1064): it belongs to no event, and a policy version is per event, so only typed wording is offered. */
  allowPolicyVersion?: boolean;
  onChange: (config: AcknowledgmentConfig) => void;
}) {
  const config: AcknowledgmentConfig = field.acknowledgment ?? { source: "TEXT", text: "" };
  const choices = acknowledgmentPolicyChoices(policyVersions.versions);
  const chosen = config.source === "POLICY_VERSION" ? policyVersions.versions.find((version) => version.id === config.policyVersionId) : undefined;
  const unavailable = config.source === "POLICY_VERSION"
    && policyVersions.status === "ready"
    && (!chosen || chosen.kind !== "ACKNOWLEDGMENT");
  const sourceId = `acknowledgment_source_${field.id}`;
  const textId = `acknowledgment_text_${field.id}`;
  const versionId = `acknowledgment_version_${field.id}`;
  return (
    <section className="field-full acknowledgment-settings" data-testid={`acknowledgment-settings-${field.key}`}>
      <div className="field-settings">
        <label className="field-full" htmlFor={sourceId}>
          What people acknowledge
          <select
            id={sourceId}
            disabled={!canEdit}
            value={config.source}
            onChange={(event) => onChange(event.target.value === "POLICY_VERSION"
              ? { source: "POLICY_VERSION", policyVersionId: "" }
              : { source: "TEXT", text: config.source === "TEXT" ? config.text : "" })}
          >
            <option value="TEXT">Exact wording typed here</option>
            {(allowPolicyVersion || config.source === "POLICY_VERSION") && <option value="POLICY_VERSION">A published policy version</option>}
          </select>
        </label>
        {config.source === "TEXT" ? (
          <label className="field-full" htmlFor={textId}>
            Wording shown to registrants
            <textarea
              id={textId}
              disabled={!canEdit}
              rows={5}
              maxLength={ACKNOWLEDGMENT_TEXT_MAX}
              value={config.text}
              onChange={(event) => onChange({ source: "TEXT", text: event.target.value })}
            />
            <small>{config.text.length.toLocaleString("en-US")} of {ACKNOWLEDGMENT_TEXT_MAX.toLocaleString("en-US")} characters. Recorded exactly as written for everyone who acknowledges; a change takes a new form version.</small>
          </label>
        ) : (
          <div className="field-full">
            <label htmlFor={versionId}>
              Published version
              <select
                id={versionId}
                disabled={!canEdit || policyVersions.status === "loading"}
                value={config.policyVersionId}
                onChange={(event) => onChange({ source: "POLICY_VERSION", policyVersionId: event.target.value })}
              >
                <option value="">{policyVersions.status === "loading" ? "Loading policy versions…" : "Choose a published version"}</option>
                {config.policyVersionId && !chosen && <option value={config.policyVersionId}>Current choice (not available to this event)</option>}
                {choices.map((version) => <option key={version.id} value={version.id}>{policyVersionLabel(version)}</option>)}
              </select>
            </label>
            {policyVersions.status === "error" && <small className="field-error" role="alert">{policyVersions.message}</small>}
            {policyVersions.status === "ready" && choices.length === 0 && <small>No published acknowledgment policy versions yet. Publish one under Policies first.</small>}
            {unavailable && <small className="field-error" role="alert" data-testid={`acknowledgment-unavailable-${field.key}`}>This policy version is not available to this event. Choose another published version before saving.</small>}
            {chosen && <small>Registrants see the full wording of this version. Later versions never change what was acknowledged.</small>}
          </div>
        )}
      </div>
      <small>Each acknowledgment records the wording or version shown, who gave it, when, and how (online, entered by staff, or on paper). The answer itself is only Yes.</small>
    </section>
  );
}

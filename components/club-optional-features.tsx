"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { FormMessage, notSavedMessage, restoreFocusAfterSave, savedMessage } from "@/components/form-message";
import styles from "./club-optional-features.module.css";
import { SubmitButton } from "@/components/submit-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { CLUB_OPTIONAL_FEATURE_KEYS, clubOptionalFeatureDefinitions, type ClubOptionalFeatureKey } from "@/modules/club-features/domain";

type FeaturesResponse = { enabled?: ClubOptionalFeatureKey[]; message?: string };

/**
 * Optional features on Club settings (#1709), for the club's director or deputy. Every feature is off until the club
 * switches it on, and a club that never does sees nothing new. Switching one off hides it and loses nothing. The route
 * checks the role again and records every change.
 */
export function ClubOptionalFeatures({ organizationId, initialEnabled }: { organizationId: string; initialEnabled: ClubOptionalFeatureKey[] }) {
  const [enabled, setEnabled] = useState<ClubOptionalFeatureKey[]>(initialEnabled);
  const [saved, setSaved] = useState<ClubOptionalFeatureKey[]>(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = CLUB_OPTIONAL_FEATURE_KEYS.some((key) => enabled.includes(key) !== saved.includes(key));
  useUnsavedChangesGuard(dirty, "You have unsaved changes to the optional features. Leave this page and discard them?");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/features`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: Object.fromEntries(CLUB_OPTIONAL_FEATURE_KEYS.map((key) => [key, enabled.includes(key)])) }),
      });
      const result = await response.json().catch(() => ({})) as FeaturesResponse;
      if (!response.ok || !result.enabled) throw new Error(result.message ?? "The optional features could not be saved.");
      setEnabled(result.enabled);
      setSaved(result.enabled);
      setNotice(savedMessage());
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "The optional features could not be saved."));
    } finally {
      setSaving(false);
      restoreFocusAfterSave("club-features-save");
    }
  }

  return (
    <form className="public-manage-card form-stack" noValidate onSubmit={save}>
      <div className="public-manage-card-heading">
        <div>
          <p className="public-registration-eyebrow">Club settings</p>
          <h2 id="club-optional-features-heading">Optional features</h2>
        </div>
      </div>
      <p className={`field-help ${styles.helpText}`}>These are off until you turn them on. Nothing here is required, and turning one off hides it without losing anything. Every change is recorded.</p>
      {CLUB_OPTIONAL_FEATURE_KEYS.map((key) => {
        const definition = clubOptionalFeatureDefinitions[key];
        const on = enabled.includes(key);
        return (
          <div key={key}>
            <label className="checkbox-label">
              <input
                aria-describedby={`club-feature-${key}-help`}
                checked={on}
                name={key}
                onChange={(event) => {
                  setNotice("");
                  setEnabled((current) => (event.target.checked ? [...current.filter((item) => item !== key), key] : current.filter((item) => item !== key)));
                }}
                type="checkbox"
              />
              {definition.title}
            </label>
            <p className={`field-help ${styles.helpText}`} id={`club-feature-${key}-help`}>{definition.description}</p>
            {key === "roster-health-flags" && saved.includes(key) && (
              <p><Link className="secondary-button" href={`/account/clubs/${organizationId}/roster-health`}>Open roster health</Link></p>
            )}
            {key === "master-guide-tracking" && saved.includes(key) && (
              <p><Link className="secondary-button" href={`/account/clubs/${organizationId}/master-guide`}>Open Master Guide tracking</Link></p>
            )}
            {key === "fill-in-letters" && saved.includes(key) && (
              <p><Link className="secondary-button" href={`/account/clubs/${organizationId}/letters`}>Open letters</Link></p>
            )}
            {key === "completion-certificates" && saved.includes(key) && (
              <p><Link className="secondary-button" href={`/account/clubs/${organizationId}/certificates`}>Open certificates</Link></p>
            )}
            {key === "roster-charts" && saved.includes(key) && (
              <p><Link className="secondary-button" href={`/account/clubs/${organizationId}/charts`}>Open charts</Link></p>
            )}
            {key === "staff-training-records" && saved.includes(key) && (
              <p><Link className="secondary-button" href={`/account/clubs/${organizationId}/staff-training`}>Open staff training</Link></p>
            )}
          </div>
        );
      })}
      <div>
        <SubmitButton id="club-features-save" icon={<Save aria-hidden="true" size={16} />} label="Save optional features" submitting={saving} submittingLabel="Saving…" />
        {error ? <FormMessage message={error} tone="error" /> : notice ? <FormMessage message={notice} tone="success" /> : null}
      </div>
    </form>
  );
}

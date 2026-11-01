"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CLUB_FORM_REQUIREMENTS,
  REQUIRED_ROLE_TYPES,
  requiredRoleLabels,
  requirementLabels,
  type ClubFormRequirementValue,
  type RequiredRoleType,
} from "@/modules/club-forms/required-domain";

/**
 * The "Required" setting for one club form (#1246): not required, once per club each club year, or once for each
 * member of the chosen roles. Shown to system administrators and Clubs Administrators; the route checks again.
 */
export function ClubFormRequirement({
  templateKey,
  name,
  requirement,
  requiredRoles,
}: {
  templateKey: string;
  name: string;
  requirement: ClubFormRequirementValue;
  requiredRoles: RequiredRoleType[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState(requirement);
  const [roles, setRoles] = useState<RequiredRoleType[]>(requiredRoles);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = mode !== requirement || (mode === "PER_ROLE_MEMBER_YEAR" && roles.join(",") !== requiredRoles.join(","));

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/club-forms/${encodeURIComponent(templateKey)}/requirement`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: mode, requiredRoles: mode === "PER_ROLE_MEMBER_YEAR" ? roles : [] }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? "The change could not be saved.");
        return;
      }
      setNotice("Saved.");
      router.refresh();
    } catch {
      setError("The change could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(role: RequiredRoleType, on: boolean) {
    setRoles((current) => REQUIRED_ROLE_TYPES.filter((candidate) => (candidate === role ? on : current.includes(candidate))));
  }

  const selectId = `requirement-${templateKey}`;
  return (
    <div className="club-form-requirement">
      <label htmlFor={selectId}>
        <span className="sr-only">{`Whether ${name} is required`}</span>
        <select disabled={saving} id={selectId} onChange={(event) => setMode(event.target.value as ClubFormRequirementValue)} value={mode}>
          {CLUB_FORM_REQUIREMENTS.map((value) => <option key={value} value={value}>{requirementLabels[value]}</option>)}
        </select>
      </label>
      {mode === "PER_ROLE_MEMBER_YEAR" && (
        <fieldset className="club-form-requirement-roles">
          <legend className="sr-only">{`Roles that must each have ${name}`}</legend>
          {REQUIRED_ROLE_TYPES.map((role) => (
            <label className="checkbox-hit" key={role}>
              <input checked={roles.includes(role)} disabled={saving} onChange={(event) => toggle(role, event.target.checked)} type="checkbox" />
              {requiredRoleLabels[role]}
            </label>
          ))}
        </fieldset>
      )}
      {dirty && (
        <button className="secondary-button" disabled={saving || (mode === "PER_ROLE_MEMBER_YEAR" && roles.length === 0)} onClick={() => void save()} type="button">Save</button>
      )}
      {error && <small className="club-report-problem" role="alert">{error}</small>}
      {notice && !dirty && <small className="quiet-copy" role="status">{notice}</small>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyApplicationLink } from "@/components/copy-application-link";

type FillMode = "FAMILY" | "CLUB" | "OPEN_APPLICATION";

const labels: Record<FillMode, string> = {
  FAMILY: "Families and individuals",
  CLUB: "Club forms",
  OPEN_APPLICATION: "Open application",
};

/**
 * "Who fills it in" for one club form (#1229), and for an open application its public address and the close or
 * reopen switch for the current club year. System administrators only; the routes check again.
 */
export function ClubFormFillMode({
  templateKey,
  name,
  fillMode,
  applicationUrl,
  clubYear,
  closed,
}: {
  templateKey: string;
  name: string;
  fillMode: FillMode;
  applicationUrl: string;
  clubYear: string;
  closed: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function put(path: string, body: unknown, failure: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/club-forms/${encodeURIComponent(templateKey)}/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? failure);
        return;
      }
      router.refresh();
    } catch {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  const selectId = `fill-mode-${templateKey}`;
  return (
    <div className="club-form-fill-mode">
      <label htmlFor={selectId}>
        <span className="sr-only">{`Who fills in ${name}`}</span>
        <select
          disabled={saving}
          id={selectId}
          onChange={(event) => void put("fill-mode", { fillMode: event.target.value }, "The change could not be saved.")}
          value={fillMode}
        >
          {(Object.keys(labels) as FillMode[]).map((mode) => <option key={mode} value={mode}>{labels[mode]}</option>)}
        </select>
      </label>
      {fillMode === "OPEN_APPLICATION" && (
        <>
          <CopyApplicationLink url={applicationUrl} />
          <p className="field-help">{closed ? `Closed for ${clubYear}.` : `Open for ${clubYear}.`}</p>
          <button
            className={closed ? "primary-button" : "secondary-button"}
            disabled={saving}
            onClick={() => void put("open-link", { closed: !closed }, "The change could not be saved.")}
            type="button"
          >
            {closed ? "Reopen" : `Close for ${clubYear}`}
          </button>
        </>
      )}
      {error && <small className="club-report-problem" role="alert">{error}</small>}
    </div>
  );
}

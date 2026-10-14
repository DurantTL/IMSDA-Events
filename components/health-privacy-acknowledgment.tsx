"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { HEALTH_PRIVACY_ACK_TEXT, HEALTH_PRIVACY_ACK_VERSION } from "@/modules/health-records/acknowledgment-domain";

/**
 * The one-time privacy notice shown before health access works (#923). It
 * stands where training would: read it, tick the box, continue. It is shown
 * again only when the wording version changes. Nothing health-related passes
 * through here; the page refreshes once the acknowledgment is saved.
 */
export function HealthPrivacyAcknowledgment({ as }: { as: "STAFF" | "ATTENDEE" }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!agreed) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/health-records/acknowledgment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ as, version: HEALTH_PRIVACY_ACK_VERSION }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setError(result.message ?? "That didn't work. Please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="public-manage-card">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Protected health information</p>
        <h2>{HEALTH_PRIVACY_ACK_TEXT.title}</h2>
      </div>
      <div className="public-manage-security-note">
        <ShieldCheck size={20} aria-hidden="true" />
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <p>{HEALTH_PRIVACY_ACK_TEXT.intro}</p>
          <ul>
            {HEALTH_PRIVACY_ACK_TEXT.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <label className="checkbox-row">
            <input checked={agreed} onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
            <span>{HEALTH_PRIVACY_ACK_TEXT.confirm}</span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={!agreed || busy} type="submit">Continue</button>
        </form>
      </div>
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/visiting-club-request-form.module.css";
import { VISITING_CLUB_TYPES, VISITING_SCREENING_CONFIRMATION, visitingClubTypeLabels, type VisitingClubTypeValue } from "@/modules/visiting-clubs/domain";

/**
 * The visiting director's form (#835): club name, type, home conference and church, a phone, and the confirmation of their
 * own conference's adult screening. Their name and email come from their account; the event comes from the link.
 */
export function VisitingClubRequestForm({ eventName, token }: { eventName: string; token: string }) {
  const router = useRouter();
  const [clubName, setClubName] = useState("");
  const [clubType, setClubType] = useState<VisitingClubTypeValue>("PATHFINDER");
  const [homeConference, setHomeConference] = useState("");
  const [homeChurch, setHomeChurch] = useState("");
  const [directorPhone, setDirectorPhone] = useState("");
  const [screeningConfirmed, setScreeningConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Typed answers not yet sent.
  useUnsavedChangesGuard(
    !done && (clubName.trim() !== "" || homeConference.trim() !== "" || homeChurch.trim() !== "" || directorPhone.trim() !== "" || screeningConfirmed),
    "You have typed something here that has not been sent. Leave this page and discard it?",
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/attendee/visiting-clubs/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, clubName, clubType, homeConference, homeChurch, directorPhone, screeningConfirmed }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The request could not be sent.");
      setDone(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be sent.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="public-manage-card" role="status">
        <h2>Request sent</h2>
        <p className={styles.intro}>
          Thank you. Conference staff will review your club for {eventName}. We will email you when it is approved, and then you can register your club from your account.
        </p>
      </section>
    );
  }

  return (
    <form className="public-manage-card" onSubmit={(event) => void submit(event)}>
      <fieldset className={`form-stack ${styles.form}`} disabled={saving}>
        <legend className="sr-only">Your visiting club</legend>
        <p className={styles.intro}>
          Tell us about the club you are bringing to <strong translate="no">{eventName}</strong>. Your club is a guest for this event only. Staff review your request before your club can register.
        </p>
        <div className={styles.grid}>
          <label className={styles.field}>
            Club name
            <input autoComplete="organization" maxLength={120} onChange={(event) => setClubName(event.target.value)} required value={clubName} />
          </label>
          <label className={styles.field}>
            Club type
            <select onChange={(event) => setClubType(event.target.value as VisitingClubTypeValue)} value={clubType}>
              {VISITING_CLUB_TYPES.map((type) => <option key={type} value={type}>{visitingClubTypeLabels[type]}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            Home conference
            <input maxLength={120} onChange={(event) => setHomeConference(event.target.value)} required value={homeConference} />
          </label>
          <label className={styles.field}>
            Home church
            <input maxLength={120} onChange={(event) => setHomeChurch(event.target.value)} required value={homeChurch} />
          </label>
          <label className={styles.field}>
            Director phone
            <input autoComplete="tel" inputMode="tel" onChange={(event) => setDirectorPhone(event.target.value)} required type="tel" value={directorPhone} />
            <small className={styles.help}>For example (515) 555-0100.</small>
          </label>
        </div>
        <label className={styles.agree}>
          <input checked={screeningConfirmed} onChange={(event) => setScreeningConfirmed(event.target.checked)} required type="checkbox" />
          <span>{VISITING_SCREENING_CONFIRMATION}</span>
        </label>
        {error && <div className="inline-notice error" role="alert">{error}</div>}
        <div className={styles.actions}>
          <button className="primary-button" disabled={saving} type="submit">{saving ? "Sending…" : "Send request"}</button>
        </div>
      </fieldset>
    </form>
  );
}

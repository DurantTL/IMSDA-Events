"use client";

import { useState } from "react";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary, type ErrorSummaryItem } from "@/components/form-error-summary";
import { PhoneInput, phoneBlockingMessage } from "@/components/phone-input";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/visiting-club-request-form.module.css";
import {
  VISITING_CLUB_TYPES,
  VISITING_SCREENING_CONFIRMATION,
  visitingClubTypeLabels,
  type VisitingClubStatusValue,
  type VisitingClubTypeValue,
} from "@/modules/visiting-clubs/domain";

type FieldKey = "clubName" | "homeConference" | "homeChurch" | "directorPhone" | "screeningConfirmed";

const labels: Record<FieldKey, string> = {
  clubName: "Club name",
  homeConference: "Home conference",
  homeChurch: "Home church",
  directorPhone: "Director phone",
  screeningConfirmed: "Adult screening confirmation",
};
const fieldId = (key: FieldKey) => `visiting_${key}`;
const errorId = (key: FieldKey) => `visiting_${key}_error`;

/** The confirmation, shown right after sending and again when the director reopens the used link. */
export function VisitingClubSent({ eventName, requestStatus = "PENDING" }: { eventName: string; requestStatus?: VisitingClubStatusValue }) {
  return (
    <section className="public-manage-card" role="status">
      <h2>{requestStatus === "APPROVED" ? "Request approved" : requestStatus === "DECLINED" ? "Request not approved" : "Request sent"}</h2>
      <p className={styles.intro}>
        {requestStatus === "APPROVED"
          ? `Your club was approved for ${eventName}. Sign in to your account to register it.`
          : requestStatus === "DECLINED"
            ? `The conference was not able to approve your request for ${eventName}. Check your email for details.`
            : `Thank you. Conference staff will review your club for ${eventName}. We will email you when it is approved, and then you can register your club from your account.`}
      </p>
    </section>
  );
}

/**
 * The visiting director's form (#835): club name, type, home conference and church, a phone, and the confirmation of their
 * own conference's adult screening. Their name and email come from their account; the event comes from the link.
 */
export function VisitingClubRequestForm({ eventName, token }: { eventName: string; token: string }) {
  const [clubName, setClubName] = useState("");
  const [clubType, setClubType] = useState<VisitingClubTypeValue>("PATHFINDER");
  const [homeConference, setHomeConference] = useState("");
  const [homeChurch, setHomeChurch] = useState("");
  const [directorPhone, setDirectorPhone] = useState("");
  const [screeningConfirmed, setScreeningConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [done, setDone] = useState(false);
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField } = useFormErrorSummary();

  // Typed answers not yet sent.
  useUnsavedChangesGuard(
    !done && (clubName.trim() !== "" || homeConference.trim() !== "" || homeChurch.trim() !== "" || directorPhone.trim() !== "" || screeningConfirmed),
    "You have typed something here that has not been sent. Leave this page and discard it?",
  );

  function findProblems() {
    const found: Partial<Record<FieldKey, string>> = {};
    const required = "This is required.";
    if (!clubName.trim()) found.clubName = required;
    if (!homeConference.trim()) found.homeConference = required;
    if (!homeChurch.trim()) found.homeChurch = required;
    if (!directorPhone.trim()) found.directorPhone = "Give a phone number for the director.";
    else {
      const phone = phoneBlockingMessage("Director phone", directorPhone);
      if (phone) found.directorPhone = phone;
    }
    if (!screeningConfirmed) found.screeningConfirmed = "Tick the box to confirm your conference's adult screening.";
    return found;
  }

  function summaryFor(found: Partial<Record<FieldKey, string>>): ErrorSummaryItem[] {
    return (Object.keys(labels) as FieldKey[]).filter((key) => found[key]).map((key) => ({ targetId: fieldId(key), message: summaryMessage(labels[key], found[key] as string) }));
  }

  function change(key: FieldKey) {
    setErrors((current) => {
      if (!current[key]) return current;
      const { [key]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });
    clearField(fieldId(key));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = findProblems();
    setAttempted(true);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      showSummary(summaryFor(found));
      return;
    }
    setErrors({});
    clearSummary();
    setSaving(true);
    try {
      const response = await fetch("/api/attendee/visiting-clubs/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, clubName, clubType, homeConference, homeChurch, directorPhone, screeningConfirmed }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; issues?: Array<{ path: string; message: string }> };
      if (!response.ok) {
        // The server decided again: a message for a field goes beside it, anything else stands alone in the summary.
        const serverFound: Partial<Record<FieldKey, string>> = {};
        for (const issue of result.issues ?? []) if (issue.path in labels && !serverFound[issue.path as FieldKey]) serverFound[issue.path as FieldKey] = issue.message;
        setErrors(serverFound);
        const items = summaryFor(serverFound);
        showSummary(items.length > 0 ? items : [{ targetId: null, message: result.message ?? "The request could not be sent." }]);
        return;
      }
      // The used link now shows the same confirmation when reopened, so nothing needs refreshing here.
      setDone(true);
    } catch {
      showSummary([{ targetId: null, message: "The request could not be sent. Check your connection and try again." }]);
    } finally {
      setSaving(false);
    }
  }

  if (done) return <VisitingClubSent eventName={eventName} />;

  const props = (key: FieldKey) => fieldErrorProps(errorId(key), errors[key]);
  return (
    <form className="public-manage-card" noValidate onSubmit={(event) => void submit(event)}>
      <fieldset className={`form-stack ${styles.form}`} disabled={saving}>
        <legend className="sr-only">Your visiting club</legend>
        <p className={styles.intro}>
          Tell us about the club you are bringing to <strong translate="no">{eventName}</strong>. Your club is a guest for this event only. Staff review your request before your club can register.
        </p>
        {summaryItems.length > 0 && <FormErrorSummary action="sending" items={summaryItems} ref={summaryRef} />}
        <div className={styles.grid}>
          <label className={styles.field}>
            {labels.clubName}
            <input autoComplete="organization" id={fieldId("clubName")} maxLength={120} onChange={(event) => { setClubName(event.target.value); change("clubName"); }} required value={clubName} {...props("clubName")} />
            <FieldError id={errorId("clubName")}>{errors.clubName}</FieldError>
          </label>
          <label className={styles.field}>
            Club type
            <select id="visiting_clubType" onChange={(event) => setClubType(event.target.value as VisitingClubTypeValue)} value={clubType}>
              {VISITING_CLUB_TYPES.map((type) => <option key={type} value={type}>{visitingClubTypeLabels[type]}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            {labels.homeConference}
            <input id={fieldId("homeConference")} maxLength={120} onChange={(event) => { setHomeConference(event.target.value); change("homeConference"); }} required value={homeConference} {...props("homeConference")} />
            <FieldError id={errorId("homeConference")}>{errors.homeConference}</FieldError>
          </label>
          <label className={styles.field}>
            {labels.homeChurch}
            <input id={fieldId("homeChurch")} maxLength={120} onChange={(event) => { setHomeChurch(event.target.value); change("homeChurch"); }} required value={homeChurch} {...props("homeChurch")} />
            <FieldError id={errorId("homeChurch")}>{errors.homeChurch}</FieldError>
          </label>
          <label className={styles.field}>
            {labels.directorPhone}
            <PhoneInput
              error={errors.directorPhone}
              errorId={errorId("directorPhone")}
              id={fieldId("directorPhone")}
              label="Director phone"
              onValueChange={(value) => { setDirectorPhone(value); change("directorPhone"); }}
              required
              showNow={attempted}
              value={directorPhone}
            />
            <small className={styles.help}>For example (515) 555-0100.</small>
          </label>
        </div>
        <div>
          <label className={styles.agree}>
            <input checked={screeningConfirmed} id={fieldId("screeningConfirmed")} onChange={(event) => { setScreeningConfirmed(event.target.checked); change("screeningConfirmed"); }} required type="checkbox" {...props("screeningConfirmed")} />
            <span>{VISITING_SCREENING_CONFIRMATION}</span>
          </label>
          <FieldError id={errorId("screeningConfirmed")}>{errors.screeningConfirmed}</FieldError>
        </div>
        <div className={styles.actions}>
          <button className="primary-button" disabled={saving} type="submit">{saving ? "Sending…" : "Send request"}</button>
        </div>
      </fieldset>
    </form>
  );
}

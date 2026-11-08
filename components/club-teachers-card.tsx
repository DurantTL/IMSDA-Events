"use client";

import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { teacherRuleSummary } from "@/modules/club-teachers/domain";
import type { ClubTeacherStep } from "@/modules/club-teachers/repository";
import styles from "@/components/club-teachers-card.module.css";

type Pick = { honorName: string; locationId: string };

/**
 * "Who from your club is teaching?" (#1681), on a club event whose Club teachers tool is on. Adults and staff from the
 * club's own roster only. A club below its number sees a warning and can still register, unless the event chose to block.
 */
export function ClubTeachersCard({ canEdit, eventId, initialStep, organizationId }: {
  canEdit: boolean;
  eventId: string;
  initialStep: ClubTeacherStep;
  organizationId: string;
}) {
  const [step, setStep] = useState(initialStep);
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(
    initialStep.teachers.map((teacher) => [teacher.memberId, { honorName: teacher.honorName, locationId: teacher.locationId ?? "" }]),
  ));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function toggle(memberId: string, on: boolean) {
    setMessage(null);
    setPicks((current) => {
      const next = { ...current };
      if (on) next[memberId] = { honorName: "", locationId: "" };
      else delete next[memberId];
      return next;
    });
  }

  function change(memberId: string, patch: Partial<Pick>) {
    setMessage(null);
    setPicks((current) => ({ ...current, [memberId]: { ...current[memberId]!, ...patch } }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/teachers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teachers: Object.entries(picks).map(([rosterMemberId, pick]) => ({ rosterMemberId, honorName: pick.honorName, locationId: pick.locationId || null })),
        }),
      });
      const result = await response.json().catch(() => ({})) as { step?: ClubTeacherStep; message?: string };
      if (!response.ok || !result.step) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "Your teachers could not be saved. Try again.") });
        return;
      }
      setStep(result.step);
      setPicks(Object.fromEntries(result.step.teachers.map((teacher) => [teacher.memberId, { honorName: teacher.honorName, locationId: teacher.locationId ?? "" }])));
      setMessage({ tone: "ok", text: savedMessage() });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try Save again.") });
    } finally {
      setSaving(false);
    }
  }

  // Only people who can teach count, to match "You have named N".
  const flaggedIds = new Set(step.teachers.filter((teacher) => teacher.flag).map((teacher) => teacher.memberId));
  const named = Object.keys(picks).filter((id) => !flaggedIds.has(id)).length;
  // Unsaved: the picks differ from what was last saved.
  const dirty = Object.keys(picks).length !== step.teachers.length || step.teachers.some((teacher) => {
    const pick = picks[teacher.memberId];
    return !pick || pick.honorName !== teacher.honorName || pick.locationId !== (teacher.locationId ?? "");
  });
  useUnsavedChangesGuard(dirty && !saving, "You have unsaved teachers. Leave this page and discard them?");
  return (
    <section aria-labelledby="club-teachers-heading" className="public-manage-card" data-testid="club-teachers-card">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Honors Weekend</p>
        <h2 id="club-teachers-heading"><GraduationCap aria-hidden="true" size={20} /> Who from your club is teaching?</h2>
      </div>
      <p className="field-help">
        This event asks for {teacherRuleSummary(step.rule)}. Pick adults or staff aged 18 or older from your roster.
        {step.rule.requireTeachers ? " Your registration needs this number before you can submit it." : " Clubs that bring teachers are placed on their weekend first."}
      </p>
      <p className={step.warning ? "inline-notice error" : "inline-notice"} role="status">
        {step.warning ?? `You have named ${step.status.named} of ${step.status.required}. That meets what this event asks.`}
      </p>
      {step.candidates.length === 0 && step.teachers.length === 0 ? (
        <p className="public-manage-empty">Your roster has no adults or staff aged 18 or older yet. Add them on your roster first.</p>
      ) : (
        <ul className={styles.list}>
          {step.teachers.filter((teacher) => teacher.flag).map((teacher) => (
            <li className={styles.person} key={teacher.memberId} data-testid="club-teacher-flagged">
              <label className={styles.pick}>
                <input checked={Boolean(picks[teacher.memberId])} disabled={!canEdit || saving} onChange={(event) => toggle(teacher.memberId, event.target.checked)} type="checkbox" />
                <span translate="no">{teacher.name}</span>
              </label>
              <p className="inline-notice error" role="status">{teacher.flag}. {picks[teacher.memberId] ? "Clear the box and save to replace them." : "Save to remove them."}</p>
            </li>
          ))}
          {step.candidates.map((candidate) => {
            const pick = picks[candidate.memberId];
            return (
              <li className={styles.person} key={candidate.memberId}>
                <label className={styles.pick}>
                  <input checked={Boolean(pick)} disabled={!canEdit || saving} onChange={(event) => toggle(candidate.memberId, event.target.checked)} type="checkbox" />
                  <span translate="no">{candidate.name}{candidate.role ? <span className={styles.role}> · {candidate.role}</span> : null}</span>
                </label>
                {pick && (
                  <div className={styles.details}>
                    <label>
                      Honor they would teach (optional)
                      <input disabled={!canEdit || saving} maxLength={120} onChange={(event) => change(candidate.memberId, { honorName: event.target.value })} type="text" value={pick.honorName} />
                    </label>
                    {step.locations.length > 0 && (
                      <label>
                        Preferred weekend or site (optional)
                        <select disabled={!canEdit || saving} onChange={(event) => change(candidate.memberId, { locationId: event.target.value })} value={pick.locationId}>
                          <option value="">No preference</option>
                          {step.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {step.unavailable.length > 0 && (
        <div data-testid="club-teachers-unavailable">
          <p className={styles.unavailableHeading}>These people can&apos;t be named as teachers yet:</p>
          <ul className={styles.list}>
            {step.unavailable.map((person) => (
              <li className={styles.person} key={person.memberId}>
                <span translate="no">{person.name}</span> · {person.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canEdit ? (
        <div className={styles.actions}>
          <button className="primary-button" disabled={saving} onClick={save} type="button">{saving ? "Saving…" : `Save teachers (${named})`}</button>
        </div>
      ) : (
        <p className="field-help">Only a club director, deputy or registrar can change this.</p>
      )}
      {message && <FormMessage message={message.text} tone={message.tone === "ok" ? "success" : "error"} />}
    </section>
  );
}

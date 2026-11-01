"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { classChangeEmailChoices, classChangeEmailLabels, type ClassChangeEmailChoice } from "@/modules/honors/class-change-domain";
import { savedMessage } from "@/components/form-message";

type Preference = { instructorId: string; eventName: string; classChangeEmails: ClassChangeEmailChoice };

/**
 * How an instructor hears when a youth joins or leaves one of their classes (#1098): a daily summary, one email right
 * away, or none. One choice per event they teach at. The server decides; this only sends the choice.
 */
export function InstructorClassEmailChoice({ preferences }: { preferences: Preference[] }) {
  const [choices, setChoices] = useState(() => Object.fromEntries(preferences.map((item) => [item.instructorId, item.classChangeEmails])) as Record<string, ClassChangeEmailChoice>);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function choose(instructorId: string, choice: ClassChangeEmailChoice) {
    const before = choices[instructorId];
    setChoices({ ...choices, [instructorId]: choice });
    setBusy(instructorId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/attendee/honor-instructor/preferences/${encodeURIComponent(instructorId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classChangeEmails: choice }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Your choice could not be saved.");
      setNotice(savedMessage());
    } catch (caught) {
      if (before) setChoices((current) => ({ ...current, [instructorId]: before }));
      setError(caught instanceof Error ? caught.message : "Your choice could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="public-manage-card" aria-labelledby="instructor-email-heading">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow"><Bell size={15} aria-hidden="true" /> Class list emails</p>
        <h2 id="instructor-email-heading">Hear when someone joins or leaves your class</h2>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {preferences.map((item) => (
        <fieldset className="instructor-email-choice" key={item.instructorId} disabled={busy === item.instructorId}>
          <legend><strong translate="no">{item.eventName}</strong></legend>
          {classChangeEmailChoices.map((choice) => (
            <label className="checkbox-row" key={choice}>
              <input
                checked={choices[item.instructorId] === choice}
                name={`class-change-emails-${item.instructorId}`}
                onChange={() => void choose(item.instructorId, choice)}
                type="radio"
                value={choice}
              />
              <span>
                {classChangeEmailLabels[choice].label}
                <small> {classChangeEmailLabels[choice].help}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </section>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { ExactValue } from "@/components/exact-value";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { FormMessage, notSavedMessage, restoreFocusAfterSave, savedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import type { LeaderDirectoryChoices } from "@/modules/leader-directory/domain";
import styles from "./leader-directory-choices.module.css";

/**
 * A club leader's own leader directory choices (#1707), on their profile: be listed or not, share the email they sign in
 * with, share the phone on their profile. Shown to anyone with an active club leader role, even while the conference
 * switch is off, so a leader can opt out before the directory goes live. Not listed means nothing is shown at all, so the
 * two sharing boxes are disabled then.
 */
export function LeaderDirectoryChoices({ initialChoices, email, hasPhone, directoryOn }: {
  initialChoices: LeaderDirectoryChoices;
  email: string | null;
  hasPhone: boolean;
  directoryOn: boolean;
}) {
  const [choices, setChoices] = useState(initialChoices);
  const [saved, setSaved] = useState(initialChoices);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  function change(next: Partial<LeaderDirectoryChoices>) {
    setChoices((current) => ({ ...current, ...next }));
    setState("idle");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving") return;
    setState("saving");
    setMessage("");
    try {
      const response = await submitJson("/api/attendee/leader-directory", choices, { method: "PATCH", init: { cache: "no-store" } });
      if (response.unavailable) throw new Error(unavailableMessage(response));
      const payload = response.body as { choices?: LeaderDirectoryChoices; message?: string } | null;
      if (!response.ok || !payload?.choices) throw new Error(payload?.message ?? "Your choices could not be saved.");
      setChoices(payload.choices);
      setSaved(payload.choices);
      setState("saved");
      setMessage(savedMessage(payload.choices.listed ? "You are listed in the leader directory." : "You are not listed in the leader directory."));
    } catch (error) {
      setState("error");
      setMessage(notSavedMessage(error instanceof Error ? error.message : "Your choices could not be saved."));
    } finally {
      restoreFocusAfterSave("leader-directory-save-button");
    }
  }

  const sharing = [
    choices.listed && choices.shareEmail ? "your email" : null,
    choices.listed && choices.sharePhone && hasPhone ? "your phone" : null,
  ].filter(Boolean).join(" and ");
  const dirty = choices.listed !== saved.listed || choices.shareEmail !== saved.shareEmail || choices.sharePhone !== saved.sharePhone;
  useUnsavedChangesGuard(dirty, "You have unsaved leader directory choices. Leave this page and discard them?");

  return (
    <form aria-busy={state === "saving"} className="public-manage-contact-card" onSubmit={save}>
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Club leaders</p>
        <h2 id="leader-directory-heading">Leader directory</h2>
        <p>
          {directoryOn
            ? "Club directors, deputies and Area Coordinators can see other clubs' leaders in a leader directory."
            : "The leader directory is not turned on yet. When it is, club directors, deputies and Area Coordinators will be able to see other clubs' leaders."}
          {" "}It shows only your name, role and club, and what you choose to share below.
        </p>
      </div>
      <label className={styles.check}>
        <input checked={choices.listed} onChange={(event) => change({ listed: event.target.checked })} type="checkbox" />
        <span>List me in the leader directory</span>
      </label>
      <label className={styles.check}>
        <input checked={choices.shareEmail} disabled={!choices.listed} onChange={(event) => change({ shareEmail: event.target.checked })} type="checkbox" />
        <span>Share my email{email ? <> (<ExactValue>{email}</ExactValue>)</> : null}</span>
      </label>
      <label className={styles.check}>
        <input checked={choices.sharePhone} disabled={!choices.listed} onChange={(event) => change({ sharePhone: event.target.checked })} type="checkbox" />
        <span>Share my phone</span>
      </label>
      {!hasPhone && <p className={styles.help}>You have no phone saved in your usual details above, so none would be shown.</p>}
      <p className={styles.current} role="status">
        {dirty
          ? "You have changes that are not saved yet."
          : saved.listed
            ? `Saved: you are listed${sharing ? `, sharing ${sharing}` : ", with no contact shown"}.`
            : "Saved: you are not listed. Nobody sees you in the leader directory."}
      </p>
      <div className="public-manage-contact-actions">
        <SubmitButton className="" id="leader-directory-save-button" icon={<Save size={17} aria-hidden="true" />} label="Save leader directory choices" submitting={state === "saving"} submittingLabel="Saving…" />
        {message && state !== "idle" && state !== "saving" && <FormMessage tone={state === "error" ? "error" : "success"} message={message} />}
      </div>
    </form>
  );
}

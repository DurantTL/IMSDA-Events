"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "@/components/registration-profile-review.module.css";

type ReviewConflict = {
  field: string;
  label: string;
  savedValue: string;
  enteredValue: string;
  kind: "different" | "addition";
};

type Review = { registrationId: string; version: string; conflicts: ReviewConflict[] };

type Phase = "loading" | "hidden" | "review" | "done" | "kept";

/**
 * Offered on the registration confirmation to a signed-in attendee (#1512): where their saved profile differs from what
 * they just entered. Nothing is checked and nothing changes until they press "Update my profile". The new values are
 * read by the server from the saved registration; this component only sends the field names and the version it was shown.
 * Any refusal (not signed in, second step pending, unknown registration) hides the panel quietly.
 */
export function RegistrationProfileReview({ registrationId }: { registrationId: string }) {
  const headingId = useId();
  const [phase, setPhase] = useState<Phase>("loading");
  const [review, setReview] = useState<Review | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  // One live region stays mounted through every state (same tree position, so React keeps the element); after an
  // action focus moves to it once the new phase is committed, so the result is announced.
  useEffect(() => {
    if (phase === "done" || phase === "kept") statusRef.current?.focus();
  }, [phase]);

  const load = useCallback(async (keepMessage = false) => {
    try {
      const response = await fetch(`/api/attendee/profile/registration-review?registrationId=${encodeURIComponent(registrationId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        setPhase("hidden");
        return;
      }
      const body = await response.json() as { review?: Review };
      const next = body.review;
      if (!next || !Array.isArray(next.conflicts) || next.conflicts.length === 0) {
        setPhase("hidden");
        return;
      }
      setReview(next);
      setChosen(new Set());
      if (!keepMessage) setMessage("");
      setPhase("review");
    } catch {
      setPhase("hidden");
    }
  }, [registrationId]);

  useEffect(() => {
    // Loading happens after the page renders, so the confirmation is never held up.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function toggle(field: string, checked: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(field);
      else next.delete(field);
      return next;
    });
  }

  async function apply() {
    if (!review) return;
    if (chosen.size === 0) {
      setMessage("Choose at least one detail to update, or keep your profile as it is.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/attendee/profile/registration-review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrationId, fields: [...chosen], version: review.version }),
      });
      if (response.status === 409) {
        setMessage("Your profile or this registration changed while you were looking. Review the differences again.");
        await load(true);
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        setMessage(body.message ?? "We could not update your profile. Try again in a moment.");
        return;
      }
      setMessage("Your saved profile is updated.");
      setPhase("done");
    } catch {
      setMessage("We could not update your profile. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function keep() {
    setMessage("Your profile was not changed.");
    setPhase("kept");
  }

  const reviewing = phase === "review" && review;
  const status = (
    <p
      ref={statusRef}
      className={message ? (reviewing ? styles.status : styles.statusDone) : "sr-only"}
      role="status"
      aria-live="polite"
      tabIndex={-1}
    >
      {message}
    </p>
  );
  return (
    <>
    {reviewing ? (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>Your saved profile is different</h2>
      <p className={styles.intro}>
        What you entered here does not match the profile saved on your account. Your profile is only changed if you choose
        details below and press the button.
      </p>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Details to update in your profile</legend>
        <ul className={styles.list}>
          {review.conflicts.map((conflict) => {
            const id = `${headingId}-${conflict.field}`;
            return (
              <li key={conflict.field} className={styles.row}>
                <input
                  id={id}
                  type="checkbox"
                  aria-describedby={`${id}-values`}
                  checked={chosen.has(conflict.field)}
                  onChange={(event) => toggle(conflict.field, event.target.checked)}
                />
                <div className={styles.values}>
                  <label className={styles.fieldName} htmlFor={id}>{conflict.label}</label>
                  <dl className={styles.valueList} id={`${id}-values`}>
                    <div className={styles.valueLine}>
                      <dt>Saved profile</dt>
                      <dd translate="no">{conflict.savedValue || "Nothing saved"}</dd>
                    </div>
                    <div className={styles.valueLine}>
                      <dt>You entered</dt>
                      <dd translate="no">{conflict.enteredValue}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className={styles.actions}>
        <button type="button" className="primary-button" onClick={() => void apply()} disabled={busy}>
          {busy ? "Updating…" : "Update my profile"}
        </button>
        <button type="button" className="secondary-button" onClick={keep} disabled={busy}>
          Keep my profile as it is
        </button>
      </div>
    </section>
    ) : null}
    {status}
    </>
  );
}

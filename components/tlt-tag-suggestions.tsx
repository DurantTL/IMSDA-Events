"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { submitButtonState } from "@/components/submit-button";
import styles from "./tlt-directory.module.css";

/**
 * Tags suggested from a TLT's TLT Opportunities choices (#1686). Each is one button: nothing is applied until the TLT
 * director presses it, and the server re-checks that the tag really is suggested for that TLT.
 */
export function TltTagSuggestions({ personId, suggestions }: { personId: string; suggestions: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function accept(tagId: string) {
    setBusyId(tagId);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/attendee/area-clubs/tlt-directory/suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, tagId }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "That could not be saved.");
      setMessage(savedMessage());
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.noPrint}>
      <p className={styles.status} id={`suggest-${personId}`}>Suggested from their TLT Opportunities choices. Add one to keep it:</p>
      <ul aria-labelledby={`suggest-${personId}`} className={styles.suggestions}>
        {suggestions.map((tag) => {
          const state = submitButtonState({ submitting: busyId === tag.id, disabled: busyId !== null, label: `Add ${tag.name}`, submittingLabel: "Saving…" });
          return (
            <li key={tag.id}>
              <button aria-busy={state.ariaBusy || undefined} className="secondary-button" disabled={state.disabled} onClick={() => void accept(tag.id)} type="button">
                {state.label}
              </button>
            </li>
          );
        })}
      </ul>
      <FormMessage message={error || message} tone={error ? "error" : "success"} />
    </div>
  );
}

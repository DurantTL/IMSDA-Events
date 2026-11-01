"use client";

import styles from "./form-message.module.css";

/**
 * The one message slot per form (#1455, rules B5, B9, B10, G1, G3). It sits directly under the action buttons and
 * carries both the success and the error, so every form says the same words in the same place. Success looks like
 * `.inline-notice` and is announced politely (`role="status"`); an error is `.inline-notice.error` and is announced
 * at once (`role="alert"`). Render only one slot per form so a result is never announced twice.
 */

/** Success always starts with "Saved." and may add one helpful sentence. */
export function savedMessage(extra?: string) {
  const sentence = extra?.trim();
  return sentence ? `Saved. ${sentence}` : "Saved.";
}

/** Errors start with "Not saved:" and say what to do. A reason that already starts that way is kept as is. */
export function notSavedMessage(reason: string) {
  const text = reason.trim();
  if (/^not saved:/i.test(text)) return text;
  return `Not saved: ${text}`;
}

export type FormMessageUndo = {
  /** Defaults to "Undo". */
  label?: string;
  onUndo: () => void;
  busy?: boolean;
};

export type FormMessageProps = {
  tone: "success" | "error";
  message: string;
  /** Only where the reverse action already exists in the same component. */
  undo?: FormMessageUndo;
  className?: string;
};

export function FormMessage({ tone, message, undo, className }: FormMessageProps) {
  if (!message) return null;
  const classes = ["inline-notice", tone === "error" ? "error" : "success", styles.message, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role={tone === "error" ? "alert" : "status"}>
      {message}
      {undo && (
        <>
          {" "}
          <button
            aria-busy={undo.busy || undefined}
            className={styles.undo}
            disabled={undo.busy}
            onClick={undo.onUndo}
            type="button">
            {undo.busy ? "Undoing…" : undo.label ?? "Undo"}
          </button>
        </>
      )}
    </div>
  );
}

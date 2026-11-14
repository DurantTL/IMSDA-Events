The one place a form says it is saving, saved or not saved (rules B5 and B10).

- The message sits directly under the form's buttons. Success is a `.inline-notice` starting "Saved." plus at most one sentence (`role="status"`, polite). A failure is `.inline-notice.error` starting "Not saved:" and saying what to do (`role="alert"`). Use one slot per form so a result is read out once.
- Where the reverse action exists in the same place, the message ends with an "Undo" button that looks like a link in the notice color (44px tall, "Undoing…" while busy).
- While a request runs, the button's label becomes "Saving…" (or "Submitting…"), a 17px spinner replaces its icon, and it is disabled and marked `aria-busy` (58% opacity, wait cursor). When the save ends, focus goes back to the button.
- Settings pages show a status line with the same words: "Saving…", "Saved", "Unsaved changes", "Not saved" and "Not saved: changed by someone else".

"use client";

import { useState } from "react";

/** One choice per line, cleaned the way the builder saves them: trimmed, with empty lines dropped. */
export function parseChoiceLines(text: string): string[] {
  return text.split("\n").map((value) => value.trim()).filter(Boolean);
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * The "Choices — one per line" box. It keeps what is typed (new empty lines, trailing spaces) so Enter and spaces
 * work, and reports the cleaned list. When the choices change from outside (a quick-choices preset, undo), the box
 * shows them instead (#2041).
 */
export function BuilderChoiceListInput({ choices, disabled, onChoicesChange }: { choices: string[]; disabled: boolean; onChoicesChange: (choices: string[]) => void }) {
  const shown = choices.join("\n");
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  if (shown !== seen) {
    setSeen(shown);
    if (!sameList(parseChoiceLines(draft), choices)) setDraft(shown);
  }
  return (
    <textarea
      autoComplete="off"
      name="builder-rb-note-9"
      disabled={disabled}
      rows={Math.min(8, Math.max(3, choices.length))}
      value={draft}
      onChange={(event) => { setDraft(event.target.value); onChoicesChange(parseChoiceLines(event.target.value)); }}
    />
  );
}

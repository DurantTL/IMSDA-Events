"use client";

import { SEMINAR_NOT_ATTENDING_LABEL } from "@/modules/forms/definition";
import styles from "@/components/seminar-not-attending-choice.module.css";

/**
 * The explicit "Not attending" pick that sits beside a seminar field's choices (#893). It is never preselected, and it is a
 * real checkbox so keyboard and screen-reader users reach it like any other choice. Picking it clears the seminar picks
 * (the caller stores the "Not attending" marker); picking a seminar afterward clears it again.
 */
export function SeminarNotAttendingChoice({
  id,
  selected,
  disabled = false,
  onChange,
}: {
  id: string;
  selected: boolean;
  disabled?: boolean;
  onChange: (selected: boolean) => void;
}) {
  return (
    <label className={`${styles.choice}${selected ? ` ${styles.selected}` : ""}`} htmlFor={id}>
      <input id={id} type="checkbox" checked={selected} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={styles.text}>
        <strong>{SEMINAR_NOT_ATTENDING_LABEL}</strong>
        <small>I will not attend a seminar, so I am not asking for a seat.</small>
      </span>
    </label>
  );
}

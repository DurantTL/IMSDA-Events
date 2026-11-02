"use client";

import { useId } from "react";

/**
 * The hidden `website` trap (#1480), the same field and pattern as the registration and club application forms: a
 * person never sees or fills it, so a value means a script. Positioned off screen by the shared
 * `.public-registration-honeypot` class and removed from the tab order.
 */
export function HoneypotField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="public-registration-honeypot" aria-hidden="true">
      <label htmlFor={id}>Website</label>
      <input autoComplete="off" id={id} name="website" onChange={(event) => onChange(event.target.value)} tabIndex={-1} type="text" value={value} />
    </div>
  );
}

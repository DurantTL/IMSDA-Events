"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * The address of a form's public open application (#1229), with a button to copy it. The address is always shown as
 * text too, so it can be selected and copied by hand when the clipboard is unavailable.
 */
export function CopyApplicationLink({ url, label = "Copy application link", showAddress = true }: { url: string; label?: string; showAddress?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="copy-application-link">
      <button className="secondary-button" onClick={() => void copy()} type="button">
        {state === "copied" ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />} {state === "copied" ? "Link copied" : label}
      </button>
      {showAddress && <code>{url}</code>}
      <span aria-live="polite" className={state === "failed" ? "field-help" : "sr-only"} role="status">
        {state === "copied" ? "The application link was copied." : state === "failed" ? "Copying didn't work here. Select the address above and copy it." : ""}
      </span>
    </div>
  );
}

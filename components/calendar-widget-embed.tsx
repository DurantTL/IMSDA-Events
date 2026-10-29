"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import styles from "./calendar-widget-embed.module.css";

/** The upcoming-events widget's embed code for staff (#107): read-only, with a copy button. */
export function CalendarWidgetEmbed({ code }: { code: string }) {
  const [state, setState] = useState<"copied" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState(null), 3000);
  }

  return (
    <section aria-labelledby="calendar-widget-embed-heading" className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Website widget</p>
          <h2 id="calendar-widget-embed-heading">Show upcoming events on another website</h2>
        </div>
      </div>
      <p>
        Paste this block into a website&apos;s Custom HTML area to show the next five public events. It only appears on
        allow-listed sites (imsda.org and its subdomains by default). Add <code>?limit=8</code> (1 to 12) or
        {" "}<code>&amp;filter=camps</code> to the address to change what it shows.
      </p>
      <label className="sr-only" htmlFor="calendar-widget-embed-code">Upcoming events embed code</label>
      <textarea className={styles.code} id="calendar-widget-embed-code" readOnly rows={6} value={code} />
      <div className={styles.actions}>
        <button className="secondary-button" onClick={copy} type="button">
          {state === "copied" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />} Copy embed code
        </button>
        <span aria-live="polite" role="status">
          {state === "copied" && "Embed code copied."}
          {state === "failed" && "Could not copy. Select the code and copy it by hand."}
        </span>
      </div>
    </section>
  );
}

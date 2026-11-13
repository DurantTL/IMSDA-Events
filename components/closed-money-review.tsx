"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useConfirm } from "@/components/use-confirm";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { CodeValue, Money } from "@/components/exact-value";
import { formatCents } from "@/modules/payments/format-cents";
import styles from "@/components/event-closeout.module.css";

export type ClosedMoneyItem = {
  id: string;
  kind: "PAYMENT" | "REFUND";
  amountCents: number;
  createdAt: string;
  reference: string | null;
};

type Props = {
  eventId: string;
  items: ClosedMoneyItem[];
  /** MANAGE_FINANCE or FINALIZE_INVOICES; everyone else who opens the page only reads. */
  canReview: boolean;
  /** The note's length limit, from the server. */
  noteMaxLength: number;
};

type Outcome = { tone: "success" | "error"; message: string } | null;

const when = (iso: string) => formatInConferenceTime(iso, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The money Square recorded after the event closed, with "Mark reviewed" (#1515 follow-up). The server decides everything. */
export function ClosedMoneyReview({ eventId, items, canReview, noteMaxLength }: Props) {
  const router = useRouter();
  const { ask, confirmDialog } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  // The button that was pressed can disappear with its item, so focus moves to the result instead of the top of the page.
  useEffect(() => {
    if (outcome) messageRef.current?.focus();
  }, [outcome]);

  async function review(item: ClosedMoneyItem) {
    if (busyId) return;
    const note = await ask({
      title: `Mark this ${item.kind === "REFUND" ? "refund" : "payment"} of ${formatCents(item.amountCents)} as reviewed`,
      body: "It stays recorded and counted in the money report. Marking it reviewed only takes it off this list.",
      confirmLabel: "Mark reviewed",
      input: { label: "What did you check?", required: true, multiline: true, maxLength: noteMaxLength, hint: "For example: matches the Square dashboard; no change needed." },
    });
    if (note === null) return;
    setBusyId(item.id);
    setOutcome(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/closeout/review-money`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewId: item.id, note }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setOutcome({ tone: "error", message: notSavedMessage(data?.message ?? "The server did not answer. Nothing was changed; try again.") });
        if (response.status === 409 || response.status === 404) router.refresh();
        return;
      }
      setOutcome({ tone: "success", message: savedMessage("Marked as reviewed.") });
      router.refresh();
    } catch {
      setOutcome({ tone: "error", message: notSavedMessage("The server did not answer. Nothing was changed; try again.") });
    } finally {
      setBusyId(null);
    }
  }

  // The section is only drawn while something is waiting, but the result message stays: clearing the last item (or a 409
  // that removes the list) must not take "Marked as reviewed." or the error with it.
  return (
    <>
      {items.length > 0 ? (
        <section className={styles.panel} aria-labelledby="closeout-closed-money-heading" id="closeout-closed-money">
          <h3 className={styles.panelHeading} id="closeout-closed-money-heading">Money recorded while closed ({items.length})</h3>
          <p className={styles.note}>Square payments and refunds that arrived after the event was closed. Each is recorded and counted in the money report. A finance admin marks each one reviewed, with a note.</p>
          <ul className={styles.history} data-testid="closeout-closed-money">
            {items.map((item) => (
              <li className={styles.entry} key={item.id} data-review={item.id}>
                <p className={styles.entryTitle}>{item.kind === "REFUND" ? "Refund" : "Payment"} of <Money cents={item.amountCents} /> on {when(item.createdAt)}</p>
                <p className={styles.note}>{item.reference ? <>Square reference: <CodeValue code={item.reference} /></> : "No Square reference is stored."}</p>
                {canReview ? (
                  <div className={styles.actions}>
                    <button className="secondary-button" type="button" onClick={() => review(item)} disabled={busyId !== null} aria-busy={busyId === item.id || undefined}>{busyId === item.id ? "Saving…" : "Mark reviewed"}</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div ref={messageRef} tabIndex={-1}>
        <FormMessage tone={outcome?.tone ?? "success"} message={outcome?.message ?? ""} />
      </div>
      {confirmDialog}
    </>
  );
}

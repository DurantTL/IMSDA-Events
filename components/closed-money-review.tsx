"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useConfirm } from "@/components/use-confirm";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
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
        body: JSON.stringify({ flagId: item.id, note }),
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

  return (
    <div className={styles.form}>
      <ul className={styles.history} data-testid="closeout-closed-money">
        {items.map((item) => (
          <li className={styles.entry} key={item.id} data-flag={item.id}>
            <p className={styles.entryTitle}>{item.kind === "REFUND" ? "Refund" : "Payment"} of {formatCents(item.amountCents)} on {when(item.createdAt)}</p>
            <p className={styles.note}>{item.reference ? `Square reference: ${item.reference}` : "No Square reference is stored."}</p>
            {canReview ? (
              <div className={styles.actions}>
                <button className="secondary-button" type="button" onClick={() => review(item)} disabled={busyId !== null} aria-busy={busyId === item.id || undefined}>{busyId === item.id ? "Saving…" : "Mark reviewed"}</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <FormMessage tone={outcome?.tone ?? "success"} message={outcome?.message ?? ""} />
      {confirmDialog}
    </div>
  );
}

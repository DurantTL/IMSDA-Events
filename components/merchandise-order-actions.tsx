"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EditorDialog } from "@/components/editor-dialog";
import { FormMessage, notSavedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { formatMerchandiseMoney, merchandiseEndpoint } from "@/components/merchandise-admin-ui";
import {
  availableMerchandiseOrderActions,
  MERCHANDISE_RECORDED_METHOD_LABELS,
  type MerchandiseOrderActionPermissions,
  type MerchandiseOrderActionValue,
  type MerchandiseRecordedMethod,
} from "@/modules/merchandise/order-actions-domain";
import type { MerchandiseOrderStatusValue } from "@/modules/merchandise/domain";
import styles from "./merchandise-orders-panel.module.css";

const buttonLabels: Record<MerchandiseOrderActionValue, string> = { MARK_PAID: "Mark paid", COMP: "Comp", CANCEL: "Cancel order" };

/**
 * Mark paid, Comp and Cancel for one merchandise order (#148). Only the actions this person may do, and the order's
 * status allows, are shown; the server checks both again. Mark paid only records a payment already received: it never
 * charges a card.
 */
export function MerchandiseOrderActions({ eventId, orderId, purchaserName, status, totalCents, permissions }: {
  eventId: string;
  orderId: string;
  purchaserName: string;
  status: MerchandiseOrderStatusValue;
  totalCents: number;
  permissions: MerchandiseOrderActionPermissions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<MerchandiseOrderActionValue | null>(null);
  const [method, setMethod] = useState<MerchandiseRecordedMethod>("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // One id per opened form, kept for a retry of the same submission so a second tap cannot apply it twice.
  const requestId = useRef("");
  const allowed = { MARK_PAID: permissions.canMarkPaid, COMP: permissions.canComp, CANCEL: permissions.canCancel };
  const actions = availableMerchandiseOrderActions(status).filter((action) => allowed[action]);
  if (actions.length === 0) return <span className={styles.note}>No actions</span>;

  function openForm(action: MerchandiseOrderActionValue) {
    requestId.current = crypto.randomUUID();
    setMethod("CASH");
    setError("");
    setOpen(action);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!open) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const body = open === "MARK_PAID"
      ? { action: open, clientRequestId: requestId.current, method, reference: text("reference") || undefined, note: text("note") || undefined }
      : { action: open, clientRequestId: requestId.current, reason: text("reason") };
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(merchandiseEndpoint(eventId, `/orders/${encodeURIComponent(orderId)}/actions`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "The order could not be changed.");
      setOpen(null);
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "The order could not be changed."));
    } finally {
      setSubmitting(false);
    }
  }

  const titles: Record<MerchandiseOrderActionValue, string> = { MARK_PAID: "Mark paid", COMP: "Comp this order", CANCEL: "Cancel this order" };
  return (
    <>
      <div className={styles.actions}>
        {actions.map((action) => <button className="secondary-button" key={action} type="button" onClick={() => openForm(action)}>{buttonLabels[action]}<span className="sr-only"> for {purchaserName}</span></button>)}
      </div>
      {open && (
        <EditorDialog closeLabel="Close" eyebrow={purchaserName} onRequestClose={() => !submitting && setOpen(null)} title={titles[open]}>
          <form className="form-stack" onSubmit={submit}>
            {open === "MARK_PAID" && (
              <>
                <p className={styles.note}>This records a payment you already received. It does not charge anyone. Amount: {formatMerchandiseMoney(totalCents)}, the full order total.</p>
                <label>Payment method
                  <select name="method" value={method} onChange={(event) => setMethod(event.target.value as MerchandiseRecordedMethod)}>
                    {(Object.keys(MERCHANDISE_RECORDED_METHOD_LABELS) as MerchandiseRecordedMethod[]).map((key) => <option key={key} value={key}>{MERCHANDISE_RECORDED_METHOD_LABELS[key]}</option>)}
                  </select>
                </label>
                {method !== "CASH" && (
                  <label>{method === "CHECK" ? "Check number" : "Square receipt or transaction reference"}
                    <input name="reference" required maxLength={60} autoComplete="off" />
                  </label>
                )}
                <label>Note <small>Optional</small><textarea name="note" rows={2} maxLength={300} /></label>
              </>
            )}
            {open === "COMP" && <p className={styles.note}>No charge for this order. The items still count for pickup, and the registrant gets a receipt that says so.</p>}
            {open === "CANCEL" && <p className={styles.note}>This frees the items. A paid order can&apos;t be cancelled here, because that would be a refund.</p>}
            {open !== "MARK_PAID" && <label>Reason<textarea name="reason" required minLength={3} maxLength={300} rows={3} /></label>}
            <div className="form-actions">
              <button className="secondary-button" type="button" disabled={submitting} onClick={() => setOpen(null)}>Back</button>
              <SubmitButton label={buttonLabels[open]} submitting={submitting} submittingLabel="Saving…" />
            </div>
            <FormMessage tone="error" message={error} />
          </form>
        </EditorDialog>
      )}
    </>
  );
}

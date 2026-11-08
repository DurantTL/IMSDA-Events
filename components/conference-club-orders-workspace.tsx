"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/conference-club-orders-workspace.module.css";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { conferenceOrderStatusLabels, orderGrandTotalCents, staffCanCancel, staffCanFill } from "@/modules/club-orders/conference-orders";
import type { ChurchBillRecord, StaffConferenceOrderRecord } from "@/modules/club-orders/conference-repository";
import { Money } from "@/components/exact-value";

const statusTone = { SUBMITTED: "gold", FILLED: "green", CANCELLED: "neutral" } as const;

const apiBase = "/api/admin/conference-club-orders";

/**
 * Conference club orders for youth department staff (#1688): every order clubs submitted, newest waiting first. Staff mark a
 * submitted order Filled (they enter the postage; it is added to the sponsoring church's bill as a draft invoice line, and can
 * optionally join the club's stock) or Cancelled with a reason. Filling never finalizes an invoice: the treasurer does that on the
 * invoice page. The server checks the role and every rule again; hiding a button is never the protection.
 */
export function ConferenceClubOrdersWorkspace({ orders, bills }: { orders: StaffConferenceOrderRecord[]; bills: ChurchBillRecord[] }) {
  const router = useRouter();
  const { ask, confirmDialog } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [postage, setPostage] = useState<Record<string, string>>({});
  const [addToStock, setAddToStock] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  // A postage problem is shown on that order's card, beside the field.
  const [postageError, setPostageError] = useState<Record<string, string>>({});
  // Postage typed or the stock box ticked, and not filled yet.
  useUnsavedChangesGuard(Object.values(postage).some((value) => value.trim() !== "") || Object.values(addToStock).some(Boolean));

  async function send(orderId: string, action: "fill" | "cancel", body: Record<string, unknown>, success: (result: Record<string, unknown>) => string) {
    setBusyId(orderId);
    setMessage(null);
    setPostageError((current) => ({ ...current, [orderId]: "" }));
    try {
      const response = await fetch(`${apiBase}/${encodeURIComponent(orderId)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = typeof result.message === "string" ? result.message : "The change could not be saved.";
        if (result.error === "INVALID_POSTAGE") setPostageError((current) => ({ ...current, [orderId]: reason }));
        else setMessage({ tone: "error", text: notSavedMessage(reason) });
        return;
      }
      setPostage((current) => ({ ...current, [orderId]: "" }));
      setAddToStock((current) => ({ ...current, [orderId]: false }));
      setMessage({ tone: "success", text: savedMessage(success(result)) });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("The change could not be saved. Check your connection and try again.") });
    } finally {
      setBusyId(null);
    }
  }

  function fill(order: StaffConferenceOrderRecord) {
    void send(order.id, "fill", { postage: postage[order.id] ?? "", addToStock: addToStock[order.id] ?? false }, (result) => {
      const outcome = result.invoiceOutcome;
      if (outcome === "REVISION_STARTED") return "It is on the church's bill as a revision draft, because that invoice was already finalized. The treasurer finalizes it.";
      return "It is on the church's bill as a draft invoice line. The treasurer finalizes the invoice.";
    });
  }

  async function cancel(order: StaffConferenceOrderRecord) {
    const reason = await ask({
      title: `Cancel the order from ${order.clubName}`,
      body: <p>The club is not billed. Say why, so the club can see it.</p>,
      confirmLabel: "Cancel order",
      destructive: true,
      input: { label: "Reason", required: true, maxLength: 500, multiline: true },
    });
    if (!reason) return;
    void send(order.id, "cancel", { reason }, () => "The order was cancelled.");
  }

  const waiting = orders.filter((order) => order.status === "SUBMITTED");
  const rest = orders.filter((order) => order.status !== "SUBMITTED");

  function renderOrder(order: StaffConferenceOrderRecord) {
    const busy = busyId === order.id;
    return (
      <li className={styles.card} key={order.id}>
        <div className={styles.head}>
          <strong>{order.clubName}</strong>
          <span className={`status-chip ${statusTone[order.status]}`}>{conferenceOrderStatusLabels[order.status]}</span>
        </div>
        <p className={styles.muted}>
          Billed to {order.churchName} · {order.clubYear} · submitted {formatInConferenceTime(order.submittedAt, { dateStyle: "long" })}
        </p>
        <ul className={styles.lines}>
          {order.lines.map((line) => <li key={line.itemId}>{line.itemName}: {line.quantity} at <Money cents={line.unitPriceCents} /> = <Money cents={line.quantity * line.unitPriceCents} /></li>)}
        </ul>
        <p className={styles.muted}>
          Pathfinder shoulder patches to exchange: {order.patchesToExchange} · Items <Money cents={order.itemsTotalCents} />
          {order.postageCents !== null ? <> · Postage <Money cents={order.postageCents} /> · Total <Money cents={orderGrandTotalCents(order)} /></> : " · Postage is added when filled"}
        </p>
        {order.status === "FILLED" && order.filledAt && (
          <p className={styles.muted}>Filled {formatInConferenceTime(order.filledAt, { dateStyle: "long" })}{order.addedToStock ? " · added to the club's stock" : ""}.</p>
        )}
        {order.status === "CANCELLED" && order.cancelledReason && <p className={styles.muted}>Cancelled: {order.cancelledReason}</p>}
        {staffCanFill(order.status) && (
          <div className={styles.fillForm}>
            <label className={styles.field}>
              Postage (dollars)
              <input
                aria-describedby={postageError[order.id] ? `postage-error-${order.id}` : undefined}
                aria-invalid={postageError[order.id] ? true : undefined}
                className={styles.input}
                inputMode="decimal"
                onChange={(event) => setPostage((current) => ({ ...current, [order.id]: event.target.value }))}
                placeholder="0.00"
                type="text"
                value={postage[order.id] ?? ""}
              />
              {postageError[order.id] && <small className="field-error-message" id={`postage-error-${order.id}`}>{postageError[order.id]}</small>}
            </label>
            <label className={styles.check}>
              <input checked={addToStock[order.id] ?? false} onChange={(event) => setAddToStock((current) => ({ ...current, [order.id]: event.target.checked }))} type="checkbox" />
              Add the items to the club&apos;s stock
            </label>
            <button className="primary-button" disabled={busy} onClick={() => fill(order)} type="button">{busy ? "Saving…" : "Mark filled and add to church bill"}</button>
            {staffCanCancel(order.status) && <button className="secondary-button" disabled={busy} onClick={() => void cancel(order)} type="button">Cancel order</button>}
          </div>
        )}
      </li>
    );
  }

  return (
    <section className={styles.page}>
      {confirmDialog}
      <section aria-labelledby="conference-orders-waiting" className={styles.block}>
        <h2 id="conference-orders-waiting">Waiting to be filled ({waiting.length})</h2>
        <p className={styles.intro}>
          Clubs order the conference patches and pins from their Orders tab. Mark an order filled when it is shipped or handed out. Prices are set in the{" "}
          <Link href="/admin/club-supplies">Club supply catalog</Link>; a price change never alters an order already submitted.
        </p>
        {waiting.length === 0 ? <p className={styles.muted}>No orders are waiting. A new club order shows here and is emailed to the conference orders address.</p> : <ul className={styles.list}>{waiting.map(renderOrder)}</ul>}
        <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />
      </section>

      <section aria-labelledby="conference-orders-bills" className={styles.block}>
        <h2 id="conference-orders-bills">Church bills</h2>
        <p className={styles.intro}>
          Filled orders become lines on the sponsoring church&apos;s invoice for the club year. The treasurer finalizes each invoice as usual; nothing is finalized or sent from here.
        </p>
        {bills.length === 0 ? <p className={styles.muted}>No bills yet. A church&apos;s bill appears here when one of its clubs&apos; orders is filled.</p> : (
          <ul className={styles.list}>
            {bills.map((bill) => (
              <li className={styles.billRow} key={bill.invoiceId}>
                <span>{bill.churchName} · {bill.clubYear} · {bill.status === "DRAFT" ? (bill.hasOpenRevision ? "Revision draft" : "Draft") : `Finalized ${bill.number ?? ""}`} · <Money cents={bill.amountDueCents} /></span>
                <Link href={`/finance/invoices/${encodeURIComponent(bill.invoiceId)}?event=${encodeURIComponent(bill.eventId)}`}>Open invoice</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="conference-orders-history" className={styles.block}>
        <h2 id="conference-orders-history">Filled and cancelled orders</h2>
        {rest.length === 0 ? <p className={styles.muted}>Nothing filled or cancelled yet.</p> : <ul className={styles.list}>{rest.map(renderOrder)}</ul>}
      </section>
    </section>
  );
}

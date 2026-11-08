"use client";

import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/club-conference-orders.module.css";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import {
  NO_CHURCH_MESSAGE,
  conferenceOrderStatusLabels,
  directorCanCancel,
  itemsTotalCents,
  wholeCount,
} from "@/modules/club-orders/conference-orders";
import type { ClubConferenceOrderWorkspace, ConferenceOrderRecord } from "@/modules/club-orders/conference-repository";
import { Money } from "@/components/exact-value";

/**
 * A club's "Conference order" section (#1688): the conference-supplied patches and pin, their prices and a quantity each, the
 * patches to exchange, the total ("postage not included"), and the club's own conference orders with their status. The order goes
 * to the youth department, not AdventSource, and is billed to the club's sponsoring church once filled. A director may cancel an
 * order while it is still Submitted. The server checks the club role and every rule again; hiding a button is never the protection.
 */
export function ClubConferenceOrderSection({
  organizationId,
  initial,
  readOnly,
}: {
  organizationId: string;
  initial: ClubConferenceOrderWorkspace;
  readOnly: boolean;
}) {
  const [orders, setOrders] = useState<ConferenceOrderRecord[]>(initial.orders);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [exchange, setExchange] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const base = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/orders/conference`;

  const lines = initial.items.map((item) => ({ ...item, quantity: wholeCount(quantities[item.itemId]) }));
  const total = itemsTotalCents(lines.map((line) => ({ quantity: line.quantity, unitPriceCents: line.unitPriceCents })));
  const canSubmit = !readOnly && !busy && lines.some((line) => line.quantity > 0);
  // Typed quantities that were not sent yet.
  useUnsavedChangesGuard(lines.some((line) => line.quantity > 0) || wholeCount(exchange) > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantities: Object.fromEntries(lines.filter((line) => line.quantity > 0).map((line) => [line.itemId, line.quantity])), patchesToExchange: wholeCount(exchange) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: notSavedMessage(typeof result.message === "string" ? result.message : "The order could not be sent.") });
        return;
      }
      setOrders((current) => [result.order as ConferenceOrderRecord, ...current]);
      setQuantities({});
      setExchange("");
      setMessage({ tone: "success", text: savedMessage("The youth department has your order, and you will get a confirmation email.") });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("The order could not be sent. Check your connection and try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(order: ConferenceOrderRecord) {
    const confirmed = await confirm({
      title: "Cancel this conference order",
      body: <p>The youth department will not fill it, and your church will not be billed.</p>,
      confirmLabel: "Cancel order",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(order.id)}/cancel`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: notSavedMessage(typeof result.message === "string" ? result.message : "The order could not be cancelled.") });
        return;
      }
      setOrders((current) => current.map((entry) => (entry.id === order.id ? { ...entry, status: "CANCELLED", cancelledReason: "Cancelled by the club.", cancelledAt: new Date().toISOString() } : entry)));
      setMessage({ tone: "success", text: savedMessage("The order was cancelled.") });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("The order could not be cancelled. Check your connection and try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="conference-order-heading" className={styles.section} id="conference-order">
      {confirmDialog}
      <h2 id="conference-order-heading">Conference order: patches and pins</h2>
      <p className={styles.intro}>
        These come from the conference youth department, not AdventSource. The order is billed to {initial.churchName ?? "your sponsoring church"}. Postage is not included; the youth department adds it when the order is filled.
      </p>

      {initial.churchName === null && !readOnly && <p className={styles.notice} role="status">{NO_CHURCH_MESSAGE}</p>}

      {initial.items.length === 0 ? (
        <p className={styles.muted}>No conference items are available to order yet. The youth department sets the items and prices.</p>
      ) : (
        <form aria-label="Conference order" onSubmit={submit}>
          <ul className={styles.items}>
            {initial.items.map((item) => (
              <li className={styles.item} key={item.itemId}>
                <span className={styles.itemText}>
                  <strong>{item.name}</strong>
                  <small><Money cents={item.unitPriceCents} /> each</small>
                </span>
                <label>
                  <span className="sr-only">{item.name} quantity</span>
                  <input
                    className={styles.quantity}
                    disabled={readOnly || initial.churchName === null}
                    inputMode="numeric"
                    max={9999}
                    min={0}
                    onChange={(event) => setQuantities((current) => ({ ...current, [item.itemId]: event.target.value }))}
                    placeholder="0"
                    type="number"
                    value={quantities[item.itemId] ?? ""}
                  />
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.exchange}>
            <label>
              Pathfinder shoulder patches to exchange
              <input
                className={styles.quantity}
                disabled={readOnly || initial.churchName === null}
                inputMode="numeric"
                max={9999}
                min={0}
                onChange={(event) => setExchange(event.target.value)}
                placeholder="0"
                type="number"
                value={exchange}
              />
            </label>
          </div>
          <p className={styles.totals}>
            <strong>Items total: <Money cents={total} /></strong>
            <span>Postage not included.</span>
          </p>
          <div className={styles.actions}>
            <button className="primary-button" disabled={!canSubmit || initial.churchName === null} type="submit">{busy ? "Working…" : "Submit order"}</button>
          </div>
          {readOnly && <p className={styles.muted}>Only a director or deputy can place a conference order.</p>}
        </form>
      )}
      <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />

      <h3>Your conference orders</h3>
      {orders.length === 0 ? (
        <p className={styles.muted}>No conference orders yet. An order you submit shows here with its status.</p>
      ) : (
        <ul className={styles.orders}>
          {orders.map((order) => (
            <li className={styles.order} key={order.id}>
              <div className={styles.orderHead}>
                <span className={styles.status}>{conferenceOrderStatusLabels[order.status]}</span>
                <span className={styles.muted}>{formatInConferenceTime(order.submittedAt, { dateStyle: "long" })}</span>
              </div>
              <ul className={styles.lines}>
                {order.lines.map((line) => <li key={line.itemId}>{line.itemName}: {line.quantity} at <Money cents={line.unitPriceCents} /></li>)}
              </ul>
              {order.patchesToExchange > 0 && <p className={styles.muted}>Pathfinder shoulder patches to exchange: {order.patchesToExchange}</p>}
              <p className={styles.totals}>
                <strong>Items <Money cents={order.itemsTotalCents} />{order.postageCents !== null && <>, postage <Money cents={order.postageCents} /></>}</strong>
              </p>
              {order.status === "CANCELLED" && order.cancelledReason && <p className={styles.muted}>Cancelled: {order.cancelledReason}</p>}
              {!readOnly && directorCanCancel(order.status) && (
                <div className={styles.actions}>
                  <button className="secondary-button" disabled={busy} onClick={() => void cancel(order)} type="button">Cancel order</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

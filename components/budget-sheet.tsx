"use client";

import { Download } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { BudgetCostLineRow, BudgetFiguresBlock, BudgetTotalsBlock } from "@/components/budget-sheet-view";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Money } from "@/components/exact-value";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { PrintReportButton } from "@/components/print-report-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { COST_LABEL_SUGGESTIONS, MAX_DESCRIPTION_LENGTH, computeBudgetTotals, parseDollarsToCents, type BudgetFigures, type CostLineView } from "@/modules/event-budgets/domain";
import styles from "@/components/budget-sheet.module.css";

type Draft = { id: string | null; label: string; description: string; quantity: string; amount: string };
const blankDraft: Draft = { id: null, label: COST_LABEL_SUGGESTIONS[0], description: "", quantity: "", amount: "" };

/**
 * This year's Budget sheet (#1682): the figures that filled in from registrations, the cost lines a person can add, change
 * and delete (when `canEdit`), the totals, and the print and CSV buttons. There is no file upload: nothing here holds a receipt.
 * The server decides who may change a line; this only shows or hides the controls.
 */
export function BudgetSheetEditor({ endpoint, exportHref, eventName, figures, initialLines, canEdit }: {
  /** The route that takes cost line changes (`.../budget/lines`). */
  endpoint: string;
  exportHref: string;
  eventName: string;
  figures: BudgetFigures;
  initialLines: CostLineView[];
  canEdit: boolean;
}) {
  const [lines, setLines] = useState(initialLines);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [confirming, setConfirming] = useState<CostLineView | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; quantity?: string }>({});
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const formId = useId();
  useUnsavedChangesGuard(draft !== null && JSON.stringify(draft) !== baseline);
  const totals = useMemo(() => computeBudgetTotals(figures.money, lines), [figures.money, lines]);

  function startEdit(line: CostLineView | null) {
    setMessage(null);
    setFieldErrors({});
    const next: Draft = line ? { id: line.id, label: line.label, description: line.description, quantity: line.quantity === null ? "" : String(line.quantity), amount: (line.amountCents / 100).toFixed(2) } : { ...blankDraft };
    setBaseline(JSON.stringify(next));
    setDraft(next);
  }

  /** An error shows in the form, or in the delete dialog while that is open. */
  function setProblem(text: string) {
    if (confirming) setDeleteError(text);
    else setMessage({ tone: "error", text });
  }

  async function request(method: "POST" | "PATCH" | "DELETE", body: object) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { line?: CostLineView; message?: string };
      if (!response.ok) {
        setProblem(notSavedMessage(result.message ?? "Try again."));
        return null;
      }
      return result;
    } catch {
      setProblem(notSavedMessage("Check your connection and try again."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const amountCents = parseDollarsToCents(draft.amount);
    const quantityText = draft.quantity.trim();
    const quantity = quantityText === "" ? null : Number(quantityText);
    const found: { amount?: string; quantity?: string } = {};
    if (amountCents === null) found.amount = "Enter the amount in dollars, like 12.50.";
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) found.quantity = "Quantity must be a whole number of at least 1, or left blank.";
    setFieldErrors(found);
    if (found.amount || found.quantity || amountCents === null) {
      setMessage({ tone: "error", text: notSavedMessage(found.amount ?? found.quantity ?? "Review what you entered.") });
      return;
    }
    const body = { label: draft.label, description: draft.description.trim(), quantity, amountCents };
    const result = await request(draft.id ? "PATCH" : "POST", draft.id ? { id: draft.id, ...body } : body);
    if (!result?.line) return;
    const saved = result.line;
    setLines((current) => draft.id ? current.map((line) => (line.id === saved.id ? saved : line)) : [...current, saved]);
    setBaseline("");
    setDraft(null);
    setMessage({ tone: "success", text: savedMessage(draft.id ? "Cost updated." : "Cost added.") });
  }

  async function remove(id: string) {
    const result = await request("DELETE", { id });
    if (!result) return;
    setLines((current) => current.filter((line) => line.id !== id));
    setConfirming(null);
    setDeleteError("");
    setMessage({ tone: "success", text: savedMessage("Cost deleted.") });
  }

  return (
    <div className={styles.sheet} data-testid="budget-sheet">
      <h2 className={styles.printTitle}>Budget sheet: {eventName}</h2>
      <div className={`${styles.toolbar} ${styles.noPrint}`}>
        <PrintReportButton label="Print" />
        <a className="secondary-button" download href={exportHref}><Download aria-hidden="true" size={15} />Download CSV</a>
      </div>
      <BudgetFiguresBlock figures={figures} headingId="budget-figures" />
      <section className={styles.block} aria-labelledby="budget-costs">
        <h3 className={styles.heading} id="budget-costs">Costs</h3>
        {lines.length === 0 ? <p className={styles.empty}>No costs yet.{canEdit ? " Add the first one below." : ""}</p> : (
          <ul className={styles.lines}>
            {lines.map((line) => (
              <BudgetCostLineRow
                key={line.id}
                line={line}
                actions={canEdit ? (
                  <div className={`${styles.actions} ${styles.noPrint}`}>
                    <button className="secondary-button" disabled={busy} onClick={() => startEdit(line)} type="button">Edit<span className="sr-only">: {line.label}</span></button>
                    <button className="secondary-button" disabled={busy} onClick={() => { setDeleteError(""); setConfirming(line); }} type="button">Delete<span className="sr-only">: {line.label}</span></button>
                  </div>
                ) : undefined}
              />
            ))}
          </ul>
        )}
        {canEdit && !draft && (
          <div className={styles.noPrint}>
            <button className="secondary-button" disabled={busy} onClick={() => startEdit(null)} type="button">Add a cost</button>
          </div>
        )}
        {canEdit && draft && (
          <form noValidate className={`${styles.form} ${styles.noPrint}`} onSubmit={(event) => void save(event)} aria-labelledby={`${formId}-title`}>
            <h4 className={styles.heading} id={`${formId}-title`}>{draft.id ? "Change this cost" : "Add a cost"}</h4>
            <div className={styles.fields}>
              <label className={styles.field}>What is it for?
                <select value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })}>
                  {COST_LABEL_SUGGESTIONS.map((label) => <option key={label} value={label}>{label}</option>)}
                </select>
              </label>
              <label className={styles.field}>Details (optional)
                <input maxLength={MAX_DESCRIPTION_LENGTH} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </label>
              <label className={styles.field}>Quantity (optional)
                <input {...fieldErrorProps(`${formId}-quantity-error`, fieldErrors.quantity)} inputMode="numeric" value={draft.quantity} onChange={(event) => { setDraft({ ...draft, quantity: event.target.value }); setFieldErrors((current) => ({ ...current, quantity: undefined })); }} />
                <FieldError id={`${formId}-quantity-error`}>{fieldErrors.quantity}</FieldError>
              </label>
              <label className={styles.field}>Amount in dollars
                <input {...fieldErrorProps(`${formId}-amount-error`, fieldErrors.amount, `${formId}-amount-help`)} inputMode="decimal" required value={draft.amount} onChange={(event) => { setDraft({ ...draft, amount: event.target.value }); setFieldErrors((current) => ({ ...current, amount: undefined })); }} />
                <span className={styles.help} id={`${formId}-amount-help`}>The total for this line, like 125.00.</span>
                <FieldError id={`${formId}-amount-error`}>{fieldErrors.amount}</FieldError>
              </label>
            </div>
            <div className={styles.toolbar}>
              <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save cost"}</button>
              <button className="secondary-button" disabled={busy} onClick={() => { setBaseline(""); setDraft(null); }} type="button">Cancel</button>
            </div>
            {message && <FormMessage message={message.text} tone={message.tone} />}
          </form>
        )}
        {!canEdit && <p className={`${styles.note} ${styles.noPrint}`}>You can read this sheet. Finance staff and Area Coordinators add the costs.</p>}
        {message && !draft && <div className={styles.noPrint}><FormMessage message={message.text} tone={message.tone} /></div>}
      </section>
      <BudgetTotalsBlock totals={totals} headingId="budget-totals" />
      <ConfirmDialog
        busy={busy}
        busyLabel="Deleting…"
        confirmLabel="Delete cost"
        destructive
        error={deleteError}
        onCancel={() => { setConfirming(null); setDeleteError(""); }}
        onConfirm={() => { if (confirming) void remove(confirming.id); }}
        open={confirming !== null}
        title="Delete this cost?"
      >
        {confirming && (
          <p>
            {confirming.label}{confirming.description ? `: ${confirming.description}` : ""}, <Money cents={confirming.amountCents} />. It comes off the totals. This cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

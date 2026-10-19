"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { kitchenCountKindLabels, kitchenCountKinds, KITCHEN_COUNT_MAX, KITCHEN_NOTE_MAX, type KitchenCountKind } from "@/modules/meals/kitchen-count-kinds";

export type KitchenEntryService = {
  key: string;
  label: string;
  ordered: number;
  served: number;
  cells: Partial<Record<KitchenCountKind, { quantity: number; note: string; entryId: string; byline: string }>>;
};

function CountForm({ eventId, service, kind }: { eventId: string; service: KitchenEntryService; kind: KitchenCountKind }) {
  const router = useRouter();
  const cell = service.cells[kind];
  const kindLabel = kitchenCountKindLabels[kind];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const id = `${service.key.replace(/[^a-z0-9]/gi, "-")}-${kind}`;
  const invalid = message?.tone === "error";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get("quantity") ?? "").trim();
    if (!/^\d+$/.test(raw)) { setMessage({ tone: "error", text: "Enter a whole number, 0 or more." }); return; }
    setBusy(true);
    setMessage({ tone: "ok", text: "Saving…" });
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/meals/kitchen-counts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceKey: service.key, kind, quantity: Number(raw), note: String(form.get("note") ?? ""), supersedesId: cell?.entryId ?? null }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; changed?: boolean };
      if (!response.ok) throw new Error(result.message ?? "That could not be saved. Nothing was changed.");
      setMessage({ tone: "ok", text: result.changed === false ? `${kindLabel} for ${service.label}: no change.` : `${kindLabel} for ${service.label} saved.` });
      router.refresh();
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "That could not be saved. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kitchen-count-block">
      {/* The key makes a refreshed figure reset the inputs to the new current entry. The status region below stays mounted, so its text is announced. */}
      <form className="kitchen-count-form form-stack" key={cell?.entryId ?? "none"} onSubmit={save} noValidate>
        <label htmlFor={`${id}-q`}>{kindLabel}<span className="sr-only"> for {service.label}</span>
          <input id={`${id}-q`} name="quantity" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={String(KITCHEN_COUNT_MAX).length}
            defaultValue={cell ? String(cell.quantity) : ""} placeholder="Not entered"
            aria-invalid={invalid ? true : undefined} aria-describedby={invalid ? `${id}-msg ${id}-by` : `${id}-by`} />
        </label>
        <label htmlFor={`${id}-n`}>Note (optional)<span className="sr-only"> for {kindLabel.toLowerCase()}, {service.label}</span>
          <input id={`${id}-n`} name="note" type="text" maxLength={KITCHEN_NOTE_MAX} defaultValue={cell?.note ?? ""} autoComplete="off" aria-describedby={`${id}-nh`} />
        </label>
        <p className="field-help" id={`${id}-nh`}>Counts context only. No names or health details.</p>
        <p className="field-help" id={`${id}-by`}>{cell ? `Current: ${cell.quantity}. ${cell.byline}` : "Nothing entered yet."}</p>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Saving…" : cell ? `Correct ${kindLabel.toLowerCase()}` : `Save ${kindLabel.toLowerCase()}`}<span className="sr-only"> for {service.label}</span>
          </button>
        </div>
      </form>
      <p className={invalid ? "form-error" : "field-help"} id={`${id}-msg`} role="status" aria-live="polite">{message?.text ?? ""}</p>
    </div>
  );
}

/**
 * Enter kitchen counts (#1029), one card per meal service, one small form per count so a phone shows one thing at a time.
 * Saving adds a new entry; a correction replaces the earlier figure in the report but both stay in the history.
 */
export function KitchenCountsEntry({ eventId, services }: { eventId: string; services: KitchenEntryService[] }) {
  if (services.length === 0) return <p>No meal services have tickets yet, so there is nothing to enter counts for.</p>;
  return (
    <div className="kitchen-entry-list">
      {services.map((service) => (
        <section className="panel kitchen-entry-card" key={service.key} aria-labelledby={`svc-${service.key.replace(/[^a-z0-9]/gi, "-")}`}>
          <h3 id={`svc-${service.key.replace(/[^a-z0-9]/gi, "-")}`}>{service.label}</h3>
          <p className="field-help">Ordered {service.ordered} · Served {service.served} (from the scanner; not changed by anything entered here)</p>
          {kitchenCountKinds.map((kind) => <CountForm key={kind} eventId={eventId} service={service} kind={kind} />)}
        </section>
      ))}
    </div>
  );
}

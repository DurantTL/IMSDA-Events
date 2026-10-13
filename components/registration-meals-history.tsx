"use client";

import { useState } from "react";
import { mealAgeGroupLabels, mealTypeLabels, money, type MealAgeGroupValue, type MealTypeValue } from "@/modules/meals/domain";
import type { loadRegistrationMeals } from "@/modules/meals/view-repository";

type Selections = Awaited<ReturnType<typeof loadRegistrationMeals>>;

/**
 * A registration's meal selections with every change and ledger entry, read-only (#210). Loaded on request so the
 * Finance list stays light. Changes are made on the Meals screen, never here.
 */
export function RegistrationMealsHistory({ eventId, registrationId }: { eventId: string; registrationId: string }) {
  const [selections, setSelections] = useState<Selections | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/meals/registrations/${encodeURIComponent(registrationId)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.message ?? "The meal history could not be loaded.");
      setSelections(json.selections);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The meal history could not be loaded.");
    } finally { setBusy(false); }
  }

  return <div>
    <p className="eyebrow">Meals</p>
    {selections === null ? <button className="secondary-button full-button" type="button" disabled={busy} onClick={() => void load()}>Show meal history</button> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {selections !== null && selections.length === 0 ? <p className="quiet-copy">No meal selections on this registration.</p> : null}
    {selections?.map((selection) => <div className="payment-history" key={selection.id}>
      <span>
        <strong>
          {selection.quantity} × {mealTypeLabels[selection.mealType as MealTypeValue]} ({mealAgeGroupLabels[selection.ageGroup as MealAgeGroupValue]})
          {selection.service ? ` · ${selection.service.name}` : " · any service"} · {selection.payer === "CONFERENCE" ? "conference pays" : money(selection.unitPriceCents)} each · {selection.status.toLowerCase()}
        </strong>
        <small>{selection.planName} · {selection.source.toLowerCase().replace("_", " ")}</small>
        <ul>
          {selection.changes.map((change) => <li key={change.id}><small>{new Date(change.createdAt).toLocaleString()} · {change.type.toLowerCase().replaceAll("_", " ")} · {change.actorName}{change.reason ? ` · ${change.reason}` : ""}</small></li>)}
          {selection.ledger.map((entry) => <li key={entry.id}><small>{entry.kind === "CREDIT" ? "Credit" : "Charge"} {money(Math.abs(entry.amountCents))} ({entry.quantity} × {money(entry.unitPriceCents)}) · {entry.settlement.toLowerCase().replaceAll("_", " ")}</small></li>)}
        </ul>
      </span>
    </div>)}
  </div>;
}

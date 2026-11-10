"use client";

import { ExportLink } from "@/components/export-link";
import { EventSetupHelp } from "@/components/event-setup-help";
import { useState, type FormEvent } from "react";
import { formHasEdits } from "@/components/form-has-edits";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import { StaffPageHeader } from "@/components/staff-page-header";
import { cardCell } from "@/components/table-card-labels";
import styles from "./meals-kitchen.module.css";
import { formatCents } from "@/modules/payments/format-cents";
import {
  mealAgeGroupLabels,
  mealAgeGroups,
  mealPayerLabels,
  mealTypeLabels,
  mealTypes,
  type MealAgeGroupValue,
  type MealTypeValue,
} from "@/modules/meals/domain";
import type { MealPresetOption } from "@/modules/event-content/domain";
import type { MealView } from "@/modules/meals/view-repository";

type Plan = MealView["plans"][number];
type Service = MealView["services"][number];

// The meals ordered table sorts from its headers (#1458); the keys here are the whitelist. The other tables are in a set order:
// meal services by when they are served, the recent orders as an activity log (newest first), and the price grid by meal.
type MealTotal = MealView["totals"][number];
const TOTAL_SORT: Record<"meal" | "age" | "payer" | "quantity", ColumnSpec<MealTotal>> = {
  meal: { value: (row) => mealTypeLabels[row.mealType as MealTypeValue], label: "meal" },
  age: { value: (row) => mealAgeGroupLabels[row.ageGroup as MealAgeGroupValue], label: "age group" },
  payer: { value: (row) => (row.payer === "CONFERENCE" ? "Conference" : "Attendee"), label: "payer" },
  quantity: { value: (row) => row.quantity, label: "quantity", kind: "number" },
};

async function call(url: string, method: string, body: unknown): Promise<{ meals: MealView }> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
  return json;
}

function serviceLabel(service: Service) {
  return `${service.serviceDate} ${service.startTime}${service.endTime ? `–${service.endTime}` : ""}`;
}

/** Tracks one uncontrolled form for the unsaved-changes guard: `track` goes on its onChange, `clear` runs after a save or reset. */
function useEditedForm() {
  const [edited, setEdited] = useState(false);
  // Unsaved work: any field of this form changed from its starting value, until it is saved or reset (#1468).
  useUnsavedChangesGuard(edited);
  return { track: (event: FormEvent<HTMLFormElement>) => setEdited(formHasEdits(event.currentTarget)), clear: () => setEdited(false) };
}

const reasonHint = "Do not enter allergy, medical or other personal details.";

export function MealsWorkspace({ eventId, initialView, presets = [], canConfigure, canManageFinance, canExport }: {
  eventId: string; initialView: MealView; presets?: MealPresetOption[]; canConfigure: boolean; canManageFinance: boolean; canExport: boolean;
}) {
  const [view, setView] = useState(initialView);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const totalSort = useTableSort(view.totals, TOTAL_SORT, "ordered");
  const base = `/api/events/${eventId}/meals`;
  const addPlan = useEditedForm();

  async function run(action: () => Promise<{ meals: MealView }>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      setView(result.meals);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That could not be saved.");
      return false;
    } finally { setBusy(false); }
  }

  const activeServices = view.services.filter((service) => service.status === "ACTIVE" && service.ticketing === "TICKETED");

  const { ask, confirmDialog } = useConfirm();
  return <div className="settings-stack">
    {confirmDialog}
    <StaffPageHeader
      description="Meal services, plans and prices, and walk-up orders. What people ordered is kept apart from what the café scanner served."
      actions={canExport ? <>
        <li><ExportLink href={`/api/events/${eventId}/exports/meal-tickets`}>Download meal tickets CSV (café scanner format)</ExportLink></li>
        <li><ExportLink href={`/api/events/${eventId}/exports/meal-ticket-summary`}>Download meal ticket summary</ExportLink></li>
      </> : undefined}
    />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="usage-note" role="status">{notice}</p> : null}
    {view.formWarnings.map((warning) => <p className="form-error" role="alert" key={`${warning.formName}-${warning.status}`}>
      The {warning.status === "PUBLISHED" ? "published" : "draft"} version of {warning.formName} sells meal tickets at prices that differ from the ticket plan ({warning.fieldKeys.length} field{warning.fieldKeys.length === 1 ? "" : "s"}).
      Open the form in the registration builder, save it again to bring the prices up to date, run a test submission, and republish it. Until then registrants are charged the form&apos;s old prices.
    </p>)}

    {view.services.length === 0 && view.plans.length === 0 ? presets.map((preset) => <section className="panel" key={preset.key}>
      <h3>Start from {preset.label}</h3>
      <p>{preset.description}</p>
      {canManageFinance ? <button className="primary-button" type="button" disabled={busy} onClick={() => void run(() => call(`${base}/defaults`, "POST", { preset: preset.key }), `${preset.label} meals added.`)}>Add the {preset.label} meals</button> : <p>Only staff who manage finance can add the preset.</p>}
    </section>) : null}

    <section className="panel">
      <h3>Meals ordered</h3>
      <p className={`field-help ${styles.help}`}>Registration form tickets are priced from the ticket plan below.</p>
      {view.totals.length === 0 ? <p>No meals have been ordered yet.</p> : <div className="table-wrap">{totalSort.note}<table role="table" className="report-table report-table-auto table-cards">
        <caption>Active selections of submitted and confirmed registrations, and walk-up orders</caption>
        <thead role="rowgroup"><tr role="row">{totalSort.header("meal", "Meal")}{totalSort.header("age", "Age group")}{totalSort.header("payer", "Payer")}{totalSort.header("quantity", "Quantity")}</tr></thead>
        <tbody role="rowgroup">{totalSort.rows.map((row) => <tr role="row" key={`${row.mealType}${row.ageGroup}${row.payer}`}>
          <th role="rowheader" scope="row">{mealTypeLabels[row.mealType as MealTypeValue]}</th><td {...cardCell("Age group")}>{mealAgeGroupLabels[row.ageGroup as MealAgeGroupValue]}</td>
          <td {...cardCell("Payer")}>{row.payer === "CONFERENCE" ? "Conference" : "Attendee"}</td><td {...cardCell("Quantity")}>{row.quantity}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    <section className="panel">
      <h3>Meal services</h3>
      {view.services.length === 0 ? <><p>No meal services yet. Add one below.</p><EventSetupHelp context="meal services" id="meals-no-services" /></> : <div className="table-wrap"><table role="table" className="report-table report-table-auto table-cards">
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Service</th><th role="columnheader" scope="col">When</th><th role="columnheader" scope="col">Where</th><th role="columnheader" scope="col">Capacity</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody role="rowgroup">{view.services.map((service) => <ServiceRow key={service.id} service={service} base={base} busy={busy} run={run} canManageFinance={canManageFinance} canConfigure={canConfigure} />)}</tbody>
      </table></div>}
      {canConfigure ? <ServiceForm title="Add a meal service" submitLabel="Add service" busy={busy} onSubmit={(input) => run(() => call(`${base}/services`, "POST", input), "Meal service added.")} /> : <p>Only event administrators can add or edit meal services.</p>}
    </section>

    {view.plans.map((plan) => <PlanPanel key={plan.id} plan={plan} view={view} base={base} busy={busy} run={run} canManageFinance={canManageFinance} services={activeServices} />)}

    {canManageFinance ? <section className="panel">
      <h3>Add a meal plan</h3>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const payer = String(form.get("payer"));
        const body = {
          code: String(form.get("code")), name: String(form.get("name")), description: String(form.get("description") ?? ""), payer,
          isDefaultTicketPlan: form.get("isDefaultTicketPlan") === "on" && payer === "ATTENDEE", includesAllServices: form.get("includesAllServices") === "on",
          defaultEntitlement: payer === "CONFERENCE" ? "INCLUDED" : "PAID", isActive: true,
        };
        void run(() => call(`${base}/plans`, "POST", body), "Meal plan added.").then((ok) => { if (ok) addPlan.clear(); });
      }} onChange={addPlan.track}>
        <label>Code <input name="code" required maxLength={40} placeholder="meal-tickets" /></label>
        <label>Name <input name="name" required maxLength={80} /></label>
        <label>Description <input name="description" maxLength={500} /></label>
        <label>Who pays <select name="payer" defaultValue="ATTENDEE"><option value="ATTENDEE">{mealPayerLabels.ATTENDEE}</option><option value="CONFERENCE">{mealPayerLabels.CONFERENCE}</option></select></label>
        <label><input name="includesAllServices" type="checkbox" defaultChecked /> Covers every ticketed service</label>
        <label><input name="isDefaultTicketPlan" type="checkbox" /> Sells the registration form&apos;s tickets (attendee-paid only)</label>
        <button className="primary-button" type="submit" disabled={busy}>Add plan</button>
      </form>
    </section> : <p>Only staff who manage finance can add plans or set prices.</p>}

    <section className="panel">
      <h3>Walk-up orders</h3>
      <p>A walk-up order is for one service and is settled at the counter by staff. Nothing is charged to a card here.</p>
      {canManageFinance ? <WalkUpForm services={activeServices} plans={view.plans.filter((plan) => plan.payer === "ATTENDEE" && plan.isActive)} base={base} busy={busy} run={run} /> : <p>Only staff who manage finance can take orders.</p>}
      {view.recentOrders.length > 0 ? <div className="table-wrap"><table role="table" className="report-table report-table-auto table-cards">
        <caption>Recent staff, walk-up and entitlement selections</caption>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Meal</th><th role="columnheader" scope="col">For</th><th role="columnheader" scope="col">Qty</th><th role="columnheader" scope="col">Each</th><th role="columnheader" scope="col">Source</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody role="rowgroup">{view.recentOrders.map((order) => <tr role="row" key={order.id}>
          <th className={styles.wrap} role="rowheader" scope="row">{mealTypeLabels[order.mealType as MealTypeValue]} ({mealAgeGroupLabels[order.ageGroup as MealAgeGroupValue]}){order.serviceName ? `, ${order.serviceName}` : ""}</th>
          <td {...cardCell("For")} className={styles.wrap}>{order.confirmationCode ?? order.orderLabel ?? "Walk-up"}</td><td {...cardCell("Qty")}>{order.quantity}</td>
          <td {...cardCell("Each")}>{order.payer === "CONFERENCE" ? "Conference" : formatCents(order.unitPriceCents)}</td><td {...cardCell("Source")}>{order.source.toLowerCase().replace("_", " ")}</td><td {...cardCell("Status")}>{order.status.toLowerCase()}</td>
          <td {...cardCell(null)}>{canManageFinance && order.status === "ACTIVE" ? <button type="button" disabled={busy} onClick={async () => {
            const reason = await ask({
              title: "Cancel this order?",
              body: <p>The order is cancelled and credited.</p>,
              confirmLabel: "Cancel order",
              destructive: true,
              input: { label: "Why is this order being cancelled?", required: true, minLength: 3, maxLength: 500, hint: `At least 3 characters. ${reasonHint}` },
            });
            if (reason) void run(() => call(`${base}/selections/${order.id}`, "POST", { action: "cancel", reason }), "Order cancelled and credited.");
          }}>Cancel</button> : null}</td>
        </tr>)}</tbody>
      </table></div> : null}
    </section>
  </div>;
}

function ServiceRow({ service, base, busy, run, canManageFinance, canConfigure }: {
  service: Service; base: string; busy: boolean; canManageFinance: boolean; canConfigure: boolean;
  run: (action: () => Promise<{ meals: MealView }>, success: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const { ask, confirmDialog } = useConfirm();
  const cancelled = service.status === "CANCELLED";
  return <>
    <tr role="row">
      <th className={styles.wrap} role="rowheader" scope="row">{service.name} ({mealTypeLabels[service.mealType]}{service.ticketing === "DONATION_ONLY" ? ", donation-only" : ""})</th>
      <td {...cardCell("When")}>{serviceLabel(service)}</td><td {...cardCell("Where")} className={styles.wrap}>{service.location ?? ""}</td>
      <td {...cardCell("Capacity")}>{service.capacity === null ? "No limit" : `${service.pinnedQuantity} of ${service.capacity}`}</td>
      <td {...cardCell("Status")} className={styles.wrap}>{cancelled ? `Cancelled${service.cancelReason ? `: ${service.cancelReason}` : ""}` : "Active"}</td>
      <td {...cardCell(null)}>
        {confirmDialog}
        {!cancelled && canConfigure ? <button type="button" disabled={busy} onClick={() => setEditing((value) => !value)}>{editing ? "Close" : "Edit"}</button> : null}
        {!cancelled && canConfigure && canManageFinance ? <button type="button" disabled={busy} onClick={async () => {
          const reason = await ask({
            title: `Cancel ${service.name}?`,
            body: <p>Orders pinned to this meal are credited.</p>,
            confirmLabel: `Cancel ${service.name}`,
            destructive: true,
            input: { label: "Why is this meal cancelled?", required: true, minLength: 3, maxLength: 500, hint: `At least 3 characters. ${reasonHint}` },
          });
          if (reason) void run(() => call(`${base}/services/${service.id}`, "POST", { action: "cancel", reason }), "Meal service cancelled.");
        }}>Cancel meal</button> : null}
        {cancelled && canConfigure ? <button type="button" disabled={busy} onClick={async () => {
          const reason = await ask({
            title: `Reinstate ${service.name}?`,
            body: <p>The meal is offered again.</p>,
            confirmLabel: `Reinstate ${service.name}`,
            input: { label: "Why is this meal being reinstated?", required: true, minLength: 3, maxLength: 500, hint: `At least 3 characters. ${reasonHint}` },
          });
          if (reason) void run(() => call(`${base}/services/${service.id}`, "POST", { action: "reinstate", reason }), "Meal service reinstated.");
        }}>Reinstate</button> : null}
      </td>
    </tr>
    {editing ? <tr role="row"><td role="cell" colSpan={6}>
      <ServiceForm title={`Edit ${service.name}`} submitLabel="Save service" busy={busy} initial={service}
        onSubmit={(input) => run(() => call(`${base}/services/${service.id}`, "PUT", input), "Meal service saved.")} />
    </td></tr> : null}
  </>;
}

function ServiceForm({ title, submitLabel, busy, initial, onSubmit }: {
  title: string; submitLabel: string; busy: boolean; initial?: Service; onSubmit: (input: unknown) => Promise<boolean>;
}) {
  const edit = useEditedForm();
  return <form onChange={edit.track} onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    void onSubmit({
      name: text("name"), mealType: text("mealType"), serviceDate: text("serviceDate"), startTime: text("startTime"), endTime: text("endTime") || null,
      location: text("location") || null, ticketing: text("ticketing"), capacity: text("capacity") === "" ? null : Number(text("capacity")),
    }).then((ok) => { if (ok) edit.clear(); });
  }}>
    <h4>{title}</h4>
    <label>Name <input name="name" required maxLength={80} defaultValue={initial?.name ?? ""} /></label>
    <label>Meal <select name="mealType" defaultValue={initial?.mealType ?? "BREAKFAST"}>{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></label>
    <label>Date <input name="serviceDate" type="date" required defaultValue={initial?.serviceDate ?? ""} /></label>
    <label>Serving starts <input name="startTime" type="time" required defaultValue={initial?.startTime ?? ""} /></label>
    <label>Serving ends <input name="endTime" type="time" defaultValue={initial?.endTime ?? ""} /></label>
    <label>Location <input name="location" maxLength={120} defaultValue={initial?.location ?? ""} /></label>
    <label>Capacity <input name="capacity" type="number" min={1} max={100000} defaultValue={initial?.capacity ?? ""} placeholder="no limit" /></label>
    <label>Tickets <select name="ticketing" defaultValue={initial?.ticketing ?? "TICKETED"}><option value="TICKETED">Tickets are sold</option><option value="DONATION_ONLY">Donation only (no ticket)</option></select></label>
    <button className="primary-button" type="submit" disabled={busy}>{submitLabel}</button>
  </form>;
}

function PlanPanel({ plan, view, base, busy, run, canManageFinance, services }: {
  plan: Plan; view: MealView; base: string; busy: boolean; canManageFinance: boolean; services: Service[];
  run: (action: () => Promise<{ meals: MealView }>, success: string) => Promise<boolean>;
}) {
  const priceOf = (mealType: MealTypeValue, ageGroup: MealAgeGroupValue) => plan.prices.find((price) => price.mealType === mealType && price.ageGroup === ageGroup);
  const typePrices = plan.prices.filter((price) => price.attendeeTypeId);
  const editPlan = useEditedForm();
  const typePrice = useEditedForm();
  const planServices = useEditedForm();
  return <section className="panel">
    <h3>{plan.name} <small>({mealPayerLabels[plan.payer]}{plan.isDefaultTicketPlan ? ", sells form tickets" : ""}{plan.isActive ? "" : ", off"})</small></h3>
    {plan.description ? <p>{plan.description}</p> : null}
    {canManageFinance ? <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const isActive = form.get("isActive") === "on";
      void run(() => call(`${base}/plans/${plan.id}`, "PUT", {
        code: plan.code, name: String(form.get("name")), description: String(form.get("description") ?? ""), payer: plan.payer,
        isDefaultTicketPlan: plan.payer === "ATTENDEE" && isActive && form.get("isDefaultTicketPlan") === "on",
        includesAllServices: plan.includesAllServices, defaultEntitlement: plan.defaultEntitlement, isActive,
      }), "Plan saved.").then((ok) => { if (ok) editPlan.clear(); });
    }} onChange={editPlan.track}>
      <h4>Edit this plan</h4>
      <label>Name <input name="name" required maxLength={80} defaultValue={plan.name} /></label>
      <label>Description <input name="description" maxLength={500} defaultValue={plan.description} /></label>
      <label><input name="isActive" type="checkbox" defaultChecked={plan.isActive} /> Plan is on</label>
      {plan.payer === "ATTENDEE" ? <label><input name="isDefaultTicketPlan" type="checkbox" defaultChecked={plan.isDefaultTicketPlan} /> Sells the registration form&apos;s tickets (only one plan can)</label> : null}
      <button type="submit" disabled={busy}>Save plan</button>
    </form> : null}
    <p>{plan.includesAllServices ? `Covers every ticketed service (${plan.defaultEntitlement === "INCLUDED" ? "included, never charged to the attendee" : "paid tickets"}).` : "Covers only the services listed below."}</p>
    <div className="table-wrap"><table className="report-table report-table-auto">
      <caption>{plan.payer === "CONFERENCE" ? "Rate the conference is billed per meal used" : "Price per meal"}</caption>
      <thead><tr><th scope="col">Meal</th>{mealAgeGroups.map((group) => <th key={group} scope="col">{mealAgeGroupLabels[group]}</th>)}</tr></thead>
      <tbody>{(["BREAKFAST", "LUNCH", "SUPPER"] as const).map((mealType) => <tr key={mealType}>
        <th scope="row">{mealTypeLabels[mealType]}</th>
        {mealAgeGroups.map((group) => {
          const price = priceOf(mealType, group);
          return <td key={group}>{canManageFinance
            ? <PriceForm plan={plan} mealType={mealType} group={group} amountCents={price?.amountCents ?? null} base={base} busy={busy} run={run} />
            : price ? formatCents(price.amountCents) : "Not set"}</td>;
        })}
      </tr>)}</tbody>
    </table></div>
    {typePrices.length > 0 ? <p>Attendee-type prices (a price for a type wins over the age group; $0 makes that role complimentary): {typePrices.map((price) => {
      const type = view.attendeeTypes.find((candidate) => candidate.id === price.attendeeTypeId);
      return `${type?.label ?? "Type"} ${mealTypeLabels[price.mealType as MealTypeValue].toLowerCase()} ${formatCents(price.amountCents)}`;
    }).join("; ")}.</p> : null}
    {canManageFinance && view.attendeeTypes.length > 0 ? <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const cents = Math.round(Number(form.get("amount")) * 100);
      void run(() => call(`${base}/plans/${plan.id}/prices`, "PUT", { mealType: String(form.get("mealType")), ageGroup: null, attendeeTypeId: String(form.get("attendeeTypeId")), amountCents: cents }), "Price saved.").then((ok) => { if (ok) typePrice.clear(); });
    }} onChange={typePrice.track}>
      <label>Attendee type <select name="attendeeTypeId">{view.attendeeTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
      <label>Meal <select name="mealType">{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></label>
      <label>Price in dollars <input name="amount" inputMode="decimal" required /></label>
      <button type="submit" disabled={busy}>Set price for this type</button>
    </form> : null}
    {canManageFinance && !plan.includesAllServices ? <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const listed = services.filter((service) => form.get(`service-${service.id}`) === "on").map((service) => ({ serviceId: service.id, entitlement: plan.payer === "CONFERENCE" ? "INCLUDED" : String(form.get(`entitlement-${service.id}`)) }));
      void run(() => call(`${base}/plans/${plan.id}/services`, "PUT", listed), "Plan services saved.").then((ok) => { if (ok) planServices.clear(); });
    }} onChange={planServices.track}>
      <fieldset><legend>Services this plan lists</legend>
        {services.map((service) => {
          const row = plan.services.find((candidate) => candidate.serviceId === service.id);
          return <div key={service.id}>
            <label><input type="checkbox" name={`service-${service.id}`} defaultChecked={Boolean(row)} /> {service.name} ({serviceLabel(service)})</label>
            {plan.payer === "ATTENDEE" ? <select name={`entitlement-${service.id}`} aria-label={`${service.name} is paid or included`} defaultValue={row?.entitlement ?? "PAID"}><option value="PAID">Paid</option><option value="INCLUDED">Included</option></select> : null}
          </div>;
        })}
      </fieldset>
      <button type="submit" disabled={busy}>Save plan services</button>
    </form> : null}
  </section>;
}

function WalkUpForm({ services, plans, base, busy, run }: {
  services: Service[]; plans: Plan[]; base: string; busy: boolean;
  run: (action: () => Promise<{ meals: MealView }>, success: string) => Promise<boolean>;
}) {
  const order = useEditedForm();
  if (services.length === 0 || plans.length === 0) return <p>Add a ticketed meal service and an attendee-paid plan to take walk-up orders.</p>;
  return <form onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const service = services.find((candidate) => candidate.id === String(form.get("serviceId")));
    if (!service) return;
    void run(() => call(`${base}/selections`, "POST", {
      registrationId: null, registrationAttendeeId: null, planId: String(form.get("planId")), mealType: service.mealType, serviceId: service.id,
      ageGroup: String(form.get("ageGroup")), quantity: Number(form.get("quantity")), orderLabel: String(form.get("orderLabel") ?? "").trim() || null,
      dietaryCategories: [], clientRequestId: crypto.randomUUID(),
    }), "Walk-up order recorded.").then((ok) => { if (ok) order.clear(); });
  }} onChange={order.track}>
    <label>Meal <select name="serviceId">{services.map((service) => <option key={service.id} value={service.id}>{service.name} ({serviceLabel(service)})</option>)}</select></label>
    <label>Plan <select name="planId">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
    <label>Age group <select name="ageGroup">{mealAgeGroups.map((group) => <option key={group} value={group}>{mealAgeGroupLabels[group]}</option>)}</select></label>
    <label>Quantity <input name="quantity" type="number" min={1} max={1000} defaultValue={1} required /></label>
    <label>Label (optional). No allergy or medical details. <input name="orderLabel" maxLength={60} /></label>
    <button className="primary-button" type="submit" disabled={busy}>Record walk-up order</button>
  </form>;
}

/** One cell of the price grid. A typed price that differs from the saved one is unsaved work until Save (#1468). */
function PriceForm({ plan, mealType, group, amountCents, base, busy, run }: {
  plan: Plan; mealType: MealTypeValue; group: MealAgeGroupValue; amountCents: number | null; base: string; busy: boolean;
  run: (action: () => Promise<{ meals: MealView }>, success: string) => Promise<boolean>;
}) {
  const edit = useEditedForm();
  return <form onChange={edit.track} onSubmit={(event) => {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get("amount") ?? "").trim();
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents < 0 || raw === "") { void run(async () => { throw new Error("Enter a price in dollars, such as 7 or 7.50."); }, ""); return; }
    void run(() => call(`${base}/plans/${plan.id}/prices`, "PUT", { mealType, ageGroup: group, attendeeTypeId: null, amountCents: cents }), "Price saved.").then((ok) => { if (ok) edit.clear(); });
  }}>
    <label className="sr-only" htmlFor={`price-${plan.id}-${mealType}-${group}`}>{plan.name} {mealTypeLabels[mealType]} {mealAgeGroupLabels[group]} price in dollars</label>
    <input id={`price-${plan.id}-${mealType}-${group}`} name="amount" inputMode="decimal" defaultValue={amountCents !== null ? (amountCents / 100).toFixed(2) : ""} placeholder="not set" />
    <button type="submit" disabled={busy}>Save</button>
  </form>;
}

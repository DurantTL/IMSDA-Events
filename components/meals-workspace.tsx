"use client";

import { useState } from "react";
import { staffPageTitles } from "@/components/staff-navigation";
import {
  mealAgeGroupLabels,
  mealAgeGroups,
  mealPayerLabels,
  mealTypeLabels,
  mealTypes,
  money,
  type MealAgeGroupValue,
  type MealTypeValue,
} from "@/modules/meals/domain";
import type { MealView } from "@/modules/meals/view-repository";

type Plan = MealView["plans"][number];
type Service = MealView["services"][number];

async function call(url: string, method: string, body: unknown): Promise<{ meals: MealView }> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message ?? "That could not be saved.");
  return json;
}

function serviceLabel(service: Service) {
  return `${service.serviceDate} ${service.startTime}${service.endTime ? `–${service.endTime}` : ""}`;
}

const reasonHint = "Do not enter allergy, medical or other personal details.";

export function MealsWorkspace({ eventId, eventName, initialView, canConfigure, canManageFinance, canExport }: {
  eventId: string; eventName: string; initialView: MealView; canConfigure: boolean; canManageFinance: boolean; canExport: boolean;
}) {
  const [view, setView] = useState(initialView);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/events/${eventId}/meals`;

  async function run(action: () => Promise<{ meals: MealView }>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      setView(result.meals);
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That could not be saved.");
    } finally { setBusy(false); }
  }

  const activeServices = view.services.filter((service) => service.status === "ACTIVE" && service.ticketing === "TICKETED");

  return <div className="settings-stack">
    <div className="page-intro"><div>
      <p className="eyebrow">Event configuration</p>
      <h2 className="duplicate-page-title">{staffPageTitles.meals}</h2>
      <p>Meal services, plans and prices for {eventName}. What people ordered is kept here separately from anything used or served at the café. Registration form tickets are priced from the ticket plan below.{" "}
        {canExport ? <><a href={`/api/events/${eventId}/exports/meal-tickets`}>Download meal tickets CSV</a> (café scanner format) or the <a href={`/api/events/${eventId}/exports/meal-ticket-summary`}>meal ticket summary</a>.</> : null}</p>
    </div></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="usage-note" role="status">{notice}</p> : null}
    {view.formWarnings.map((warning) => <p className="form-error" role="alert" key={`${warning.formName}-${warning.status}`}>
      The {warning.status === "PUBLISHED" ? "published" : "draft"} version of {warning.formName} sells meal tickets at prices that differ from the ticket plan ({warning.fieldKeys.length} field{warning.fieldKeys.length === 1 ? "" : "s"}).
      Open the form in the registration builder, save it again to bring the prices up to date, run a test submission, and republish it. Until then registrants are charged the form&apos;s old prices.
    </p>)}

    {view.services.length === 0 && view.plans.length === 0 ? <section className="panel">
      <h3>Start from Camp Meeting</h3>
      <p>Adds the 2026 Camp Meeting meal services (breakfast Wednesday to Saturday, lunch Wednesday to Friday, Saturday lunch donation-only, supper Tuesday to Saturday), a ticket plan ($7 / $6 breakfast, $8 / $7 lunch and supper) and a conference-paid plan for staff, pastor and volunteer meals. The dates count from this event&apos;s first day, which should be a Tuesday. Review the prices before publishing the form.</p>
      {canManageFinance ? <button className="primary-button" type="button" disabled={busy} onClick={() => void run(() => call(`${base}/defaults`, "POST", { preset: "camp-meeting-2026" }), "Camp Meeting meals added.")}>Add the Camp Meeting meals</button> : <p>Only staff who manage finance can add the preset.</p>}
    </section> : null}

    <section className="panel">
      <h3>Meals ordered</h3>
      {view.totals.length === 0 ? <p>No meals have been ordered yet.</p> : <div className="table-wrap"><table className="report-table report-table-auto">
        <caption>Active selections of submitted and confirmed registrations, and walk-up orders</caption>
        <thead><tr><th scope="col">Meal</th><th scope="col">Age group</th><th scope="col">Payer</th><th scope="col">Quantity</th></tr></thead>
        <tbody>{view.totals.map((row) => <tr key={`${row.mealType}${row.ageGroup}${row.payer}`}>
          <th scope="row">{mealTypeLabels[row.mealType as MealTypeValue]}</th><td>{mealAgeGroupLabels[row.ageGroup as MealAgeGroupValue]}</td>
          <td>{row.payer === "CONFERENCE" ? "Conference" : "Attendee"}</td><td>{row.quantity}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    <section className="panel">
      <h3>Meal services</h3>
      {view.services.length === 0 ? <p>No meal services yet. Add one below.</p> : <div className="table-wrap"><table className="report-table report-table-auto">
        <thead><tr><th scope="col">Service</th><th scope="col">When</th><th scope="col">Where</th><th scope="col">Capacity</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>{view.services.map((service) => <ServiceRow key={service.id} service={service} base={base} busy={busy} run={run} canManageFinance={canManageFinance} canConfigure={canConfigure} />)}</tbody>
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
        void run(() => call(`${base}/plans`, "POST", body), "Meal plan added.");
      }}>
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
      {view.recentOrders.length > 0 ? <div className="table-wrap"><table className="report-table report-table-auto">
        <caption>Recent staff, walk-up and entitlement selections</caption>
        <thead><tr><th scope="col">Meal</th><th scope="col">For</th><th scope="col">Qty</th><th scope="col">Each</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>{view.recentOrders.map((order) => <tr key={order.id}>
          <th scope="row">{mealTypeLabels[order.mealType as MealTypeValue]} ({mealAgeGroupLabels[order.ageGroup as MealAgeGroupValue]}){order.serviceName ? `, ${order.serviceName}` : ""}</th>
          <td>{order.confirmationCode ?? order.orderLabel ?? "Walk-up"}</td><td>{order.quantity}</td>
          <td>{order.payer === "CONFERENCE" ? "Conference" : money(order.unitPriceCents)}</td><td>{order.source.toLowerCase().replace("_", " ")}</td><td>{order.status.toLowerCase()}</td>
          <td>{canManageFinance && order.status === "ACTIVE" ? <button type="button" disabled={busy} onClick={() => {
            const reason = window.prompt(`Why is this order being cancelled? ${reasonHint}`);
            if (reason) void run(() => call(`${base}/selections/${order.id}`, "POST", { action: "cancel", reason }), "Order cancelled and credited.");
          }}>Cancel</button> : null}</td>
        </tr>)}</tbody>
      </table></div> : null}
    </section>
  </div>;
}

function ServiceRow({ service, base, busy, run, canManageFinance, canConfigure }: {
  service: Service; base: string; busy: boolean; canManageFinance: boolean; canConfigure: boolean;
  run: (action: () => Promise<{ meals: MealView }>, success: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const cancelled = service.status === "CANCELLED";
  return <>
    <tr>
      <th scope="row">{service.name} ({mealTypeLabels[service.mealType]}{service.ticketing === "DONATION_ONLY" ? ", donation-only" : ""})</th>
      <td>{serviceLabel(service)}</td><td>{service.location ?? ""}</td>
      <td>{service.capacity === null ? "No limit" : `${service.pinnedQuantity} of ${service.capacity}`}</td>
      <td>{cancelled ? `Cancelled${service.cancelReason ? `: ${service.cancelReason}` : ""}` : "Active"}</td>
      <td>
        {!cancelled && canConfigure ? <button type="button" disabled={busy} onClick={() => setEditing((value) => !value)}>{editing ? "Close" : "Edit"}</button> : null}
        {!cancelled && canConfigure && canManageFinance ? <button type="button" disabled={busy} onClick={() => {
          const reason = window.prompt(`Why is this meal cancelled? Orders pinned to it are credited. ${reasonHint}`);
          if (reason) void run(() => call(`${base}/services/${service.id}`, "POST", { action: "cancel", reason }), "Meal service cancelled.");
        }}>Cancel meal</button> : null}
        {cancelled && canConfigure ? <button type="button" disabled={busy} onClick={() => {
          const reason = window.prompt(`Why is this meal being reinstated? ${reasonHint}`);
          if (reason) void run(() => call(`${base}/services/${service.id}`, "POST", { action: "reinstate", reason }), "Meal service reinstated.");
        }}>Reinstate</button> : null}
      </td>
    </tr>
    {editing ? <tr><td colSpan={6}>
      <ServiceForm title={`Edit ${service.name}`} submitLabel="Save service" busy={busy} initial={service}
        onSubmit={(input) => run(() => call(`${base}/services/${service.id}`, "PUT", input), "Meal service saved.")} />
    </td></tr> : null}
  </>;
}

function ServiceForm({ title, submitLabel, busy, initial, onSubmit }: {
  title: string; submitLabel: string; busy: boolean; initial?: Service; onSubmit: (input: unknown) => Promise<void>;
}) {
  return <form onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    void onSubmit({
      name: text("name"), mealType: text("mealType"), serviceDate: text("serviceDate"), startTime: text("startTime"), endTime: text("endTime") || null,
      location: text("location") || null, ticketing: text("ticketing"), capacity: text("capacity") === "" ? null : Number(text("capacity")),
    });
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
  run: (action: () => Promise<{ meals: MealView }>, success: string) => Promise<void>;
}) {
  const priceOf = (mealType: MealTypeValue, ageGroup: MealAgeGroupValue) => plan.prices.find((price) => price.mealType === mealType && price.ageGroup === ageGroup);
  const typePrices = plan.prices.filter((price) => price.attendeeTypeId);
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
      }), "Plan saved.");
    }}>
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
          return <td key={group}>{canManageFinance ? <form onSubmit={(event) => {
            event.preventDefault();
            const raw = String(new FormData(event.currentTarget).get("amount") ?? "").trim();
            const cents = Math.round(Number(raw) * 100);
            if (!Number.isFinite(cents) || cents < 0 || raw === "") { void run(async () => { throw new Error("Enter a price in dollars, such as 7 or 7.50."); }, ""); return; }
            void run(() => call(`${base}/plans/${plan.id}/prices`, "PUT", { mealType, ageGroup: group, attendeeTypeId: null, amountCents: cents }), "Price saved.");
          }}>
            <label className="visually-hidden" htmlFor={`price-${plan.id}-${mealType}-${group}`}>{plan.name} {mealTypeLabels[mealType]} {mealAgeGroupLabels[group]} price in dollars</label>
            <input id={`price-${plan.id}-${mealType}-${group}`} name="amount" inputMode="decimal" defaultValue={price ? (price.amountCents / 100).toFixed(2) : ""} placeholder="not set" />
            <button type="submit" disabled={busy}>Save</button>
          </form> : price ? money(price.amountCents) : "Not set"}</td>;
        })}
      </tr>)}</tbody>
    </table></div>
    {typePrices.length > 0 ? <p>Attendee-type prices (a price for a type wins over the age group; $0 makes that role complimentary): {typePrices.map((price) => {
      const type = view.attendeeTypes.find((candidate) => candidate.id === price.attendeeTypeId);
      return `${type?.label ?? "Type"} ${mealTypeLabels[price.mealType as MealTypeValue].toLowerCase()} ${money(price.amountCents)}`;
    }).join("; ")}.</p> : null}
    {canManageFinance && view.attendeeTypes.length > 0 ? <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const cents = Math.round(Number(form.get("amount")) * 100);
      void run(() => call(`${base}/plans/${plan.id}/prices`, "PUT", { mealType: String(form.get("mealType")), ageGroup: null, attendeeTypeId: String(form.get("attendeeTypeId")), amountCents: cents }), "Price saved.");
    }}>
      <label>Attendee type <select name="attendeeTypeId">{view.attendeeTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
      <label>Meal <select name="mealType">{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></label>
      <label>Price in dollars <input name="amount" inputMode="decimal" required /></label>
      <button type="submit" disabled={busy}>Set price for this type</button>
    </form> : null}
    {canManageFinance && !plan.includesAllServices ? <form onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const listed = services.filter((service) => form.get(`service-${service.id}`) === "on").map((service) => ({ serviceId: service.id, entitlement: plan.payer === "CONFERENCE" ? "INCLUDED" : String(form.get(`entitlement-${service.id}`)) }));
      void run(() => call(`${base}/plans/${plan.id}/services`, "PUT", listed), "Plan services saved.");
    }}>
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
  run: (action: () => Promise<{ meals: MealView }>, success: string) => Promise<void>;
}) {
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
    }), "Walk-up order recorded.");
  }}>
    <label>Meal <select name="serviceId">{services.map((service) => <option key={service.id} value={service.id}>{service.name} ({serviceLabel(service)})</option>)}</select></label>
    <label>Plan <select name="planId">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
    <label>Age group <select name="ageGroup">{mealAgeGroups.map((group) => <option key={group} value={group}>{mealAgeGroupLabels[group]}</option>)}</select></label>
    <label>Quantity <input name="quantity" type="number" min={1} max={1000} defaultValue={1} required /></label>
    <label>Label (optional). No allergy or medical details. <input name="orderLabel" maxLength={60} /></label>
    <button className="primary-button" type="submit" disabled={busy}>Record walk-up order</button>
  </form>;
}

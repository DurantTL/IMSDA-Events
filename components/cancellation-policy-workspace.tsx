"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { cardCell } from "@/components/table-card-labels";
import { postJson } from "@/lib/post-json";
import type { CancellationResult } from "@/modules/cancellation-policy/calculator";
import { localInstant, localMidnightInstant } from "@/modules/cancellation-policy/event-time";
import {
  campMeetingPreset,
  chargeCategories,
  classifiableCategories,
  describeTerms,
  formatCents,
  type CancellationRules,
  type CancellationRulesInput,
} from "@/modules/cancellation-policy/rules";
import type { PolicyVersionView, RegistrationSummary } from "@/modules/cancellation-policy/repository";

/**
 * Staff screen for cancellation rules and the outcome preview (#169). It only configures rules and shows a proposed
 * outcome: nothing on this page cancels a registration, refunds money or creates credit. Every request is checked
 * again on the server for MANAGE_FINANCE on this event; hiding a control is never the protection.
 */

type TermsDraft = { refund: "FULL" | "PERCENT" | "NONE"; percent: string; flatDollars: string; flatLabel: string; deposit: "REFUND" | "FORFEIT"; credit: boolean };
type WindowDraft = { id: string; label: string; endsOn: string; terms: TermsDraft };
type Draft = {
  effectiveOn: string;
  windows: WindowDraft[];
  after: { label: string; terms: TermsDraft };
  noShow: { label: string; terms: TermsDraft } | null;
  scopes: Record<"FULL_REGISTRATION" | "ATTENDEE" | "COMPONENT", boolean>;
  supported: string[];
  supportedKeys: string;
  nonrefundable: string[];
  nonrefundableKeys: string;
  classified: Record<string, string>;
  cardFee: "REFUNDABLE" | "NONREFUNDABLE";
  note: string;
};

const blankTerms = (): TermsDraft => ({ refund: "FULL", percent: "50", flatDollars: "", flatLabel: "Processing fee", deposit: "REFUND", credit: false });

function termsFromRules(terms: CancellationRules["afterWindows"]["terms"]): TermsDraft {
  return {
    refund: terms.refund.kind,
    percent: terms.refund.kind === "PERCENT" ? String(terms.refund.percent) : "50",
    flatDollars: terms.flatWithholdCents > 0 ? (terms.flatWithholdCents / 100).toFixed(2) : "",
    flatLabel: terms.flatWithholdLabel,
    deposit: terms.depositTreatment,
    credit: terms.creditAllowed,
  };
}

function draftFromRules(rules: CancellationRulesInput, effectiveOn = ""): Draft {
  const parsed = rules as CancellationRules;
  const classified: Record<string, string> = {};
  for (const entry of parsed.classifications ?? []) classified[entry.category] = entry.fieldKeys.join(", ");
  const scopes = parsed.allowedScopes ?? ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"];
  return {
    effectiveOn,
    windows: parsed.windows.map((window) => ({ id: window.id, label: window.label, endsOn: window.endsOn, terms: termsFromRules(window.terms) })),
    after: { label: parsed.afterWindows.label, terms: termsFromRules(parsed.afterWindows.terms) },
    noShow: parsed.noShow ? { label: parsed.noShow.label, terms: termsFromRules(parsed.noShow.terms) } : null,
    scopes: { FULL_REGISTRATION: scopes.includes("FULL_REGISTRATION"), ATTENDEE: scopes.includes("ATTENDEE"), COMPONENT: scopes.includes("COMPONENT") },
    supported: [...(parsed.supportedComponents?.categories ?? [])],
    supportedKeys: (parsed.supportedComponents?.fieldKeys ?? []).join(", "),
    nonrefundable: [...(parsed.nonrefundable?.categories ?? [])],
    nonrefundableKeys: (parsed.nonrefundable?.fieldKeys ?? []).join(", "),
    classified,
    cardFee: parsed.cardFeeTreatment,
    note: "",
  };
}

const keyList = (value: string) => value.split(",").map((key) => key.trim()).filter(Boolean);

function termsToRules(terms: TermsDraft) {
  const flat = Math.round(Number(terms.flatDollars || 0) * 100);
  return {
    refund: terms.refund === "PERCENT" ? { kind: "PERCENT", percent: Number(terms.percent) } : { kind: terms.refund },
    flatWithholdCents: Number.isFinite(flat) ? flat : 0,
    flatWithholdLabel: terms.flatLabel.trim() || "Processing fee",
    depositTreatment: terms.deposit,
    creditAllowed: terms.credit,
  };
}

function draftToRequest(draft: Draft, timezone: string) {
  const rules = {
    windows: draft.windows.map((window) => ({ id: window.id, label: window.label, endsOn: window.endsOn, terms: termsToRules(window.terms) })),
    afterWindows: { label: draft.after.label, terms: termsToRules(draft.after.terms) },
    noShow: draft.noShow ? { label: draft.noShow.label, terms: termsToRules(draft.noShow.terms) } : null,
    allowedScopes: (Object.keys(draft.scopes) as Array<keyof Draft["scopes"]>).filter((scope) => draft.scopes[scope]),
    supportedComponents: { categories: draft.supported, fieldKeys: keyList(draft.supportedKeys) },
    classifications: classifiableCategories
      .filter((category) => keyList(draft.classified[category] ?? "").length > 0 && category !== "REGISTRATION")
      .map((category) => ({ category, fieldKeys: keyList(draft.classified[category] ?? "") })),
    nonrefundable: { categories: draft.nonrefundable, fieldKeys: keyList(draft.nonrefundableKeys) },
    cardFeeTreatment: draft.cardFee,
  };
  return {
    rules,
    ...(draft.effectiveOn ? { effectiveFrom: localMidnightInstant(draft.effectiveOn, timezone).toISOString() } : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
}

function when(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function dollars(cents: number) {
  return formatCents(cents);
}

export function CancellationPolicyWorkspace({
  eventId,
  eventName,
  timezone,
  versions,
  inEffectVersionId,
}: {
  eventId: string;
  eventName: string;
  timezone: string;
  versions: PolicyVersionView[];
  inEffectVersionId: string | null;
}) {
  return (
    <section className="page-stack cancel-policy">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Financial operations</p>
          <h2>Cancellation rules</h2>
          <p>
            Set when refunds are full, partial or not offered for {eventName}, and preview what the rules would propose for a
            registration. Nothing here cancels a registration, refunds money or creates credit; those are separate, reviewed steps.
            The refund policy text registrants read on the event page is edited in event settings and is not changed by these rules.
          </p>
        </div>
      </div>
      <VersionHistory timezone={timezone} versions={versions} inEffectVersionId={inEffectVersionId} />
      <NewVersion eventId={eventId} timezone={timezone} />
      <Preview eventId={eventId} timezone={timezone} />
    </section>
  );
}

function VersionHistory({ timezone, versions, inEffectVersionId }: { timezone: string; versions: PolicyVersionView[]; inEffectVersionId: string | null }) {
  return (
    <section className="panel" aria-labelledby="cancel-policy-versions">
      <div className="section-heading"><h3 id="cancel-policy-versions">Versions</h3></div>
      {versions.length === 0 ? (
        <p>No rules have been saved for this event yet, so a cancellation proposes nothing. Save the first version below.</p>
      ) : (
        <ul className="cancel-policy-versions">
          {versions.map((version) => (
            <li key={version.id}>
              <strong>Version {version.version}{version.id === inEffectVersionId ? " (in effect now)" : ""}</strong>
              <small>Effective {when(version.effectiveFrom, timezone)} ({timezone}) · saved {when(version.createdAt, timezone)} by {version.createdByName}</small>
              {version.note && <small>{version.note}</small>}
              {version.rules ? (
                <ul>
                  {version.rules.windows.map((window) => (
                    <li key={window.id}>{window.label}, through {window.endsOn}: {describeTerms(window.terms)}.</li>
                  ))}
                  <li>{version.rules.afterWindows.label}: {describeTerms(version.rules.afterWindows.terms)}.</li>
                  {version.rules.noShow && <li>{version.rules.noShow.label}: {describeTerms(version.rules.noShow.terms)}.</li>}
                  <li>
                    Can be cancelled: {version.rules.allowedScopes.map((scope) => scope === "FULL_REGISTRATION" ? "whole registration" : scope === "ATTENDEE" ? "one attendee" : "components").join(", ")}.
                    {" "}Card fee: {version.rules.cardFeeTreatment === "REFUNDABLE" ? "follows the refund" : "nonrefundable"}.
                    {version.rules.nonrefundable.categories.length + version.rules.nonrefundable.fieldKeys.length > 0 ? ` Nonrefundable: ${[...version.rules.nonrefundable.categories.map((c) => c.toLowerCase()), ...version.rules.nonrefundable.fieldKeys].join(", ")}.` : ""}
                  </li>
                </ul>
              ) : <small>These rules can no longer be read and are ignored by calculations.</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TermsEditor({ legend, value, onChange }: { legend: string; value: TermsDraft; onChange: (next: TermsDraft) => void }) {
  const id = useId();
  const set = (patch: Partial<TermsDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="cancel-policy-terms">
      <legend>{legend}</legend>
      <div className="form-grid two-column">
        <label htmlFor={`${id}-refund`}>Refund
          <select id={`${id}-refund`} value={value.refund} onChange={(event) => set({ refund: event.target.value as TermsDraft["refund"] })}>
            <option value="FULL">Full refund</option>
            <option value="PERCENT">Percentage</option>
            <option value="NONE">No refund</option>
          </select>
        </label>
        {value.refund === "PERCENT" && (
          <label htmlFor={`${id}-percent`}>Percent refunded (1 to 99)
            <input id={`${id}-percent`} inputMode="numeric" value={value.percent} onChange={(event) => set({ percent: event.target.value })} />
          </label>
        )}
        <label htmlFor={`${id}-flat`}>Flat fee withheld, dollars
          <input id={`${id}-flat`} inputMode="decimal" placeholder="0.00" value={value.flatDollars} onChange={(event) => set({ flatDollars: event.target.value })} />
        </label>
        <label htmlFor={`${id}-flat-label`}>Flat fee name
          <input id={`${id}-flat-label`} value={value.flatLabel} maxLength={80} onChange={(event) => set({ flatLabel: event.target.value })} />
        </label>
        <label htmlFor={`${id}-deposit`}>Reservation deposit
          <select id={`${id}-deposit`} value={value.deposit} onChange={(event) => set({ deposit: event.target.value as TermsDraft["deposit"] })}>
            <option value="REFUND">Refunded with the rest</option>
            <option value="FORFEIT">Forfeited</option>
          </select>
        </label>
      </div>
      <label className="cancel-policy-check"><input type="checkbox" checked={value.credit} onChange={(event) => set({ credit: event.target.checked })} /> Future-event credit may be offered</label>
    </fieldset>
  );
}

function NewVersion({ eventId, timezone }: { eventId: string; timezone: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (!draft) {
    return (
      <section className="panel" aria-labelledby="cancel-policy-new">
        <div className="section-heading"><h3 id="cancel-policy-new">New version</h3></div>
        <p>A saved version is never edited. To change the rules, save a new version; earlier calculations keep the version they used.</p>
        <div className="form-stack">
          <div className="form-actions cancel-policy-actions">
            <button className="secondary-button" type="button" onClick={() => setDraft(draftFromRules({
              windows: [], afterWindows: { label: "After the last window", terms: { refund: { kind: "NONE" }, flatWithholdCents: 0, flatWithholdLabel: "Processing fee", depositTreatment: "REFUND", creditAllowed: false } },
              noShow: null, allowedScopes: ["FULL_REGISTRATION", "ATTENDEE", "COMPONENT"], supportedComponents: { categories: [], fieldKeys: [] }, classifications: [], nonrefundable: { categories: [], fieldKeys: [] }, cardFeeTreatment: "REFUNDABLE",
            } satisfies CancellationRulesInput))}>Start blank</button>
          </div>
          <label>Camp Meeting rule: deadline date
            <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </label>
          <small>Before the deadline, a full refund minus a $10 processing fee. After it, or for a first-night no-show, the deposit is forfeited and the reservation cancelled. You review everything before it is saved.</small>
          <div className="form-actions cancel-policy-actions">
            <button className="secondary-button" type="button" disabled={!deadline} onClick={() => setDraft(draftFromRules(campMeetingPreset(deadline)))}>Start from the Camp Meeting rule</button>
          </div>
        </div>
      </section>
    );
  }

  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    const response = await postJson(`/api/events/${encodeURIComponent(eventId)}/cancellation-policy`, draftToRequest(draft, timezone), "The rules could not be saved.");
    setBusy(false);
    if (!response.ok) {
      setError(typeof response.body.message === "string" ? response.body.message : "The rules could not be saved.");
      return;
    }
    setNotice("Saved as a new version.");
    setDraft(null);
    router.refresh();
  }

  return (
    <section className="panel" aria-labelledby="cancel-policy-new">
      <div className="section-heading"><h3 id="cancel-policy-new">New version</h3></div>
      {notice && <p role="status">{notice}</p>}
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Takes effect on (start of this day in {timezone}; blank means now)
          <input type="date" value={draft.effectiveOn} onChange={(event) => update({ effectiveOn: event.target.value })} />
        </label>

        <h4>Windows, earliest first</h4>
        {draft.windows.map((window, index) => (
          <div className="inset-form" key={index}>
            <div className="form-grid two-column">
              <label>Name<input value={window.label} maxLength={80} onChange={(event) => update({ windows: draft.windows.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /></label>
              <label>Last day it covers (whole day, {timezone})<input type="date" value={window.endsOn} onChange={(event) => update({ windows: draft.windows.map((item, i) => i === index ? { ...item, endsOn: event.target.value } : item) })} /></label>
            </div>
            <TermsEditor legend={`${window.label || "Window"} terms`} value={window.terms} onChange={(terms) => update({ windows: draft.windows.map((item, i) => i === index ? { ...item, terms } : item) })} />
            <button className="text-button" type="button" onClick={() => update({ windows: draft.windows.filter((_, i) => i !== index) })}>Remove this window</button>
          </div>
        ))}
        <button className="secondary-button" type="button" disabled={draft.windows.length >= 12} onClick={() => update({ windows: [...draft.windows, { id: `window-${draft.windows.length + 1}`, label: `Window ${draft.windows.length + 1}`, endsOn: "", terms: blankTerms() }] })}>Add a window</button>

        <h4>After the last window</h4>
        <label>Name<input value={draft.after.label} maxLength={80} onChange={(event) => update({ after: { ...draft.after, label: event.target.value } })} /></label>
        <TermsEditor legend="After-window terms" value={draft.after.terms} onChange={(terms) => update({ after: { ...draft.after, terms } })} />

        <label className="cancel-policy-check"><input type="checkbox" checked={draft.noShow !== null} onChange={(event) => update({ noShow: event.target.checked ? { label: "No-show on the first night", terms: { ...blankTerms(), deposit: "FORFEIT" } } : null })} /> Different terms for a first-night no-show</label>
        {draft.noShow && (
          <>
            <label>Name<input value={draft.noShow.label} maxLength={80} onChange={(event) => update({ noShow: draft.noShow ? { ...draft.noShow, label: event.target.value } : null })} /></label>
            <TermsEditor legend="No-show terms" value={draft.noShow.terms} onChange={(terms) => update({ noShow: draft.noShow ? { ...draft.noShow, terms } : null })} />
          </>
        )}

        <fieldset className="cancel-policy-terms">
          <legend>What can be cancelled</legend>
          {([["FULL_REGISTRATION", "The whole registration"], ["ATTENDEE", "One attendee"], ["COMPONENT", "Individual components"]] as const).map(([scope, text]) => (
            <label className="cancel-policy-check" key={scope}><input type="checkbox" checked={draft.scopes[scope]} onChange={(event) => update({ scopes: { ...draft.scopes, [scope]: event.target.checked } })} /> {text}</label>
          ))}
          <p><small>Components that may be cancelled on their own, by kind:</small></p>
          {chargeCategories.map((category) => (
            <label className="cancel-policy-check" key={category}><input type="checkbox" checked={draft.supported.includes(category)} onChange={() => update({ supported: toggle(draft.supported, category) })} /> {category.toLowerCase()}</label>
          ))}
          <label>Or by form field keys, comma separated<input value={draft.supportedKeys} onChange={(event) => update({ supportedKeys: event.target.value })} /></label>
        </fieldset>

        <fieldset className="cancel-policy-terms">
          <legend>Components and fees</legend>
          <p><small>Form fields that are meals, lodging, merchandise or other (comma separated field keys):</small></p>
          {classifiableCategories.filter((category) => category !== "REGISTRATION").map((category) => (
            <label key={category}>{category.toLowerCase()}<input value={draft.classified[category] ?? ""} onChange={(event) => update({ classified: { ...draft.classified, [category]: event.target.value } })} /></label>
          ))}
          <p><small>Never refundable, by kind:</small></p>
          {chargeCategories.filter((category) => category !== "FEE").map((category) => (
            <label className="cancel-policy-check" key={category}><input type="checkbox" checked={draft.nonrefundable.includes(category)} onChange={() => update({ nonrefundable: toggle(draft.nonrefundable, category) })} /> {category.toLowerCase()}</label>
          ))}
          <label>Never refundable, by form field keys<input value={draft.nonrefundableKeys} onChange={(event) => update({ nonrefundableKeys: event.target.value })} /></label>
          <label>Card processing fee paid by the registrant
            <select value={draft.cardFee} onChange={(event) => update({ cardFee: event.target.value as Draft["cardFee"] })}>
              <option value="REFUNDABLE">Refunded like the charge it was added to</option>
              <option value="NONREFUNDABLE">Not refundable</option>
            </select>
          </label>
        </fieldset>

        <label>Note for the record (optional)<input value={draft.note} maxLength={500} onChange={(event) => update({ note: event.target.value })} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions cancel-policy-actions">
          <button className="text-button" type="button" onClick={() => setDraft(null)}>Discard</button>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving" : "Save as a new version"}</button>
        </div>
      </form>
    </section>
  );
}

type SyntheticRow = { label: string; dollars: string; category: string; attendee: string; fieldKey: string };

function Preview({ eventId, timezone }: { eventId: string; timezone: string }) {
  const [mode, setMode] = useState<"REGISTRATION" | "SYNTHETIC">("REGISTRATION");
  const [registration, setRegistration] = useState("");
  const [scope, setScope] = useState<"FULL_REGISTRATION" | "ATTENDEE" | "COMPONENT">("FULL_REGISTRATION");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [chargeIds, setChargeIds] = useState<string[]>([]);
  const [noShow, setNoShow] = useState(false);
  const [asOfDate, setAsOfDate] = useState("");
  const [asOfTime, setAsOfTime] = useState("12:00");
  const [attendeeCount, setAttendeeCount] = useState("2");
  const [rows, setRows] = useState<SyntheticRow[]>([{ label: "Registration", dollars: "100.00", category: "REGISTRATION", attendee: "", fieldKey: "" }]);
  const [paid, setPaid] = useState("100.00");
  const [deposit, setDeposit] = useState("");
  const [summary, setSummary] = useState<RegistrationSummary | null>(null);
  const [result, setResult] = useState<CancellationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toCents = (value: string) => Math.round(Number(value || 0) * 100);

  async function run() {
    setBusy(true);
    setError("");
    const input = mode === "REGISTRATION"
      ? { kind: "REGISTRATION", registration, noShowFirstNight: noShow }
      : {
          kind: "SYNTHETIC",
          attendeeCount: Number(attendeeCount) || 0,
          charges: rows.filter((row) => row.label.trim()).map((row) => ({
            label: row.label.trim(), amountCents: toCents(row.dollars), category: row.category,
            ...(row.attendee ? { attendeeNumber: Number(row.attendee) } : {}), ...(row.fieldKey.trim() ? { fieldKey: row.fieldKey.trim() } : {}),
          })),
          paidCents: toCents(paid), depositCents: toCents(deposit), noShowFirstNight: noShow,
        };
    const body = {
      input,
      selection: { scope, ...(scope === "ATTENDEE" ? { attendeeIds } : {}), ...(scope === "COMPONENT" ? { chargeIds } : {}) },
      ...(asOfDate ? { asOf: localInstant(asOfDate, Number(asOfTime.slice(0, 2)) || 0, Number(asOfTime.slice(3, 5)) || 0, timezone).toISOString() } : {}),
    };
    const response = await postJson(`/api/events/${encodeURIComponent(eventId)}/cancellation-policy/preview`, body, "The preview could not be calculated.");
    setBusy(false);
    if (!response.ok) {
      setError(typeof response.body.message === "string" ? response.body.message : "The preview could not be calculated.");
      return;
    }
    setResult(response.body.result as CancellationResult);
    setSummary((response.body.registration as RegistrationSummary | null) ?? null);
  }

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <section className="panel" aria-labelledby="cancel-policy-preview">
      <div className="section-heading"><h3 id="cancel-policy-preview">Preview an outcome</h3></div>
      <p>Shows what the rules in effect would propose. It reads one registration of this event, or the example you type, and changes nothing.</p>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <div className="form-grid two-column">
          <label>Use
            <select value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setResult(null); setSummary(null); }}>
              <option value="REGISTRATION">A registration of this event</option>
              <option value="SYNTHETIC">An example I type in</option>
            </select>
          </label>
          <label>What is cancelled
            <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
              <option value="FULL_REGISTRATION">The whole registration</option>
              <option value="ATTENDEE">One or more attendees</option>
              <option value="COMPONENT">Individual components</option>
            </select>
          </label>
        </div>
        {mode === "REGISTRATION" ? (
          <label>Confirmation code
            <input value={registration} onChange={(event) => setRegistration(event.target.value)} required />
          </label>
        ) : (
          <>
            <label>Attendees<input inputMode="numeric" value={attendeeCount} onChange={(event) => setAttendeeCount(event.target.value)} /></label>
            {rows.map((row, index) => (
              <div className="inset-form form-grid two-column" key={index}>
                <label>Charge<input value={row.label} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></label>
                <label>Amount, dollars (negative for a discount)<input inputMode="decimal" value={row.dollars} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, dollars: event.target.value } : item))} /></label>
                <label>Kind
                  <select value={row.category} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, category: event.target.value } : item))}>
                    {chargeCategories.map((category) => <option key={category} value={category}>{category.toLowerCase()}</option>)}
                  </select>
                </label>
                <label>Attendee number (blank for the registration)<input inputMode="numeric" value={row.attendee} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, attendee: event.target.value } : item))} /></label>
                <label>Form field key (optional)<input value={row.fieldKey} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, fieldKey: event.target.value } : item))} /></label>
                <button className="text-button" type="button" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove this charge</button>
              </div>
            ))}
            <button className="secondary-button" type="button" onClick={() => setRows([...rows, { label: "", dollars: "", category: "REGISTRATION", attendee: "", fieldKey: "" }])}>Add a charge</button>
            <div className="form-grid two-column">
              <label>Paid so far, dollars<input inputMode="decimal" value={paid} onChange={(event) => setPaid(event.target.value)} /></label>
              <label>Of which reservation deposit, dollars<input inputMode="decimal" value={deposit} onChange={(event) => setDeposit(event.target.value)} /></label>
            </div>
          </>
        )}
        {mode === "REGISTRATION" && scope === "ATTENDEE" && (
          summary ? (
            <fieldset className="cancel-policy-terms"><legend>Attendees to cancel</legend>
              {summary.attendees.map((attendee) => (
                <label className="cancel-policy-check" key={attendee.id}><input type="checkbox" checked={attendeeIds.includes(attendee.id)} onChange={() => setAttendeeIds(toggle(attendeeIds, attendee.id))} /> {attendee.name}</label>
              ))}
            </fieldset>
          ) : <p><small>Calculate once to load this registration&apos;s attendees, then choose who is cancelled.</small></p>
        )}
        {mode === "REGISTRATION" && scope === "COMPONENT" && (
          summary ? (
            <fieldset className="cancel-policy-terms"><legend>Charges to cancel</legend>
              {summary.charges.map((charge) => (
                <label className="cancel-policy-check" key={charge.id}><input type="checkbox" checked={chargeIds.includes(charge.id)} onChange={() => setChargeIds(toggle(chargeIds, charge.id))} /> {charge.label} ({dollars(charge.amountCents)})</label>
              ))}
            </fieldset>
          ) : <p><small>Calculate once to load this registration&apos;s charges, then choose which to cancel.</small></p>
        )}
        {mode === "SYNTHETIC" && scope === "ATTENDEE" && (
          <label>Attendee numbers cancelled, comma separated
            <input value={attendeeIds.join(", ")} onChange={(event) => setAttendeeIds(keyList(event.target.value).map((n) => `synthetic-attendee-${n}`))} />
          </label>
        )}
        {mode === "SYNTHETIC" && scope === "COMPONENT" && (
          <label>Charge numbers cancelled (row 1, 2 ...), comma separated
            <input value={chargeIds.map((id) => id.replace("synthetic:", "")).join(", ")} onChange={(event) => setChargeIds(keyList(event.target.value).map((n) => `synthetic:${n}`))} />
          </label>
        )}
        <label className="cancel-policy-check"><input type="checkbox" checked={noShow} onChange={(event) => setNoShow(event.target.checked)} /> The registrant did not arrive for the first night</label>
        <div className="form-grid two-column">
          <label>As of date ({timezone}; blank means now, server time)<input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /></label>
          <label>As of time<input type="time" value={asOfTime} onChange={(event) => setAsOfTime(event.target.value)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions cancel-policy-actions">
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Calculating" : "Calculate"}</button>
        </div>
      </form>
      {result && <ResultView result={result} />}
    </section>
  );
}

function ResultView({ result }: { result: CancellationResult }) {
  return (
    <div className="cancel-policy-result" aria-live="polite">
      <p className="billing-estimate-note"><strong>Proposed outcome only.</strong> Nothing has been cancelled, refunded or credited.</p>
      {result.status !== "CALCULATED" ? (
        <p className="form-error" role="alert">{result.message}</p>
      ) : (
        <>
          <section className="finance-summary" aria-label="Proposed amounts">
            <article className="finance-stat"><small>Charged</small><strong>{dollars(result.totals.chargedCents)}</strong></article>
            <article className="finance-stat"><small>Paid</small><strong>{dollars(result.money.paidCents)}</strong></article>
            <article className="finance-stat"><small>Refundable</small><strong>{dollars(result.money.refundCents)}</strong></article>
            <article className="finance-stat"><small>Kept</small><strong>{dollars(result.money.retainedCents)}</strong></article>
          </section>
          <ul className="cancel-policy-explanation">
            {result.explanation.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Every charge and what happens to it</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Charge</th>
                  <th role="columnheader" scope="col">Charged</th>
                  <th role="columnheader" scope="col">Cancelled</th>
                  <th role="columnheader" scope="col">Eligible</th>
                  <th role="columnheader" scope="col">Withheld</th>
                  <th role="columnheader" scope="col">Why</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {result.lines.map((line) => (
                  <tr role="row" key={line.chargeId}>
                    <th role="rowheader" scope="row">{line.label}<small className="cancel-policy-kind"> {line.category.toLowerCase()}</small></th>
                    <td {...cardCell("Charged")}>{dollars(line.amountCents)}</td>
                    <td {...cardCell("Cancelled")}>{dollars(line.inScopeCents)}</td>
                    <td {...cardCell("Eligible")}>{dollars(line.eligibleCents)}</td>
                    <td {...cardCell("Withheld")}>{dollars(line.withheldCents)}</td>
                    <td {...cardCell("Why")}>{line.reason}</td>
                  </tr>
                ))}
                {result.flatFee && result.flatFee.cents > 0 && (
                  <tr role="row">
                    <th role="rowheader" scope="row">{result.flatFee.label}</th>
                    <td {...cardCell("Charged")}>-</td>
                    <td {...cardCell("Cancelled")}>-</td>
                    <td {...cardCell("Eligible")}>-</td>
                    <td {...cardCell("Withheld")}>{dollars(result.flatFee.cents)}</td>
                    <td {...cardCell("Why")}>A fixed fee the rules take out of the refund.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <dl className="cancel-policy-facts">
            <div><dt>Policy</dt><dd>Version {result.policy?.version}</dd></div>
            <div><dt>Terms</dt><dd>{result.timing?.label}: {result.timing?.termsText}</dd></div>
            <div><dt>Reservation deposit</dt><dd>{result.deposit.outcome === "NO_DEPOSIT" ? "None held" : `${dollars(result.deposit.heldCents)} held, ${result.deposit.outcome.replaceAll("_", " ").toLowerCase()}${result.deposit.forfeitedCents > 0 ? ` (${dollars(result.deposit.forfeitedCents)} kept)` : ""}`}</dd></div>
            <div><dt>Card fees</dt><dd>{dollars(result.feeTreatment.cardFeeCents)} in this cancellation, {result.feeTreatment.treatment === "REFUNDABLE" ? "refundable" : "nonrefundable"}</dd></div>
            <div><dt>Seats and capacity</dt><dd>{result.capacity.registrationCancelled ? "The whole registration would be cancelled" : "The registration would stay"}; {result.capacity.attendeesReleased.length} attendee{result.capacity.attendeesReleased.length === 1 ? "" : "s"} released{result.capacity.componentsReleased.length > 0 ? `, ${result.capacity.componentsReleased.length} component${result.capacity.componentsReleased.length === 1 ? "" : "s"} released` : ""}</dd></div>
            <div><dt>Future-event credit</dt><dd>{result.creditOption.available ? `May be offered, up to ${dollars(result.creditOption.maximumCents)}` : result.creditOption.note}</dd></div>
            <div><dt>Evaluated</dt><dd>{result.evaluatedAt}{result.clock === "STAFF_PREVIEW_OVERRIDE" ? " (a time you chose)" : " (server time)"}</dd></div>
          </dl>
        </>
      )}
    </div>
  );
}

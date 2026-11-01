"use client";

import Link from "next/link";
import { StaffPageHeader } from "@/components/staff-page-header";
import { useEffect, useRef, useState } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { useConfirm } from "@/components/use-confirm";
import { Building2, CalendarPlus, FileText, KeyRound, Mail, Megaphone, Save, Wrench } from "lucide-react";
import { PhoneInput } from "@/components/phone-input";
import { inlinePhoneProblem } from "@/lib/field-validation";
import {
  displayPlatformSettingValue,
  normalizePlatformSettingValue,
  platformSettingsChanges,
  platformSettingsEffects,
  platformSettingsFieldInfo,
  platformSettingsFields,
  type PlatformSettingsDraft,
  type PlatformSettingsField,
} from "@/components/platform-settings-impact";
import { EnvironmentStatusPanel } from "@/components/environment-status-panel";
import { classifySettingsSaveFailure, settingsSaveState } from "@/components/settings-save-state";
import { HomepageMinistriesEditor } from "@/components/homepage-ministries-editor";
import type { HomepageMinistry } from "@/modules/system-admin/homepage-ministries-domain";
import type { EnvironmentStatus } from "@/modules/system-admin/environment-status";
import type { PlatformSettingsRecord } from "@/modules/system-admin/platform-settings";

type Draft = PlatformSettingsDraft;

function draftFrom(settings: PlatformSettingsRecord): Draft {
  return {
    organizationName: settings.organizationName,
    logoUrl: settings.logoUrl ?? "",
    publicWebsiteUrl: settings.publicWebsiteUrl ?? "",
    defaultTimezone: settings.defaultTimezone,
    defaultAttendeeEditPolicy: settings.defaultAttendeeEditPolicy,
    passkeyRpId: settings.passkeyRpId ?? "",
    invoiceHeaderDepartment: settings.invoiceHeaderDepartment ?? "",
    invoiceHeaderOrganization: settings.invoiceHeaderOrganization ?? "",
    invoiceHeaderAddress: settings.invoiceHeaderAddress ?? "",
    invoiceHeaderPhone: settings.invoiceHeaderPhone ?? "",
    publicHelpPhone: settings.publicHelpPhone ?? "",
    publicHelpEmail: settings.publicHelpEmail ?? "",
  };
}

type Outcome =
  | { kind: "saved"; fields: string[]; effects: string[] }
  | { kind: "failed"; message: string }
  | { kind: "conflict"; message: string; fields: PlatformSettingsField[] };

// Server error codes that belong to one field rather than the whole form.
const serverCodeFields: Record<string, PlatformSettingsField> = {
  INVALID_SETTING: "invoiceHeaderPhone",
  PASSKEY_ONLY_STAFF_WOULD_BE_LOCKED_OUT: "passkeyRpId",
};

const fieldId = (key: PlatformSettingsField) => `platform-setting-${key}`;
const errorId = (key: PlatformSettingsField) => `platform-setting-${key}-error`;

export type SignInSwitchState = {
  enabled: boolean;
  linkCheck: { unlinkedPairs: number; linkedPairs: number };
};

export function PlatformSettingsWorkspace({
  initialSettings,
  initialSignIn,
  initialMinistries,
  environmentStatus = null,
}: {
  initialSettings: PlatformSettingsRecord;
  initialSignIn: SignInSwitchState;
  initialMinistries: { ministries: HomepageMinistry[]; updatedAt: string | null; updatedByName: string | null };
  /** Computed on the server for a system administrator: configured / not configured / unknown, never a value. */
  environmentStatus?: EnvironmentStatus | null;
}) {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const [signIn, setSignIn] = useState(initialSignIn);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState("");
  const [signInNotice, setSignInNotice] = useState("");

  async function changeSignIn(enabled: boolean) {
    if (enabled) {
      // Fresh counts, so the warning is not stale if someone linked people since the page loaded.
      let counts = signIn.linkCheck;
      try {
        const fresh = await fetch("/api/admin/platform-settings/unified-sign-in");
        const data = await fresh.json().catch(() => ({}));
        if (fresh.ok && data.linkCheck) {
          counts = data.linkCheck;
          setSignIn((current) => ({ ...current, linkCheck: data.linkCheck }));
        }
      } catch {
        // Fall back to the counts already on screen.
      }
      const unlinked = counts.unlinkedPairs;
      const confirmed = await askConfirm({
        title: "Turn on one sign-in",
        confirmLabel: "Turn one sign-in on",
        body: (
          <>
            {unlinked > 0 && (
              <p>
                {unlinked} {unlinked === 1 ? "person still has a separate account" : "people still have separate accounts"}; link
                them on <Link className="text-button" href="/admin/people">People & access</Link> first.
              </p>
            )}
            <p>
              <code>/login</code> and <code>/account/sign-in</code> will send everyone to the single <code>/sign-in</code> page, and
              staff get both their staff and attendee sides. You can turn it off again; sessions that already exist stay valid.
            </p>
          </>
        ),
      });
      if (!confirmed) return;
    } else {
      const confirmed = await askConfirm({
        title: "Turn off one sign-in",
        confirmLabel: "Turn one sign-in off",
        body: (
          <p>
            <code>/login</code> and <code>/account/sign-in</code> go back to their separate pages right away, and staff stop getting both
            their staff and attendee sides from one sign-in. Linked accounts stay linked, and sessions that already exist stay valid.
            You can turn it on again.
          </p>
        ),
      });
      if (!confirmed) return;
    }
    setSignInBusy(true);
    setSignInError("");
    setSignInNotice("");
    try {
      const response = await fetch("/api/admin/platform-settings/unified-sign-in", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.enabled !== "boolean") {
        throw new Error(result.message ?? "The switch could not be changed.");
      }
      setSignIn({ enabled: result.enabled, linkCheck: result.linkCheck ?? signIn.linkCheck });
      setSignInNotice(result.enabled ? "One sign-in is on." : "One sign-in is off.");
    } catch (caught) {
      setSignInError(caught instanceof Error ? caught.message : "The switch could not be changed.");
    } finally {
      setSignInBusy(false);
    }
  }

  const [settings, setSettings] = useState(initialSettings);
  const [draft, setDraft] = useState(() => draftFrom(initialSettings));
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PlatformSettingsField, string>>>({});
  // The Advanced group is closed on load. It opens by itself when the passkey domain inside it is edited, collides or fails,
  // so a problem is never hidden in a closed disclosure.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // The invoice phone gets the shared check inline (#1193); the saved phone is the one already stored, which is flagged but never blocks.
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneProblem = inlinePhoneProblem("Phone", draft.invoiceHeaderPhone, settings.invoiceHeaderPhone, phoneTouched);
  const [helpPhoneTouched, setHelpPhoneTouched] = useState(false);
  const helpPhoneProblem = inlinePhoneProblem("Phone", draft.publicHelpPhone, settings.publicHelpPhone, helpPhoneTouched);
  const changes = platformSettingsChanges(draftFrom(settings), draft);
  const dirty = changes.length > 0;
  const shownOutcome = outcome?.kind === "conflict" && !dirty ? null : outcome;
  useUnsavedChangesGuard(dirty, "These platform settings have not been saved. Leave and discard the changes?");

  function edit(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "passkeyRpId") setAdvancedOpen(true);
    // A stale "Saved" must not outlive the next edit; a failure or conflict stays until the next save or Cancel.
    setOutcome((current) => (current?.kind === "saved" || current?.kind === "conflict" ? null : current));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function field(key: keyof Draft) {
    return {
      id: fieldId(key),
      value: draft[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => edit(key, event.target.value),
    };
  }

  function invalidProps(key: PlatformSettingsField, extraMessage?: string) {
    const message = fieldErrors[key] ?? extraMessage;
    return { "aria-invalid": message ? true : undefined, "aria-describedby": message ? errorId(key) : undefined };
  }

  function fieldError(key: PlatformSettingsField, extraMessage?: string) {
    const message = fieldErrors[key] ?? extraMessage;
    return message ? <small className="field-error" id={errorId(key)} role="alert">{message}</small> : null;
  }

  // Focus waits for the fieldset to be enabled again, which is after the request settles.
  const [focusRequest, setFocusRequest] = useState<{ keys: PlatformSettingsField[] } | null>(null);
  const handledFocus = useRef<unknown>(null);
  useEffect(() => {
    if (saving || !focusRequest || handledFocus.current === focusRequest) return;
    handledFocus.current = focusRequest;
    const first = platformSettingsFields.find((key) => focusRequest.keys.includes(key));
    if (first) document.getElementById(fieldId(first))?.focus();
  }, [saving, focusRequest]);
  const focusFirstInvalid = (keys: PlatformSettingsField[]) => {
    if (keys.includes("passkeyRpId")) setAdvancedOpen(true);
    setFocusRequest({ keys });
  };

  function cancelChanges() {
    setDraft(draftFrom(settings));
    setOutcome(null);
    setFieldErrors({});
    setPhoneTouched(false);
    setHelpPhoneTouched(false);
  }

  async function save(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setPhoneTouched(true);
    setHelpPhoneTouched(true);
    if (phoneProblem.blocking || helpPhoneProblem.blocking) {
      setOutcome({ kind: "failed", message: "Check the highlighted answers and try again." });
      focusFirstInvalid([
        ...(phoneProblem.blocking ? ["invoiceHeaderPhone" as const] : []),
        ...(helpPhoneProblem.blocking ? ["publicHelpPhone" as const] : []),
      ]);
      return;
    }
    if (settings.passkeyRpId
      && normalizePlatformSettingValue("passkeyRpId", draft.passkeyRpId) !== normalizePlatformSettingValue("passkeyRpId", settings.passkeyRpId)) {
      const confirmed = await askConfirm({
        title: "Change the passkey domain",
        confirmLabel: "Change passkey domain",
        body: (
          <p>
            Changing the passkey domain makes every existing passkey stop working. Anyone who signs in with a passkey will need to add
            a new one. The server refuses the change if it would lock out staff who have only a passkey.
          </p>
        ),
      });
      if (!confirmed) return;
    }
    // Computed before the request, so the success message names what was actually saved.
    const saved = changes;
    // Every saved value, so the server can tell which fields this person edited and writes only those.
    const savedValues = draftFrom(settings);
    const baseline = Object.fromEntries(platformSettingsFields.map((key) => [key, normalizePlatformSettingValue(key, savedValues[key])]));
    const edited = new Set<string>(changes.map((change) => change.field));
    setSaving(true);
    setOutcome(null);
    setFieldErrors({});
    try {
      let response: Response;
      try {
        response = await fetch("/api/admin/platform-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, baseline }),
        });
      } catch {
        setOutcome({ kind: "failed", message: "Could not reach the server. Your changes are still here; try again." });
        return;
      }
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.settings) {
        setSettings(result.settings);
        setDraft(draftFrom(result.settings));
        setOutcome({ kind: "saved", fields: saved.map((change) => change.label), effects: platformSettingsEffects(saved) });
        return;
      }
      if (response.status === 409 && result.error === "PLATFORM_SETTINGS_CONFLICT") {
        // Rebase: untouched fields follow the latest saved values, this person's edits stay, so saving again is a deliberate
        // overwrite of only the fields that collided.
        if (result.settings) {
          const latest = draftFrom(result.settings);
          setSettings(result.settings);
          setDraft((current) => Object.fromEntries(
            platformSettingsFields.map((key) => [key, edited.has(key) ? current[key] : latest[key]]),
          ) as Draft);
        }
        if (Array.isArray(result.fields) && result.fields.includes("passkeyRpId")) setAdvancedOpen(true);
        setOutcome({
          kind: "conflict",
          message: result.message ?? "Someone else saved platform settings since you opened this page.",
          fields: (result.fields ?? []).filter((key: string): key is PlatformSettingsField => key in platformSettingsFieldInfo),
        });
        return;
      }
      // Access revoked mid-edit: say so plainly. Nothing was saved and the draft is untouched.
      const failure = classifySettingsSaveFailure({
        scope: "platform",
        status: response.status,
        code: result.error,
        message: result.message,
        fallback: "The platform settings could not be saved.",
      });
      if (failure.kind === "permission") {
        setOutcome({ kind: "failed", message: failure.message });
        return;
      }
      const invalid: Partial<Record<PlatformSettingsField, string>> = {};
      if (response.status === 400 && Array.isArray(result.issues)) {
        for (const issue of result.issues as { path?: unknown[]; message?: string }[]) {
          const key = issue.path?.[0];
          if (typeof key === "string" && key in platformSettingsFieldInfo && !invalid[key as PlatformSettingsField]) {
            invalid[key as PlatformSettingsField] = issue.message ?? "Check this answer.";
          }
        }
      }
      const codeField = result.error === "INVALID_SETTING" && typeof result.message === "string" && result.message.startsWith("Help phone")
        ? "publicHelpPhone"
        : serverCodeFields[result.error as string];
      if (codeField && !invalid[codeField]) invalid[codeField] = result.message ?? "Check this answer.";
      setFieldErrors(invalid);
      setOutcome({ kind: "failed", message: result.message ?? "The platform settings could not be saved." });
      focusFirstInvalid(Object.keys(invalid) as PlatformSettingsField[]);
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = settingsSaveState({ saving, dirty, outcome: shownOutcome?.kind ?? null }).label;

  return (
    <section className="page-stack platform-settings-workspace">
      <StaffPageHeader description="Identity for the platform as a whole, and the defaults a newly created event starts from." />

      <p className="settings-scope-note">
        These settings are platform-wide, not tied to whichever event is open. Values that belong to one event are on{" "}
        <Link className="text-button" href="/more/event-settings">Event settings</Link>. Your own sign-in is on{" "}
        <Link className="text-button" href="/profile">My profile and security</Link>.
      </p>

      <section className="panel" aria-labelledby="one-sign-in-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><KeyRound aria-hidden="true" size={14} /> One sign-in</p>
            <h2 id="one-sign-in-heading">One sign-in for staff and attendees</h2>
          </div>
        </div>
        <p className="settings-ownership"><strong>Affects everyone.</strong> Turning it on or off changes every sign-in page right away.</p>
        <p className="field-help">
          Turning this on sends <code>/login</code> and <code>/account/sign-in</code> to the single <code>/sign-in</code> page, and
          staff get both their staff and attendee sides. Turning it off restores the separate pages. Sessions that already exist
          stay valid either way.
        </p>
        <p className="field-help">
          One sign-in is currently <strong>{signIn.enabled ? "on" : "off"}</strong>.
        </p>
        <ul className="field-help">
          <li>Staff with a matching attendee account, not linked yet: <strong>{signIn.linkCheck.unlinkedPairs}</strong></li>
          <li>Linked pairs: <strong>{signIn.linkCheck.linkedPairs}</strong></li>
        </ul>
        <p className="field-help">
          Link people by hand on <Link className="text-button" href="/admin/people">System management → People & access</Link>. You can
          turn this on with unlinked pairs remaining; they keep separate accounts until linked.
        </p>
        {signInError && <p className="form-error" role="alert">{signInError}</p>}
        {signInNotice && <p className="inline-notice" role="status">{signInNotice}</p>}
        <div className="form-actions">
          <button className="primary-button" type="button" disabled={signInBusy} onClick={() => void changeSignIn(!signIn.enabled)}>
            {signIn.enabled ? "Turn one sign-in off" : "Turn one sign-in on"}
          </button>
        </div>
        {confirmDialog}
      </section>

      <form className="form-stack" onSubmit={save}>
        <fieldset className="form-stack settings-fields" disabled={saving}>
        <section className="panel" aria-labelledby="platform-identity-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><Building2 aria-hidden="true" size={14} /> Organization</p>
              <h2 id="platform-identity-heading">Who this platform belongs to</h2>
            </div>
          </div>
          <p className="settings-ownership"><strong>Central value.</strong> Used everywhere the organization name and logo appear.</p>
          <label>
            Organization name
            <input required minLength={2} maxLength={120} {...field("organizationName")} {...invalidProps("organizationName")} />
            <small>Shown in the page header, emails and invoices that do not have their own name.</small>
            {fieldError("organizationName")}
          </label>
          <label>
            Logo URL
            <input type="url" placeholder="https://imsda.org/logo.png" {...field("logoUrl")} {...invalidProps("logoUrl")} />
            <small>A link to an image already hosted somewhere you control. Leave blank for none.</small>
            {fieldError("logoUrl")}
          </label>
          <label>
            Public website
            <input type="url" placeholder="https://imsda.org" {...field("publicWebsiteUrl")} {...invalidProps("publicWebsiteUrl")} />
            <small>The organization&apos;s main website, linked from public pages.</small>
            {fieldError("publicWebsiteUrl")}
          </label>
        </section>

        <section className="panel" aria-labelledby="platform-defaults-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><CalendarPlus aria-hidden="true" size={14} /> New event defaults</p>
              <h2 id="platform-defaults-heading">What a new event starts from</h2>
            </div>
          </div>
          <p className="settings-ownership">
            <strong>A template copy.</strong> These seed newly created events. Existing events keep their own values, and an
            event&apos;s own setting overrides the default.
          </p>
          <p className="field-help">
            These fill in when an event is created. Changing them here never rewrites an event that already exists.
          </p>
          <label>
            Default timezone
            <input required maxLength={60} {...field("defaultTimezone")} {...invalidProps("defaultTimezone")} />
            <small>An IANA name such as America/Chicago. Each event can still choose its own timezone.</small>
            {fieldError("defaultTimezone")}
          </label>
          <label>
            Default attendee edit verification
            <select
              id={fieldId("defaultAttendeeEditPolicy")}
              value={draft.defaultAttendeeEditPolicy}
              onChange={(event) => edit("defaultAttendeeEditPolicy", event.target.value)}
              {...invalidProps("defaultAttendeeEditPolicy")}
            >
              <option value="VERIFY_EVERY_EDIT">Verify every edit</option>
              <option value="TIERED">Tiered by sensitivity</option>
            </select>
            <small>New events inherit this choice. Existing events are never rewritten.</small>
            {fieldError("defaultAttendeeEditPolicy")}
          </label>
          <p className="field-help">
            The sender name, address and reply-to every event&apos;s email uses are set on <Link className="text-button" href="/admin/email">System management → Email</Link>.
            A new event still starts on local capture, so nothing reaches a registrant until someone turns real delivery on for that event.
          </p>
        </section>

        <section className="panel" aria-labelledby="platform-homepage-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><Megaphone aria-hidden="true" size={14} /> Public homepage</p>
              <h2 id="platform-homepage-heading">Homepage help contact</h2>
            </div>
          </div>
          <p className="settings-ownership"><strong>Central value.</strong> Shown on the public front page right away.</p>
          <p className="field-help platform-note">
            Shown at the bottom of the front page as &ldquo;Need help? Call &hellip; or email &hellip;&rdquo;. Leave a field blank to leave that part out; with both
            blank no help line shows. This is separate from the alert addresses, which are internal.
          </p>
          <label>Help phone
            <PhoneInput {...invalidProps("publicHelpPhone")} autoComplete="off" id={fieldId("publicHelpPhone")} label="Help phone" onBlur={() => setHelpPhoneTouched(true)} onValueChange={(value) => edit("publicHelpPhone", value)} showNow={helpPhoneTouched} stored={settings.publicHelpPhone} value={draft.publicHelpPhone} />
            <small>A phone number the public can call, like (515) 555-0100.</small>
            {fieldError("publicHelpPhone")}
          </label>
          <label>Help email
            <input autoComplete="off" maxLength={200} type="email" {...field("publicHelpEmail")} {...invalidProps("publicHelpEmail")} />
            <small>An address the public can write to. Shown as typed, saved in lower case.</small>
            {fieldError("publicHelpEmail")}
          </label>
        </section>

        <section className="panel" aria-labelledby="platform-invoices-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><FileText aria-hidden="true" size={14} /> Invoices</p>
              <h2 id="platform-invoices-heading">Invoice PDF header</h2>
            </div>
          </div>
          <p className="settings-ownership">
            <strong>Central value.</strong> Applies to invoice PDFs made after you save; PDFs already made keep their header.
          </p>
          <p className="field-help">
            Printed at the top of every church invoice PDF made from now on. A PDF that was already made keeps its header. Leave every
            field blank to print just the organization name above.
          </p>
          <label>
            Department line
            <input maxLength={120} placeholder="Youth Ministries Department" {...field("invoiceHeaderDepartment")} {...invalidProps("invoiceHeaderDepartment")} />
            <small>The line above the organization name, such as a department.</small>
            {fieldError("invoiceHeaderDepartment")}
          </label>
          <label>
            Organization on invoices
            <input maxLength={120} {...field("invoiceHeaderOrganization")} {...invalidProps("invoiceHeaderOrganization")} />
            <small>Blank prints the organization name from Organization above.</small>
            {fieldError("invoiceHeaderOrganization")}
          </label>
          <label>
            Mailing address
            <textarea
              id={fieldId("invoiceHeaderAddress")}
              maxLength={400}
              rows={3}
              value={draft.invoiceHeaderAddress}
              onChange={(event) => edit("invoiceHeaderAddress", event.target.value)}
              {...invalidProps("invoiceHeaderAddress")}
            />
            <small>One line per row, up to four.</small>
            {fieldError("invoiceHeaderAddress")}
          </label>
          <label>Phone
            <PhoneInput {...invalidProps("invoiceHeaderPhone")} autoComplete="off" id={fieldId("invoiceHeaderPhone")} label="Phone" onBlur={() => setPhoneTouched(true)} onValueChange={(value) => edit("invoiceHeaderPhone", value)} showNow={phoneTouched} stored={settings.invoiceHeaderPhone} value={draft.invoiceHeaderPhone} />
            <small>Printed under the address, like (515) 555-0100.</small>
            {fieldError("invoiceHeaderPhone")}
          </label>
        </section>

        <section className="panel" aria-labelledby="platform-alerts-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><Mail aria-hidden="true" size={14} /> Alerts</p>
              <h2 id="platform-alerts-heading">Alert addresses</h2>
            </div>
          </div>
          <p className="settings-ownership"><strong>Owned by Email.</strong> Nothing here is edited on this page.</p>
          <p className="field-help">
            The support contact, the security alert address and the new club application address are edited, with a switch for every
            automatic alert, on <Link className="text-button" href="/admin/email">Email</Link>.
          </p>
        </section>

        <section className="panel platform-advanced" aria-labelledby="platform-advanced-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><Wrench aria-hidden="true" size={14} /> Advanced</p>
              <h2 id="platform-advanced-heading">Technical settings</h2>
            </div>
          </div>
          <p className="field-help">
            Provider and technical details that most administrators never change. Open this only when you know why.
          </p>
          <details className="platform-advanced-details" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary>Advanced settings</summary>
            <div className="form-stack">
              <p className="settings-ownership">
                <strong>Central value.</strong> Changing the passkey domain invalidates every existing passkey. The server refuses the
                change if staff who have only a passkey would be locked out.
              </p>
              <label>
                Passkey domain
                <input autoCapitalize="off" autoComplete="off" placeholder="events.imsda.org" spellCheck={false} {...field("passkeyRpId")} {...invalidProps("passkeyRpId")} />
                <small>
                  The site&apos;s own domain, with no https:// or path. Club directors can then use a passkey instead of an authenticator
                  code. Leave blank to keep passkeys off. Changing it later makes every existing passkey stop working.
                </small>
                {fieldError("passkeyRpId")}
              </label>
              {environmentStatus && <EnvironmentStatusPanel status={environmentStatus} />}
            </div>
          </details>
        </section>
        </fieldset>

        {shownOutcome?.kind === "conflict" && (
          <div className="settings-conflict" role="alert">
            <p><strong>{shownOutcome.message}</strong> Your edits are still here and were not saved. These edits of yours collided with the other change:</p>
            {shownOutcome.fields.length > 0 && (
              <ul>
                {shownOutcome.fields.map((key) => (
                  <li key={key}>
                    {platformSettingsFieldInfo[key].label} is now saved as <strong>{displayPlatformSettingValue(key, draftFrom(settings)[key])}</strong>
                    {draft[key] !== draftFrom(settings)[key] && <> (you have <strong>{displayPlatformSettingValue(key, draft[key])}</strong>)</>}.
                  </li>
                ))}
              </ul>
            )}
            <p>Save again replaces the other person&apos;s value for those fields only. Cancel loads the latest saved values instead.</p>
          </div>
        )}

        {dirty && (
          <div className="settings-changes">
            <h3>Changes to save</h3>
            <ul>
              {changes.map((change) => (
                <li key={change.field}>
                  <strong>{change.label}:</strong> {change.from} → {change.to}
                  <span>{change.effect}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-actions settings-save-row">
          <div className="settings-save-status" role="status">
            {statusLabel && <span className={dirty && !saving ? "unsaved-dot" : undefined}>{statusLabel}</span>}
            {outcome?.kind === "saved" && !dirty && (
              <span className="settings-saved-detail">
                Saved {outcome.fields.length > 0 ? outcome.fields.join(", ") : "platform settings"}. {outcome.effects.join(" ")}
              </span>
            )}
          </div>
          {outcome?.kind === "failed" && <p className="form-error" role="alert">{outcome.message}</p>}
          {dirty && (
            <button className="secondary-button" type="button" disabled={saving} onClick={cancelChanges}>Cancel</button>
          )}
          <button className="primary-button" type="submit" disabled={saving || !dirty}>
            <Save aria-hidden="true" size={16} /> {saving ? "Saving…" : "Save platform settings"}
          </button>
        </div>
        <p className="field-help">
          Last changed {new Date(settings.updatedAt).toLocaleString()}
          {settings.updatedByName ? ` by ${settings.updatedByName}` : ""}.
        </p>
      </form>

      <p className="field-help" style={{ margin: "4px 0 0" }}>
        Notices, announcements, featured events, header links and the footer are edited, previewed and published on <Link className="text-button" href="/admin/site-content">Homepage &amp; site content</Link>.
      </p>

      <HomepageMinistriesEditor initial={initialMinistries.ministries} updatedAt={initialMinistries.updatedAt} updatedByName={initialMinistries.updatedByName} />
    </section>
  );
}

"use client";

import styles from "./staff-submit-panel.module.css";

/** What the public form needs to run as staff sending a registration for the registrant (#1510). */
export type StaffSubmitConfig = {
  /** `POST /api/events/{eventId}/staff-registration-drafts/{draftId}/submit`. */
  submitUrl: string;
  sourceLabel: string;
  source: "PHONE" | "PAPER" | "WALK_IN";
  /** The help text for the paper location field (`PAPER_LOCATION_HELP`). */
  paperLocationHelp: string;
  /** True when this person holds OVERRIDE_REGISTRATION_RULES. */
  canOverride: boolean;
  /** The rule the page found at load, in plain words ("Registration is closed for this event."), or null. */
  overrideRule: string | null;
  returnHref: string;
  returnLabel: string;
};

export const OVERRIDE_REASON_MIN = 10;
export const OVERRIDE_REASON_MAX = 500;
export const OVERRIDE_NEEDS_PERMISSION = "Someone with Registration overrides can send it.";

/** What the staff submit adds to the registration body (#1510): the paper location for a paper source, and the override with its trimmed reason. */
export function staffSubmitExtras(config: Pick<StaffSubmitConfig, "source">, paperLocation: string, overrideRule: string | null, reason: string) {
  return {
    ...(config.source === "PAPER" ? { paperLocation: paperLocation.trim() } : {}),
    ...(overrideRule ? { override: { reason: reason.trim() } } : {}),
  };
}

/** The two staff-only fields, checked before anything is sent: a paper source needs its location, an override needs a reason of 10 to 500 characters. */
export function staffSubmitFieldErrors(config: Pick<StaffSubmitConfig, "source" | "paperLocationHelp">, paperLocation: string, overrideRule: string | null, reason: string) {
  const errors: { paperLocation?: string; reason?: string } = {};
  if (config.source === "PAPER" && paperLocation.trim().length === 0) errors.paperLocation = config.paperLocationHelp;
  const length = reason.trim().length;
  if (overrideRule && (length < OVERRIDE_REASON_MIN || length > OVERRIDE_REASON_MAX)) {
    errors.reason = `Give a reason of ${OVERRIDE_REASON_MIN} to ${OVERRIDE_REASON_MAX} characters.`;
  }
  return errors;
}

export function StaffSubmitPanel({
  config,
  paperLocation,
  onPaperLocation,
  overrideReason,
  onOverrideReason,
  overrideRule,
  fieldError,
}: {
  config: StaffSubmitConfig;
  paperLocation: string;
  onPaperLocation: (value: string) => void;
  overrideReason: string;
  onOverrideReason: (value: string) => void;
  /** The rule to name above the reason box; null hides the box. */
  overrideRule: string | null;
  fieldError: { paperLocation?: string; reason?: string };
}) {
  return (
    <section className={styles.panel} aria-label="Sending for the registrant">
      <p className={styles.banner} role="status">
        You&apos;re sending this registration for the registrant. Source: {config.sourceLabel}.
      </p>
      <p className={styles.note}>
        Typed signatures aren&apos;t collected here, because staff can&apos;t sign for someone. No payment is taken or marked received.
      </p>
      {config.source === "PAPER" ? (
        <label className={styles.field}>
          <span>Where the paper form is kept <span aria-hidden="true">*</span></span>
          <input
            type="text"
            name="paperLocation"
            value={paperLocation}
            maxLength={200}
            required
            aria-required="true"
            aria-invalid={Boolean(fieldError.paperLocation)}
            aria-describedby="staff-paper-location-help"
            onChange={(event) => onPaperLocation(event.target.value)}
          />
          <small className={styles.help} id="staff-paper-location-help">{config.paperLocationHelp}</small>
          {fieldError.paperLocation ? <small className={styles.error} role="alert">{fieldError.paperLocation}</small> : null}
        </label>
      ) : null}
      {overrideRule ? (
        <label className={styles.field}>
          <span>Reason for going past this rule <span aria-hidden="true">*</span></span>
          <small className={styles.help} id="staff-override-rule">{overrideRule} Your reason is recorded with your name.</small>
          <textarea
            name="overrideReason"
            value={overrideReason}
            minLength={OVERRIDE_REASON_MIN}
            maxLength={OVERRIDE_REASON_MAX}
            required
            aria-required="true"
            aria-invalid={Boolean(fieldError.reason)}
            aria-describedby="staff-override-rule"
            onChange={(event) => onOverrideReason(event.target.value)}
          />
          <small className={styles.help}>{OVERRIDE_REASON_MIN} to {OVERRIDE_REASON_MAX} characters.</small>
          {fieldError.reason ? <small className={styles.error} role="alert">{fieldError.reason}</small> : null}
        </label>
      ) : null}
    </section>
  );
}

"use client";

import { EmailInput } from "@/components/email-input";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { PhoneInput } from "@/components/phone-input";
import { summaryMessage, type ErrorSummaryItem } from "@/components/form-error-summary";
import {
  CONTACT_MAX_LENGTHS,
  contactFieldLabels,
  contactValues,
  type ContactFormErrors,
  type ContactValues,
} from "@/modules/club-rosters/guardians-domain";
import styles from "@/components/roster-contact-fields.module.css";

/**
 * The "Contact details" section of the roster add/edit dialog (#2060): the person's own email, phone and mailing
 * address (a youth's household address), for every member type. Every field is optional. The inputs are uncontrolled and
 * named `contactEmail`, `contactPhone`, `contactAddressLine1`, ... so the form reads them like the guardian fields.
 */
export function RosterContactFields({ errors, guardianState, record }: {
  errors: ContactFormErrors;
  guardianState: "ready" | "loading" | "failed";
  record: ContactValues | undefined;
}) {
  const stored = contactValues(record);
  const readOnly = guardianState !== "ready";
  const stateError = errors.state;
  const zipError = errors.postalCode;
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Contact details (optional)</legend>
      <p className={`field-help ${styles.help}`}>
        Optional. Your club&apos;s director and deputy can see and change these. They are erased when this person is removed from the roster.
      </p>
      {guardianState === "failed" && (
        <p className={`field-help ${styles.help}`} role="status">Contact details couldn&apos;t be loaded, so saving won&apos;t change them. Close and reopen this person to try again.</p>
      )}
      <div className={styles.grid}>
        <label className={styles.field}>
          {contactFieldLabels.email}
          <EmailInput autoComplete="email" defaultValue={stored.email} error={errors.email} errorId="roster-contactEmail-error" id="roster-contactEmail" label={contactFieldLabels.email} maxLength={CONTACT_MAX_LENGTHS.email} name="contactEmail" readOnly={readOnly} stored={stored.email} />
        </label>
        <label className={styles.field}>
          {contactFieldLabels.phone}
          <PhoneInput defaultValue={stored.phone} error={errors.phone} errorId="roster-contactPhone-error" id="roster-contactPhone" label={contactFieldLabels.phone} name="contactPhone" readOnly={readOnly} stored={stored.phone} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          {contactFieldLabels.addressLine1}
          <input autoComplete="address-line1" defaultValue={stored.addressLine1} maxLength={CONTACT_MAX_LENGTHS.addressLine1} name="contactAddressLine1" readOnly={readOnly} type="text" />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          {contactFieldLabels.addressLine2}
          <input autoComplete="address-line2" defaultValue={stored.addressLine2} maxLength={CONTACT_MAX_LENGTHS.addressLine2} name="contactAddressLine2" readOnly={readOnly} type="text" />
        </label>
        <label className={styles.field}>
          {contactFieldLabels.city}
          <input autoComplete="address-level2" defaultValue={stored.city} maxLength={CONTACT_MAX_LENGTHS.city} name="contactCity" readOnly={readOnly} type="text" />
        </label>
        <label className={styles.field}>
          {contactFieldLabels.state}
          <input
            autoCapitalize="characters"
            autoComplete="address-level1"
            defaultValue={stored.state}
            id="roster-contactState"
            maxLength={CONTACT_MAX_LENGTHS.state}
            name="contactState"
            placeholder="e.g. IA"
            readOnly={readOnly}
            type="text"
            {...fieldErrorProps("roster-contactState-error", stateError)}
          />
          <FieldError id="roster-contactState-error">{stateError}</FieldError>
        </label>
        <label className={styles.field}>
          {contactFieldLabels.postalCode}
          <input
            autoComplete="postal-code"
            defaultValue={stored.postalCode}
            id="roster-contactPostalCode"
            inputMode="numeric"
            maxLength={CONTACT_MAX_LENGTHS.postalCode}
            name="contactPostalCode"
            readOnly={readOnly}
            type="text"
            {...fieldErrorProps("roster-contactPostalCode-error", zipError)}
          />
          <FieldError id="roster-contactPostalCode-error">{zipError}</FieldError>
        </label>
      </div>
    </fieldset>
  );
}

/** Summary items for the contact detail problems, each linking to its box. */
export function contactErrorItems(errors: ContactFormErrors): ErrorSummaryItem[] {
  const items: ErrorSummaryItem[] = [];
  for (const field of ["email", "phone", "state", "postalCode"] as const) {
    const message = errors[field];
    if (message) items.push({ targetId: `roster-contact${field[0]!.toUpperCase()}${field.slice(1)}`, message: summaryMessage(contactFieldLabels[field], message) });
  }
  return items;
}

import { FieldError, fieldErrorProps } from "@/components/field-error";
import { summaryMessage, type ErrorSummaryItem } from "@/components/form-error-summary";
import {
  GUARDIAN_SLOTS,
  guardianFieldLabels,
  guardianSlotValues,
  EMERGENCY_CONTACT_TERM,
  type GuardianFormErrors,
  type GuardianRecord,
} from "@/modules/club-rosters/guardians-domain";

/**
 * The emergency contact fieldset in the roster add/edit dialog (#510). Staff see it as "Emergency contact", for
 * every roster member, adult or minor. Two slots, every field optional.
 */
export function RosterGuardianFields({ errors: guardianErrors, guardianState, records }: {
  errors: GuardianFormErrors;
  guardianState: "ready" | "loading" | "failed";
  records: GuardianRecord[] | undefined;
}) {
  const term = EMERGENCY_CONTACT_TERM;
  return (
    <fieldset className="roster-guardians">
      <legend>{term.plural} (optional)</legend>
      <p className="field-help">
        Up to two emergency contacts. Your club&apos;s director and deputy, Area Coordinators and conference staff with
        sensitive-data access can see them. They are erased when this person is removed from the roster.
      </p>
      {guardianState === "failed" && (
        <p className="field-help" role="status">{term.plural} couldn&apos;t be loaded, so saving won&apos;t change them. Close and reopen this person to try again.</p>
      )}
      {Array.from({ length: GUARDIAN_SLOTS }, (_, index) => {
        const slot = index + 1;
        const stored = guardianSlotValues(records)[index]!;
        const emailError = guardianErrors[`g${slot as 1 | 2}Email`];
        const phoneError = guardianErrors[`g${slot as 1 | 2}Phone`];
        return (
          <div className="roster-guardian-slot" key={slot} role="group" aria-label={`${term.singular} ${slot}`}>
            <h3>{term.singular} {slot}</h3>
            <div className="form-grid two-column">
              <label>
                {guardianFieldLabels.name}
                <input autoComplete="off" defaultValue={stored.name} readOnly={guardianState !== "ready"} maxLength={120} name={`g${slot}Name`} />
              </label>
              <label>
                {guardianFieldLabels.relationship}
                <input autoComplete="off" defaultValue={stored.relationship} readOnly={guardianState !== "ready"} maxLength={60} name={`g${slot}Relationship`} placeholder="e.g. Spouse or parent" />
              </label>
              <label>
                {guardianFieldLabels.email}
                <input {...fieldErrorProps(`roster-g${slot}Email-error`, emailError)} autoComplete="email" id={`roster-g${slot}Email`} defaultValue={stored.email} readOnly={guardianState !== "ready"} inputMode="email" maxLength={160} name={`g${slot}Email`} type="email" />
                <FieldError id={`roster-g${slot}Email-error`}>{emailError}</FieldError>
              </label>
              <label>
                {guardianFieldLabels.phone}
                <input {...fieldErrorProps(`roster-g${slot}Phone-error`, phoneError)} autoComplete="tel" id={`roster-g${slot}Phone`} defaultValue={stored.phone} readOnly={guardianState !== "ready"} inputMode="tel" maxLength={40} name={`g${slot}Phone`} type="tel" />
                <FieldError id={`roster-g${slot}Phone-error`}>{phoneError}</FieldError>
              </label>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

/** Summary items for the emergency contact problems, in slot order, each linking to its box. */
export function guardianErrorItems(errors: GuardianFormErrors): ErrorSummaryItem[] {
  const items: ErrorSummaryItem[] = [];
  for (const slot of [1, 2] as const) {
    for (const field of ["Email", "Phone"] as const) {
      const message = errors[`g${slot}${field}`];
      if (message) items.push({ targetId: `roster-g${slot}${field}`, message: summaryMessage(`${EMERGENCY_CONTACT_TERM.singular} ${slot} ${field.toLowerCase()}`, message) });
    }
  }
  return items;
}

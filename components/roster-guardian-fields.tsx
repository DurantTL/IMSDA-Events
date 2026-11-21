import { EmailInput } from "@/components/email-input";
import { PhoneInput } from "@/components/phone-input";
import { summaryMessage, type ErrorSummaryItem } from "@/components/form-error-summary";
import {
  GUARDIAN_SLOTS,
  guardianFieldLabels,
  guardianSlotValues,
  EMERGENCY_CONTACT_TERM,
  PARENT_CONTACT_TERM,
  type GuardianFormErrors,
  type ParentFormErrors,
  type GuardianRecord,
} from "@/modules/club-rosters/guardians-domain";

type ContactKind = "g" | "p";
type ContactErrors = Partial<Record<`${ContactKind}${1 | 2}${"Email" | "Phone"}`, string>>;

/**
 * One two-slot contact fieldset: emergency contacts (field names `g1Name`, ...) or parents or guardians (#2058, `p1Name`,
 * ...). Both are the same four optional fields; only the prefix, wording and help text differ.
 */
function RosterContactFields({ kind, term, help, errors, guardianState, records }: {
  kind: ContactKind;
  term: { singular: string; plural: string };
  help: string;
  errors: ContactErrors;
  guardianState: "ready" | "loading" | "failed";
  records: GuardianRecord[] | undefined;
}) {
  return (
    <fieldset className="roster-guardians">
      <legend>{term.plural} (optional)</legend>
      <p className="field-help">{help}</p>
      {guardianState === "failed" && (
        <p className="field-help" role="status">{term.plural} couldn&apos;t be loaded, so saving won&apos;t change them. Close and reopen this person to try again.</p>
      )}
      {Array.from({ length: GUARDIAN_SLOTS }, (_, index) => {
        const slot = index + 1;
        const stored = guardianSlotValues(records)[index]!;
        const emailError = errors[`${kind}${slot as 1 | 2}Email`];
        const phoneError = errors[`${kind}${slot as 1 | 2}Phone`];
        return (
          <div className="roster-guardian-slot" key={slot} role="group" aria-label={`${term.singular} ${slot}`}>
            <h3>{term.singular} {slot}</h3>
            <div className="form-grid two-column">
              <label>
                {guardianFieldLabels.name}
                <input autoComplete="off" defaultValue={stored.name} readOnly={guardianState !== "ready"} maxLength={120} name={`${kind}${slot}Name`} />
              </label>
              <label>
                {guardianFieldLabels.relationship}
                <input autoComplete="off" defaultValue={stored.relationship} readOnly={guardianState !== "ready"} maxLength={60} name={`${kind}${slot}Relationship`} placeholder={kind === "p" ? "e.g. Mother or guardian" : "e.g. Spouse or parent"} />
              </label>
              <label>
                {guardianFieldLabels.email}
                <EmailInput autoComplete="email" defaultValue={stored.email} error={emailError} errorId={`roster-${kind}${slot}Email-error`} id={`roster-${kind}${slot}Email`} label={guardianFieldLabels.email} maxLength={160} name={`${kind}${slot}Email`} readOnly={guardianState !== "ready"} stored={stored.email} />
              </label>
              <label>
                {guardianFieldLabels.phone}
                <PhoneInput defaultValue={stored.phone} error={phoneError} errorId={`roster-${kind}${slot}Phone-error`} id={`roster-${kind}${slot}Phone`} label={guardianFieldLabels.phone} name={`${kind}${slot}Phone`} readOnly={guardianState !== "ready"} stored={stored.phone} />
              </label>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * The emergency contact fieldset in the roster add/edit dialog (#510). Staff see it as "Emergency contact", for
 * every roster member, adult or minor. Two slots, every field optional.
 */
export function RosterGuardianFields({ errors, guardianState, records }: {
  errors: GuardianFormErrors;
  guardianState: "ready" | "loading" | "failed";
  records: GuardianRecord[] | undefined;
}) {
  return (
    <RosterContactFields
      errors={errors}
      guardianState={guardianState}
      help="Up to two emergency contacts. Your club's director and deputy, Area Coordinators and conference staff with sensitive-data access can see them. They are erased when this person is removed from the roster."
      kind="g"
      records={records}
      term={EMERGENCY_CONTACT_TERM}
    />
  );
}

/**
 * The parents or guardians fieldset (#2058), shown for youth and underage members before the emergency contacts.
 * Permission slips for outings go to the first parent email.
 */
export function RosterParentFields({ errors, guardianState, records }: {
  errors: ParentFormErrors;
  guardianState: "ready" | "loading" | "failed";
  records: GuardianRecord[] | undefined;
}) {
  return (
    <RosterContactFields
      errors={errors}
      guardianState={guardianState}
      help="Up to two parents or guardians. Your club's director and deputy, Area Coordinators and conference staff with sensitive-data access can see them. They are erased when this person is removed from the roster. Permission slips go to the first parent email, or to an emergency contact if there is no parent email."
      kind="p"
      records={records}
      term={PARENT_CONTACT_TERM}
    />
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

/** Summary items for the parent or guardian problems, in slot order, each linking to its box (#2058). */
export function parentErrorItems(errors: ParentFormErrors): ErrorSummaryItem[] {
  const items: ErrorSummaryItem[] = [];
  for (const slot of [1, 2] as const) {
    for (const field of ["Email", "Phone"] as const) {
      const message = errors[`p${slot}${field}`];
      if (message) items.push({ targetId: `roster-p${slot}${field}`, message: summaryMessage(`${PARENT_CONTACT_TERM.singular} ${slot} ${field.toLowerCase()}`, message) });
    }
  }
  return items;
}

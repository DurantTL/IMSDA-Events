/**
 * Emergency contact and physician/clinic answers on two club forms are plain
 * answers, not sealed ones. Decided by Caleb Durant (repository owner) on
 * 2026-11-07, recorded on issue #1652 and in ADR 0005 (Addendum G): directors
 * carry the paper forms, and the system copy is a backup that has to stay
 * reachable in an emergency.
 *
 * This is the one reviewed change that `assertNotLoosened` (templates.ts) asks
 * for. It is deliberately a fixed list of template key and field keys, not a
 * setting: any other field that stops being sensitive is still refused.
 * Pure (no server-only import) so tests and the operator script can share it.
 */
export const EMERGENCY_PLAIN_DECISION_DATE = "2026-11-07";

const PASSENGER_EMERGENCY_KEYS = Array.from({ length: 20 }, (_, index) => `passenger_${index + 1}_emergency_contact`);

export const EMERGENCY_PLAIN_KEYS: Readonly<Record<string, readonly string[]>> = {
  off_premises_permission_slip: ["physician_name", "physician_phone", "clinic_name", "clinic_phone", "emergency_contact_phone"],
  transportation_passenger_list: PASSENGER_EMERGENCY_KEYS,
};

/** The keys the decision made plain for this template key (empty for every other template, including staff copies under another key). */
export function emergencyPlainKeys(templateKey: string): readonly string[] {
  return EMERGENCY_PLAIN_KEYS[templateKey] ?? [];
}

/** `keys` without exactly the keys the decision made plain for this template. */
export function withoutEmergencyPlainKeys(templateKey: string, keys: readonly string[]): string[] {
  const plain = new Set(emergencyPlainKeys(templateKey));
  return plain.size === 0 ? [...keys] : keys.filter((key) => !plain.has(key));
}

/** The slip's medical-section note before the decision, and the text that replaces it. Only an unedited old note is replaced. */
export const SLIP_MEDICAL_NOTE_BEFORE = "Medical and emergency information. Only the club's director and deputies, and conference staff with sensitive-data access, can read these answers.";
export const SLIP_MEDICAL_NOTE_AFTER = "Medical and emergency information. The club keeps the paper form; this copy is a backup, so anyone who can open this form can read these answers.";

/** `notes` with the old slip medical note swapped for the new one; any other note is left alone. Returns null when nothing changes. */
export function sectionNotesWithPlainEmergencyText(templateKey: string, notes: unknown): Record<string, string[]> | null {
  if (templateKey !== "off_premises_permission_slip" || !notes || typeof notes !== "object") return null;
  const current = (notes as Record<string, unknown>).sec_medical;
  if (!Array.isArray(current) || current.length !== 1 || current[0] !== SLIP_MEDICAL_NOTE_BEFORE) return null;
  return { ...(notes as Record<string, string[]>), sec_medical: [SLIP_MEDICAL_NOTE_AFTER] };
}

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

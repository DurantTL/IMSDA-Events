/**
 * Dirty tracking for the roster person/contact editor (#1101). The form is
 * uncontrolled, so the editor takes a snapshot of its entries once the loaded
 * values are in the DOM and compares against it when the person tries to close.
 * Person fields and emergency-contact fields are snapshotted separately because
 * a contact refresh (#510) re-baselines only the contact fields and must not
 * hide what was typed into the person fields.
 */
export type RosterFormPart = "person" | "contacts";
export type RosterFormSnapshot = { person: string; contacts: string };

const guardianFieldName = /^g\d+(Name|Relationship|Email|Phone)$/;

export function rosterFormSnapshot(entries: Iterable<[string, string]>, part: RosterFormPart) {
  const picked: Array<[string, string]> = [];
  for (const [name, value] of entries) {
    if (guardianFieldName.test(name) === (part === "contacts")) picked.push([name, value]);
  }
  picked.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(picked);
}

export function rosterFormSnapshots(entries: Iterable<[string, string]>): RosterFormSnapshot {
  const list = Array.from(entries);
  return { person: rosterFormSnapshot(list, "person"), contacts: rosterFormSnapshot(list, "contacts") };
}

export function formEntries(form: HTMLFormElement): Array<[string, string]> {
  return Array.from(new FormData(form).entries()).flatMap(([name, value]) =>
    typeof value === "string" ? [[name, value] as [string, string]] : []);
}

export function rosterDialogIsDirty(baseline: RosterFormSnapshot | null, current: RosterFormSnapshot) {
  if (!baseline) return false;
  return baseline.person !== current.person || baseline.contacts !== current.contacts;
}

/**
 * The one close decision for Close, Cancel, Escape and the backdrop:
 * saving waits, clean closes now, dirty asks first.
 */
export function rosterCloseDecision(input: { saving: boolean; reviewing: boolean; dirty: boolean }) {
  if (input.saving || input.reviewing) return "ignore" as const;
  return input.dirty ? ("confirm" as const) : ("close" as const);
}

export const rosterDiscardPrompt = {
  title: "Discard unsaved changes?",
  body: "This person's details or emergency contacts have changes that haven't been saved. Discarding closes the editor and loses them.",
  confirmLabel: "Discard changes",
  cancelLabel: "Keep editing",
  destructive: true,
};

/** Whether the Add staff or Edit access dialog holds changes that are not saved yet (#1468). */
export type StaffAssignmentValues = { displayName: string; email: string; role: string; status: string };

export const newStaffRole = "READ_ONLY_STAFF";

export function staffAssignmentDirty(
  mode: "add" | "edit" | null,
  values: StaffAssignmentValues,
  selected: { role: string; status: string } | null,
): boolean {
  if (mode === "add") {
    return values.displayName.trim() !== "" || values.email.trim() !== "" || values.role !== (selected?.role ?? newStaffRole);
  }
  if (mode === "edit" && selected) return values.role !== selected.role || values.status !== selected.status;
  return false;
}

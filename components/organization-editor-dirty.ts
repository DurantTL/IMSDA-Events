/** Whether the Clubs and churches editor dialogs hold changes that are not saved yet (#1468). */
export type OrganizationFormValues = { name: string; parentOrganizationId: string; isActive: boolean };
export type SavedOrganization = { name: string; parentOrganizationId: string | null; isActive: boolean };

/** A new organization is dirty once it has a name or sponsor, or is switched off; an existing one when any value differs from the saved record. */
export function organizationFormDirty(saved: SavedOrganization | null, values: OrganizationFormValues): boolean {
  if (!saved) {
    return values.name.trim() !== "" || values.parentOrganizationId !== "" || !values.isActive;
  }
  return values.name !== saved.name
    || values.parentOrganizationId !== (saved.parentOrganizationId ?? "")
    || values.isActive !== saved.isActive;
}

export type IdentityFormValues = { provider: string; providerScope: string; externalId: string; displayLabel: string };
export type SavedIdentity = { provider: string; providerScope: string | null; externalId: string; displayLabel: string | null };

export const defaultIdentityProvider = "EADVENTIST";

/** A new identifier is dirty once anything is typed; a correction when a value differs from the saved identifier. */
export function identityFormDirty(saved: SavedIdentity | null, values: IdentityFormValues): boolean {
  const baseline = {
    provider: saved?.provider ?? defaultIdentityProvider,
    providerScope: saved?.providerScope ?? "",
    externalId: saved?.externalId ?? "",
    displayLabel: saved?.displayLabel ?? "",
  };
  return values.provider !== baseline.provider
    || values.providerScope !== baseline.providerScope
    || values.externalId !== baseline.externalId
    || values.displayLabel !== baseline.displayLabel;
}

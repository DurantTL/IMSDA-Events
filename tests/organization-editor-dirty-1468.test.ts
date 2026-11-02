import { describe, expect, it } from "vitest";
import { identityFormDirty, organizationFormDirty } from "@/components/organization-editor-dirty";

describe("organizationFormDirty (#1468)", () => {
  const blank = { name: "", parentOrganizationId: "", isActive: true };

  it("a new organization is clean until a name or sponsor is chosen or it is switched off", () => {
    expect(organizationFormDirty(null, blank)).toBe(false);
    expect(organizationFormDirty(null, { ...blank, name: "   " })).toBe(false);
    expect(organizationFormDirty(null, { ...blank, name: "Sample Church" })).toBe(true);
    expect(organizationFormDirty(null, { ...blank, parentOrganizationId: "org-1" })).toBe(true);
    expect(organizationFormDirty(null, { ...blank, isActive: false })).toBe(true);
  });

  it("an existing organization is dirty only while a value differs from the saved record", () => {
    const saved = { name: "Sample Club", parentOrganizationId: "org-1", isActive: true };
    expect(organizationFormDirty(saved, { name: "Sample Club", parentOrganizationId: "org-1", isActive: true })).toBe(false);
    expect(organizationFormDirty(saved, { name: "Sample Clubs", parentOrganizationId: "org-1", isActive: true })).toBe(true);
    expect(organizationFormDirty(saved, { name: "Sample Club", parentOrganizationId: "org-2", isActive: true })).toBe(true);
    expect(organizationFormDirty(saved, { name: "Sample Club", parentOrganizationId: "org-1", isActive: false })).toBe(true);
  });

  it("a church has no sponsor, so a null saved sponsor matches the empty value", () => {
    expect(organizationFormDirty({ name: "Sample Church", parentOrganizationId: null, isActive: true }, { name: "Sample Church", parentOrganizationId: "", isActive: true })).toBe(false);
  });
});

describe("identityFormDirty (#1468)", () => {
  const blank = { provider: "EADVENTIST", providerScope: "", externalId: "", displayLabel: "" };

  it("a new identifier is clean until something is typed or the provider changes", () => {
    expect(identityFormDirty(null, blank)).toBe(false);
    expect(identityFormDirty(null, { ...blank, externalId: "12345" })).toBe(true);
    expect(identityFormDirty(null, { ...blank, provider: "OTHER" })).toBe(true);
  });

  it("a correction is dirty only while a value differs from the saved identifier", () => {
    const saved = { provider: "EADVENTIST", providerScope: null, externalId: "12345", displayLabel: null };
    expect(identityFormDirty(saved, { ...blank, externalId: "12345" })).toBe(false);
    expect(identityFormDirty(saved, { ...blank, externalId: "12346" })).toBe(true);
    expect(identityFormDirty(saved, { ...blank, externalId: "12345", displayLabel: "Label" })).toBe(true);
  });
});

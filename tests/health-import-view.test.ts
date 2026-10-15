import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HealthImportWorkspace } from "@/components/health-import-workspace";
import { HEALTH_IMPORTED_NOTICE, HealthRecordView } from "@/components/health-record-view";
import { HEALTH_CONSENT_TEXT, HEALTH_CONSENT_VERSION } from "@/modules/health-records/domain";
import type { HealthTabView } from "@/modules/health-records/repository";

vi.mock("server-only", () => ({}));

function health(overrides: Partial<HealthTabView> = {}): HealthTabView {
  return {
    member: { id: "m1", firstName: "Riley", lastName: "Sample" },
    club: { name: "Example Pathfinders", sponsoringChurch: null },
    status: "NEEDS_UPDATE",
    hasHealthNote: true,
    importedForReview: false,
    values: { hasAllergies: "NO", hasInsurance: "YES", insuranceCompany: "Synthetic Cover Co", insuranceCardInCognito: true, emergencyContacts: [] },
    needsCorrection: [],
    canEdit: true,
    consentText: HEALTH_CONSENT_TEXT,
    consentVersion: HEALTH_CONSENT_VERSION,
    ...overrides,
  };
}

const render = (value: HealthTabView) => renderToStaticMarkup(createElement(HealthRecordView, { health: value }));

describe("the Health tab for an imported record (#878)", () => {
  it("says it was imported from the 2026 online form and asks the director to review it", () => {
    expect(HEALTH_IMPORTED_NOTICE).toBe("Imported from the 2026 online form, director please review.");
    expect(render(health({ importedForReview: true }))).toContain("Imported from the 2026 online form, director please review.");
  });

  it("shows no notice once it has been reviewed", () => {
    expect(render(health())).not.toContain("Imported from the 2026 online form");
  });

  it("asks for the insurance card again when one was uploaded on the old form, without any link", () => {
    const html = render(health());
    expect(html).toContain("Ask the parent to upload it again here.");
    expect(html).not.toMatch(/https?:/);
  });
});

describe("the import page", () => {
  const html = renderToStaticMarkup(createElement(HealthImportWorkspace));

  it("explains the steps without showing any medical value, and lists the clean-up checklist", () => {
    expect(html).toContain("Import health records from Cognito Forms");
    expect(html).toContain("The file isn&#x27;t stored");
    expect(html).toContain("Delete the export file you downloaded from Cognito Forms");
    expect(html).toContain("delete its entries there");
    expect(html).toContain("Insurance cards are not imported");
  });

  it("starts with the preview button off until a file is chosen", () => {
    expect(/<button[^>]*disabled=""[^>]*>Preview the import<\/button>/.test(html)).toBe(true);
  });
});

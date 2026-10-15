import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HealthRecordForm } from "@/components/health-record-form";
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

  it("says an imported consent came from the 2026 online form, and says when there is none", () => {
    const signed = render(health({ values: { consent: { importedFromOnlineForm: true }, signature: { typedName: "", signedOn: "2026-09-20" }, emergencyContacts: [] } }));
    expect(signed).toContain("Signed on the 2026 online form on 2026-09-20. Imported from the 2026 online form.");
    const typed = render(health({ values: { consent: { importedFromOnlineForm: true }, signature: { typedName: "Pat Sample", signedOn: "" }, emergencyContacts: [] } }));
    expect(typed).toContain("Signed on the 2026 online form by Pat Sample. Imported");
    expect(render(health({ values: { emergencyContacts: [] } }))).toContain("No consent has been given in the new system yet");
  });

  it("asks for the insurance card again when one was uploaded on the old form, without any link", () => {
    const html = render(health());
    expect(html).toContain("Ask the parent to upload it again here.");
    expect(html).not.toMatch(/https?:/);
  });
});

describe("an imported record with unanswered or unusable answers (#878)", () => {
  it("says Not answered, never No or None reported, for a blank insurance or allergy answer", () => {
    const html = render(health({ values: { emergencyContacts: [] } }));
    expect(html).toContain("Not answered");
    expect(html).not.toMatch(/None reported/);
    expect(html.match(/Not answered/g)).toHaveLength(2);
    expect(render(health({ values: { hasAllergies: "NO", hasInsurance: "NO", emergencyContacts: [] } }))).toMatch(/None reported/);
  });
});

describe("the form for an imported record (#878)", () => {
  const props = { mode: { kind: "director", organizationId: "club-a", memberId: "m1" } as const, consentText: HEALTH_CONSENT_TEXT, clubName: "Example Pathfinders", memberName: "Riley Sample" };
  const form = (initialValues: Record<string, unknown>, needsCorrection: string[]) => renderToStaticMarkup(createElement(HealthRecordForm, { ...props, initialValues, needsCorrection }));

  it("names each field that needs correcting in the banner", () => {
    const html = form({ lastTetanusBooster: "2019", medications: "x".repeat(2100), emergencyContacts: [] }, ["lastTetanusBooster", "medications", "emergencyContacts.0.phone"]);
    expect(html).toContain("Date of last tetanus booster, Medications or other relevant health information, Emergency contact 1 phone");
  });

  it("shows a tetanus answer that is not a date as typed, with what to fix", () => {
    const html = form({ lastTetanusBooster: "2019", emergencyContacts: [] }, ["lastTetanusBooster"]);
    expect(html).toMatch(/<input[^>]*value="2019"/);
    expect(html).toContain("Enter the date as year-month-day");
  });

  it("marks over-length text, and leaves unanswered questions unanswered", () => {
    const html = form({ medications: "x".repeat(2100), emergencyContacts: [] }, ["medications"]);
    expect(html).toContain("Keep this to 2000 characters or fewer. This saved answer needs correcting.");
    expect(html.match(/Not answered: choose one/g)).toHaveLength(2);
  });

  it("starts a brand-new record at No, as before", () => {
    expect(form({}, [])).not.toContain("Not answered: choose one");
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

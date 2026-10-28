import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPROVED_REQUEST_METADATA_KEYS } from "@/modules/acknowledgments/domain";

const read = (path: string) => readFileSync(path, "utf8");

describe("signature evidence wiring (#1265)", () => {
  it("records evidence in the submission transaction with the request's trusted IP", () => {
    const repository = read("modules/forms/public-repository.ts");
    expect(repository).toMatch(/recordSubmissionSignatures\(tx,/);
    expect(repository).toContain("ipAddress: requestContext?.ipAddress ?? null");
    const route = read("app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route.ts");
    expect(route).toContain("ipAddress: trustedClientIpAddress(request)");
  });

  it("drops signature answers when staff act as a director", () => {
    expect(read("modules/forms/public-repository.ts")).toMatch(/actAsAcknowledgmentKeys = club\?\.submittedByUserId\s*\?\s*new Set\(\[\.\.\.acknowledgmentFields\(definition\), \.\.\.signatureFields\(definition\)\]/);
  });

  it("holds signatures in amendments and strips them from carried-over drafts on a form change", () => {
    expect(read("modules/registrations/amendments-repository.ts")).toContain("holdSignatureAnswers(definition");
    expect(read("modules/club-registrations/repository.ts")).toContain("signatureFields(draftForm.definition)");
    expect(read("modules/general-link-registrations/repository.ts")).toContain("signatureFields(experience.form.definition)");
  });

  it("does not add the IP address to acknowledgment request metadata", () => {
    expect([...APPROVED_REQUEST_METADATA_KEYS]).toEqual(["userAgentHash", "formVersionId", "submissionKey"]);
  });

  it("keeps the append-only trigger and RESTRICT references in the migration", () => {
    const migration = read("prisma/migrations/20261208100000_signature_evidence/migration.sql");
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "SignatureEvidence"/);
    expect(migration).toMatch(/BEFORE TRUNCATE ON "SignatureEvidence"/);
    expect(migration.match(/ON DELETE RESTRICT/g)).toHaveLength(3);
    expect(migration).not.toMatch(/ALTER TABLE "(?!SignatureEvidence)/);
  });

  it("is read only by the staff signatures route and the deletion count, never by exports or messages", () => {
    for (const file of [
      "modules/forms/attendee-roster-csv.ts",
      "modules/registration-pdf/model.ts",
      "modules/registration-pdf/repository.ts",
      "modules/registration-form-notifications/domain.ts",
      "app/api/events/[eventId]/exports/registrations/route.ts",
      "app/api/events/[eventId]/exports/attendees/route.ts",
    ]) {
      expect(read(file), file).not.toMatch(/signatureEvidence|modules\/signatures\/repository/);
    }
  });
});

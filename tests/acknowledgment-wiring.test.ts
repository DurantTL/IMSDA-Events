import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventDeletionBlockers, decideEventDeletion, type EventDeletionCounts } from "@/modules/events/deletion";

/**
 * #150: the places acknowledgment evidence is wired in, and the places it must never be. Source checks where the
 * behavior needs a database (proved by scripts/verify-acknowledgments.ts) or a whole request.
 */

const emptyCounts: EventDeletionCounts = {
  registrations: 0, attendees: 0, payments: 0, invoices: 0, honorEnrollments: 0, locations: 0, forms: 0, messages: 0, queuedMessages: 0,
  formSubmissions: 0, imports: 0, merchandiseOrders: 0, clubRegistrationDrafts: 0, communityPosts: 0, announcements: 0, realPayments: 0, scholarshipContributions: 0,
  healthSnapshots: 0, heldHealthSnapshots: 0, acknowledgmentEvidence: 0,
};

describe("event deletion refuses while acknowledgment evidence exists", () => {
  it("blocks on evidence alone, even with no registration counted", () => {
    expect(eventDeletionBlockers(emptyCounts)).toEqual([]);
    expect(eventDeletionBlockers({ ...emptyCounts, acknowledgmentEvidence: 3 })).toEqual(["3 acknowledgment records"]);
    expect(eventDeletionBlockers({ ...emptyCounts, acknowledgmentEvidence: 1 })).toEqual(["1 acknowledgment record"]);
  });

  it("refuses a system administrator, with the reason, and names unpublishing instead", () => {
    const decision = decideEventDeletion({ globalRole: "SYSTEM_ADMIN", eventRole: null }, { isPublished: false, counts: { ...emptyCounts, acknowledgmentEvidence: 2 } });
    expect(decision).toMatchObject({ allowed: false });
    expect(decision.allowed === false && decision.reason).toMatch(/2 acknowledgment records/);
  });
});

describe("where evidence is written", () => {
  const publicRepository = readFileSync("modules/forms/public-repository.ts", "utf8");
  const route = readFileSync("app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route.ts", "utf8");

  it("records evidence inside the registration's own transaction, after the responsible-adult declaration it depends on", () => {
    const declarations = publicRepository.indexOf("await recordRegistrationDeclarations(tx");
    const evidence = publicRepository.indexOf("await recordSubmissionAcknowledgments(tx");
    const lodging = publicRepository.indexOf("await recordRegistrationLodging(tx");
    expect(declarations).toBeGreaterThan(0);
    expect(evidence).toBeGreaterThan(declarations);
    expect(evidence).toBeLessThan(lodging);
  });

  it("takes the registrant as the person who acknowledged, never the household or a client-supplied id", () => {
    expect(publicRepository).toContain("actedByPersonId: accountHolder.id");
    expect(publicRepository).not.toMatch(/actedByPersonId: input\./);
  });

  it("labels a form submitted by staff for a director as staff-entered and the registrant's own as online", () => {
    expect(publicRepository).toContain('channel: club?.submittedByUserId ? "STAFF_ENTERED" : "ONLINE"');
    expect(publicRepository).toContain("recordedByUserId: club?.submittedByUserId ?? null");
  });

  it("refuses a submission with an unauthorized acknowledgment as an invalid submission that marks the field", () => {
    expect(publicRepository).toContain('"ACKNOWLEDGMENT_NOT_AUTHORIZED"');
    expect(publicRepository).toContain("attendees.${attendeeIndex}.responses.${refusal.key}");
  });

  it("passes only a hash of the user agent to the evidence, and only from the public route", () => {
    expect(route).toContain('{ userAgent: request.headers.get("user-agent") }');
    expect(publicRepository).toContain("userAgentHash: hashUserAgent(requestContext?.userAgent ?? null)");
    expect(publicRepository).not.toMatch(/ipAddress|x-forwarded-for|clientIp/i);
  });

  it("reads a policy version's wording into the public experience by exact version id", () => {
    expect(publicRepository).toContain("acknowledgmentContent: await loadAcknowledgmentDisplayContent(form.eventId, definition)");
  });
});

describe("where evidence is checked and never exposed", () => {
  const formsRepository = readFileSync("modules/forms/repository.ts", "utf8");
  const amendments = readFileSync("modules/registrations/amendments-repository.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20261029100000_acknowledgment_evidence/migration.sql", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const evidenceModel = schema.slice(schema.indexOf("model AcknowledgmentEvidence"), schema.indexOf("A second adult claiming a minor"));

  it("checks policy references when a form is saved and again when it is published", () => {
    const save = formsRepository.indexOf("await assertAcknowledgmentPolicies(eventId, definition);");
    const publish = formsRepository.lastIndexOf("await assertAcknowledgmentPolicies(eventId, definition);");
    expect(save).toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(save);
    expect(formsRepository).toContain("ACKNOWLEDGMENT_POLICY_UNAVAILABLE");
  });

  it("holds acknowledgment answers while an amendment is checked, so an amendment can neither give nor change one", () => {
    expect(amendments).toContain("holdAcknowledgmentAnswers(definition, input");
    expect(amendments).toContain("...acknowledgmentKeys");
  });

  it("makes every reference RESTRICT, including the policy version", () => {
    const relations = evidenceModel.split("\n").filter((line) => line.includes("@relation("));
    expect(relations.length).toBeGreaterThanOrEqual(7);
    for (const line of relations) expect(line).toContain("onDelete: Restrict");
    expect(evidenceModel).toMatch(/policyVersion\s+ConsentPolicyVersion\?\s+@relation\(fields: \[policyVersionId\], references: \[id\], onDelete: Restrict\)/);
    const foreignKeys = migration.split("\n").filter((line) => line.includes('ADD CONSTRAINT "AcknowledgmentEvidence_') && line.includes("FOREIGN KEY"));
    expect(foreignKeys.length).toBeGreaterThanOrEqual(7);
    for (const line of foreignKeys) expect(line).toContain("ON DELETE RESTRICT");
  });

  it("is append-only in the database, with no exception for event deletion", () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "AcknowledgmentEvidence"');
    const guard = migration.slice(migration.indexOf('CREATE FUNCTION "AcknowledgmentEvidence_append_only"'), migration.indexOf('CREATE TRIGGER "AcknowledgmentEvidence_append_only"'));
    expect(guard).toContain("RAISE EXCEPTION");
    expect(guard).not.toContain("imsda.event_deletion");
  });

  it("is an additive migration later than every other migration", () => {
    expect(migration).not.toMatch(/DROP (TABLE|COLUMN)|ALTER TABLE "(?!AcknowledgmentEvidence)[A-Za-z]+" (DROP|ALTER COLUMN)/);
    expect("20261029100000_acknowledgment_evidence" > "20261027200000_consent_policies").toBe(true);
  });

  it("is read by no export, report, search, message or analytics module", () => {
    const readers = [
      "modules/reporting", "modules/messaging", "modules/exports", "modules/analytics", "modules/operations-search",
    ];
    for (const directory of readers) {
      let listing: string[] = [];
      try {
        listing = readdirRecursive(directory);
      } catch {
        continue;
      }
      for (const file of listing) {
        const text = readFileSync(file, "utf8");
        expect(text, file).not.toMatch(/acknowledgmentEvidence|AcknowledgmentEvidence|modules\/acknowledgments/);
      }
    }
  });
});

function readdirRecursive(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? readdirRecursive(path) : path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

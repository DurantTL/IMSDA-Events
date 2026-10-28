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
  formSubmissions: 0, informationFormResponses: 0, imports: 0, merchandiseOrders: 0, clubRegistrationDrafts: 0, communityPosts: 0, announcements: 0, realPayments: 0, scholarshipContributions: 0,
  healthSnapshots: 0, heldHealthSnapshots: 0, acknowledgmentEvidence: 0, signatureEvidence: 0,
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

  it("never records a director's acknowledgment given by staff acting as them", () => {
    expect(publicRepository).toContain('channel: "ONLINE"');
    expect(publicRepository).toContain("recordedByUserId: null");
    expect(publicRepository).not.toContain("recordedByUserId: club");
    // Act-as answers are dropped and not required, so the registration is made with no evidence.
    expect(publicRepository).toContain("const actAsAcknowledgmentKeys = club?.submittedByUserId");
    expect(publicRepository).toContain("optionalFieldKeys: actAsAcknowledgmentKeys.size > 0");
    expect(publicRepository).toContain("This form asks each attendee for a recorded acknowledgment, which club and group events cannot take.");
  });

  it("refuses a submission with an unauthorized acknowledgment as an invalid submission that marks the field", () => {
    expect(publicRepository).toContain('"ACKNOWLEDGMENT_NOT_AUTHORIZED"');
    expect(publicRepository).toContain("attendees.${attendeeIndex}.responses.${refusal.key}");
  });

  it("passes only a hash of the user agent to the evidence, and only from the public route", () => {
    expect(route).toContain('{ userAgent: request.headers.get("user-agent"), ipAddress: trustedClientIpAddress(request) }');
    expect(publicRepository).toContain("userAgentHash: hashUserAgent(requestContext?.userAgent ?? null)");
    // The IP is for typed-signature evidence only (#1265): the acknowledgment request metadata stays on its approved keys.
    const metadata = /await recordSubmissionAcknowledgments\(tx, \{[\s\S]*?requestMetadata: (\{[\s\S]*?\n      \}),/.exec(publicRepository)?.[1] ?? "";
    expect(metadata).toContain("userAgentHash");
    expect(metadata).not.toMatch(/ipAddress|x-forwarded-for|clientIp/i);
    expect([...metadata.matchAll(/^\s{8}(\w+):/gm)].map((match) => match[1])).toEqual(["userAgentHash", "formVersionId", "submissionKey"]);
  });

  it("reads a policy version's wording into the public experience by exact version id", () => {
    expect(publicRepository).toContain("acknowledgmentContent: await loadAcknowledgmentDisplayContent(form.eventId, definition)");
  });
});

describe("other places an acknowledgment must not leak or be mis-attributed (#150)", () => {
  const clubRegistrations = readFileSync("modules/club-registrations/repository.ts", "utf8");
  const clubRosters = readFileSync("modules/club-rosters/repository.ts", "utf8");
  const generalLink = readFileSync("modules/general-link-registrations/repository.ts", "utf8");
  const editor = readFileSync("components/registration-amendment-editor.tsx", "utf8");
  const acknowledgmentsRepository = readFileSync("modules/acknowledgments/repository.ts", "utf8");

  it("drops acknowledgment answers from a club's saved server draft, as the browser draft does", () => {
    expect(clubRegistrations).toContain("acknowledgmentFields(draftForm.definition)");
    expect(clubRegistrations).toContain("responses: withoutAcknowledgments(input.responses)");
    expect(clubRegistrations).toContain(".map(([key, answers]) => [key, withoutAcknowledgments(answers)])");
  });

  it("counts both evidence relations before removing a club roster person, so removal keeps the Person instead of failing", () => {
    expect(clubRosters).toContain("acknowledgmentEvidenceAsSubject: true");
    expect(clubRosters).toContain("acknowledgmentEvidenceActed: true");
  });

  it("confirms a general-link team only with acknowledgment answers from the form version the director saw", () => {
    expect(generalLink).toContain("storedVersionId !== experience.form.versionId");
    expect(generalLink).toContain('"FORM_CHANGED"');
    // Acknowledgments are stripped first, then answers to questions the current form no longer has (#1044).
    expect(generalLink).toContain("withoutRetiredAnswers(experience.form.definition, withoutAcknowledgments(answers))");
    expect(generalLink).toContain("responses: currentAnswers(stored.responses ?? {})");
    expect(generalLink).toContain("responses: currentAnswers(attendee.responses)");
  });

  it("shows an acknowledgment's standing from its evidence in the amendment editor, since staff evidence never rewrites the stored answer", () => {
    expect(editor).toContain("/acknowledgments`");
    expect(editor).toContain("acknowledgmentStatus={acknowledgmentStatuses[");
    expect(acknowledgmentsRepository).not.toMatch(/formResponses:\s*\{[^}]*ack/);
    expect(acknowledgmentsRepository).not.toContain("registration.update");
  });

  it("limits who staff can name as having acknowledged to the registrant or someone on the registration, with one answer for everyone else", () => {
    expect(acknowledgmentsRepository).toContain("registration.attendees.some((candidate) => candidate.personId === actedByPersonId)");
    expect(acknowledgmentsRepository).not.toContain("tx.person.findUnique");
  });

  it("reads declared authority for the registration the evidence belongs to", () => {
    expect(acknowledgmentsRepository).toContain("request.attendee.personId, request.registrationId");
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

  it("corrects evidence only by appending a void: its own append-only table, restricted references, an insert guard, no truncate", () => {
    expect(migration).toContain('CREATE TABLE "AcknowledgmentVoid"');
    expect(migration).toContain('CREATE UNIQUE INDEX "AcknowledgmentVoid_evidenceId_key"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "AcknowledgmentVoid"');
    expect(migration).toContain('BEFORE TRUNCATE ON "AcknowledgmentVoid"');
    const voidKeys = migration.split("\n").filter((line) => line.includes('ADD CONSTRAINT "AcknowledgmentVoid_') && line.includes("FOREIGN KEY"));
    expect(voidKeys).toHaveLength(4);
    for (const line of voidKeys) expect(line).toContain("ON DELETE RESTRICT");
    expect(migration).toContain('BEFORE TRUNCATE ON "AcknowledgmentEvidence"');
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

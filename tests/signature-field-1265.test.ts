import { describe, expect, it } from "vitest";
import { signatureTypePatch } from "@/components/signature-field-settings";
import { paletteRegistry } from "@/components/registration-builder/palette-registry";
import { fieldTypeLabels } from "@/components/registration-builder/builder-types";
import { eventDeletionBlockers, type EventDeletionCounts } from "@/modules/events/deletion";
import {
  SIGNATURE_PLACEHOLDER_TEXT,
  SIGNATURE_TEXT_MAX,
  formFieldSchema,
  formFieldTypes,
  placeholderSignatureLabels,
  registrationFormDefinitionSchema,
  validateTestResponses,
} from "@/modules/forms/definition";
import { attendeeRosterExportColumns } from "@/modules/forms/attendee-roster-csv";
import { isDraftExcludedField } from "@/modules/forms/public-draft";
import { preparePublicRegistration } from "@/modules/forms/public-domain";
import { informationFormDefinitionIssues } from "@/modules/information-forms/definition";
import { excludedFieldKeys, displayAnswer } from "@/modules/registration-pdf/model";
import { holdSignatureAnswers, planSignatures, presentSignatures, sha256, signatureEvidenceKey } from "@/modules/signatures/domain";
import { trustedClientIpAddress, getRateLimitConfiguration } from "@/modules/rate-limit/domain";

// Obviously synthetic statement; no legal text.
const STATEMENT = "Synthetic statement signed in the signature field tests.";

const base = { helpText: "", required: false, options: [] as string[], scope: "REGISTRATION" as const };
const signature = (overrides: Record<string, unknown> = {}) => ({
  id: "f_sig", key: "sig_one", label: "Signature", type: "SIGNATURE", ...base,
  signature: { text: STATEMENT }, ...overrides,
});

function definition(fields: Array<Record<string, unknown>>, roster = true) {
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic signature form",
    confirmationMessage: "Received.",
    ...(roster ? { attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 4 } } : {}),
    sections: [{
      id: "sec_one", title: "Everything", description: "", fields: [
        { id: "f_first", key: "first_name", label: "First name", type: "TEXT", scope: roster ? "ATTENDEE" : "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: roster ? "ATTENDEE" : "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_email", key: "email", label: "Email", type: "EMAIL", scope: "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_choice", key: "wants_program", label: "Program?", type: "RADIO", scope: "REGISTRATION", required: false, options: ["Yes", "No"], helpText: "" },
        ...fields,
      ],
    }],
  });
}

describe("the SIGNATURE field type (#1265)", () => {
  it("is its own type with a builder label", () => {
    expect(formFieldTypes).toContain("SIGNATURE");
    expect(fieldTypeLabels.SIGNATURE).toBe("Signature (typed name)");
  });

  it("carries the statement, trimmed, 5 to 4,000 characters", () => {
    expect(formFieldSchema.parse(signature({ signature: { text: `  ${STATEMENT}\n\nSecond line.  ` } })).signature).toEqual({ text: `${STATEMENT}\n\nSecond line.` });
    expect(formFieldSchema.safeParse(signature({ signature: { text: "abcd" } })).success).toBe(false);
    expect(formFieldSchema.safeParse(signature({ signature: { text: "a".repeat(SIGNATURE_TEXT_MAX) } })).success).toBe(true);
    expect(formFieldSchema.safeParse(signature({ signature: { text: "a".repeat(SIGNATURE_TEXT_MAX + 1) } })).success).toBe(false);
  });

  it("requires the statement on a signature and refuses it on any other type", () => {
    expect(formFieldSchema.safeParse(signature({ signature: undefined })).success).toBe(false);
    expect(formFieldSchema.safeParse({ id: "f_t", key: "t", label: "T", type: "TEXT", ...base, signature: { text: STATEMENT } }).success).toBe(false);
  });

  it("carries no choices, price or credit", () => {
    expect(formFieldSchema.safeParse(signature({ priceCents: 500 })).success).toBe(false);
    expect(formFieldSchema.safeParse(signature({ options: ["A", "B"] })).success).toBe(false);
  });

  it("flags a placeholder statement so the form cannot be published", () => {
    const form = definition([signature({ signature: { text: SIGNATURE_PLACEHOLDER_TEXT } }), signature({ id: "f_ok", key: "sig_ok", label: "Fine" })]);
    expect(placeholderSignatureLabels(form)).toEqual(["Signature"]);
  });

  it("starts a new builder field with the placeholder and sheds what it cannot carry", () => {
    const patch = signatureTypePatch({ id: "f", key: "k", label: "L", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], placeholder: "x" }, "SIGNATURE");
    expect(patch.signature).toEqual({ text: SIGNATURE_PLACEHOLDER_TEXT });
    expect(patch.placeholder).toBeUndefined();
    expect(signatureTypePatch({ id: "f", key: "k", label: "L", helpText: "", type: "SIGNATURE", scope: "REGISTRATION", required: false, options: [], signature: { text: STATEMENT } }, "TEXT")).toEqual({ signature: undefined });
  });

  it("is offered by the builder palette, and information forms refuse it", () => {
    const entry = paletteRegistry.getSnapshot().entries.find((candidate) => candidate.label === "Signature (typed name)");
    expect(entry).toBeTruthy();
    const added = entry!.add({ existingFields: [], newId: () => "new_id" });
    expect(added.fields[0]).toMatchObject({ type: "SIGNATURE", signature: { text: SIGNATURE_PLACEHOLDER_TEXT } });
    const refusals = informationFormDefinitionIssues(definition([signature()], false));
    expect(refusals.length).toBeGreaterThan(0);
  });
});

describe("validation behaves like a text field", () => {
  const form = definition([signature({ required: true })], false);
  const issues = (responses: Record<string, unknown>) => validateTestResponses(form, responses).issues.filter((issue) => issue.key === "sig_one");

  it("requires a name when required, ignoring blanks", () => {
    expect(issues({})).toHaveLength(1);
    expect(issues({ sig_one: "   " })).toHaveLength(1);
    expect(issues({ sig_one: "Ann Sample" })).toEqual([]);
  });

  it("allows blank when optional", () => {
    const optional = definition([signature({ required: false })], false);
    expect(validateTestResponses(optional, {}).issues.filter((issue) => issue.key === "sig_one")).toEqual([]);
  });

  it("caps the name at 200 characters and refuses non-text", () => {
    expect(issues({ sig_one: "A".repeat(200) })).toEqual([]);
    expect(issues({ sig_one: "A".repeat(201) })).toHaveLength(1);
    expect(issues({ sig_one: 12 })).toHaveLength(1);
  });

  it("is not asked when a condition hides it", () => {
    const conditional = definition([signature({ required: true, conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" } })], false);
    expect(validateTestResponses(conditional, { wants_program: "No" }).issues.filter((issue) => issue.key === "sig_one")).toEqual([]);
  });

  it("prunes a hidden conditional signature from a public submission", () => {
    const conditional = definition([signature({ required: false, conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" } })]);
    const prepared = preparePublicRegistration(conditional, {
      versionId: "v1", idempotencyKey: "00000000-0000-4000-8000-000000001265", website: "",
      responses: { email: "ann@example.test", wants_program: "No", sig_one: "Ann Sample" },
      attendees: [{ clientId: "a1", responses: { first_name: "Ann", last_name: "Sample" } }],
    }, { timeZone: "America/Chicago" });
    expect(prepared.registrationResponses.sig_one).toBeUndefined();
  });
});

describe("planning which signatures a submission gives", () => {
  const answers = (registrationResponses: Record<string, unknown>, attendees: Array<{ clientId: string; responses: Record<string, unknown> }> = []) => ({ registrationResponses, attendees });

  it("plans a visible, named registration signature with the trimmed name", () => {
    const planned = planSignatures(definition([signature()]), answers({ sig_one: "  Ann Sample  " }));
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ attendeeClientId: null, signerName: "Ann Sample" });
  });

  it("records nothing for a blank optional signature", () => {
    expect(planSignatures(definition([signature()]), answers({ sig_one: "  " }))).toEqual([]);
    expect(planSignatures(definition([signature()]), answers({}))).toEqual([]);
  });

  it("records nothing for a field hidden by its condition", () => {
    const form = definition([signature({ conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" } })]);
    expect(planSignatures(form, answers({ wants_program: "No", sig_one: "Ann Sample" }))).toEqual([]);
    expect(planSignatures(form, answers({ wants_program: "Yes", sig_one: "Ann Sample" }))).toHaveLength(1);
  });

  it("plans one per attendee for an attendee-level field", () => {
    const form = definition([signature({ scope: "ATTENDEE" })]);
    const planned = planSignatures(form, answers({}, [
      { clientId: "a1", responses: { sig_one: "Ann Sample" } },
      { clientId: "a2", responses: {} },
      { clientId: "a3", responses: { sig_one: "Cy Sample" } },
    ]));
    expect(planned.map((item) => [item.attendeeClientId, item.signerName])).toEqual([["a1", "Ann Sample"], ["a3", "Cy Sample"]]);
  });

  it("derives a stable key from the submission key, field and attendee", () => {
    expect(signatureEvidenceKey("reg-1", "sub-1", "f_sig", null)).toBe("submission:reg-1:sub-1:f_sig:registration");
    expect(signatureEvidenceKey("reg-1", "sub-1", "f_sig", "a1")).toBe("submission:reg-1:sub-1:f_sig:a1");
    expect(signatureEvidenceKey("reg-2", "sub-1", "f_sig", null)).not.toBe(signatureEvidenceKey("reg-1", "sub-1", "f_sig", null));
    expect(sha256("abc")).toHaveLength(64);
  });
});

describe("an amendment holds signature answers", () => {
  it("keeps the stored name, drops a typed one for a new attendee and lists the keys", () => {
    const form = definition([signature(), signature({ id: "f_att", key: "att_sig", scope: "ATTENDEE" })]);
    const held = holdSignatureAnswers(form, {
      responses: { sig_one: "Someone Else" },
      attendees: [
        { attendeeId: "att-1", responses: { att_sig: "Changed Name" } },
        { attendeeId: null, responses: { att_sig: "Staff Typed" } },
      ],
    }, { registration: { sig_one: "Ann Sample" }, attendee: (id) => (id === "att-1" ? { att_sig: "Ann Sample" } : null) });
    expect(held.input.responses.sig_one).toBe("Ann Sample");
    expect(held.input.attendees[0]!.responses.att_sig).toBe("Ann Sample");
    expect(held.input.attendees[1]!.responses.att_sig).toBeUndefined();
    expect(held.keys.sort()).toEqual(["att_sig", "sig_one"]);
  });
});

describe("exports, drafts, PDFs and messages leave signatures out", () => {
  const form = definition([signature({ scope: "ATTENDEE" }), signature({ id: "f_reg", key: "reg_sig" })]);

  it("keeps the attendee roster file free of the field", () => {
    const columns = attendeeRosterExportColumns(form);
    expect(columns).not.toContain("Signature");
    expect(columns).toContain("First name");
  });

  it("never carries a signature in a saved draft", () => {
    expect(isDraftExcludedField(form.sections[0]!.fields.find((field) => field.key === "reg_sig")!, form)).toBe(true);
  });

  it("is excluded from the registration PDF and the form notification answers", () => {
    const excluded = excludedFieldKeys(form);
    expect(excluded.has("reg_sig")).toBe(true);
    expect(excluded.has("sig_one")).toBe(true);
    expect(excluded.has("first_name")).toBe(false);
  });

  it("is not a condition source for notification routing", async () => {
    const { conditionFieldChoices } = await import("@/modules/registration-form-notifications/domain");
    expect(conditionFieldChoices(form).map((choice) => choice.key)).not.toContain("reg_sig");
  });

  it("still shows a plain value if asked directly (the PDF never asks)", () => {
    expect(displayAnswer(form.sections[0]!.fields.find((field) => field.key === "reg_sig")!, "Ann Sample")).toBe("Ann Sample");
  });
});

describe("event deletion", () => {
  const empty: EventDeletionCounts = {
    registrations: 0, attendees: 0, payments: 0, invoices: 0, honorEnrollments: 0, locations: 0, forms: 0, messages: 0, queuedMessages: 0,
    formSubmissions: 0, informationFormResponses: 0, imports: 0, merchandiseOrders: 0, clubRegistrationDrafts: 0, communityPosts: 0,
    announcements: 0, realPayments: 0, scholarshipContributions: 0, healthSnapshots: 0, heldHealthSnapshots: 0, acknowledgmentEvidence: 0,
    signatureEvidence: 0,
  };

  it("is blocked by signature records, with a count", () => {
    expect(eventDeletionBlockers({ ...empty, signatureEvidence: 1 })).toEqual(["1 signature record"]);
    expect(eventDeletionBlockers({ ...empty, signatureEvidence: 4 })).toEqual(["4 signature records"]);
  });
});

describe("what staff may read", () => {
  const row = { id: "s1", fieldKey: "sig_one", fieldLabel: "Signature", registrationAttendeeId: null, signerName: "Ann Sample", signedAt: new Date("2027-01-02T15:04:05.000Z"), signedText: STATEMENT, contentHash: sha256(STATEMENT), ipAddress: "203.0.113.7" };

  it("gives the full record only with permission", () => {
    const full = presentSignatures([row], true);
    expect(full.canViewRecord).toBe(true);
    expect(full.signatures[0]).toMatchObject({ signedText: STATEMENT, ipAddress: "203.0.113.7", signerName: "Ann Sample" });
  });

  it("gives only who and when without it", () => {
    const limited = presentSignatures([row], false);
    expect(limited.canViewRecord).toBe(false);
    expect(Object.keys(limited.signatures[0]!).sort()).toEqual(["fieldKey", "fieldLabel", "id", "registrationAttendeeId", "signedAt", "signerName"]);
    expect(JSON.stringify(limited)).not.toContain("203.0.113.7");
    expect(JSON.stringify(limited)).not.toContain(STATEMENT);
  });
});

describe("the trusted client IP", () => {
  const request = (headers: Record<string, string>) => new Request("https://events.example.test/api", { headers });

  it("is null when proxy trust is not configured, even with a forwarding header", () => {
    const configuration = getRateLimitConfiguration({ NODE_ENV: "test" });
    expect(trustedClientIpAddress(request({ "x-forwarded-for": "203.0.113.9" }), configuration)).toBeNull();
  });

  it("reads the address the configured proxy appended", () => {
    const configuration = getRateLimitConfiguration({ NODE_ENV: "test", RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" });
    expect(trustedClientIpAddress(request({ "x-forwarded-for": "198.51.100.1, 203.0.113.9" }), configuration)).toBe("203.0.113.9");
  });

  it("is null when the header is missing", () => {
    const configuration = getRateLimitConfiguration({ NODE_ENV: "test", RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" });
    expect(trustedClientIpAddress(request({}), configuration)).toBeNull();
  });
});

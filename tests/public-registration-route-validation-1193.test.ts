import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #855 and #1193: the public registration ROUTE rejects a bad phone, email and number, not only
 * `preparePublicRegistration()`. The real route handler runs: body parsing, the input schema and the
 * error-to-response mapping. The repository is the one stand-in: its `submitPublicRegistration` does only the step the real
 * one does at this point (`preparePublicRegistration` on the saved form, then `INVALID_SUBMISSION` with the issues), and
 * the error class is the real one. No submitted value may appear in the response or in any log. Synthetic data only.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkPublicRegistrationRateLimit: vi.fn(async () => ({ allowed: true, decisions: [] })),
  checkPublicFormRoommateLookupRateLimit: vi.fn(async () => ({ allowed: true, decisions: [] })),
  publicRequestClientHash: vi.fn(() => "client-hash-1"),
}));
vi.mock("@/modules/forms/public-repository", async (importActual) => {
  const actual = await importActual<typeof import("@/modules/forms/public-repository")>();
  return { ...actual, submitPublicRegistration: mocks.submit, getPublicRegistrationExperience: vi.fn() };
});

import { POST } from "@/app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { preparePublicRegistration, type PublicRegistrationInput } from "@/modules/forms/public-domain";
import { PublicRegistrationError } from "@/modules/forms/public-repository";

const definition = registrationFormDefinitionSchema.parse({
  title: "Validation fixture",
  description: "Fictitious.",
  confirmationMessage: "Done.",
  sections: [{
    id: "contact_section",
    title: "Contact",
    description: "",
    fields: [
      { id: "f_first", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "f_last", key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "f_email", key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
      { id: "f_phone", key: "phone", label: "Phone", helpText: "", type: "PHONE", scope: "REGISTRATION", required: false, options: [] },
      { id: "f_party", key: "party_size", label: "Party size", helpText: "", type: "NUMBER", scope: "REGISTRATION", required: false, options: [] },
    ],
  }],
});

const good = { first_name: "Avery", last_name: "Tester", email: "avery@example.test", phone: "515 555 0134", party_size: "3" };
const context = { params: Promise.resolve({ eventSlug: "synthetic-event", formSlug: "attendee" }) };
const post = (responses: Record<string, unknown>) => new Request("https://events.imsda.test/api/public/events/synthetic-event/forms/attendee/registrations", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: JSON.stringify({ versionId: "version-1", idempotencyKey: "f4f76d46-f7d6-443d-a030-cb9a8ca15066", responses, website: "" }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_BASE_URL", "https://events.imsda.test");
  mocks.submit.mockImplementation(async (_event: string, _form: string, input: PublicRegistrationInput) => {
    const prepared = preparePublicRegistration(definition, input, { timeZone: "America/Chicago" });
    if (!prepared.isValid) throw new PublicRegistrationError("INVALID_SUBMISSION", "Review the highlighted fields and submit again.", prepared.issues);
    return { confirmation: { confirmationCode: "REG-SYNTHETIC", phone: prepared.responses.phone } };
  });
});

describe("public registration route (#855, #1193)", () => {
  it("accepts good answers and passes the phone on in its stored form", async () => {
    const response = await POST(post(good), context);
    expect(response.status).toBe(201);
    expect(await response.text()).toContain("(515) 555-0134");
  });

  it.each([
    ["phone", { phone: "idk-call-me" }, "Phone must be a 10-digit US number"],
    ["email", { email: "avery at example" }, "Email must be a valid email address"],
    ["number", { party_size: "a few" }, "Party size must be a number"],
  ])("answers 422 for a bad %s, naming the field and never the value", async (_name, patch, message) => {
    const response = await POST(post({ ...good, ...patch }), context);
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain("INVALID_SUBMISSION");
    expect(body).toContain(message);
    for (const value of Object.values(patch)) expect(body).not.toContain(value);
    for (const call of mocks.logError.mock.calls) for (const value of Object.values(patch)) expect(JSON.stringify(call)).not.toContain(value);
  });
});

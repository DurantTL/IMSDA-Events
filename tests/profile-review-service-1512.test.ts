import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  authorizeAttendeeRegistration: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/attendee-accounts/registrations-repository", () => ({
  authorizeAttendeeRegistration: mocks.authorizeAttendeeRegistration,
}));

import { profileReviewVersion, type ReviewableProfile } from "@/modules/attendee-accounts/profile-conflicts";
import {
  applyRegistrationProfileReview,
  getRegistrationProfileReview,
  ProfileReviewError,
} from "@/modules/attendee-accounts/profile-review-service";

const account = { id: "acct-1", verifiedEmail: "avery@example.test" };

const storedRow = {
  firstName: "Avery",
  lastName: "Person",
  phone: "(515) 555-0100",
  shirtSize: "M",
  mailingLine1: "1 Example Way",
  mailingLine2: null,
  mailingCity: "Sampletown",
  mailingRegion: "MI",
  mailingPostalCode: "49000",
  mailingCountry: "United States",
  emergencyContactName: "Casey Contact",
  emergencyContactPhone: "(515) 555-0101",
  displayName: "Avery Person",
};
const storedProfile = (): ReviewableProfile => {
  return Object.fromEntries(
    Object.entries(storedRow).filter(([key]) => key !== "displayName").map(([key, value]) => [key, value ?? ""]),
  ) as ReviewableProfile;
};

const definition = {
  sections: [{
    fields: [
      { key: "first_name", scope: "REGISTRATION" },
      { key: "last_name", scope: "REGISTRATION" },
      { key: "phone", scope: "REGISTRATION" },
      { key: "shirt_size", scope: "REGISTRATION" },
      { key: "dietary_needs", scope: "REGISTRATION" },
      { key: "mailing_address", scope: "REGISTRATION" },
      { key: "child_first_name", scope: "ATTENDEE" },
      { key: "emergency_contact_name", scope: "ATTENDEE" },
      { key: "first_name", scope: "ATTENDEE" },
      { key: "last_name", scope: "ATTENDEE" },
      { key: "attendee_phone", scope: "ATTENDEE" },
      { key: "shirt_size", scope: "ATTENDEE" },
      { key: "email", scope: "ATTENDEE" },
      { key: "birth_date", scope: "ATTENDEE" },
    ],
  }],
};

const registration = { findUnique: vi.fn() };
const attendeeAccount = { findUniqueOrThrow: vi.fn(), update: vi.fn() };
const attendeeProfileChange = { createMany: vi.fn() };
const tx = { registration, attendeeAccount, attendeeProfileChange, $queryRaw: vi.fn() };

function storedAnswers(
  responses: Record<string, unknown>,
  amended?: Record<string, unknown>,
  attendees: Array<Record<string, unknown>> = [],
) {
  registration.findUnique.mockResolvedValue({
    publicFormSubmission: { responses, formVersion: { definition } },
    operations: amended ? [{ afterSnapshot: { registrationResponses: amended } }] : [],
    attendees: attendees.map((formResponses) => ({ formResponses })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({
    registration,
    attendeeAccount,
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  });
  mocks.authorizeAttendeeRegistration.mockResolvedValue({ registrationId: "reg-1", eventId: "evt-1" });
  attendeeAccount.findUniqueOrThrow.mockResolvedValue(storedRow);
  attendeeAccount.update.mockResolvedValue({ id: "acct-1" });
  tx.$queryRaw.mockResolvedValue([{ id: "acct-1" }]);
});

describe("getRegistrationProfileReview", () => {
  it("is null for a registration the account may not see, and reads no answers", async () => {
    mocks.authorizeAttendeeRegistration.mockResolvedValue(null);
    await expect(getRegistrationProfileReview(account, "reg-other")).resolves.toBeNull();
    expect(mocks.authorizeAttendeeRegistration).toHaveBeenCalledWith("avery@example.test", "reg-other");
    expect(registration.findUnique).not.toHaveBeenCalled();
  });

  it("lists conflicts with a version, and ignores attendee-scope and health answers", async () => {
    storedAnswers({
      first_name: "Avery B",
      shirt_size: "M",
      dietary_needs: "Peanut allergy",
      child_first_name: "Riley",
      emergency_contact_name: "Pat Contact",
    });
    const review = await getRegistrationProfileReview(account, "reg-1");
    expect(review?.conflicts.map((conflict) => conflict.field)).toEqual(["firstName"]);
    expect(review?.version).toBe(profileReviewVersion(storedProfile(), { first_name: "Avery B", shirt_size: "M" }, true));
    expect(JSON.stringify(review)).not.toMatch(/allergy|Riley|Pat Contact/);
  });

  it("uses the latest amendment's answers over the original submission", async () => {
    storedAnswers({ first_name: "Avery" }, { first_name: "Avery C" });
    const review = await getRegistrationProfileReview(account, "reg-1");
    expect(review?.conflicts).toEqual([expect.objectContaining({ field: "firstName", enteredValue: "Avery C" })]);
  });

  it("offers nothing when no answer differs", async () => {
    storedAnswers({ first_name: "avery", phone: "515-555-0100" });
    expect((await getRegistrationProfileReview(account, "reg-1"))?.conflicts).toEqual([]);
  });
});

describe("applyRegistrationProfileReview", () => {
  const answers = { first_name: "Avery B", shirt_size: "L", phone: "515-555-0199" };
  const version = () => profileReviewVersion(storedProfile(), answers, true);

  it("refuses a registration the account may not see", async () => {
    mocks.authorizeAttendeeRegistration.mockResolvedValue(null);
    await expect(applyRegistrationProfileReview(account, { registrationId: "reg-x", fields: ["firstName"], version: version() }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(attendeeAccount.update).not.toHaveBeenCalled();
  });

  it("refuses a stale version without writing anything", async () => {
    storedAnswers(answers);
    const stale = profileReviewVersion({ ...storedProfile(), firstName: "Someone" }, answers, true);
    const error = await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["firstName"], version: stale }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProfileReviewError);
    expect(error).toMatchObject({ code: "STALE" });
    expect(attendeeAccount.update).not.toHaveBeenCalled();
    expect(attendeeProfileChange.createMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("locks the profile row before reading it", async () => {
    storedAnswers(answers);
    await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["firstName"], version: version() });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(attendeeAccount.findUniqueOrThrow.mock.invocationCallOrder[0]!);
  });

  it("applies only the selected fields and takes the values from the stored answers", async () => {
    storedAnswers(answers);
    const result = await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["firstName", "phone"], version: version() });
    expect(result.applied).toEqual(["firstName", "phone"]);
    const { data } = attendeeAccount.update.mock.calls[0]![0];
    expect(data).toEqual({ firstName: "Avery B", phone: "(515) 555-0199", displayName: "Avery B Person" });
    expect(data).not.toHaveProperty("shirtSize");
  });

  it("ignores a selected field that is not a conflict", async () => {
    storedAnswers(answers);
    const result = await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["lastName"], version: version() });
    expect(result.applied).toEqual([]);
    expect(attendeeAccount.update).not.toHaveBeenCalled();
  });

  it("keeps old and new values in history for name, phone and shirt size, by registration and actor", async () => {
    storedAnswers(answers);
    await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["firstName", "shirtSize"], version: version() });
    expect(attendeeProfileChange.createMany).toHaveBeenCalledWith({
      data: [
        { accountId: "acct-1", field: "firstName", oldValue: "Avery", newValue: "Avery B", source: "REGISTRATION_REVIEW", registrationId: "reg-1", actorAttendeeAccountId: "acct-1" },
        { accountId: "acct-1", field: "shirtSize", oldValue: "M", newValue: "L", source: "REGISTRATION_REVIEW", registrationId: "reg-1", actorAttendeeAccountId: "acct-1" },
      ],
    });
  });

  it("records the address and emergency contact by field name only", async () => {
    storedAnswers({ mailing_address: { line1: "2 Other Road", locality: "Elsewhere" } });
    const personalVersion = profileReviewVersion(storedProfile(), { mailing_address: { line1: "2 Other Road", locality: "Elsewhere" } }, true);
    await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["mailingLine1", "mailingCity"], version: personalVersion });
    const rows = attendeeProfileChange.createMany.mock.calls[0]![0].data;
    expect(rows).toEqual([
      expect.objectContaining({ field: "mailingLine1", oldValue: null, newValue: null }),
      expect.objectContaining({ field: "mailingCity", oldValue: null, newValue: null }),
    ]);
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toMatch(/Other Road|Elsewhere|Example Way/);
  });

  it("writes an audit entry with field names only", async () => {
    storedAnswers(answers);
    await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["firstName", "phone"], version: version() });
    const [entry, client] = mocks.writeAuditLog.mock.calls[0]!;
    expect(client).toBe(tx);
    expect(entry).toMatchObject({
      action: "ATTENDEE_PROFILE_REVIEWED_FROM_REGISTRATION",
      entityId: "acct-1",
      metadata: { actorAttendeeAccountId: "acct-1", registrationId: "reg-1", changedFields: ["firstName", "phone"] },
    });
    expect(JSON.stringify(entry)).not.toMatch(/Avery B|555-0199/);
  });

  it("never changes the email or health fields", async () => {
    storedAnswers({ ...answers, dietary_needs: "Vegan", email: "other@example.test" });
    await applyRegistrationProfileReview(account, {
      registrationId: "reg-1",
      fields: ["firstName", "phone", "shirtSize"],
      version: profileReviewVersion(storedProfile(), { ...answers, dietary_needs: "Vegan", email: "other@example.test" }, true),
    });
    const { data } = attendeeAccount.update.mock.calls[0]![0];
    expect(Object.keys(data).sort()).toEqual(["displayName", "firstName", "phone", "shirtSize"]);
  });

  it("rejects an entered phone that is not usable, before writing", async () => {
    const bad = { phone: "call me" };
    storedAnswers(bad);
    await expect(applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["phone"], version: profileReviewVersion(storedProfile(), bad, true) }))
      .rejects.toThrow();
    expect(attendeeAccount.update).not.toHaveBeenCalled();
  });
});

describe("the account holder's attendee answers", () => {
  const holder = { email: "Avery@Example.test ", birth_date: "1990-05-05", first_name: "Avery", last_name: "Person", attendee_phone: "515-555-0177", shirt_size: "XL" };
  const child = { first_name: "Riley", last_name: "Person", birth_date: "2015-05-05", shirt_size: "S", attendee_phone: "515-555-0188" };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-01T18:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("compares the holder's attendee answers and never the child's", async () => {
    storedAnswers({ first_name: "Avery" }, undefined, [child, holder]);
    const review = await getRegistrationProfileReview(account, "reg-1");
    expect(review?.conflicts.map((conflict) => [conflict.field, conflict.enteredValue])).toEqual([
      ["phone", "515-555-0177"],
      ["shirtSize", "XL"],
    ]);
    expect(JSON.stringify(review)).not.toMatch(/Riley|555-0188/);
  });

  it("lets a registration answer win over the holder's attendee answer", async () => {
    storedAnswers({ shirt_size: "L" }, undefined, [holder]);
    const review = await getRegistrationProfileReview(account, "reg-1");
    expect(review?.conflicts.map((conflict) => [conflict.field, conflict.enteredValue])).toEqual([
      ["phone", "515-555-0177"],
      ["shirtSize", "L"],
    ]);
  });

  it("compares nothing from attendees when the holder cannot be told apart", async () => {
    storedAnswers({ first_name: "Avery" }, undefined, [holder, { ...holder, first_name: "Second" }]);
    expect((await getRegistrationProfileReview(account, "reg-1"))?.conflicts).toEqual([]);
  });

  it("keeps only attendee-scope keys from the stored form", async () => {
    storedAnswers({}, undefined, [{ ...holder, dietary_needs: "Vegan", unlisted_key: "x" }]);
    expect(JSON.stringify(await getRegistrationProfileReview(account, "reg-1"))).not.toMatch(/Vegan/);
  });

  it("reads attendees in roster order from the registration's current attendees", async () => {
    storedAnswers({}, undefined, [holder]);
    await getRegistrationProfileReview(account, "reg-1");
    expect(registration.findUnique.mock.calls[0]![0].select.attendees).toEqual({
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { formResponses: true },
    });
  });

  it("makes an open review stale when the holder's attendee answer changes", async () => {
    storedAnswers({}, undefined, [holder]);
    const review = await getRegistrationProfileReview(account, "reg-1");
    storedAnswers({}, undefined, [{ ...holder, shirt_size: "XXL" }]);
    await expect(applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["phone"], version: review!.version }))
      .rejects.toMatchObject({ code: "STALE" });
    expect(attendeeAccount.update).not.toHaveBeenCalled();
  });

  it("applies a chosen holder answer from the stored answers", async () => {
    storedAnswers({}, undefined, [holder]);
    const review = await getRegistrationProfileReview(account, "reg-1");
    const result = await applyRegistrationProfileReview(account, { registrationId: "reg-1", fields: ["shirtSize"], version: review!.version });
    expect(result.applied).toEqual(["shirtSize"]);
    expect(attendeeAccount.update.mock.calls[0]![0].data).toEqual({ shirtSize: "XL" });
  });

  it("stops comparing attendee answers once the holder is no longer an adult on the record", async () => {
    storedAnswers({}, undefined, [{ ...holder, birth_date: "" }]);
    expect((await getRegistrationProfileReview(account, "reg-1"))?.conflicts).toEqual([]);
  });
});

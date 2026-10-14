import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildImportPreview, InvitationCsvError } from "@/modules/staff-invitations/csv";
import {
  approvedEmail,
  COVERAGE_SENTENCE,
  duplicatePartyName,
  FAMILY_MAX_DEPENDANT_AGE,
  invitationEmail,
  invitationRegistrationSchema,
  invitationStatus,
  invitationUrl,
  invitationUsable,
  MAX_IMPORT_ROWS,
  officeDigestWindow,
  parseInvitationGroup,
  partyOf,
  receivedEmail,
} from "@/modules/staff-invitations/domain";
import { invitationIdFromToken, invitationToken, invitationTokenMatches } from "@/modules/staff-invitations/link";

const none = { invited: new Set<string>(), registered: new Set<string>() };

describe("parseInvitationGroup", () => {
  it("accepts the three groups in any case, singular or plural", () => {
    expect(parseInvitationGroup(" Staff ")).toBe("STAFF");
    expect(parseInvitationGroup("PASTORS")).toBe("PASTOR");
    expect(parseInvitationGroup("volunteer")).toBe("VOLUNTEER");
    expect(parseInvitationGroup("employee")).toBeNull();
    expect(parseInvitationGroup("")).toBeNull();
  });
});

describe("the CSV preview", () => {
  const csv = [
    "Email,First Name,Last Name,Group",
    "ada.synthetic@example.test,Ada,Synthetic,Staff",
    "bea.synthetic@example.test,Bea,Synthetic,pastor",
    "not-an-email,Cy,Synthetic,Staff",
    "ADA.SYNTHETIC@example.test ,Ada,Again,Staff",
    "dee.synthetic@example.test,Dee,Synthetic,Janitor",
    "eve.synthetic@example.test,Eve,Synthetic,",
    "fay.synthetic@example.test,Fay,Synthetic,Volunteer",
    "gus.synthetic@example.test,Gus,Synthetic,Volunteer",
  ].join("\n");

  const preview = buildImportPreview({
    csv,
    defaultGroup: "VOLUNTEER",
    existing: { invited: new Set(["fay.synthetic@example.test"]), registered: new Set(["gus.synthetic@example.test"]) },
  });
  const byLine = Object.fromEntries(preview.rows.map((row) => [row.line, row]));

  it("reports every row with what confirming would do, and creates nothing itself", () => {
    expect(byLine[2]).toMatchObject({ email: "ada.synthetic@example.test", group: "STAFF", status: "NEW" });
    expect(byLine[3]).toMatchObject({ group: "PASTOR", status: "NEW" });
    expect(byLine[4].status).toBe("INVALID_EMAIL");
    expect(byLine[5]).toMatchObject({ email: "ada.synthetic@example.test", status: "DUPLICATE_IN_FILE" });
    expect(byLine[6].status).toBe("INVALID_GROUP");
    expect(byLine[7]).toMatchObject({ group: "VOLUNTEER", status: "NEW" });
    expect(byLine[8].status).toBe("ALREADY_INVITED");
    expect(byLine[9].status).toBe("ALREADY_REGISTERED");
    expect(preview.willCreate).toBe(3);
    expect(preview.counts).toMatchObject({ NEW: 3, INVALID_EMAIL: 1, INVALID_GROUP: 1, DUPLICATE_IN_FILE: 1, ALREADY_INVITED: 1, ALREADY_REGISTERED: 1 });
  });

  it("uses the group chosen for the whole file when there is no group column", () => {
    const plain = buildImportPreview({ csv: "email\nada.synthetic@example.test\nbea.synthetic@example.test", defaultGroup: "PASTOR", existing: none });
    expect(plain.rows.map((row) => row.group)).toEqual(["PASTOR", "PASTOR"]);
    expect(plain.rows.every((row) => row.firstName === "" && row.lastName === "")).toBe(true);
  });

  it("needs a group from somewhere, and an email column", () => {
    expect(() => buildImportPreview({ csv: "email\nada.synthetic@example.test", defaultGroup: null, existing: none })).toThrow(InvitationCsvError);
    expect(() => buildImportPreview({ csv: "name\nAda", defaultGroup: "STAFF", existing: none })).toThrow(/email/);
    expect(() => buildImportPreview({ csv: "email", defaultGroup: "STAFF", existing: none })).toThrow(/no people/);
  });

  it("accepts a byte-order mark, quoted commas, header aliases and a Windows line ending", () => {
    const text = "﻿E-mail,First,Surname,Type\r\n\"ada.synthetic@example.test\",\"Ada, Jr\",Synthetic,Staff\r\n";
    const result = buildImportPreview({ csv: text, defaultGroup: null, existing: none });
    expect(result.rows[0]).toMatchObject({ email: "ada.synthetic@example.test", firstName: "Ada, Jr", lastName: "Synthetic", group: "STAFF", status: "NEW" });
  });

  it("refuses a file with too many people, and flags a name that is too long", () => {
    const many = ["email", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `p${index}@example.test`)].join("\n");
    expect(() => buildImportPreview({ csv: many, defaultGroup: "STAFF", existing: none })).toThrow(/more than/);
    const long = buildImportPreview({ csv: `email,first name\nada.synthetic@example.test,${"A".repeat(200)}`, defaultGroup: "STAFF", existing: none });
    expect(long.rows[0].status).toBe("NAME_TOO_LONG");
  });

  it("has a digest that follows exactly what would be created", () => {
    const same = buildImportPreview({ csv, defaultGroup: "VOLUNTEER", existing: { invited: new Set(["fay.synthetic@example.test"]), registered: new Set(["gus.synthetic@example.test"]) } });
    expect(same.digest).toBe(preview.digest);
    // Fay is no longer invited, so confirming would now create someone the preview did not show.
    const changed = buildImportPreview({ csv, defaultGroup: "VOLUNTEER", existing: { invited: new Set(), registered: new Set(["gus.synthetic@example.test"]) } });
    expect(changed.digest).not.toBe(preview.digest);
  });

  it("strips control characters from names", () => {
    const result = buildImportPreview({ csv: "email,first name\nada.synthetic@example.test,\"Ada\u0007\u0000  Q\"", defaultGroup: "STAFF", existing: none });
    expect(result.rows[0].firstName).toBe("Ada Q");
  });
});

describe("invitation status", () => {
  const base = { revokedAt: null, registeredAt: null, approval: null, sentAt: null, message: null };
  it("follows the link, the delivery and the registration", () => {
    expect(invitationStatus(base)).toBe("NOT_SENT");
    expect(invitationStatus({ ...base, sentAt: new Date(), message: { status: "SENT", providerDeliveryStatus: "DELIVERED" } })).toBe("SENT");
    expect(invitationStatus({ ...base, sentAt: new Date(), message: { status: "PENDING", providerDeliveryStatus: null } })).toBe("SENT");
    expect(invitationStatus({ ...base, sentAt: new Date(), message: { status: "FAILED", providerDeliveryStatus: null } })).toBe("DELIVERY_FAILED");
    expect(invitationStatus({ ...base, sentAt: new Date(), message: { status: "SENT", providerDeliveryStatus: "BOUNCED" } })).toBe("DELIVERY_FAILED");
    expect(invitationStatus({ ...base, sentAt: new Date(), message: { status: "SUPPRESSED", providerDeliveryStatus: null } })).toBe("DELIVERY_FAILED");
    expect(invitationStatus({ ...base, registeredAt: new Date(), approval: "WAITING" })).toBe("REGISTERED");
    expect(invitationStatus({ ...base, registeredAt: new Date(), approval: "APPROVED" })).toBe("APPROVED");
    expect(invitationStatus({ ...base, registeredAt: new Date(), approval: "DECLINED" })).toBe("DECLINED");
    expect(invitationStatus({ ...base, sentAt: new Date(), revokedAt: new Date() })).toBe("REVOKED");
  });
  it("only an unused, unrevoked link is usable", () => {
    expect(invitationUsable(base)).toBe(true);
    expect(invitationUsable({ revokedAt: new Date(), registeredAt: null })).toBe(false);
    expect(invitationUsable({ revokedAt: null, registeredAt: new Date() })).toBe(false);
  });
});

describe("the family a link covers", () => {
  const person = { firstName: "Ada", lastName: "Synthetic" };

  it("takes the person, a spouse, and children up to 18", () => {
    const input = invitationRegistrationSchema.parse({
      ...person,
      spouse: { firstName: "Bo", lastName: "Synthetic" },
      dependants: [{ firstName: "Cy", lastName: "Synthetic", age: 0 }, { firstName: "Di", lastName: "Synthetic", age: FAMILY_MAX_DEPENDANT_AGE }],
    });
    const party = partyOf(input);
    expect(party.map((member) => [member.role, member.attendeeType, member.age])).toEqual([
      ["PRIMARY", "WORKER", null],
      ["SPOUSE", "ATTENDEE", null],
      ["DEPENDANT", "CHILD", 0],
      ["DEPENDANT", "CHILD", 18],
    ]);
  });

  it("refuses a dependant over 18 or with a fractional or negative age", () => {
    const attempt = (age: number) => invitationRegistrationSchema.safeParse({ ...person, dependants: [{ firstName: "Cy", lastName: "Synthetic", age }] });
    expect(attempt(19).success).toBe(false);
    expect(attempt(18).success).toBe(true);
    expect(attempt(-1).success).toBe(false);
    expect(attempt(7.5).success).toBe(false);
    expect(invitationRegistrationSchema.safeParse({ ...person, dependants: [{ firstName: "Cy", lastName: "Synthetic", age: 19 }] })).toMatchObject({ success: false });
  });

  it("allows one spouse only and no other adult relative", () => {
    expect(invitationRegistrationSchema.safeParse({ ...person, spouse: [{ firstName: "A", lastName: "B" }, { firstName: "C", lastName: "D" }] }).success).toBe(false);
    expect(invitationRegistrationSchema.safeParse({ ...person, relatives: [{ firstName: "A", lastName: "B" }] }).success).toBe(false);
  });

  it("caps the number of children, rejects an unknown field and a filled honeypot", () => {
    const kids = Array.from({ length: 13 }, (_, index) => ({ firstName: `K${index}`, lastName: "Synthetic", age: 5 }));
    expect(invitationRegistrationSchema.safeParse({ ...person, dependants: kids }).success).toBe(false);
    expect(invitationRegistrationSchema.safeParse({ ...person, group: "STAFF" }).success).toBe(false);
    expect(invitationRegistrationSchema.safeParse({ ...person, website: "http://spam.example" }).success).toBe(false);
    expect(invitationRegistrationSchema.safeParse({ ...person, website: "" }).success).toBe(true);
  });

  it("requires names, and a person listed twice is caught", () => {
    expect(invitationRegistrationSchema.safeParse({ firstName: "", lastName: "Synthetic" }).success).toBe(false);
    const input = invitationRegistrationSchema.parse({ ...person, spouse: { firstName: "ada", lastName: "SYNTHETIC" } });
    expect(duplicatePartyName(partyOf(input))).toBe("ada SYNTHETIC");
    expect(duplicatePartyName(partyOf(invitationRegistrationSchema.parse(person)))).toBeNull();
  });
});

describe("personal links", () => {
  const invitation = { id: "cminvite00000001", linkVersion: 1 };

  it("derives the same link every time, and a reissue makes every earlier link fail", () => {
    const token = invitationToken(invitation);
    expect(invitationToken(invitation)).toBe(token);
    expect(invitationIdFromToken(token)).toBe(invitation.id);
    expect(invitationTokenMatches(token, invitation)).toBe(true);
    expect(invitationTokenMatches(token, { ...invitation, linkVersion: 2 })).toBe(false);
    expect(invitationToken({ ...invitation, linkVersion: 2 })).not.toBe(token);
  });

  it("rejects a token for another invitation, a forged signature and junk", () => {
    const token = invitationToken(invitation);
    const other = invitationToken({ id: "cminvite00000002", linkVersion: 1 });
    expect(invitationTokenMatches(other, invitation)).toBe(false);
    expect(invitationTokenMatches(`${invitation.id}.${other.split(".")[1]}`, invitation)).toBe(false);
    expect(invitationTokenMatches(`${token}x`, invitation)).toBe(false);
    for (const junk of ["", ".", "abc", "a.b", `${invitation.id}.`, `${invitation.id}.${"A".repeat(43)}.extra`]) {
      expect(invitationIdFromToken(junk)).toBeNull();
    }
    expect(invitationTokenMatches(`${invitation.id}.${"A".repeat(43)}`, invitation)).toBe(false);
  });

  it("is a private path that carries no email address or name", () => {
    const url = invitationUrl("https://events.example.test/", invitationToken(invitation));
    expect(url.startsWith("https://events.example.test/staff-invite/")).toBe(true);
    expect(url).not.toMatch(/@|%40/);
  });
});

describe("the words people read", () => {
  it("states the coverage and the group, and never a price", () => {
    const email = invitationEmail({ eventName: "Test Meeting", firstName: "Ada", group: "PASTOR", url: "https://events.example.test/staff-invite/x", supportContact: "office@example.test" });
    expect(email.bodyText).toContain("as a pastor");
    expect(email.bodyText).toContain(COVERAGE_SENTENCE);
    expect(email.bodyText).toContain("https://events.example.test/staff-invite/x");
    expect(email.bodyText).toContain("office@example.test");
    expect(email.bodyText).not.toMatch(/\$\d/);
  });
  it("greets without a first name and names the reference in the receipt and the approval", () => {
    expect(receivedEmail({ eventName: "Test Meeting", firstName: "", confirmationCode: "REG-TEST" }).bodyText).toMatch(/^Hello,\n/);
    expect(approvedEmail({ eventName: "Test Meeting", firstName: "Ada", confirmationCode: "REG-TEST" }).bodyText).toContain("REG-TEST");
  });
  it("groups the office digest into 15 minute windows", () => {
    const a = new Date("2026-10-14T10:00:00Z");
    expect(officeDigestWindow(new Date(a.getTime() + 14 * 60 * 1000))).toBe(officeDigestWindow(a));
    expect(officeDigestWindow(new Date(a.getTime() + 15 * 60 * 1000))).not.toBe(officeDigestWindow(a));
  });
});

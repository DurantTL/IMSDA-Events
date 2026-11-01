import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { RegistrationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  STATUS_WORDS,
  registrationMoneyStatus,
  registrationStatusWord,
  registrationStatusWords,
  waitlistPositionDetail,
  waitlistStatusText,
} from "@/modules/registrations/status-words";
import { describePublicRegistrationStatus } from "@/modules/public-access/domain";
import { registrationStateLabel } from "@/modules/attendee-accounts/registration-card";
import { statusLabel as staffStatusLabel } from "@/components/people-workspace";
import type { RegistrationRecord } from "@/modules/registrations/repository";

const eight = ["Draft", "Submitted", "Pending payment", "Pending approval", "Confirmed", "Waitlisted", "Cancelled", "Refunded"];

describe("status words (#1453, B12)", () => {
  it("is exactly the eight agreed words", () => {
    expect([...STATUS_WORDS]).toEqual(eight);
  });

  it("maps every RegistrationStatus enum value to exactly one of the eight words", () => {
    const values = Object.values(RegistrationStatus);
    expect(Object.keys(registrationStatusWords).sort()).toEqual([...values].sort());
    for (const status of values) {
      expect(eight).toContain(registrationStatusWord({ status }));
      expect(eight).toContain(registrationStatusWords[status]);
    }
    expect(new Set(Object.values(registrationStatusWords)).size).toBe(values.length);
  });

  it("derives Pending payment and Pending approval from display context only", () => {
    expect(registrationStatusWord({ status: "SUBMITTED", attendeeBalanceCents: 4000 })).toBe("Pending payment");
    expect(registrationStatusWord({ status: "SUBMITTED", attendeeBalanceCents: 0 })).toBe("Submitted");
    expect(registrationStatusWord({ status: "SUBMITTED", attendeeBalanceCents: 4000, deferredBilling: true })).toBe("Submitted");
    expect(registrationStatusWord({ status: "CONFIRMED", attendeeBalanceCents: 4000 })).toBe("Confirmed");
    expect(registrationStatusWord({ status: "DRAFT", awaitingApproval: true })).toBe("Pending approval");
    expect(registrationStatusWord({ status: "WAITLISTED", awaitingApproval: true })).toBe("Waitlisted");
    expect(registrationStatusWord({ status: "CANCELLED", awaitingApproval: true })).toBe("Cancelled");
  });

  it("keeps the stored enum values untouched", () => {
    expect(Object.values(RegistrationStatus).sort()).toEqual(["CANCELLED", "CONFIRMED", "DRAFT", "SUBMITTED", "WAITLISTED"]);
  });

  it("uses the shared words for attendee-facing status text", () => {
    for (const status of Object.values(RegistrationStatus)) {
      const label = describePublicRegistrationStatus(status, null).label;
      expect(label).toBe(registrationStatusWords[status]);
    }
    expect(describePublicRegistrationStatus("SUBMITTED", null, { attendeeBalanceCents: 100 }).label).toBe("Pending payment");
    expect(describePublicRegistrationStatus("WAITLISTED", 3).label).toBe("Waitlisted · position 3");
  });

  it("formats the waitlist position one way", () => {
    expect(waitlistPositionDetail({ position: 3 })).toBe("position 3");
    expect(waitlistPositionDetail({ position: 3, place: "Camp Heritage" })).toBe("at Camp Heritage, position 3");
    expect(waitlistPositionDetail({ place: "Camp Heritage" })).toBe("at Camp Heritage");
    expect(waitlistPositionDetail({})).toBeNull();
    expect(waitlistStatusText({})).toBe("Waitlisted");
  });

  it("words the money state once, with an audience flag", () => {
    const base = { totalCents: 10000, balanceCents: 0 };
    expect(registrationMoneyStatus(base)).toBe("Paid in full");
    expect(registrationMoneyStatus({ totalCents: 0, balanceCents: 0 })).toBe("No charge");
    expect(registrationMoneyStatus({ ...base, balanceCents: 500 })).toBe("Balance due");
    expect(registrationMoneyStatus({ ...base, balanceCents: 500, formatAmount: (cents) => `$${cents / 100}` })).toBe("$5 due");
    expect(registrationMoneyStatus({ ...base, deferredBilling: true, audience: "staff" })).toBe("Billed to church");
    expect(registrationMoneyStatus({ ...base, deferredBilling: true, audience: "attendee" })).toBe("Billed to your church");
    expect(registrationMoneyStatus({ ...base, deferredBilling: true, isGroup: true })).toBe("Billed to group contact");
  });
});

describe("one registration, one word (#1453)", () => {
  const cases = [
    { name: "submitted with a balance", status: "SUBMITTED", balanceCents: 35000, deferred: false, word: "Pending payment" },
    { name: "submitted with no balance", status: "SUBMITTED", balanceCents: 0, deferred: false, word: "Submitted" },
    { name: "submitted and church-billed", status: "SUBMITTED", balanceCents: 0, deferred: true, word: "Submitted" },
    { name: "confirmed with a balance", status: "CONFIRMED", balanceCents: 500, deferred: false, word: "Confirmed" },
  ] as const;
  for (const c of cases) {
    it(`staff, account, attendee page and email agree for ${c.name}`, () => {
      const staff = staffStatusLabel({
        status: c.status, balanceCents: c.balanceCents, totalAmountCents: 35000, isDeferredOrganizationBilling: c.deferred, staffInvitation: null,
      } as unknown as RegistrationRecord);
      const attendee = describePublicRegistrationStatus(c.status, null, { attendeeBalanceCents: c.balanceCents, deferredBilling: c.deferred });
      const account = registrationStateLabel({ lifecycle: c.status, status: attendee });
      // The reactivation email token (restored_status) is this same function with the same context.
      const email = registrationStatusWord({ status: c.status, attendeeBalanceCents: c.balanceCents, deferredBilling: c.deferred });
      expect([staff, attendee.label, account, email]).toEqual([c.word, c.word, c.word, c.word]);
    });
  }

  it("builds the email token and the attendee listing from registrationStatusWord", () => {
    expect(readFileSync(join(__dirname, "../modules/communications/transactional-messages.ts"), "utf8")).toMatch(/restored_status: registrationStatusWord\(/);
    expect(readFileSync(join(__dirname, "../modules/registrations/attendee-listing.ts"), "utf8")).toMatch(/statusLabel: registrationStatusWord\(/);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

const root = join(__dirname, "..");
const files = ["app", "components", "modules"].flatMap((dir) => sourceFiles(join(root, dir)))
  .filter((file) => relative(root, file) !== "modules/registrations/status-words.ts");

/**
 * Allowlist, kept short. "Registration received" is the confirmation page heading and the confirmation email subject
 * (an event, not a status label). "Not sent" below is an email-sent state, not a registration status.
 */
const allowlist: Record<string, string[]> = {
  "Registration received": ["components/public-registration-form.tsx", "modules/communications/templates.ts"],
};

/** `only` narrows a rule to the files where the word names a registration or request status (other records legitimately say it). */
const banned: Array<{ name: string; pattern: RegExp; only?: RegExp }> = [
  { name: "Registration received", pattern: /Registration received/ },
  // Club monthly reports and club forms say "Not submitted" about their own records, which is fine.
  { name: "Not submitted (registration)", pattern: /"Not submitted"/, only: /^(modules\/public-access|modules\/club-rosters|app\/\(public\)\/manage|components\/people-workspace)/ },
  { name: "Waiting for office approval", pattern: /[Ww]aiting for office approval/ },
  { name: "Waiting on the sending club", pattern: /Waiting on the sending club/ },
  { name: "Waiting for a decision", pattern: /Waiting for a decision/ },
  { name: "Waiting for staff", pattern: /Waiting for staff/ },
  // Email-send states ("Not sent" on an assignment email, a test email) are not a status of the invite itself.
  { name: "Not sent (status label)", pattern: /PENDING: "Not sent"/ },
  { name: "Paid as a standalone status label", pattern: /return "Paid";|label: "Paid"[,\s}]|<option value="PAID">Paid<\/option>/, only: /^(app\/\(workspace\)\/overview|components\/people-workspace|modules\/registrations|modules\/attendee-accounts|modules\/public-access)/ },
  { name: "registration status lowercased", pattern: /(?:registration|reg|selected)\.status\.toLowerCase\(\)|[rR]egistrationStatus\.toLowerCase\(\)|(?:row|line)\.status\.toLowerCase\(\)/, only: /^(components\/(finance-workspace|people-workspace|church-amounts-owed|billing-responsibility|church-code-invoices|cancellation-requests-workspace)|app\/\(public\)\/account|modules\/(cancellation|registrations|attendee-accounts))/ },
  { name: "old waitlist formats", pattern: /Waitlisted at \$\{|Waitlisted · position|"On the waitlist"|Waitlisted \(#/ },
];

describe("status word source scan (#1453)", () => {
  for (const rule of banned) {
    it(`has no "${rule.name}"`, () => {
      const hits = files
        .map((file) => relative(root, file))
        .filter((file) => !rule.only || rule.only.test(file))
        .filter((file) => !(allowlist[rule.name.split(" (")[0]!] ?? []).includes(file))
        .filter((file) => rule.pattern.test(readFileSync(join(root, file), "utf8")));
      expect(hits).toEqual([]);
    });
  }

  it("never lowercases a status for display anywhere in app/ (class names excepted)", () => {
    const hits = files
      .map((file) => relative(root, file))
      .filter((file) => file.startsWith("app/"))
      .flatMap((file) => readFileSync(join(root, file), "utf8").split("\n")
        .filter((line) => /[sS]tatus\.toLowerCase\(\)/.test(line) && !line.includes("className"))
        .map((line) => `${file}: ${line.trim().slice(0, 80)}`));
    expect(hits).toEqual([]);
  });

  it("has no inline label map keyed by registration status values", () => {
    // An object literal giving string labels to SUBMITTED and WAITLISTED is a second map.
    const hits = files
      .map((file) => relative(root, file))
      .filter((file) => /SUBMITTED:\s*"[^"]*"[\s\S]{0,200}WAITLISTED:\s*"|WAITLISTED:\s*"[^"]*"[\s\S]{0,200}SUBMITTED:\s*"/.test(readFileSync(join(root, file), "utf8")));
    expect(hits).toEqual([]);
  });

  it("defines no other RegistrationStatus label map", () => {
    const hits = files
      .map((file) => relative(root, file))
      .filter((file) => /Record<\s*(?:Club)?RegistrationStatus\s*,\s*string\s*>/.test(readFileSync(join(root, file), "utf8")));
    expect(hits).toEqual([]);
  });
});

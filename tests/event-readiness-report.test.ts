import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);
import { collectEventReadinessReport } from "@/modules/events/event-readiness-report";

const readyEnv = {
  RESEND_API_KEY: "synthetic-provider-key",
  RESEND_WEBHOOK_SECRET: "synthetic-webhook-key",
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_APPLICATION_ID: "sandbox-synthetic-app",
  SQUARE_ACCESS_TOKEN: "synthetic-access-token",
  SQUARE_LOCATION_ID: "synthetic-location",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "synthetic-signature",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://synthetic.invalid/api/webhooks/square",
};

import { campMeetingPreset } from "./support/camp-meeting-seeds";

// A rules document that parses under the real schema, so the policy counts as in effect.
const policyRules = campMeetingPreset("2026-05-25");

function dataSource(overrides: {
  event?: Record<string, unknown> | null;
  publishedFormCount?: number;
  settings?: Record<string, unknown> | null;
  templates?: ReadonlyArray<Record<string, unknown>>;
  registrations?: ReadonlyArray<Record<string, unknown>>;
  sender?: string | null;
  attendeeTypes?: ReadonlyArray<{ label: string; minimumAge: number | null }>;
  policyVersions?: ReadonlyArray<Record<string, unknown>>;
} = {}) {
  const event = overrides.event === null ? null : {
    id: "event_synthetic",
    name: "Synthetic Retreat",
    slug: "synthetic-retreat",
    startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-09-03T00:00:00Z"),
    timezone: "America/Chicago",
    location: "Synthetic Conference Center",
    publicInfoUrl: "https://www.imsda.org/synthetic-retreat",
    supportContact: "Registration team",
    isPublished: true,
    billingMode: "ATTENDEE_PAY",
    ...overrides.event,
  };
  const templates = overrides.templates ?? [
    "REGISTRATION_CONFIRMATION_PAID",
    "REGISTRATION_CONFIRMATION_UNPAID",
    "PAYMENT_RECEIPT",
    "BALANCE_REMINDER",
    "SHIRT_SIZE_REQUEST",
  ].map((key) => ({ key, isEnabled: true, versions: [{ id: `version_${key}` }] }));
  const reads = {
    event: { findUnique: vi.fn().mockResolvedValue(event) },
    registrationFormVersion: { count: vi.fn().mockResolvedValue(overrides.publishedFormCount ?? 1) },
    // The required publish items (#1408): a saved central sender and attendee types; a cancellation policy is recommended.
    platformSettings: { findUnique: vi.fn().mockResolvedValue({ defaultSenderEmail: overrides.sender === undefined ? "events@imsda.org" : overrides.sender }) },
    eventAttendeeType: { findMany: vi.fn().mockResolvedValue(overrides.attendeeTypes ?? [{ label: "Adult", minimumAge: 18 }]) },
    eventCancellationPolicyVersion: { findMany: vi.fn().mockResolvedValue(overrides.policyVersions ?? [{ id: "pol_1", version: 1, effectiveFrom: new Date("2020-01-01T00:00:00Z"), rules: policyRules }]) },
    registrationForm: { findMany: vi.fn().mockResolvedValue([]) },
    eventLocation: { findMany: vi.fn().mockResolvedValue([]) },
    eventMessageSettings: { findFirst: vi.fn().mockResolvedValue(overrides.settings === null ? null : overrides.settings ?? { deliveryMode: "EXTERNAL_EMAIL", senderEmail: "notifications@imsda.org", replyToEmail: "registration@imsda.org" }) },
    eventMessageTemplate: { findMany: vi.fn().mockResolvedValue(templates) },
    registration: { findMany: vi.fn().mockResolvedValue(overrides.registrations ?? [{ totalAmount: 0, attendees: [{ formResponses: { shirt_size: "Adult M" } }], payments: [] }]) },
  };
  return { prisma: reads as unknown as PrismaClient, reads };
}

function check(report: Awaited<ReturnType<typeof collectEventReadinessReport>>, code: string) {
  return report?.checks.find((item) => item.code === code);
}

describe("collectEventReadinessReport", () => {
  it("returns a fully ready, aggregate-only fixture through read methods", async () => {
    const { prisma, reads } = dataSource();
    const report = await collectEventReadinessReport(prisma, "synthetic-retreat", readyEnv);

    expect(report?.summary).toEqual({ blockers: 0, warnings: 0, isReady: true });
    expect(report?.activeRegistrationCount).toBe(1);
    expect(report?.checks.map((item) => item.code)).toEqual(expect.arrayContaining([
      "PUBLISH_BASICS", "PUBLISH_LOCATION", "PUBLISH_PUBLIC_INFO", "PUBLISH_SUPPORT", "PUBLISH_REGISTRATION_FORM",
      "EVENT_PUBLISHED", "DELIVERY_MODE", "SENDER_ADDRESS", "REPLY_TO_ADDRESS", "TEMPLATES", "SQUARE",
    ]));
    for (const delegate of Object.values(reads)) {
      expect(Object.keys(delegate).every((method) => ["findUnique", "findFirst", "findMany", "count"].includes(method))).toBe(true);
    }
  });

  it.each([
    ["publish basics", { event: { name: "" } }, "PUBLISH_BASICS"],
    ["publish location", { event: { location: null } }, "PUBLISH_LOCATION"],
    ["support", { event: { supportContact: null } }, "PUBLISH_SUPPORT"],
    ["published form", { publishedFormCount: 0 }, "PUBLISH_REGISTRATION_FORM"],
    ["event publication", { event: { isPublished: false } }, "EVENT_PUBLISHED"],
    ["placeholder sender", { settings: { deliveryMode: "EXTERNAL_EMAIL", senderEmail: "sender@example.invalid", replyToEmail: "reply@imsda.org" } }, "SENDER_ADDRESS"],
    ["required templates", { templates: [] }, "TEMPLATES"],
    ["balance without card path", { registrations: [{ totalAmount: 25, attendees: [{ formResponses: { shirt_size: "Adult M" } }], payments: [] }] }, "SQUARE"],
  ] as const)("blocks for %s", async (_name, overrides, code) => {
    const { prisma } = dataSource(overrides);
    const env = code === "SQUARE" ? {} : readyEnv;
    expect(check(await collectEventReadinessReport(prisma, "synthetic-retreat", env), code)?.severity).toBe("BLOCKER");
  });

  it("flags an existing CLUB event set to attendee-pay, and only that (#565)", async () => {
    const mismatched = await collectEventReadinessReport(dataSource({ event: { audience: "CLUB", billingMode: "ATTENDEE_PAY" } }).prisma, "synthetic-retreat", readyEnv);
    expect(check(mismatched, "PUBLISH_CLUB_BILLING")).toMatchObject({ severity: "BLOCKER", label: "Church billing for club registration" });
    const general = await collectEventReadinessReport(dataSource({ event: { audience: "GENERAL", billingMode: "ATTENDEE_PAY" } }).prisma, "synthetic-retreat", readyEnv);
    expect(check(general, "PUBLISH_CLUB_BILLING")).toBeUndefined();
  });

  it("requires a saved central sender, and says it is not blocked by the email environment (#1408)", async () => {
    const missing = await collectEventReadinessReport(dataSource({ sender: null }).prisma, "synthetic-retreat", readyEnv);
    expect(check(missing, "PUBLISH_CENTRAL_SENDER")).toMatchObject({ severity: "BLOCKER", label: "Central email sender saved" });
    expect(check(await collectEventReadinessReport(dataSource({ sender: "   " }).prisma, "synthetic-retreat", readyEnv), "PUBLISH_CENTRAL_SENDER")?.severity).toBe("BLOCKER");
    const saved = await collectEventReadinessReport(dataSource().prisma, "synthetic-retreat", {});
    expect(check(saved, "PUBLISH_CENTRAL_SENDER")?.severity).toBe("READY");
  });

  it("requires an adult attendee type for a general event only (#1408)", async () => {
    const none = { attendeeTypes: [{ label: "Child", minimumAge: null }] };
    expect(check(await collectEventReadinessReport(dataSource(none).prisma, "synthetic-retreat", readyEnv), "PUBLISH_ATTENDEE_TYPES")?.severity).toBe("BLOCKER");
    const club = await collectEventReadinessReport(dataSource({ ...none, event: { audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" } }).prisma, "synthetic-retreat", readyEnv);
    expect(check(club, "PUBLISH_ATTENDEE_TYPES")).toBeUndefined();
    expect(check(club, "PUBLISH_CLUB_BILLING")?.severity).toBe("READY");
  });

  it("recommends a cancellation policy but never blocks on it (#1408)", async () => {
    const report = await collectEventReadinessReport(dataSource({ policyVersions: [] }).prisma, "synthetic-retreat", readyEnv);
    expect(check(report, "PUBLISH_CANCELLATION_POLICY")?.severity).toBe("WARNING");
    expect(report?.summary.blockers).toBe(0);
    expect(check(await collectEventReadinessReport(dataSource().prisma, "synthetic-retreat", readyEnv), "PUBLISH_CANCELLATION_POLICY")?.severity).toBe("READY");
    // Not where online cancellation never applies (club or church-billed events).
    const club = await collectEventReadinessReport(dataSource({ policyVersions: [], event: { audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" } }).prisma, "synthetic-retreat", readyEnv);
    expect(check(club, "PUBLISH_CANCELLATION_POLICY")).toBeUndefined();
  });

  it("never blocks publish on the optional IMSDA.org information page (#467)", async () => {
    const { prisma } = dataSource({ event: { publicInfoUrl: null } });
    const withoutUrl = await collectEventReadinessReport(prisma, "synthetic-retreat", readyEnv);
    expect(withoutUrl?.summary).toEqual({ blockers: 0, warnings: 0, isReady: true });
    expect(check(withoutUrl, "PUBLISH_PUBLIC_INFO")?.severity).toBe("READY");

    const { prisma: prismaInvalid } = dataSource({ event: { publicInfoUrl: "not-a-url" } });
    const withInvalidUrl = await collectEventReadinessReport(prismaInvalid, "synthetic-retreat", readyEnv);
    expect(check(withInvalidUrl, "PUBLISH_PUBLIC_INFO")?.severity).toBe("WARNING");
    expect(withInvalidUrl?.summary.blockers).toBe(0);
    expect(withInvalidUrl?.summary.isReady).toBe(true);
  });

  it("blocks for a missing provider key and an invalid Square configuration", async () => {
    const { prisma } = dataSource();
    const report = await collectEventReadinessReport(prisma, "synthetic-retreat", {
      ...readyEnv,
      RESEND_API_KEY: "",
      SQUARE_ENVIRONMENT: "production",
      SQUARE_ENABLE_PRODUCTION: "false",
    });
    expect(check(report, "DELIVERY_MODE")?.severity).toBe("BLOCKER");
    expect(check(report, "SQUARE")?.label).toContain("PRODUCTION_DISABLED");
  });

  it("returns null after only the event lookup for an unknown slug", async () => {
    const { prisma, reads } = dataSource({ event: null });
    expect(await collectEventReadinessReport(prisma, "unknown", readyEnv)).toBeNull();
    expect(reads.registration.findMany).not.toHaveBeenCalled();
  });

  it("never treats a deferred-organization registration's estimated rate as a balance with no card path", async () => {
    const { prisma } = dataSource({
      event: { billingMode: "DEFERRED_ORGANIZATION_INVOICE" },
      templates: [
        { key: "REGISTRATION_CONFIRMATION_ORGANIZATION_BILLED", isEnabled: true, versions: [{ id: "version_org_billed" }] },
        { key: "SHIRT_SIZE_REQUEST", isEnabled: true, versions: [{ id: "version_shirt" }] },
      ],
      registrations: [{ totalAmount: 9, attendees: [{ formResponses: { shirt_size: "Adult M" } }], payments: [] }],
    });
    const report = await collectEventReadinessReport(prisma, "synthetic-retreat", {});
    expect(check(report, "SQUARE")?.severity).toBe("WARNING");
    expect(check(report, "TEMPLATES")?.severity).toBe("READY");
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);
vi.mock("server-only", () => ({}));

import { EmailProviderRequestError } from "@/integrations/email/resend";
import { processExternalEmailQueue } from "@/modules/communications/email-delivery";
import { renderEmailLayoutDocument } from "@/modules/communications/email-layout";
import { resolveEmailLook, type EmailLook } from "@/modules/registration-themes/email-look";
import type { EmailLookSource } from "@/modules/registration-themes/email-look-repository";
import { PLATFORM_DEFAULT_THEME } from "@/modules/registration-themes/tokens";

/** The email look is stamped on a message once and reused (#283, slice 2 round B). Synthetic data, no database. */

const event = { slug: "pine-lake", name: "Pine Lake Camp", isPublished: true, archivedAt: null };
function lookFor(primary: string, logoAssetId: string | null = null): EmailLook {
  return resolveEmailLook({
    row: { status: "PUBLISHED", tokens: { ...PLATFORM_DEFAULT_THEME, primary, logoAlt: "Logo" }, logoAssetId },
    event,
    logoAssetExists: Boolean(logoAssetId),
    appOrigin: "https://events.example.test",
  })!;
}
const GREEN = lookFor("#1b4d3e");
const PLUM = lookFor("#4a1d5e");

function fakeStore(overrides: Record<string, unknown> = {}) {
  const message: Record<string, unknown> = {
    id: "message-1",
    eventId: "event-1",
    accountUserId: null,
    templateKey: "REGISTRATION_CONFIRMATION_PAID",
    registrationId: "registration-1",
    recipientEmail: "attendee@example.test",
    senderNameSnapshot: "IMAdventist",
    senderEmailSnapshot: "registration@imsda.org",
    replyToEmailSnapshot: "help@imsda.org",
    subjectSnapshot: "Registration received",
    bodyTextSnapshot: "Your registration is saved.",
    bodyHtmlSnapshot: "<p>Your registration is saved.</p>",
    status: "PENDING",
    attemptCount: 0,
    registrationThemeVersionId: null,
    availableAt: new Date("2026-07-23T11:00:00.000Z"),
    lockToken: null,
    ...overrides,
  };
  const attempts: Array<Record<string, unknown>> = [];
  const messageOutbox = {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async (query: { where?: { availableAt?: { lte: Date } } }) => (message.status === "PENDING"
      && (!query?.where?.availableAt || (message.availableAt as Date) <= query.where.availableAt.lte)
      ? {
          id: message.id,
          eventId: message.eventId,
          accountUserId: null,
          templateKey: message.templateKey,
          registrationId: message.registrationId,
          recipientEmail: message.recipientEmail,
          senderNameSnapshot: message.senderNameSnapshot,
          senderEmailSnapshot: message.senderEmailSnapshot,
          replyToEmailSnapshot: message.replyToEmailSnapshot,
          subjectSnapshot: message.subjectSnapshot,
          bodyTextSnapshot: message.bodyTextSnapshot,
          bodyHtmlSnapshot: message.bodyHtmlSnapshot,
          registrationThemeVersionId: message.registrationThemeVersionId,
          recipientKind: message.recipientKind,
          registration: message.registration,
          attachment: null,
          files: [],
          attemptCount: message.attemptCount,
        }
      : null)),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.id !== message.id || (where.status && where.status !== message.status)) return { count: 0 };
      if ("lockToken" in where && where.lockToken !== message.lockToken) return { count: 0 };
      if ("registrationThemeVersionId" in where && where.registrationThemeVersionId !== message.registrationThemeVersionId) return { count: 0 };
      Object.assign(message, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(message, data)),
  };
  const tx = {
    messageOutbox,
    messageDeliveryAttempt: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { attempts.push(data); return data; }),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _max: { attemptNumber: attempts.length || null } })),
    },
    messageProviderEvent: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null) },
    clubFormLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
    healthRecordLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    eventMessageSettings: { findUnique: vi.fn(async () => ({ deliveryMode: "EXTERNAL_EMAIL", senderEmail: "registration@imsda.org" })) },
    messageOutbox,
    invoiceDeliveryRecipient: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, message, messageOutbox };
}

function run(store: ReturnType<typeof fakeStore>, emailLookSource: EmailLookSource | null, sendEmail: ReturnType<typeof vi.fn>, at = "2026-07-23T12:00:00.000Z") {
  return processExternalEmailQueue("event-1", {
    dependencies: {
      configuration: { apiKey: "re_test_only", apiUrl: "https://api.resend.test" },
      now: () => new Date(at),
      prisma: store.prisma as never,
      sendEmail: sendEmail as never,
      emailParts: { appOrigin: () => "https://events.example.test" },
      emailLookSource,
    },
  });
}

const ok = () => vi.fn<(input: { bodyHtml?: string | null; bodyText: string }) => Promise<{ provider: "RESEND"; providerMessageId: string }>>(async () => ({ provider: "RESEND", providerMessageId: "provider-1" }));
const htmlOf = (sendEmail: ReturnType<typeof ok>, call = 0) => sendEmail.mock.calls[call][0].bodyHtml ?? "";

describe("the email look on a delivered message (#283)", () => {
  it("stamps the published version once, uses its look, and reuses the stamp on a retry even after a later publish", async () => {
    const store = fakeStore();
    const published = vi.fn(async () => "version-1");
    const loadLook = vi.fn(async (id: string) => (id === "version-1" ? GREEN : PLUM));
    const source: EmailLookSource = { clubEmailsUseLook: async () => false, findPublishedVersionId: published, loadLook };

    const failing = vi.fn(async () => { throw new EmailProviderRequestError("Try again later.", "HTTP_503", true, 503); });
    await run(store, source, failing as never);
    expect(store.message.registrationThemeVersionId).toBe("version-1");
    expect([store.message.status, store.message.lastError]).toEqual(["PENDING", "Try again later."]);
    expect(published).toHaveBeenCalledTimes(1);

    // A newer look is published before the retry.
    published.mockResolvedValue("version-2");
    const sendEmail = ok();
    await run(store, source, sendEmail, "2026-07-23T13:00:00.000Z");

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(published).toHaveBeenCalledTimes(1);
    expect(store.message.registrationThemeVersionId).toBe("version-1");
    expect(loadLook).toHaveBeenLastCalledWith("version-1", "https://events.example.test");
    expect(htmlOf(sendEmail)).toContain('bgcolor="#1b4d3e" class="em-bar"');
    expect(htmlOf(sendEmail)).not.toContain("#4a1d5e");
  });

  it("stamps with a conditional update held by this worker's lock, only while the stamp is still empty", async () => {
    const store = fakeStore();
    const source: EmailLookSource = { clubEmailsUseLook: async () => false, findPublishedVersionId: async () => "version-1", loadLook: async () => GREEN };
    await run(store, source, ok());
    const stampCalls = store.messageOutbox.updateMany.mock.calls
      .map((call) => call[0] as { where: Record<string, unknown>; data: Record<string, unknown> })
      .filter((call) => "registrationThemeVersionId" in call.data);
    expect(stampCalls).toHaveLength(1);
    expect(stampCalls[0].where).toMatchObject({ id: "message-1", status: "PROCESSING", registrationThemeVersionId: null });
    expect(typeof stampCalls[0].where.lockToken).toBe("string");
  });

  it("uses an already stamped version without asking which look is published now", async () => {
    const store = fakeStore({ registrationThemeVersionId: "version-1" });
    const published = vi.fn(async () => "version-2");
    const source: EmailLookSource = { clubEmailsUseLook: async () => false, findPublishedVersionId: published, loadLook: async (id) => (id === "version-1" ? GREEN : PLUM) };
    const sendEmail = ok();
    await run(store, source, sendEmail);
    expect(published).not.toHaveBeenCalled();
    expect(htmlOf(sendEmail)).toContain("#1b4d3e");
    expect(htmlOf(sendEmail)).not.toContain("#4a1d5e");
  });

  it("sends the platform layout, unstamped, when the event has no published look", async () => {
    const store = fakeStore();
    const loadLook = vi.fn();
    const sendEmail = ok();
    await run(store, { clubEmailsUseLook: async () => false, findPublishedVersionId: async () => null, loadLook }, sendEmail);
    expect(store.message.registrationThemeVersionId).toBeNull();
    expect(loadLook).not.toHaveBeenCalled();
    expect(htmlOf(sendEmail)).toContain("#f0b323");
  });

  it("falls back to the platform layout, and still sends, when the look cannot be read", async () => {
    const store = fakeStore();
    const sendEmail = ok();
    const result = await run(store, { clubEmailsUseLook: async () => false, findPublishedVersionId: async () => { throw new Error("database busy"); }, loadLook: async () => GREEN }, sendEmail);
    expect(result.sentIds).toEqual(["message-1"]);
    expect(store.message.registrationThemeVersionId).toBeNull();
    expect(htmlOf(sendEmail)).toContain("#f0b323");

    const store2 = fakeStore({ registrationThemeVersionId: "version-1" });
    const sendEmail2 = ok();
    const result2 = await run(store2, { clubEmailsUseLook: async () => false, findPublishedVersionId: async () => "version-1", loadLook: async () => { throw new Error("gone"); } }, sendEmail2);
    expect(result2.sentIds).toEqual(["message-1"]);
    expect(htmlOf(sendEmail2)).toContain("#f0b323");
  });

  it("changes nothing without a look source, and the text part never depends on the look", async () => {
    const plainStore = fakeStore();
    const plainSend = ok();
    await run(plainStore, null, plainSend);
    expect(plainStore.message.registrationThemeVersionId).toBeNull();
    const themedStore = fakeStore();
    const themedSend = ok();
    await run(themedStore, { clubEmailsUseLook: async () => false, findPublishedVersionId: async () => "version-1", loadLook: async () => GREEN }, themedSend);
    expect(themedSend.mock.calls[0][0].bodyText).toBe(plainSend.mock.calls[0][0].bodyText);
    expect(htmlOf(themedSend)).not.toBe(htmlOf(plainSend));
    expect(htmlOf(plainSend)).toBe(renderEmailLayoutDocument({
      title: "Registration received",
      bodyHtml: "<p>Your registration is saved.</p>",
      whyLine: "You got this because you registered for an event.",
      helpLine: "Questions about this event? Email help@imsda.org.",
      calendarUrl: "https://events.example.test/calendar",
    }));
  });
});

describe("club email and the event look (#283 follow-up)", () => {
  const clubMessage = { templateKey: "REGISTRATION_CONFIRMATION_PAID", registration: { clubRegistration: { id: "club-registration-1" } } };
  const sourceWith = (useLook: boolean, extra: Partial<EmailLookSource> = {}): EmailLookSource => ({
    clubEmailsUseLook: async () => useLook,
    findPublishedVersionId: async () => "version-1",
    loadLook: async () => GREEN,
    ...extra,
  });

  it("keeps the platform layout, and stamps nothing, for club email while the switch is off", async () => {
    const store = fakeStore(clubMessage);
    const sendEmail = ok();
    const published = vi.fn(async () => "version-1");
    await run(store, sourceWith(false, { findPublishedVersionId: published }), sendEmail);
    expect(store.message.registrationThemeVersionId).toBeNull();
    expect(published).not.toHaveBeenCalled();
    expect(htmlOf(sendEmail)).toContain("#f0b323");
    expect(htmlOf(sendEmail)).not.toContain("#1b4d3e");
  });

  it("uses and stamps the look for club email once the switch is on", async () => {
    const store = fakeStore(clubMessage);
    const sendEmail = ok();
    await run(store, sourceWith(true), sendEmail);
    expect(store.message.registrationThemeVersionId).toBe("version-1");
    expect(htmlOf(sendEmail)).toContain('bgcolor="#1b4d3e" class="em-bar"');
  });

  it("treats a club director's invoice and a club-only template as club email", async () => {
    for (const overrides of [{ templateKey: "REGISTRATION_CONFIRMATION_PAID", recipientKind: "CLUB_DIRECTOR", registration: null }, { templateKey: "CLUB_DRAFT_REMINDER" }]) {
      const store = fakeStore(overrides);
      await run(store, sourceWith(false), ok());
      expect(store.message.registrationThemeVersionId).toBeNull();
    }
  });

  it("leaves non-club email alone whatever the switch says", async () => {
    for (const useLook of [false, true]) {
      const store = fakeStore();
      const sendEmail = ok();
      const clubSetting = vi.fn(async () => useLook);
      await run(store, sourceWith(useLook, { clubEmailsUseLook: clubSetting }), sendEmail);
      expect(store.message.registrationThemeVersionId).toBe("version-1");
      expect(htmlOf(sendEmail)).toContain("#1b4d3e");
      expect(clubSetting).not.toHaveBeenCalled();
    }
  });

  it("keeps a look already stamped on a club message even with the switch off, and never throws if the setting cannot be read", async () => {
    const stamped = fakeStore({ ...clubMessage, registrationThemeVersionId: "version-1" });
    const sendEmail = ok();
    await run(stamped, sourceWith(false), sendEmail);
    expect(htmlOf(sendEmail)).toContain("#1b4d3e");

    const broken = fakeStore(clubMessage);
    const brokenSend = ok();
    const result = await run(broken, sourceWith(true, { clubEmailsUseLook: async () => { throw new Error("database busy"); } }), brokenSend);
    expect(result.sentIds).toEqual(["message-1"]);
    expect(broken.message.registrationThemeVersionId).toBeNull();
    expect(htmlOf(brokenSend)).toContain("#f0b323");
  });
});

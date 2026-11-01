import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MessageTemplateKey } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);
vi.mock("server-only", () => ({}));

import { processAccountEmailQueue, processExternalEmailQueue } from "@/modules/communications/email-delivery";
import {
  EMAIL_HEADER_RULES,
  EMAIL_WHY_LINES,
  emailHeaderContext,
  emailIsClubLinked,
  emailHeaderName,
  emailPreviewLayout,
  emailWhyLine,
} from "@/modules/communications/email-layout";

const ALL_KEYS = Object.values(MessageTemplateKey) as MessageTemplateKey[];

/** Caleb's club list (#1443): club roles and invites, the club director sign-in code, club forms, club applications and notices to club directors. */
const CLUB_KEYS: MessageTemplateKey[] = [
  "ATTENDEE_SIGN_IN_CODE",
  "CLUB_INVITE",
  "CLUB_ASSIGNMENTS",
  "CLUB_TEAM_ROLE_NOTIFICATION",
  "CLUB_FORM_LINK",
  "CLUB_FORM_SUBMITTED",
  "HEALTH_RECORD_LINK",
  "NEW_CLUB_APPLICATION_SUBMITTED",
  "NEW_CLUB_APPLICATION_DECLINED",
  "NEW_CLUB_APPLICATION_INVITE",
  "MEMBER_TRANSFER_STARTED",
  "MEMBER_TRANSFER_COMPLETED",
  "DEADLINE_REMINDER",
  "TEAM_PERMISSION_REQUEST",
  "CLUB_TEAM_ADVANCEMENT_NOTICE",
  "HONOR_CLASS_WAITLIST_OFFER",
  "HONOR_CLASS_PICKS_NOT_RESTORED",
];

describe("every template key has a header context and a why line (#1443)", () => {
  it("covers exactly the keys the schema has, with no stale entries", () => {
    expect(Object.keys(EMAIL_HEADER_RULES).sort()).toEqual([...ALL_KEYS].sort());
    expect(Object.keys(EMAIL_WHY_LINES).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("gives every key a non-empty why line that names no placeholder", () => {
    for (const key of ALL_KEYS) {
      const line = emailWhyLine(key, "person@example.org");
      expect(line, key).toMatch(/^You got this because .+\.$/);
      expect(line, key).not.toMatch(/\{|\}|TODO|lorem/i);
    }
  });

  it("puts the club list in the club context and nothing else", () => {
    const club = ALL_KEYS.filter((key) => emailHeaderContext(key) === "club");
    expect(club.sort()).toEqual([...CLUB_KEYS].sort());
    for (const key of CLUB_KEYS) expect(emailHeaderContext(key, { clubRegistration: false }), key).toBe("club");
  });

  it("makes a registration message club only when the registration belongs to a club", () => {
    const dependent = ALL_KEYS.filter((key) => EMAIL_HEADER_RULES[key] === "registration-dependent");
    expect(dependent).toContain("REGISTRATION_CONFIRMATION_PAID");
    expect(dependent).toContain("PAYMENT_RECEIPT");
    for (const key of dependent) {
      expect(emailHeaderContext(key, { clubRegistration: true }), key).toBe("club");
      expect(emailHeaderContext(key, { clubRegistration: false }), key).toBe("general");
      expect(emailHeaderContext(key), key).toBe("general");
    }
    expect(emailHeaderContext("SOME_FUTURE_KEY")).toBe("general");
  });

  it("picks the header name by context from the settings", () => {
    const settings = { headerName: "IMSDA Events", clubHeaderName: "IMSDA Club Ministry", helpEmail: null, helpPhone: null };
    expect(emailHeaderName(settings, "general")).toBe("IMSDA Events");
    expect(emailHeaderName(settings, "club")).toBe("IMSDA Club Ministry");
  });
});

function sourceFiles(directory: string, found: string[] = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) found.push(path);
  }
  return found;
}

describe("only the shared layout builds an email document (#1443)", () => {
  const root = process.cwd();
  const files = ["app", "modules", "components", "lib", "integrations"].flatMap((directory) => sourceFiles(join(root, directory)));
  const rel = (path: string) => relative(root, path).split("\\").join("/");

  it("writes <!DOCTYPE html> in one file only", () => {
    const writers = files.filter((file) => /<!DOCTYPE html/i.test(readFileSync(file, "utf8")));
    expect(writers.map(rel)).toEqual(["modules/communications/email-layout.ts"]);
  });

  it("calls the document renderers only from the delivery worker and the two staff previews", () => {
    const callers = files
      .filter((file) => rel(file) !== "modules/communications/email-layout.ts" && rel(file) !== "modules/communications/email-html.ts")
      .filter((file) => /\brender(EmailHtmlDocument|EmailLayoutDocument)\(/.test(readFileSync(file, "utf8")))
      .map(rel)
      .sort();
    expect(callers).toEqual(["components/communications-workspace.tsx", "modules/communications/email-delivery.ts"]);
  });

  it("calls the mail provider send function only from the delivery worker", () => {
    const callers = files
      .filter((file) => !rel(file).startsWith("integrations/"))
      .filter((file) => /\bsendEmailWithProvider\b|\bsendEmail\b[^;]*from "@\/integrations\/email\/(provider|resend|ses)"/.test(readFileSync(file, "utf8")))
      .map(rel)
      .sort();
    expect(callers).toEqual(["modules/communications/email-delivery.ts"]);
  });
});

type Row = Record<string, unknown> & { id: string; status: string };

/** A delivery store holding several messages, so a run's reads can be counted against its messages. */
function multiStore(rows: Array<Partial<Row> & { id: string; templateKey: string }>, settingsRow: Record<string, unknown>) {
  const messages: Row[] = rows.map((row) => ({
    eventId: "event-1",
    accountUserId: null,
    registrationId: null,
    recipientEmail: `${row.id}@example.org`,
    senderNameSnapshot: "IMSDA Events",
    senderEmailSnapshot: "registration@imsda.org",
    replyToEmailSnapshot: "events@example.org",
    subjectSnapshot: "Subject",
    bodyTextSnapshot: "Hello.",
    bodyHtmlSnapshot: "<p>Hello.</p>",
    status: "PENDING",
    attemptCount: 0,
    availableAt: new Date("2026-07-23T11:00:00.000Z"),
    createdAt: new Date("2026-07-23T11:00:00.000Z"),
    lockedAt: null,
    lockToken: null,
    ...row,
  }));
  const byId = (id: unknown) => messages.find((message) => message.id === id);
  const messageOutbox = {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => {
      const next = messages.find((message) => message.status === "PENDING");
      return next ? { ...next, attachment: null, files: [] } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
      const message = byId(where.id);
      if (!message || (where.status && where.status !== message.status)) return { count: 0 };
      Object.assign(message, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(byId(where.id)!, data)),
  };
  const tx = {
    messageOutbox,
    messageDeliveryAttempt: {
      create: vi.fn(async ({ data }: { data: unknown }) => data),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _max: { attemptNumber: null } })),
    },
    messageProviderEvent: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null) },
    clubFormLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
    healthRecordLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const platformSettings = { findUnique: vi.fn(async (...args: [{ where: { id: string }; select: Record<string, boolean> }]) => (args.length ? settingsRow : null)) };
  const prisma = {
    eventMessageSettings: { findUnique: vi.fn(async () => ({ deliveryMode: "EXTERNAL_EMAIL", senderEmail: "registration@imsda.org" })) },
    messageOutbox,
    platformSettings,
    invoiceDeliveryRecipient: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
  return { prisma, platformSettings, messages };
}

describe("delivery picks the header for the message's context (#1443)", () => {
  it("uses the club name for club mail and a club registration, the general name for everything else, reading the settings once", async () => {
    const store = multiStore(
      [
        { id: "m1", templateKey: "CLUB_INVITE" },
        { id: "m2", templateKey: "ATTENDEE_EMAIL_VERIFICATION" },
        { id: "m3", templateKey: "REGISTRATION_CONFIRMATION_PAID", registration: { clubRegistration: { id: "club-reg-1" } } },
        { id: "m4", templateKey: "REGISTRATION_CONFIRMATION_PAID", registration: { clubRegistration: null } },
      ],
      { emailHeaderName: "IMSDA Events", emailClubHeaderName: "IMSDA Club Ministry", emailHelpEmail: "help@example.org", emailHelpPhone: null, defaultSenderEmail: "registration@imsda.org" },
    );
    const sent: Record<string, { html: string; text: string }> = {};
    const sendEmail = vi.fn(async (input: { toEmail: string; bodyHtml?: string | null; bodyText: string }) => {
      sent[input.toEmail.split("@")[0]] = { html: input.bodyHtml ?? "", text: input.bodyText };
      return { provider: "RESEND" as const, providerMessageId: `provider-${input.toEmail}` };
    });
    const result = await processExternalEmailQueue("event-1", {
      dependencies: {
        configuration: { apiKey: "re_test_only", apiUrl: "https://api.resend.test" },
        now: () => new Date("2026-07-23T12:00:00.000Z"),
        prisma: store.prisma as never,
        sendEmail: sendEmail as never,
      },
    });
    expect(result.sentIds.sort()).toEqual(["m1", "m2", "m3", "m4"]);
    const header = (key: string) => /class="em-bar-name"[^>]*>([^<]*)</.exec(sent[key].html)?.[1];
    expect(header("m1")).toBe("IMSDA Club Ministry");
    expect(header("m2")).toBe("IMSDA Events");
    expect(header("m3")).toBe("IMSDA Club Ministry");
    expect(header("m4")).toBe("IMSDA Events");
    // The footer in the text part agrees with the header, and the event's own contact wins for event mail.
    expect(sent.m1.text).toContain("Sent by IMSDA Club Ministry for the Iowa-Missouri Conference");
    expect(sent.m4.text).toContain("Sent by IMSDA Events for the Iowa-Missouri Conference");
    expect(sent.m4.text).toContain("Questions about this event? Email events@example.org.");
    // One read of the layout settings for four messages.
    const layoutReads = store.platformSettings.findUnique.mock.calls.filter(
      (call) => "emailHeaderName" in call[0].select,
    );
    expect(layoutReads).toHaveLength(1);
  });
});

function deps(store: ReturnType<typeof multiStore>, sent: Array<{ html: string | null | undefined; text: string }>, extra: Record<string, unknown> = {}) {
  return {
    configuration: { apiKey: "re_test_only", apiUrl: "https://api.resend.test" },
    now: () => new Date("2026-07-23T12:00:00.000Z"),
    prisma: store.prisma as never,
    sendEmail: vi.fn(async (input: { bodyHtml?: string | null; bodyText: string }) => {
      sent.push({ html: input.bodyHtml, text: input.bodyText });
      return { provider: "RESEND" as const, providerMessageId: `provider-${sent.length}` };
    }) as never,
    ...extra,
  };
}
const SETTINGS_ROW = { emailHeaderName: "IMSDA Events", emailClubHeaderName: "IMSDA Club Ministry", emailHelpEmail: "help@example.org", emailHelpPhone: null, defaultSenderEmail: "registration@imsda.org" };

describe("club invoices and every scope get the layout (#1443)", () => {
  it("gives an invoice to a club director the club header, and a billing contact the general one", async () => {
    const store = multiStore(
      [
        { id: "m1", templateKey: "INVOICE_DELIVERY", recipientKind: "CLUB_DIRECTOR" },
        { id: "m2", templateKey: "INVOICE_DELIVERY", recipientKind: "BILLING_CONTACT" },
      ],
      SETTINGS_ROW,
    );
    const sent: Array<{ html: string | null | undefined; text: string }> = [];
    await processExternalEmailQueue("event-1", { dependencies: deps(store, sent) });
    expect(sent[0].html).toMatch(/class="em-bar-name"[^>]*>IMSDA Club Ministry</);
    expect(sent[1].html).toMatch(/class="em-bar-name"[^>]*>IMSDA Events</);
  });

  it("sends the account queue's text-only rows and the sign-in code box as HTML, never null, in both scopes", async () => {
    vi.stubEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "no-reply@imsda.org");
    const store = multiStore(
      [
        { id: "a1", eventId: null, templateKey: "ATTENDEE_SIGN_IN_CODE", bodyHtmlSnapshot: null, bodyTextSnapshot: "Enter this code to finish signing in:\n\n482 913\n\nDidn't try to sign in?\nIgnore it." },
        { id: "a2", eventId: null, templateKey: "ACCOUNT_PASSWORD_RESET", bodyHtmlSnapshot: null, bodyTextSnapshot: "Hello.\n\nOpen it: http://localhost:3000/reset" },
      ],
      SETTINGS_ROW,
    );
    const sent: Array<{ html: string | null | undefined; text: string }> = [];
    await processAccountEmailQueue({
      dependencies: deps(store, sent, {
        prepareBodyText: async (input: { bodyText: string; templateKey?: string }) => (
          input.templateKey === "ATTENDEE_SIGN_IN_CODE"
            ? { bodyText: input.bodyText, codeBox: { code: "482 913", caption: "Works for 10 minutes" } }
            : { bodyText: input.bodyText }
        ),
      }),
    });
    expect(sent).toHaveLength(2);
    expect(sent[0].html).toContain(">482 913</div>");
    expect(sent[0].html).toMatch(/class="em-bar-name"[^>]*>IMSDA Club Ministry</);
    expect(sent[1].html).toContain("Button not working?");
    // Event scope too: a text-only row is no longer sent without a formatted part.
    const eventStore = multiStore([{ id: "e1", templateKey: "CUSTOM_MESSAGE", bodyHtmlSnapshot: null }], SETTINGS_ROW);
    const eventSent: Array<{ html: string | null | undefined; text: string }> = [];
    await processExternalEmailQueue("event-1", { dependencies: deps(eventStore, eventSent) });
    for (const message of [...sent, ...eventSent]) {
      expect(message.html).toBeTruthy();
      expect(message.text).toContain("\n--\nSent by ");
    }
  });
});

describe("the staff preview picks the header delivery sends (#1443)", () => {
  it("agrees for a club-registration confirmation and a club-director invoice, and for their general twins", async () => {
    const settings = { headerName: "IMSDA Events", clubHeaderName: "IMSDA Club Ministry", helpEmail: "help@example.org", helpPhone: null };
    const store = multiStore(
      [
        { id: "m1", templateKey: "REGISTRATION_CONFIRMATION_PAID", registration: { clubRegistration: { id: "c1" } } },
        { id: "m2", templateKey: "INVOICE_DELIVERY", recipientKind: "CLUB_DIRECTOR" },
        { id: "m3", templateKey: "REGISTRATION_CONFIRMATION_PAID", registration: { clubRegistration: null } },
        { id: "m4", templateKey: "INVOICE_DELIVERY", recipientKind: "BILLING_CONTACT" },
      ],
      SETTINGS_ROW,
    );
    const sent: Array<{ html: string | null | undefined; text: string }> = [];
    await processExternalEmailQueue("event-1", { dependencies: deps(store, sent, { emailLayoutSettings: settings }) });
    const previews = [
      emailPreviewLayout(settings, "REGISTRATION_CONFIRMATION_PAID", "events@example.org", "a@example.org", emailIsClubLinked({ clubRegistration: true })),
      emailPreviewLayout(settings, "INVOICE_DELIVERY", "events@example.org", "b@example.org", emailIsClubLinked({ recipientKind: "CLUB_DIRECTOR" })),
      emailPreviewLayout(settings, "REGISTRATION_CONFIRMATION_PAID", "events@example.org", "c@example.org", emailIsClubLinked({ clubRegistration: false })),
      emailPreviewLayout(settings, "INVOICE_DELIVERY", "events@example.org", "d@example.org", emailIsClubLinked({ recipientKind: "BILLING_CONTACT" })),
    ];
    expect(sent).toHaveLength(4);
    previews.forEach((preview, index) => {
      expect(sent[index].html, String(index)).toMatch(new RegExp(`class="em-bar-name"[^>]*>${preview.headerName}<`));
    });
    expect(previews.map((preview) => preview.headerName)).toEqual(["IMSDA Club Ministry", "IMSDA Club Ministry", "IMSDA Events", "IMSDA Events"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * #1680: a staff edit may send the baptism follow-up notice, only when staff ask. Synthetic data only.
 */

const state = vi.hoisted(() => ({
  moduleOn: true,
  leads: ["lead@example.test"] as string[],
  pastorEmail: "pastor@example.test" as string | null,
  ledger: [] as string[],
  clubRowFindFirst: vi.fn(),
  amendRegistration: vi.fn(),
  preview: vi.fn(),
  sendNotice: vi.fn(),
  previewNotice: vi.fn(),
  logError: vi.fn(),
  sendThrows: false,
  noticeResponses: { baptism_names: "Ava Sample, Ben Sample" } as Record<string, unknown>,
  noticeSender: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: state.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: { id: "u", email: "u@example.test", displayName: "Staff", globalRole: "SYSTEM_ADMIN" } }) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: vi.fn(async () => undefined) }));
vi.mock("@/modules/group-registrations/repository", () => ({ GroupRegistrationError: class extends Error {}, groupStaffAmendmentOptions: async () => null }));
vi.mock("@/modules/event-locations/api-errors", () => ({ isBusyDatabaseError: () => false, logExpiredTransaction: vi.fn() }));
vi.mock("@/modules/registrations/amendments-repository", () => ({
  RegistrationAmendmentError: class extends Error {},
  amendRegistration: state.amendRegistration,
  previewRegistrationAmendment: state.preview,
  currentRegistrationAnswers: async () => ({ updatedAt: "2026-10-01T00:00:00.000Z", responses: state.noticeResponses }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: class extends Error {},
  isAccountEmailConfigured: () => false,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const client = {
    clubEventRegistration: { findFirst: state.clubRowFindFirst },
    eventModule: { findUnique: async () => (state.moduleOn ? { id: "m" } : null) },
    baptismFollowUpSetting: { findUnique: async () => ({ leadEmails: state.leads }) },
    baptismFollowUp: {
      findMany: async () => state.ledger.map((normalizedName) => ({ normalizedName })),
      createManyAndReturn: async ({ data }: { data: Array<{ normalizedName: string; displayName: string }> }) => data.map(({ normalizedName, displayName }) => ({ normalizedName, displayName })),
    },
    organization: { findUnique: async () => ({ name: "Sample Club", parentOrganizationId: "church-1" }) },
    organizationContact: { findFirst: async () => (state.pastorEmail ? { email: state.pastorEmail } : null) },
    event: { findUnique: async () => ({ name: "Sample Fall Camporee", startsAt: new Date("2026-10-09T15:00:00Z"), endsAt: new Date("2026-10-11T17:00:00Z"), timezone: "America/Chicago" }) },
    messageOutbox: { create: async (args: { data: Record<string, unknown> }) => { state.noticeSender(args.data); return { id: "msg" }; } },
    $transaction: async (run: (tx: unknown) => unknown) => run(client),
  };
  return { getPrisma: () => client };
});

import { POST } from "@/app/api/events/[eventId]/registrations/[registrationId]/amendment/route";
import { BaptismNoticeOption } from "@/components/baptism-notice-option";
import { previewBaptismFollowUpNotice, sendBaptismFollowUpNoticesForStaffEdit } from "@/modules/baptism-follow-up/notice";
import { registrationAmendmentInputSchema } from "@/modules/registrations/schemas";

const body = (extra: Record<string, unknown> = {}) => ({
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  expectedUpdatedAt: "2026-10-01T00:00:00.000Z",
  responses: { baptism_names: "Ava Sample, Ben Sample" },
  attendees: [{ attendeeId: "a1", clientId: "c1", responses: {} }],
  ...(extra.previewOnly === false ? { quoteFingerprint: "f".repeat(64) } : {}),
  ...extra,
});
const post = (extra: Record<string, unknown>) => POST(new Request("https://events.imsda.test/x", { method: "POST", headers: { "content-type": "application/json", origin: "https://events.imsda.test" }, body: JSON.stringify(body(extra)) }), { params: Promise.resolve({ eventId: "event-1", registrationId: "reg-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { moduleOn: true, leads: ["lead@example.test"], pastorEmail: "pastor@example.test", ledger: [], noticeResponses: { baptism_names: "Ava Sample, Ben Sample" } });
  state.clubRowFindFirst.mockResolvedValue({ organizationId: "club-from-registration" });
  state.amendRegistration.mockResolvedValue({ pendingMessageIds: [], registration: { id: "reg-1" } });
  state.preview.mockResolvedValue({ quoteFingerprint: "x".repeat(64), totalCents: 0 });
});

describe("the amendment request flag (#1680)", () => {
  it("is optional, and absent means no send", () => {
    const parsed = registrationAmendmentInputSchema.parse(body({ previewOnly: false }));
    expect(parsed.sendBaptismFollowUp).toBeUndefined();
    expect(registrationAmendmentInputSchema.parse(body({ sendBaptismFollowUp: true })).sendBaptismFollowUp).toBe(true);
    expect(() => registrationAmendmentInputSchema.parse(body({ sendBaptismFollowUp: "yes" }))).toThrow();
  });
});

describe("the staff edit route (#1680)", () => {
  it("sends nothing when the flag is absent or false", async () => {
    expect((await post({ previewOnly: false })).status).toBe(200);
    expect((await post({ previewOnly: false, sendBaptismFollowUp: false })).status).toBe(200);
    expect(state.noticeSender).not.toHaveBeenCalled();
    expect(state.clubRowFindFirst).not.toHaveBeenCalled();
  });

  it("sends through the same path when true and there are new names, to the lead and the pastor", async () => {
    expect((await post({ previewOnly: false, sendBaptismFollowUp: true })).status).toBe(200);
    expect(state.noticeSender.mock.calls.map((call) => (call[0] as { recipientEmail: string }).recipientEmail)).toEqual(["lead@example.test", "pastor@example.test"]);
    expect(state.noticeSender.mock.calls.every((call) => (call[0] as { templateKey: string }).templateKey === "BAPTISM_FOLLOW_UP")).toBe(true);
  });

  it("sends nothing when true but there are no new names, or the module is off", async () => {
    state.ledger = ["ava sample", "ben sample"];
    await post({ previewOnly: false, sendBaptismFollowUp: true });
    expect(state.noticeSender).not.toHaveBeenCalled();
    state.ledger = [];
    state.moduleOn = false;
    await post({ previewOnly: false, sendBaptismFollowUp: true });
    expect(state.noticeSender).not.toHaveBeenCalled();
  });

  it("never sends on a preview, even with the flag", async () => {
    await post({ previewOnly: true, sendBaptismFollowUp: true });
    expect(state.noticeSender).not.toHaveBeenCalled();
  });

  it("does not fail the amendment when sending breaks", async () => {
    state.clubRowFindFirst.mockRejectedValue(new Error("db down"));
    expect((await post({ previewOnly: false, sendBaptismFollowUp: true })).status).toBe(200);
    expect(state.logError).toHaveBeenCalled();
  });

  it("takes the club from the registration, never from the request", async () => {
    // A request cannot carry an organization id: the schema is strict.
    expect((await post({ previewOnly: false, sendBaptismFollowUp: true, organizationId: "club-from-request" })).status).toBe(400);
    await post({ previewOnly: false, sendBaptismFollowUp: true });
    expect(state.clubRowFindFirst).toHaveBeenCalledWith({ where: { registrationId: "reg-1", eventId: "event-1" }, select: { organizationId: true } });
    await sendBaptismFollowUpNoticesForStaffEdit({ eventId: "event-1", registrationId: "reg-1" });
    const idempotencyKeys = state.noticeSender.mock.calls.map((call) => String((call[0] as { idempotencyKey: string }).idempotencyKey));
    expect(idempotencyKeys.every((key) => key.includes(":club-from-registration:"))).toBe(true);
  });

  it("adds the offer to the preview only when new names would be sent, with roles and no address", async () => {
    const offered = await (await post({ previewOnly: true })).json() as { preview: { baptismFollowUp?: unknown } };
    expect(offered.preview.baptismFollowUp).toEqual({ names: 2, recipients: ["lead", "pastor"] });
    expect(JSON.stringify(offered)).not.toContain("@");
    state.pastorEmail = null;
    expect(((await (await post({ previewOnly: true })).json()) as { preview: { baptismFollowUp?: unknown } }).preview.baptismFollowUp).toEqual({ names: 2, recipients: ["lead"] });
    for (const off of [() => { state.moduleOn = false; }, () => { state.moduleOn = true; state.leads = []; }, () => { state.leads = ["lead@example.test"]; state.ledger = ["ava sample", "ben sample"]; }]) {
      off();
      expect(await previewBaptismFollowUpNotice({ eventId: "event-1", registrationId: "reg-1", responses: { baptism_names: "Ava Sample, Ben Sample" } })).toBeNull();
    }
  });

  it("offers nothing for a registration that is not a club's", async () => {
    state.clubRowFindFirst.mockResolvedValue(null);
    expect(await previewBaptismFollowUpNotice({ eventId: "event-1", registrationId: "reg-1", responses: { baptism_names: "Ava Sample" } })).toBeNull();
  });
});

describe("the checkbox (#1680)", () => {
  const render = (offer: Parameters<typeof BaptismNoticeOption>[0]["offer"]) => renderToStaticMarkup(createElement(BaptismNoticeOption, { offer, checked: false, disabled: false, onChange: () => undefined }));

  it("is not shown unless the review offers it", () => {
    expect(render(undefined)).toBe("");
  });

  it("is a real labelled checkbox, unchecked, naming who gets the notice", () => {
    const html = render({ names: 1, recipients: ["lead", "pastor"] });
    expect(html).toContain('<label class="checkbox-row" for="amendment-send-baptism">');
    expect(html).toContain('id="amendment-send-baptism"');
    expect(html).not.toContain("checked");
    expect(html).toContain("event lead and the club&#x27;s church pastor");
    expect(render({ names: 2, recipients: ["lead"] })).toContain("event lead only; no pastor is on file");
  });
});

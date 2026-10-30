import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConfiguration } from "@/modules/event-clones/domain";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), loadSourceConfiguration: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/event-clones/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/event-clones/repository")>("@/modules/event-clones/repository");
  return { ...actual, loadSourceConfiguration: mocks.loadSourceConfiguration, appOrigins: () => ["https://events.imsda.test"] };
});

import { previewTemplateFromEvent, saveTemplateFromEvent } from "@/modules/event-templates/from-event-repository";
import { EventTemplateOperationError } from "@/modules/event-templates/repository";
import { saveTemplateRequestInputOf, saveTemplateFromEventInputSchema } from "@/modules/event-templates/from-event-domain";
import { eventTemplatePayloadSchema } from "@/modules/event-templates/domain";
import { operationalReportKinds } from "@/modules/reporting/operational-reports";

const SECRET = "SYNTHETICTOKEN0123456789";

function config(overrides: Partial<SourceConfiguration> = {}): SourceConfiguration {
  return {
    event: { id: "event-src", name: "Synthetic Retreat 2027", slug: "synthetic-retreat-2027", startsOn: "2027-05-05", endsOn: "2027-05-07", isPublished: true },
    eventDetails: {
      location: null, timezone: "America/Chicago", publicInfoUrl: null, supportContact: null, tagline: null, subtitle: null, helpEmail: null, refundPolicy: null, calendarCategory: null, showOnCalendar: false,
      hotelName: null, hotelBookingUrl: null, hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null,
      audience: "GENERAL", billingMode: "ATTENDEE_PAY",
    },
    moduleToggles: { waitlistEnabled: false, autoPromoteWaitlist: false, collectsShirtSizes: false, checksAdultBackgrounds: false, community: null },
    contentSections: [],
    registrationForms: [], formsWithoutPublishedVersion: 0,
    attendeeTypes: [{ code: "ADULT", label: "Adult", description: "", sortOrder: 0, isActive: true, minimumAge: 18, maximumAge: null }],
    attendeeClassifications: [],
    messageTemplates: [{ key: "EVENT_ANNOUNCEMENT", isEnabled: true, versionId: "mv-1", versionNumber: 1, subjectTemplate: "News", bodyTemplate: `Hi. ${`https://events.imsda.test/manage/${SECRET}`}` }],
    messageTemplatesWithoutPublishedVersion: 0,
    tags: [], promoCodes: [], honorSessions: [], honorOfferings: [], locations: [],
    unsupported: { merchandiseProducts: 0, paymentInstructionVersions: 0, messageDeliverySettings: 0, uploadedFiles: 0 },
    ...overrides,
  };
}

const loadedAt = new Date("2027-01-01T00:00:00.000Z");
const newVersionInput = { sourceEventId: "event-src", releaseNote: "Reviewed after the 2027 retreat.", requestKey: "idempotency-key-0001", target: { mode: "NEW_VERSION" as const, templateId: "template-1" } };

function versionRow(overrides: Partial<{ versionNumber: number; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; payload: unknown }> = {}) {
  return { id: `v${overrides.versionNumber ?? 1}`, templateId: "template-1", versionNumber: overrides.versionNumber ?? 1, status: overrides.status ?? "PUBLISHED", payload: overrides.payload ?? eventTemplatePayloadSchema.parse({ audience: "GENERAL" }), updatedAt: loadedAt };
}

/** A mocked client wired the way `saveTemplateFromEvent` and the `getEventTemplate` read-back use theirs. */
function mockSave(options: { templateStatus?: "DRAFT" | "PUBLISHED" | "ARCHIVED" | null; versions?: ReturnType<typeof versionRow>[]; existingSource?: unknown } = {}) {
  const templateStatus = options.templateStatus === undefined ? "PUBLISHED" : options.templateStatus;
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn()
      .mockResolvedValueOnce(templateStatus ? [{ status: templateStatus }] : [])
      .mockResolvedValue([{ id: "event-src" }]),
    eventTemplate: {
      create: vi.fn().mockResolvedValue({ id: "template-new", name: "New Template", versions: [{ id: "version-new" }] }),
      update: vi.fn().mockResolvedValue({ name: "Weekend Retreat" }),
    },
    eventTemplateVersion: {
      findMany: vi.fn().mockResolvedValue(options.versions ?? [versionRow()]),
      create: vi.fn().mockResolvedValue({ id: "version-2" }),
      update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(),
    },
    eventTemplateVersionSource: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    event: { findUnique: vi.fn().mockResolvedValue({ generalRegistrationLinkEnabled: false }) },
  };
  const prisma = {
    eventTemplateVersionSource: { findUnique: vi.fn().mockResolvedValue(options.existingSource ?? null) },
    eventTemplate: { findUnique: vi.fn().mockResolvedValue({ id: "template-1", name: "Weekend Retreat", description: "", status: "PUBLISHED", createdAt: loadedAt, updatedAt: loadedAt, createdBy: { displayName: "A" }, versions: [] }) },
    event: { findUnique: vi.fn().mockResolvedValue({ generalRegistrationLinkEnabled: false }) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx };
}

async function freshFingerprint() {
  mocks.getPrisma.mockReturnValue(mockSave().prisma);
  return (await previewTemplateFromEvent({ sourceEventId: "event-src" })).fingerprint;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadSourceConfiguration.mockImplementation(async () => config());
});

describe("previewTemplateFromEvent (#154)", () => {
  it("shows what is copied and excluded, with a fingerprint, and never the token", async () => {
    mocks.getPrisma.mockReturnValue(mockSave().prisma);
    const preview = await previewTemplateFromEvent({ sourceEventId: "event-src" });
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.domains.find((domain) => domain.key === "attendeeTypes")!.count).toBe(1);
    expect(preview.exclusions.length).toBeGreaterThan(10);
    expect(JSON.stringify(preview)).not.toContain(SECRET);
  });

  it("reports a missing event and rejects unknown input keys", async () => {
    mocks.getPrisma.mockReturnValue(mockSave().prisma);
    mocks.loadSourceConfiguration.mockResolvedValue(null);
    await expect(previewTemplateFromEvent({ sourceEventId: "missing" })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    await expect(previewTemplateFromEvent({ sourceEventId: "x", extra: true })).rejects.toThrow();
  });

  it("changes the fingerprint when what would be copied changes", async () => {
    const first = await freshFingerprint();
    mocks.loadSourceConfiguration.mockImplementation(async () => config({ attendeeTypes: [] }));
    expect(await freshFingerprint()).not.toBe(first);
  });
});

describe("fingerprint and kept settings (#154)", () => {
  it("changes when the event's dates change, because the day offsets depend on them", async () => {
    const first = await freshFingerprint();
    mocks.loadSourceConfiguration.mockImplementation(async () => config({ event: { ...config().event, startsOn: "2027-05-06" } }));
    expect(await freshFingerprint()).not.toBe(first);
    mocks.loadSourceConfiguration.mockImplementation(async () => config({ event: { ...config().event, endsOn: "2027-05-09" } }));
    expect(await freshFingerprint()).not.toBe(first);
  });

  it("keeps reportSelections, formTemplateKeys, registrationClosesOn and starterKey in a new version", async () => {
    const fingerprint = await freshFingerprint();
    const existing = eventTemplatePayloadSchema.parse({
      starterKey: "fall_camporee", audience: "GENERAL", formTemplateKeys: ["simple_rsvp"], reportSelections: [operationalReportKinds[0]], registrationClosesOn: "2027-04-01",
    });
    const { prisma, tx } = mockSave({ versions: [versionRow({ payload: existing })] });
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint });
    const saved = eventTemplatePayloadSchema.parse(tx.eventTemplateVersion.create.mock.calls[0]![0].data.payload);
    expect(saved).toMatchObject({ starterKey: "fall_camporee", formTemplateKeys: ["simple_rsvp"], reportSelections: [operationalReportKinds[0]], registrationClosesOn: "2027-04-01" });
    expect(result.kept.map((entry) => entry.key).sort()).toEqual(["formTemplateKeys", "registrationClosesOn", "reportSelections", "starterKey"]);
    const stored = JSON.stringify(tx.eventTemplateVersionSource.create.mock.calls[0]![0].data.exclusions);
    expect(stored).not.toContain(SECRET);
    expect(JSON.parse(stored).every((entry: object) => Object.keys(entry).every((key) => ["key", "count", "links"].includes(key)))).toBe(true);
  });
});

describe("saveTemplateFromEvent (#154)", () => {
  it("saves a new DRAFT version, leaving the published one untouched, with provenance, actor and an ids-and-counts audit", async () => {
    const fingerprint = await freshFingerprint();
    const { prisma, tx } = mockSave();
    mocks.getPrisma.mockReturnValue(prisma);

    const result = await saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint });

    expect(result).toMatchObject({ versionId: "version-2", versionNumber: 2, alreadySaved: false });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.eventTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ templateId: "template-1", createdByUserId: "usr_actor", versionNumber: 2, status: "DRAFT" }),
      select: { id: true },
    });
    for (const method of [tx.eventTemplateVersion.update, tx.eventTemplateVersion.updateMany, tx.eventTemplateVersion.delete]) expect(method).not.toHaveBeenCalled();
    const payload = tx.eventTemplateVersion.create.mock.calls[0]![0].data.payload;
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toContain("event-src");
    expect(tx.eventTemplateVersionSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateVersionId: "version-2", sourceEventId: "event-src", sourceEventName: "Synthetic Retreat 2027", actorUserId: "usr_actor",
        releaseNote: "Reviewed after the 2027 retreat.", requestKey: "idempotency-key-0001",
        provenance: expect.objectContaining({ fingerprint, messageTemplates: [{ key: "EVENT_ANNOUNCEMENT", versionId: "mv-1", versionNumber: 1 }] }),
      }),
    });
    const audit = tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ action: "EVENT_TEMPLATE_SAVED_FROM_EVENT", actorUserId: "usr_actor", entityId: "template-1" });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(JSON.stringify(audit)).not.toContain("News");
  });

  it("creates a new template with draft version 1", async () => {
    const fingerprint = await freshFingerprint();
    const { prisma, tx } = mockSave();
    mocks.getPrisma.mockReturnValue(prisma);
    await saveTemplateFromEvent("usr_actor", { sourceEventId: "event-src", fingerprint, releaseNote: "First save.", requestKey: "idempotency-key-0002", target: { mode: "NEW", name: "New Template", description: "" } });
    expect(tx.eventTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "New Template", createdByUserId: "usr_actor", versions: { create: expect.objectContaining({ versionNumber: 1, status: "DRAFT" }) } }),
    }));
    expect(tx.eventTemplateVersionSource.create).toHaveBeenCalledWith({ data: expect.objectContaining({ templateVersionId: "version-new" }) });
  });

  it("returns the earlier version for the same key and input, without a second version", async () => {
    const fingerprint = await freshFingerprint();
    const input = saveTemplateFromEventInputSchema.parse({ ...newVersionInput, fingerprint });
    const { prisma, tx } = mockSave({
      existingSource: { requestInput: saveTemplateRequestInputOf(input), templateVersion: { id: "version-2", templateId: "template-1", versionNumber: 2 } },
    });
    mocks.getPrisma.mockReturnValue(prisma);
    const result = await saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint });
    expect(result).toMatchObject({ alreadySaved: true, versionId: "version-2", versionNumber: 2 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.eventTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("refuses the same key with different input", async () => {
    const fingerprint = await freshFingerprint();
    const original = saveTemplateFromEventInputSchema.parse({ ...newVersionInput, fingerprint });
    const { prisma, tx } = mockSave({
      existingSource: { requestInput: saveTemplateRequestInputOf(original), templateVersion: { id: "version-2", templateId: "template-1", versionNumber: 2 } },
    });
    mocks.getPrisma.mockReturnValue(prisma);
    await expect(saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint, releaseNote: "A different reason." }))
      .rejects.toMatchObject({ code: "REQUEST_KEY_REUSED" });
    expect(tx.eventTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("returns the racing request's version when a unique index fires first", async () => {
    const fingerprint = await freshFingerprint();
    const input = saveTemplateFromEventInputSchema.parse({ ...newVersionInput, fingerprint });
    const { prisma, tx } = mockSave();
    tx.eventTemplateVersionSource.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    prisma.eventTemplateVersionSource.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ requestInput: saveTemplateRequestInputOf(input), templateVersion: { id: "version-2", templateId: "template-1", versionNumber: 2 } });
    mocks.getPrisma.mockReturnValue(prisma);
    expect(await saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint })).toMatchObject({ alreadySaved: true, versionNumber: 2 });
  });

  it("refuses a stale preview and writes nothing", async () => {
    const fingerprint = await freshFingerprint();
    mocks.loadSourceConfiguration.mockImplementation(async () => config({ attendeeTypes: [] }));
    const { prisma, tx } = mockSave();
    mocks.getPrisma.mockReturnValue(prisma);
    await expect(saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(tx.eventTemplateVersion.create).not.toHaveBeenCalled();
    expect(tx.eventTemplateVersionSource.create).not.toHaveBeenCalled();
  });

  it("refuses an archived template, and an existing draft (never overwritten)", async () => {
    const fingerprint = await freshFingerprint();
    const archived = mockSave({ templateStatus: "ARCHIVED" });
    mocks.getPrisma.mockReturnValue(archived.prisma);
    await expect(saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint })).rejects.toMatchObject({ code: "TEMPLATE_ARCHIVED" });

    const drafted = mockSave({ versions: [versionRow({ versionNumber: 2, status: "DRAFT" }), versionRow({ versionNumber: 1, status: "PUBLISHED" })] });
    mocks.getPrisma.mockReturnValue(drafted.prisma);
    const error = await saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EventTemplateOperationError);
    expect(error).toMatchObject({ code: "DRAFT_EXISTS", message: expect.stringContaining("edit it in the template editor first") });
    expect(drafted.tx.eventTemplateVersion.create).not.toHaveBeenCalled();
    expect(drafted.tx.eventTemplateVersion.update).not.toHaveBeenCalled();
  });

  it("refuses a template for another audience", async () => {
    const fingerprint = await freshFingerprint();
    const club = mockSave({ versions: [versionRow({ payload: eventTemplatePayloadSchema.parse({ audience: "CLUB" }) })] });
    mocks.getPrisma.mockReturnValue(club.prisma);
    await expect(saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint })).rejects.toMatchObject({ code: "AUDIENCE_MISMATCH" });
    expect(club.tx.eventTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown template, a missing source and a missing release note", async () => {
    const fingerprint = await freshFingerprint();
    mocks.getPrisma.mockReturnValue(mockSave({ templateStatus: null }).prisma);
    await expect(saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint })).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    const noSource = mockSave();
    noSource.tx.$queryRaw.mockReset().mockResolvedValueOnce([{ status: "PUBLISHED" }]).mockResolvedValue([]);
    mocks.getPrisma.mockReturnValue(noSource.prisma);
    await expect(saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    await expect(saveTemplateFromEvent("usr_actor", { ...newVersionInput, fingerprint, releaseNote: "  " })).rejects.toThrow();
  });
});

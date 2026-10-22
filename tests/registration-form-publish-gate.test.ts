import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  listActiveAttendeeTypes: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/attendee-types/repository", () => ({
  listActiveAttendeeTypes: dependencies.listActiveAttendeeTypes,
}));

import { ACKNOWLEDGMENT_PLACEHOLDER_TEXT, formTemplates, getFormTemplate } from "@/modules/forms/definition";
import {
  FormOperationError,
  publishRegistrationForm,
} from "@/modules/forms/repository";

const definition = formTemplates[0].definition;

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-2",
    formId: "form-1",
    versionNumber: 2,
    status: "DRAFT",
    definition,
    publishedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdBy: { displayName: "Caleb Durant" },
    testSubmissions: [],
    _count: { testSubmissions: 0 },
    ...overrides,
  };
}

function transactionClient(previouslyPublishedCount: number, validTests: number) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    eventMealPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    registrationForm: {
      findFirst: vi.fn().mockResolvedValue({
        id: "form-1",
        eventId: "event-1",
        name: "Retreat registration",
        versions: [
          version(),
          ...(previouslyPublishedCount > 0
            ? [version({ id: "version-1", versionNumber: 1, status: "ARCHIVED", publishedAt: new Date("2026-07-01T00:00:00.000Z") })]
            : []),
        ],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    registrationFormVersion: {
      count: vi.fn().mockResolvedValue(previouslyPublishedCount),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    formTestSubmission: {
      count: vi.fn().mockResolvedValue(validTests),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function prismaFor(tx: ReturnType<typeof transactionClient>) {
  return {
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    registrationForm: {
      findFirst: vi.fn().mockResolvedValue({
        id: "form-1",
        eventId: "event-1",
        name: "Retreat registration",
        slug: "retreat-registration",
        status: "PUBLISHED",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        createdBy: { displayName: "Caleb Durant" },
        versions: [version({ status: "PUBLISHED", publishedAt: new Date("2026-08-02T00:00:00.000Z") })],
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.listActiveAttendeeTypes.mockResolvedValue([]);
});

describe("registration form publish gate", () => {
  it("refuses to publish a draft whose meal ticket prices differ from the meal plan, and publishes once they match (#210)", async () => {
    const campMeeting = getFormTemplate("camp_meeting_export")!.definition;
    const stale = transactionClient(0, 1);
    stale.eventMealPlan.findFirst.mockResolvedValue({ prices: [{ mealType: "BREAKFAST", ageGroup: "ADULT", amountCents: 750 }] });
    stale.registrationForm.findFirst.mockResolvedValue({ id: "form-1", eventId: "event-1", name: "Camp Meeting", versions: [version({ definition: campMeeting })] });
    dependencies.getPrisma.mockReturnValue(prismaFor(stale));
    await expect(publishRegistrationForm("event-1", "form-1", "user-1")).rejects.toMatchObject({ code: "MEAL_PRICE_DRIFT" });
    expect(stale.registrationFormVersion.updateMany).not.toHaveBeenCalled();

    const current = transactionClient(0, 1);
    current.eventMealPlan.findFirst.mockResolvedValue({ prices: [{ mealType: "BREAKFAST", ageGroup: "ADULT", amountCents: 700 }] });
    current.registrationForm.findFirst.mockResolvedValue({ id: "form-1", eventId: "event-1", name: "Camp Meeting", versions: [version({ definition: campMeeting })] });
    dependencies.getPrisma.mockReturnValue(prismaFor(current));
    await publishRegistrationForm("event-1", "form-1", "user-1");
    expect(current.registrationFormVersion.updateMany).toHaveBeenCalled();
  });

  it("refuses to publish while an acknowledgment still has the placeholder wording, naming the field, and allows it once reworded (#1065)", async () => {
    const withAcknowledgment = (text: string) => {
      const next = structuredClone(definition);
      next.sections[0]!.fields.push({
        id: "field_placeholder_ack", key: "placeholder_ack", label: "Synthetic acknowledgment", helpText: "", type: "ACKNOWLEDGMENT", scope: "REGISTRATION",
        required: true, options: [], acknowledgment: { source: "TEXT", text },
      });
      return next;
    };
    const placeholder = transactionClient(1, 0);
    placeholder.registrationForm.findFirst.mockResolvedValue({ id: "form-1", eventId: "event-1", name: "Form", versions: [version({ definition: withAcknowledgment(ACKNOWLEDGMENT_PLACEHOLDER_TEXT) })] });
    dependencies.getPrisma.mockReturnValue(prismaFor(placeholder));
    await expect(publishRegistrationForm("event-1", "form-1", "user-1")).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_PLACEHOLDER", message: "Write the acknowledgment statement for: Synthetic acknowledgment." });
    expect(placeholder.registrationFormVersion.updateMany).not.toHaveBeenCalled();

    const reworded = transactionClient(0, 1);
    reworded.registrationForm.findFirst.mockResolvedValue({ id: "form-1", eventId: "event-1", name: "Form", versions: [version({ definition: withAcknowledgment("I have read and agree to the synthetic rules.") })] });
    dependencies.getPrisma.mockReturnValue(prismaFor(reworded));
    await publishRegistrationForm("event-1", "form-1", "user-1");
    expect(reworded.registrationFormVersion.updateMany).toHaveBeenCalled();
  });

  it("requires a valid test submission for a form's first published version", async () => {
    const tx = transactionClient(0, 0);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));

    await expect(
      publishRegistrationForm("event-1", "form-1", "user-1"),
    ).rejects.toMatchObject({ code: "TEST_REQUIRED" });
    expect(tx.registrationFormVersion.updateMany).not.toHaveBeenCalled();
  });

  it("publishes the first version once a valid test exists", async () => {
    const tx = transactionClient(0, 1);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));

    await publishRegistrationForm("event-1", "form-1", "user-1");

    expect(tx.registrationFormVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "version-2", status: "DRAFT" }) }),
    );
  });

  it("publishes a later draft without a test once an earlier version was published or archived (#1061)", async () => {
    const tx = transactionClient(1, 0);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));

    await publishRegistrationForm("event-1", "form-1", "user-1");

    expect(tx.formTestSubmission.count).not.toHaveBeenCalled();
    expect(tx.registrationFormVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ARCHIVED" } }),
    );
    expect(tx.registrationFormVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "version-2", status: "DRAFT" }) }),
    );
  });

  it("treats a form whose only earlier version is the live published one as already published (#1061)", async () => {
    const tx = transactionClient(0, 0);
    tx.registrationForm.findFirst.mockResolvedValue({
      id: "form-1",
      eventId: "event-1",
      name: "Retreat registration",
      versions: [version(), version({ id: "version-1", versionNumber: 1, status: "PUBLISHED", publishedAt: new Date("2026-07-01T00:00:00.000Z") })],
    });
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));

    await publishRegistrationForm("event-1", "form-1", "user-1");

    expect(tx.formTestSubmission.count).not.toHaveBeenCalled();
  });

  it("checks the first publish's test against the draft itself", async () => {
    const tx = transactionClient(0, 1);
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));

    await publishRegistrationForm("event-1", "form-1", "user-1");

    expect(tx.formTestSubmission.count).toHaveBeenCalledWith({
      where: { formVersionId: "version-2", isValid: true },
    });
  });

  it("refuses to publish when the draft changed after the test count (stale test)", async () => {
    const tx = transactionClient(1, 1);
    tx.registrationFormVersion.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));

    await expect(
      publishRegistrationForm("event-1", "form-1", "user-1"),
    ).rejects.toMatchObject({ code: "EDIT_CONFLICT" });
    expect(tx.registrationForm.update).not.toHaveBeenCalled();
  });

  it("still refuses a form with no draft version", async () => {
    const tx = transactionClient(1, 0);
    tx.registrationForm.findFirst.mockResolvedValue({
      id: "form-1",
      eventId: "event-1",
      name: "Retreat registration",
      versions: [version({ status: "PUBLISHED", publishedAt: new Date() })],
    });
    dependencies.getPrisma.mockReturnValue(prismaFor(tx));

    await expect(
      publishRegistrationForm("event-1", "form-1", "user-1"),
    ).rejects.toBeInstanceOf(FormOperationError);
  });
});

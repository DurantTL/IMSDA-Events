import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/communications/transactional-messages", () => ({
  enqueueRegistrationUpdatedMessage: vi.fn().mockResolvedValue({ pendingMessageIds: [] }),
}));

import { updateTieredRegistrationAnswersWithClient } from "@/modules/attendee-accounts/answer-update-repository";

const field = (key: string, label: string, type: string) => ({
  id: `f_${key}`, key, label, type, helpText: "", scope: "ATTENDEE", required: false, options: [] as string[],
});
const definition = {
  title: "Typed audit fixture",
  description: "",
  confirmationMessage: "Received.",
  sections: [{
    id: "details_section",
    title: "Details",
    description: "",
    fields: [
      field("cell_phone", "Cell phone", "PHONE"),
      field("contact_email", "Contact email", "EMAIL"),
      field("arrival_date", "Arrival date", "DATE"),
    ],
  }],
};

describe("typed answers stay out of the audit record (#1198)", () => {
  it("keeps phone, email and date values out of audit metadata and still replays", async () => {
    const attendee = {
      id: "attendee-1",
      formResponses: { cell_phone: "(515) 555-0100", contact_email: "old@example.test", arrival_date: "2026-07-01" } as Record<string, unknown>,
      profileSnapshot: { firstName: "Test", lastName: "Guest" },
      person: { firstName: "Test", lastName: "Person" },
    };
    const registration = {
      id: "registration-1",
      eventId: "event-1",
      confirmationCode: "REG-TEST",
      updatedAt: new Date("2026-07-30T10:00:00.000Z"),
      event: { attendeeEditPolicy: "TIERED", timezone: "America/Chicago", seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false },
      publicFormSubmission: { responses: {}, formVersionId: "v1", formVersion: { definition, formId: "form-1" } },
      attendees: [attendee],
    };
    const tx = {
      clubEventRegistration: { findUnique: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: registration.id }]),
      registration: { findFirst: vi.fn().mockResolvedValue(registration), update: vi.fn().mockResolvedValue({}) },
      registrationAttendee: {
        update: vi.fn().mockImplementation(async ({ data }: { data: { formResponses: Record<string, unknown> } }) => {
          attendee.formResponses = data.formResponses;
          return {};
        }),
      },
      programAssignmentRun: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      programAttendeeAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    };
    const input = {
      notifyApprovers: false,
      registrationId: registration.id,
      clientRequestId: "5d1f0e7e-7f0a-4c5d-9d57-0a3a2d9f1c11",
      expectedUpdatedAt: registration.updatedAt.toISOString(),
      attendees: [{
        attendeeId: "attendee-1",
        responses: { cell_phone: "515.555.0199", contact_email: "new@example.test", arrival_date: "2026-07-04" },
      }],
      now: new Date("2026-07-30T11:00:00.000Z"),
      audit: { action: "PRIVATE_LINK_ANSWERS_UPDATED", summary: () => "Private choices changed.", metadata: { source: "PRIVATE_MANAGE_LINK" } },
    };
    const first = await updateTieredRegistrationAnswersWithClient(tx as never, input);
    expect(first!.attendees[0]!.responses.cell_phone).toBe("(515) 555-0199");

    const metadata = tx.auditLog.create.mock.calls[0]![0].data.metadata;
    const text = JSON.stringify(metadata);
    for (const value of ["555-0199", "555-0100", "new@example.test", "old@example.test", "2026-07-04", "2026-07-01"]) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain("(changed)");

    tx.auditLog.findFirst.mockResolvedValue({ metadata });
    const retried = await updateTieredRegistrationAnswersWithClient(tx as never, input);
    expect(retried!.attendees).toEqual(first!.attendees);
    expect(tx.registrationAttendee.update).toHaveBeenCalledOnce();
  });
});

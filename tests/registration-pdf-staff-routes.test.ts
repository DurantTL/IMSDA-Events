import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, AttendeeOperationError, OperationError } = vi.hoisted(() => {
  class AttendeeError extends Error {
    constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
      super(message);
    }
  }
  class OpError extends Error {
    constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
      super(message);
    }
  }
  return {
    AttendeeOperationError: AttendeeError,
    OperationError: OpError,
    mocks: {
      requirePermission: vi.fn(),
      addRegistrationAttendee: vi.fn(),
      updateRegistrationAttendeeEmail: vi.fn(),
      substituteRegistrationAttendee: vi.fn(),
      finishRegistrationChange: vi.fn(),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/authorization", () => ({
  AccessDeniedError: class extends Error {},
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn().mockResolvedValue({}) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/registrations/repository", () => ({
  RegistrationAttendeeOperationError: AttendeeOperationError,
  addRegistrationAttendee: mocks.addRegistrationAttendee,
  updateRegistrationAttendeeEmail: mocks.updateRegistrationAttendeeEmail,
}));
vi.mock("@/modules/registrations/operations-repository", () => ({
  RegistrationOperationError: OperationError,
  substituteRegistrationAttendee: mocks.substituteRegistrationAttendee,
}));
vi.mock("@/modules/communications/messaging-repository", () => ({
  ensureEventMessagingDefaults: vi.fn(),
  processQueuedMessageIdsAfterCommit: vi.fn(),
}));
vi.mock("@/modules/club-teams/errors", () => ({ ClubTeamError: class extends Error {}, clubTeamErrorStatus: () => 409 }));
vi.mock("@/modules/registration-pdf/after-commit", () => ({ finishRegistrationChange: mocks.finishRegistrationChange }));

import { POST as addAttendee } from "@/app/api/events/[eventId]/registrations/[registrationId]/attendees/route";
import { PATCH as editAttendee } from "@/app/api/events/[eventId]/registrations/[registrationId]/attendees/[attendeeId]/route";
import { POST as substitute } from "@/app/api/events/[eventId]/registrations/[registrationId]/attendees/[attendeeId]/substitution/route";

/** The staff routes that change a registration announce it with the new PDF only after a saved change (#1082). */

const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = (body: unknown) => new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const base = { eventId: "event-1", registrationId: "registration-1" };
const withAttendee = { params: Promise.resolve({ ...base, attendeeId: "attendee-1" }) };
const withoutAttendee = { params: Promise.resolve(base) };
const newPerson = { firstName: "Casey", lastName: "Demo", email: "casey@example.test" };
const substitution = { firstName: "Blake", lastName: "Sample", email: "blake@example.test", phone: "", reason: "", clientRequestId: "6f1d3c6e-1c0e-4b7b-9a53-0a1f0f5d9a10" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ user: { id: "staff-1", displayName: "Staff" } });
  mocks.addRegistrationAttendee.mockResolvedValue({ id: "registration-1" });
  mocks.updateRegistrationAttendeeEmail.mockResolvedValue({ id: "registration-1" });
  mocks.substituteRegistrationAttendee.mockResolvedValue({ pendingMessageIds: [], response: { operation: { id: "operation-9" } } });
});

describe("add attendee (#1082)", () => {
  it("announces the change after the person is saved, as a meaningful change", async () => {
    const response = await addAttendee(json(newPerson), withoutAttendee);
    expect(response.status).toBe(201);
    expect(mocks.finishRegistrationChange).toHaveBeenCalledOnce();
    expect(mocks.finishRegistrationChange).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", registrationId: "registration-1", meaningful: true }));
    expect(mocks.addRegistrationAttendee.mock.invocationCallOrder[0]!).toBeLessThan(mocks.finishRegistrationChange.mock.invocationCallOrder[0]!);
  });

  it("announces nothing on a 400 or a 404", async () => {
    expect((await addAttendee(json({ firstName: "", lastName: "" }), withoutAttendee)).status).toBe(400);
    mocks.addRegistrationAttendee.mockRejectedValueOnce(new AttendeeOperationError("REGISTRATION_NOT_FOUND", "No."));
    expect((await addAttendee(json(newPerson), withoutAttendee)).status).toBe(404);
    expect(mocks.finishRegistrationChange).not.toHaveBeenCalled();
  });
});

describe("attendee email edit (#1082)", () => {
  it("hands the change over as not meaningful (the PDF does not show emails), only after the save", async () => {
    const response = await editAttendee(patch({ email: "new@example.test" }), withAttendee);
    expect(response.status).toBe(200);
    expect(mocks.finishRegistrationChange).toHaveBeenCalledWith(expect.objectContaining({ registrationId: "registration-1", meaningful: false }));
  });

  it("announces nothing on a 400 or a 404", async () => {
    expect((await editAttendee(patch({ email: "not-an-email" }), withAttendee)).status).toBe(400);
    mocks.updateRegistrationAttendeeEmail.mockRejectedValueOnce(new AttendeeOperationError("ATTENDEE_NOT_FOUND", "No."));
    expect((await editAttendee(patch({ email: "new@example.test" }), withAttendee)).status).toBe(404);
    expect(mocks.finishRegistrationChange).not.toHaveBeenCalled();
  });
});

describe("substitution (#1082)", () => {
  it("announces after the swap, as a meaningful change, keyed by stable ids so a replay is the same change", async () => {
    expect((await substitute(json(substitution), withAttendee)).status).toBe(200);
    expect(mocks.finishRegistrationChange).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      registrationId: "registration-1",
      meaningful: true,
      changeKey: "staff-substitution:registration-1:attendee-1:operation-9",
    }));
    await substitute(json(substitution), withAttendee);
    const keys = mocks.finishRegistrationChange.mock.calls.map(([call]) => call.changeKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("announces nothing on a 400 or a 404", async () => {
    expect((await substitute(json({ firstName: "" }), withAttendee)).status).toBe(400);
    mocks.substituteRegistrationAttendee.mockRejectedValueOnce(new OperationError("ATTENDEE_NOT_FOUND", "No."));
    expect((await substitute(json(substitution), withAttendee)).status).toBe(404);
    expect(mocks.finishRegistrationChange).not.toHaveBeenCalled();
  });
});

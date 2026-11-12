import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: db.getPrisma }));

import { NoteError, addNoteRevision } from "@/modules/notes/repository";

function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "note-1",
    eventId: "event-1",
    registrationId: "reg-1",
    attendeeId: null,
    personId: null,
    visibility: "STAFF",
    restrictedPermission: null,
    revisions: [{ sequence: 1 }],
    ...overrides,
  };
}

function prismaWith(row: unknown) {
  const tx = {
    staffNoteRevision: { create: vi.fn().mockResolvedValue({}) },
    staffNote: {
      update: vi.fn().mockResolvedValue({
        id: "note-1",
        visibility: "STAFF",
        restrictedPermission: null,
        author: { id: "user-1", displayName: "Staff" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        revisions: [],
      }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const client = {
    staffNote: { findFirst: vi.fn().mockResolvedValue(row) },
    registrationAttendee: { findFirst: vi.fn().mockResolvedValue({ id: "att-1" }) },
    $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
  };
  db.getPrisma.mockReturnValue(client);
  return { tx, client };
}

const revise = (
  subject: { registrationId: string } | { attendeeId: string },
  permissions: string[],
  attendeeRegistrationId?: string,
) =>
  addNoteRevision("event-1", "note-1", "user-1", { body: "Updated" }, {
    subject,
    actorPermissions: new Set(permissions),
    attendeeRegistrationId,
  });

beforeEach(() => vi.clearAllMocks());

describe("revising a staff note", () => {
  it("is refused when the note is restricted to a permission the editor lacks", async () => {
    const { tx } = prismaWith(noteRow({ visibility: "RESTRICTED", restrictedPermission: "VIEW_SENSITIVE_DATA" }));
    await expect(revise({ registrationId: "reg-1" }, ["MANAGE_REGISTRATION"])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(tx.staffNoteRevision.create).not.toHaveBeenCalled();
  });

  it("is allowed when the editor holds the restricting permission", async () => {
    const { tx } = prismaWith(noteRow({ visibility: "RESTRICTED", restrictedPermission: "VIEW_SENSITIVE_DATA" }));
    await revise({ registrationId: "reg-1" }, ["VIEW_SENSITIVE_DATA"]);
    expect(tx.staffNoteRevision.create).toHaveBeenCalled();
  });

  it("is not found when the note belongs to a different registration than the URL", async () => {
    const { tx } = prismaWith(noteRow({ registrationId: "reg-2" }));
    const result = revise({ registrationId: "reg-1" }, []);
    await expect(result).rejects.toBeInstanceOf(NoteError);
    await expect(result).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.staffNoteRevision.create).not.toHaveBeenCalled();
  });

  it("is not found when a registration note is addressed as an attendee note", async () => {
    prismaWith(noteRow({ registrationId: "reg-1", attendeeId: null }));
    await expect(revise({ attendeeId: "att-1" }, [])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is not found when the attendee does not belong to the registration in the URL", async () => {
    const { client, tx } = prismaWith(noteRow({ registrationId: null, attendeeId: "att-1" }));
    client.registrationAttendee.findFirst.mockResolvedValue(null);
    await expect(revise({ attendeeId: "att-1" }, [], "reg-other")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(client.registrationAttendee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "att-1", registrationId: "reg-other", eventId: "event-1" } }));
    expect(tx.staffNoteRevision.create).not.toHaveBeenCalled();
  });

  it("revises an attendee note when the attendee belongs to that registration", async () => {
    const { tx } = prismaWith(noteRow({ registrationId: null, attendeeId: "att-1" }));
    await revise({ attendeeId: "att-1" }, [], "reg-1");
    expect(tx.staffNoteRevision.create).toHaveBeenCalled();
  });
});

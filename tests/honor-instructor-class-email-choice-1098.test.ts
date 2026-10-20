import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), writeAuditLog: vi.fn(), sendFinalClassChangeSummary: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/honors/class-change-emails", () => ({ sendFinalClassChangeSummary: mocks.sendFinalClassChangeSummary }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/background-checks/repository", () => ({ currentCheckStateForPerson: vi.fn(), namesAgree: vi.fn() }));
vi.mock("@/modules/background-checks/refresh-after-write", () => ({ refreshBackgroundCheckMatchesSafely: vi.fn() }));

import { listHonorInstructors, listInstructorEmailPreferences, setInstructorClassChangeEmails, HonorInstructorError } from "@/modules/honors/instructor-repository";

const now = new Date("2026-10-21T15:00:00.000Z");

function database(row: Record<string, unknown> | null) {
  const db = {
    honorInstructor: {
      findFirst: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    honorOffering: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(db)),
  };
  mocks.getPrisma.mockReturnValue(db);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
});

describe("setting how an instructor hears about class list changes (#1098)", () => {
  it("only finds the signed-in account's own accepted, un-revoked assignment", async () => {
    const db = database({ id: "ins-1", eventId: "event-1", classChangeEmails: "DAILY" });
    await setInstructorClassChangeEmails("acct-1", "ins-1", "IMMEDIATE", now);
    expect(db.honorInstructor.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ins-1", attendeeAccountId: "acct-1", acceptedAt: { not: null }, revokedAt: null },
    }));
  });

  it("refuses an assignment that isn't theirs, and changes nothing", async () => {
    const db = database(null);
    await expect(setInstructorClassChangeEmails("acct-1", "ins-other", "OFF", now)).rejects.toBeInstanceOf(HonorInstructorError);
    expect(db.honorInstructor.updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("saves the choice and audits it with ids only", async () => {
    const db = database({ id: "ins-1", eventId: "event-1", classChangeEmails: "DAILY" });
    expect(await setInstructorClassChangeEmails("acct-1", "ins-1", "OFF", now)).toEqual({ classChangeEmails: "OFF" });
    expect(db.honorInstructor.updateMany).toHaveBeenCalledWith({ where: { id: "ins-1", classChangeEmails: "DAILY" }, data: { classChangeEmails: "OFF" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "HONOR_INSTRUCTOR_CLASS_EMAILS_CHANGED",
      eventId: "event-1",
      entityId: "ins-1",
      metadata: { eventId: "event-1", actorAttendeeAccountId: "acct-1", from: "DAILY", to: "OFF" },
    }), db);
  });

  it("starts the daily summary from now when the instructor comes back to it, so old changes don't come back", async () => {
    const db = database({ id: "ins-1", eventId: "event-1", classChangeEmails: "IMMEDIATE" });
    await setInstructorClassChangeEmails("acct-1", "ins-1", "DAILY", now);
    expect(db.honorInstructor.updateMany).toHaveBeenCalledWith({ where: { id: "ins-1", classChangeEmails: "IMMEDIATE" }, data: { classChangeEmails: "DAILY", classChangeSummaryAt: now } });
  });

  it("sends one last summary, after the choice has committed, when the instructor leaves the daily summary", async () => {
    const db = database({ id: "ins-1", eventId: "event-1", classChangeEmails: "DAILY" });
    let committed = false;
    db.$transaction.mockImplementation(async (work: (client: unknown) => unknown) => {
      const result = await work(db);
      committed = true;
      return result;
    });
    mocks.sendFinalClassChangeSummary.mockImplementation(async () => {
      expect(committed).toBe(true);
    });
    await setInstructorClassChangeEmails("acct-1", "ins-1", "IMMEDIATE", now);
    expect(mocks.sendFinalClassChangeSummary).toHaveBeenCalledWith("ins-1", now);
  });

  it("two requests that read the same choice: only the one that changes it sends the final summary", async () => {
    const db = database({ id: "ins-1", eventId: "event-1", classChangeEmails: "DAILY" });
    db.honorInstructor.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await Promise.all([
      setInstructorClassChangeEmails("acct-1", "ins-1", "IMMEDIATE", now),
      setInstructorClassChangeEmails("acct-1", "ins-1", "OFF", now),
    ]);
    expect(mocks.sendFinalClassChangeSummary).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("sends no final summary for a change that doesn't leave the daily summary, or one that changes nothing", async () => {
    database({ id: "ins-1", eventId: "event-1", classChangeEmails: "OFF" });
    await setInstructorClassChangeEmails("acct-1", "ins-1", "DAILY", now);
    await setInstructorClassChangeEmails("acct-1", "ins-1", "OFF", now);
    database({ id: "ins-1", eventId: "event-1", classChangeEmails: "DAILY" });
    await setInstructorClassChangeEmails("acct-1", "ins-1", "DAILY", now);
    expect(mocks.sendFinalClassChangeSummary).not.toHaveBeenCalled();
  });

  it("does nothing when the choice is already that one", async () => {
    const db = database({ id: "ins-1", eventId: "event-1", classChangeEmails: "OFF" });
    await setInstructorClassChangeEmails("acct-1", "ins-1", "OFF", now);
    expect(db.honorInstructor.updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the instructor's page and the staff list (#1098)", () => {
  it("lists one choice per event the account teaches at, for open rosters only, with no person data", async () => {
    const db = database(null);
    db.honorInstructor.findMany.mockResolvedValue([
      { id: "ins-1", classChangeEmails: "DAILY", event: { name: "Synthetic Weekend", endsAt: new Date("2026-12-06T20:00:00Z") } },
      { id: "ins-2", classChangeEmails: "OFF", event: { name: "Past Weekend", endsAt: new Date("2026-01-06T20:00:00Z") } },
    ]);
    expect(await listInstructorEmailPreferences("acct-1", now)).toEqual([{ instructorId: "ins-1", eventName: "Synthetic Weekend", classChangeEmails: "DAILY" }]);
    expect(db.honorInstructor.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { attendeeAccountId: "acct-1", acceptedAt: { not: null }, revokedAt: null, classes: { some: {} } },
    }));
  });

  it("shows staff each instructor's choice", async () => {
    const db = database(null);
    db.honorInstructor.findMany.mockResolvedValue([{
      id: "ins-1", name: "Ira Instructor", email: "ira@imsda-events.test", personId: "person-1", sentAt: null, acceptedAt: now, revokedAt: null,
      classChangeEmails: "IMMEDIATE", classes: [{ offeringId: "class-1" }],
    }]);
    const { currentCheckStateForPerson } = await import("@/modules/background-checks/repository");
    (currentCheckStateForPerson as ReturnType<typeof vi.fn>).mockResolvedValue("CURRENT");
    const { instructors } = await listHonorInstructors("event-1");
    expect(instructors[0]).toMatchObject({ id: "ins-1", classChangeEmails: "IMMEDIATE" });
  });
});

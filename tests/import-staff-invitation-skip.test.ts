/**
 * A legacy file may not change a registration made through a personal staff, pastor or volunteer link (#804): its UPDATE would
 * overwrite the $0 amount and the status the office's approval decides. The preview flags and skips such a row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  importRunFindUnique: vi.fn(),
  registrationFindMany: vi.fn(),
  personFindMany: vi.fn(),
  formVersionFindFirst: vi.fn(),
  importRunCreate: vi.fn(),
  registrationAggregate: vi.fn(),
  paymentAggregate: vi.fn(),
  attendeeCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    importRun: { findUnique: mocks.importRunFindUnique, create: mocks.importRunCreate },
    registration: { findMany: mocks.registrationFindMany, aggregate: mocks.registrationAggregate },
    person: { findMany: mocks.personFindMany },
    registrationFormVersion: { findFirst: mocks.formVersionFindFirst },
    payment: { aggregate: mocks.paymentAggregate },
    registrationAttendee: { count: mocks.attendeeCount },
  }),
}));

import { previewWr26BundleImport } from "@/modules/imports/repository";

const bundle = [
  { name: "Registrations.csv", text: ["Registration ID,Timestamp,First Name,Last Name,Email,Final Amount,Status", "WR26-1780602786558-7AC3,2026-06-04T14:53:07Z,Test,Person,person@example.test,250.00,active"].join("\n") },
  { name: "Attendees.csv", text: ["Attendee ID,Registration ID,First Name,Last Name,Meal Preference", "A-1,WR26-1780602786558-7AC3,Test,Person,regular"].join("\n") },
];

function capturedRecords() {
  return (mocks.importRunCreate.mock.calls[0]?.[0]?.data?.records?.create ?? []) as Array<{ proposedAction: string; errors?: string[] }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importRunFindUnique.mockResolvedValue(null);
  mocks.personFindMany.mockResolvedValue([]);
  mocks.formVersionFindFirst.mockResolvedValue({ id: "ver" });
  mocks.registrationAggregate.mockResolvedValue({ _sum: { totalAmount: null }, _count: 0 });
  mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: null } });
  mocks.attendeeCount.mockResolvedValue(0);
  mocks.importRunCreate.mockResolvedValue({ id: "imp_1", records: [], event: { id: "evt" } });
});

describe("import preview and staff invitation registrations (#804)", () => {
  it("flags and skips a matched staff-invitation registration, never proposing an update", async () => {
    mocks.registrationFindMany.mockResolvedValue([{
      id: "reg_1", confirmationCode: "WR26-1780602786558-7AC3", accountHolderPersonId: "p1", status: "CONFIRMED", totalAmount: 0,
      accountHolderPerson: { id: "p1", firstName: "Test", lastName: "Person", normalizedEmail: "person@example.test", phone: null },
      attendees: [], staffInvitation: { id: "inv_1" },
    }]);
    await previewWr26BundleImport("evt", "usr_1", bundle).catch(() => undefined);
    expect(mocks.importRunCreate).toHaveBeenCalled();
    const [record] = capturedRecords();
    expect(record.proposedAction).toBe("ERROR");
    expect(record.errors?.some((error) => /personal invitation link/.test(error))).toBe(true);
  });

  it("still proposes a create for a code nobody holds", async () => {
    mocks.registrationFindMany.mockResolvedValue([]);
    await previewWr26BundleImport("evt", "usr_1", bundle).catch(() => undefined);
    expect(capturedRecords()[0]?.proposedAction).toBe("CREATE");
  });
});

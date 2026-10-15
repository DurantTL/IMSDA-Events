import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFindUnique: vi.fn(),
  runFindMany: vi.fn(),
  listRegistrations: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findUnique: mocks.eventFindUnique },
    programAssignmentRun: { findMany: mocks.runFindMany },
  }),
}));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: mocks.listRegistrations }));

import { getEventPackets } from "@/modules/reporting/event-packets-repository";

const definition = {
  title: "Synthetic event",
  description: "",
  confirmationMessage: "Registered.",
  sections: [{
    id: "group",
    title: "Group",
    description: "",
    fields: [{
      id: "club", key: "club", label: "Club name", helpText: "", type: "SELECT",
      scope: "REGISTRATION", required: false, options: ["Eagles"],
    }],
  }],
};

const registration = {
  id: "registration-1",
  confirmationCode: "EV-001",
  status: "CONFIRMED",
  totalAmountCents: 0,
  paidCents: 0,
  balanceCents: 0,
  accountHolder: { id: "person-1", firstName: "Ana", lastName: "Rivera", email: "ana@example.test", phone: "555-0100" },
  attendees: [{
    id: "attendee-1", firstName: "Ana", lastName: "Rivera", email: null, phone: null, attendeeType: "Adult",
    position: 0, checkedIn: false, checkedInAt: null, responses: { shirt_size: "Adult M" },
  }],
  attendeeCount: 1,
  checkedInCount: 0,
  publicSubmission: {
    responses: { club: "Eagles" },
    attendeeResponses: [{ shirt_size: "Adult M" }],
    definition,
  },
};

function eventRecord(collectsShirtSizes: boolean) {
  return {
    id: "event-1", slug: "synthetic", name: "Synthetic", startsAt: new Date("2027-05-05T12:00:00Z"),
    endsAt: new Date("2027-05-06T12:00:00Z"), timezone: "America/Denver", location: null, supportContact: null,
    operationalPacketConfig: null, collectsShirtSizes, contentSections: [],
  };
}

describe("getEventPackets shirt column (#155)", () => {
  beforeEach(() => {
    mocks.runFindMany.mockResolvedValue([]);
    mocks.listRegistrations.mockResolvedValue([registration]);
  });

  it("hides the shirt column when the event does not collect shirt sizes", async () => {
    mocks.eventFindUnique.mockResolvedValue(eventRecord(false));
    const packets = await getEventPackets("event-1");
    expect(packets?.config.sections.shirtSize).toBe(false);
    expect(packets?.groups[0].attendees[0].shirtSize).toBeNull();
  });

  it("shows the shirt column when the event collects shirt sizes", async () => {
    mocks.eventFindUnique.mockResolvedValue(eventRecord(true));
    const packets = await getEventPackets("event-1");
    expect(packets?.config.sections.shirtSize).toBe(true);
    expect(packets?.groups[0].attendees[0].shirtSize).toBe("Adult M");
  });
});

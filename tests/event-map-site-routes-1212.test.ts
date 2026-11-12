import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  createEvent: vi.fn(),
  updateEventSettings: vi.fn(),
  findActiveMembership: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", async () => {
  const { EventOperationError } = await vi.importActual<typeof import("@/modules/events/operation-error")>("@/modules/events/operation-error");
  return {
    EventOperationError,
    createEvent: dependencies.createEvent,
    findActiveMembership: dependencies.findActiveMembership,
    getEventSettings: vi.fn(),
    listEventsForUser: vi.fn(),
    updateEventSettings: dependencies.updateEventSettings,
  };
});

import { POST } from "@/app/api/events/route";
import { PATCH } from "@/app/api/events/[eventId]/route";
import { EventOperationError } from "@/modules/events/operation-error";

const payload = {
  name: "Spring Conference", slug: "spring-conference", startsOn: "2027-11-21", endsOn: "2027-11-23", timezone: "America/Chicago",
  location: null, capacity: null, publicInfoUrl: null, supportContact: null, registrationOpensOn: null, registrationClosesOn: null,
  collectsShirtSizes: false, waitlistEnabled: false, autoPromoteWaitlist: false, mapSiteOrganizationId: "gone",
};
const request = (method: string, url: string) => new Request(url, {
  method,
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(payload),
});

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  dependencies.findActiveMembership.mockResolvedValue(null);
});

describe("a map pin the server refuses (#1212)", () => {
  const failure = () => new EventOperationError("EVENT_MAP_SITE_INVALID", "That site is no longer available.");
  const expected = {
    error: "EVENT_MAP_SITE_INVALID",
    message: "That site is no longer available.",
    issues: [{ path: ["mapSiteOrganizationId"], message: "That site is no longer available." }],
  };

  it("answers an update with 400 and the field's issue", async () => {
    dependencies.updateEventSettings.mockRejectedValueOnce(failure());
    const response = await PATCH(request("PATCH", "https://events.imsda.test/api/events/event-1"), { params: Promise.resolve({ eventId: "event-1" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expected);
  });

  it("answers a create with 400 and the field's issue", async () => {
    dependencies.createEvent.mockRejectedValueOnce(failure());
    const response = await POST(request("POST", "https://events.imsda.test/api/events"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expected);
  });
});

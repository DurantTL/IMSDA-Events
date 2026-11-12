import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ findActiveMembership: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership }));

import { libraryViewer } from "@/modules/events/image-library-http";

function access(globalRole: "SYSTEM_ADMIN" | null) {
  return { user: { id: "usr_1", email: "a@example.test", displayName: "A", globalRole }, membership: null };
}

beforeEach(() => vi.clearAllMocks());

describe("libraryViewer.configurableEventIds", () => {
  it("lets a system administrator see every event without a lookup", async () => {
    const ids = await libraryViewer(access("SYSTEM_ADMIN")).configurableEventIds(["e1", "e2"]);
    expect([...ids]).toEqual(["e1", "e2"]);
    expect(dependencies.findActiveMembership).not.toHaveBeenCalled();
  });

  it("keeps only events where the viewer holds CONFIGURE_EVENT on an active membership", async () => {
    dependencies.findActiveMembership.mockImplementation(async (_user: string, eventId: string) => ({
      eventId,
      userId: "usr_1",
      role: eventId === "e_admin" ? "EVENT_ADMIN" : "READ_ONLY_STAFF",
      status: eventId === "e_inactive" ? "INACTIVE" : "ACTIVE",
      permissions: [],
    }));
    const ids = await libraryViewer(access(null)).configurableEventIds(["e_admin", "e_readonly", "e_inactive", "e_none"]);
    expect([...ids]).toEqual(["e_admin"]);
  });

  it("treats no membership as no access", async () => {
    dependencies.findActiveMembership.mockResolvedValue(null);
    expect((await libraryViewer(access(null)).configurableEventIds(["e1"])).size).toBe(0);
  });
});

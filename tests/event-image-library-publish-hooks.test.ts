import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn(), keepPublishedHeaderImagesForEvent: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/events/image-library", () => ({
  keepPublishedHeaderImagesForEvent: dependencies.keepPublishedHeaderImagesForEvent,
}));
vi.mock("@/modules/events/repository", () => ({
  EventOperationError: class extends Error {},
  eventAccessFilter: vi.fn(),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { unarchiveEvent, archiveEvent } from "@/modules/events/archive-repository";

function mockPrisma(published: boolean, changed = 1) {
  const tx = {
    event: {
      findUnique: vi.fn(async () => ({ id: "event_1", isBillingContainer: false, lifecycleState: "PUBLISHED", isPublished: published })),
      updateMany: vi.fn(async () => ({ count: changed })),
    },
    eventLifecycleTransition: { create: vi.fn() },
  };
  dependencies.getPrisma.mockReturnValue({
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  });
}

const actor = { userId: "usr_1", eventRole: "EVENT_ADMIN", globalRole: null } as never;

describe("image library hooks on archive changes (#1913)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the published banner when a published event is unarchived", async () => {
    mockPrisma(true);
    await unarchiveEvent({ eventId: "event_1", actor });
    expect(dependencies.keepPublishedHeaderImagesForEvent).toHaveBeenCalledWith("event_1");
  });

  it("does nothing for a draft event, a no-op, or an archive", async () => {
    mockPrisma(false);
    await unarchiveEvent({ eventId: "event_1", actor });
    mockPrisma(true, 0);
    await unarchiveEvent({ eventId: "event_1", actor });
    mockPrisma(true);
    await archiveEvent({ eventId: "event_1", actor });
    expect(dependencies.keepPublishedHeaderImagesForEvent).not.toHaveBeenCalled();
  });
});

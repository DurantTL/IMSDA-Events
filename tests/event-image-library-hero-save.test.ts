import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn(), keepHeaderImageInLibrary: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/events/image-library", () => ({ keepHeaderImageInLibrary: dependencies.keepHeaderImageInLibrary }));

import { replaceEventContent } from "@/modules/events/content-repository";
import type { EventContentInput } from "@/modules/events/content-schemas";

function mockPrisma() {
  const tx = {
    eventAsset: { findMany: vi.fn().mockResolvedValue([{ id: "asset_hero", contentType: "image/png" }]) },
    eventContentSection: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn() },
  };
  const client = {
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    eventContentSection: { findMany: vi.fn().mockResolvedValue([]) },
  };
  dependencies.getPrisma.mockReturnValue(client);
  return tx;
}

const heroInput: EventContentInput = {
  sections: [{
    kind: "HERO",
    title: "Camporee 2027",
    body: "",
    placement: "PUBLIC_PAGE",
    items: [],
    isPublished: true,
    links: [],
    data: { assetId: "asset_hero", alt: "Tents under tall pines", subtitle: "", button: null, focalX: 50, focalY: 50, overlay: 40 },
  }],
};

describe("saving a header banner (#1913)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the banner image in the library with its alt text, after the save", async () => {
    const tx = mockPrisma();
    await replaceEventContent("event_1", heroInput, "user_1");
    expect(tx.eventContentSection.create).toHaveBeenCalled();
    expect(dependencies.keepHeaderImageInLibrary).toHaveBeenCalledWith("event_1", "asset_hero", "Tents under tall pines");
  });

  it("does nothing for a page without a banner", async () => {
    mockPrisma();
    await replaceEventContent("event_1", {
      sections: [{ kind: "RICH_TEXT", title: "Welcome", body: "Hello", placement: "PUBLIC_PAGE", items: [], isPublished: true, links: [] }],
    }, "user_1");
    expect(dependencies.keepHeaderImageInLibrary).not.toHaveBeenCalled();
  });
});

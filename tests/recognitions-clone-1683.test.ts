import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));

import { loadSourceConfiguration } from "@/modules/event-clones/repository";

const tags = [
  { name: "Memory verses", normalizedName: "memory verses", color: "#1D4ED8", description: "", isActive: true, recognitionItem: "PIN" },
  { name: "VIP", normalizedName: "vip", color: "#4F46E5", description: "", isActive: true, recognitionItem: null },
];

/** A database where every read finds nothing except the event row and its tags. */
function fakeDb() {
  const empty = { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) };
  return new Proxy({}, {
    get: (_target, name) => {
      if (name === "event") return { findUnique: vi.fn().mockResolvedValue({ id: "event-1", name: "Sample Camporee", audience: "CLUB", startsAt: new Date("2027-05-01T12:00:00Z"), endsAt: new Date("2027-05-03T12:00:00Z") }) };
      if (name === "eventTag") return { findMany: vi.fn().mockResolvedValue(tags) };
      return empty;
    },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("cloning keeps a recognition a recognition (#1683)", () => {
  it("carries recognitionItem into the clone configuration, null for an ordinary tag", async () => {
    const config = await loadSourceConfiguration(fakeDb() as never, "event-1");
    expect(config?.tags.map((tag) => [tag.name, tag.recognitionItem])).toEqual([["Memory verses", "PIN"], ["VIP", null]]);
  });
});

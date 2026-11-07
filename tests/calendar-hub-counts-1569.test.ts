import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const counts: Array<Record<string, unknown>> = [];
const prisma = {
  calendarEntry: {
    findMany: vi.fn(async () => []),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => { counts.push(where); return 0; }),
  },
};
vi.mock("@/lib/prisma", () => ({ getPrisma: () => prisma }));

const { countPublicCalendarEntries } = await import("@/modules/calendar/repository");

/** Every clause of a nested AND, flattened, so a test can look for a guard anywhere in it. */
function clauses(where: unknown): Array<Record<string, unknown>> {
  if (!where || typeof where !== "object") return [];
  const node = where as Record<string, unknown>;
  const and = Array.isArray(node.AND) ? (node.AND as unknown[]).flatMap(clauses) : [];
  return [node, ...and];
}

describe("Admin hub calendar counts (#1569)", () => {
  it("guards both counts like the public calendar: no hidden items, no feed-removed items, no deadlines", async () => {
    counts.length = 0;
    await countPublicCalendarEntries(new Date("2026-11-07T18:00:00Z"));
    expect(counts).toHaveLength(2);
    for (const where of counts) {
      const all = clauses(where);
      expect(all.some((clause) => clause.isHiddenLocally === false)).toBe(true);
      expect(all.some((clause) => clause.sourceRemovedAt === null)).toBe(true);
      expect(all.some((clause) => JSON.stringify(clause.entryType) === JSON.stringify({ not: "DEADLINE" }))).toBe(true);
    }
    // One count is published items, the other unpublished: a removed or hidden item is in neither.
    expect(counts.map((where) => clauses(where).find((clause) => "isPublished" in clause)?.isPublished).sort()).toEqual([false, true]);
  });

  it("looks for repeating series that began in the past once, not once per count", async () => {
    prisma.calendarEntry.findMany.mockClear();
    await countPublicCalendarEntries(new Date("2026-11-07T18:00:00Z"));
    expect(prisma.calendarEntry.findMany).toHaveBeenCalledTimes(1);
  });
});

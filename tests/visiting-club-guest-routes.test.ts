/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #835: a visiting guest club may use only its own event, on every club-event route and page, not just registration.
 * One shared check (`clubMayUseEvent`) answers it; this walks every route and page under the club's event address and
 * fails when a new one skips it. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { clubMayUseEvent, rejectGuestClubOtherEvent } from "@/modules/club-registrations/event-gate";

const root = process.cwd();
const routeRoot = "app/api/attendee/clubs/[organizationId]/events/[eventId]";
const pageRoot = "app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]";

function walk(dir: string, name: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((entry) => {
    const relative = path.join(dir, entry);
    if (statSync(path.join(root, relative)).isDirectory()) return walk(relative, name);
    return entry === name ? [relative] : [];
  });
}
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

beforeEach(() => {
  mocks.getPrisma.mockReturnValue({
    organization: {
      findUnique: vi.fn(async ({ where }: any) => ({ guest: { guestEventId: "event-guest" }, conference: { guestEventId: null } } as Record<string, any>)[where.id] ?? null),
    },
  });
});

describe("the shared check", () => {
  it("lets a guest club use its own event only, and a conference club any event", async () => {
    expect(await clubMayUseEvent("guest", "event-guest")).toBe(true);
    expect(await clubMayUseEvent("guest", "event-other")).toBe(false);
    expect(await clubMayUseEvent("conference", "event-other")).toBe(true);
  });

  it("answers a route with not found for a guest club on another event, and nothing otherwise", async () => {
    const response = await rejectGuestClubOtherEvent("guest", "event-other");
    expect(response?.status).toBe(404);
    expect((await response!.json()).error).toBe("EVENT_NOT_FOUND");
    expect(await rejectGuestClubOtherEvent("guest", "event-guest")).toBeNull();
    expect(await rejectGuestClubOtherEvent("conference", "event-other")).toBeNull();
  });
});

describe("every club-event route and page applies it", () => {
  it("finds the routes", () => {
    expect(walk(routeRoot, "route.ts").length).toBeGreaterThanOrEqual(11);
    expect(walk(pageRoot, "page.tsx").length).toBeGreaterThanOrEqual(5);
  });

  it("calls rejectGuestClubOtherEvent in every route under the club's event address", () => {
    // One guest check per access check, so every handler in a file asks, not just one of them.
    const count = (source: string, needle: string) => source.split(needle).length - 1;
    const missing = walk(routeRoot, "route.ts").filter((file) => {
      const source = read(file);
      const guarded = count(source, "rejectGuestClubOtherEvent(");
      return guarded === 0 || guarded < count(source, "requireRosterAccess(");
    });
    expect(missing).toEqual([]);
  });

  it("asks clubMayUseEvent, or loads the workspace that does, in every page under the club's event address", () => {
    const missing = walk(pageRoot, "page.tsx").filter((file) => {
      const source = read(file);
      return !source.includes("clubMayUseEvent(") && !source.includes("getClubEventWorkspace(");
    });
    expect(missing).toEqual([]);
  });

  it("keeps the workspace, the teachers step and the registration paths on the same check", () => {
    expect(read("modules/club-registrations/repository.ts")).toContain("clubMayUseEvent(organizationId, eventId)");
    expect(read("modules/club-teachers/repository.ts")).toContain("clubMayUseEvent(organizationId, eventId)");
    expect(read("app/(public)/account/(portal)/club-registration/[eventSlug]/page.tsx")).toContain("guestEventId");
  });
});

describe("the director's form after sending (#835)", () => {
  it("shows the confirmation itself and never refreshes the page into the used link's 404", () => {
    const form = read("components/visiting-club-request-form.tsx");
    expect(form).not.toContain("router.refresh");
    expect(form).not.toContain("useRouter");
    expect(form).toContain("setDone(true)");
  });
});

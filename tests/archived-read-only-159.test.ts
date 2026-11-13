import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ getPrisma: vi.fn(), logError: vi.fn() }));
const access = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  createTag: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.unmock("@/modules/events/archived-read-only");
vi.unmock("@/modules/events/archived-read-only-guard");
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: access.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: access.findActiveMembership }));
vi.mock("@/modules/tags/repository", () => ({
  TagConfigurationError: class extends Error { code = "X"; },
  createTag: access.createTag,
  listTags: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: database.getPrisma }));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logError: database.logError,
}));

import { withRequestContext } from "@/lib/request-context";
import { refuseIfEventArchived } from "@/modules/events/archived-read-only-guard";
import { POST as tagsPost } from "@/app/api/events/[eventId]/tags/route";
import {
  EVENT_ARCHIVED_READ_ONLY_MESSAGE,
  archivedWriteTarget,
} from "@/modules/events/archived-read-only";

describe("archivedWriteTarget (#159)", () => {
  it.each([
    ["POST", "/api/events/e1/tags", "e1"],
    ["PATCH", "/api/events/e1", "e1"],
    ["PUT", "/api/events/e1/meals/plans/p1/", "e1"],
    ["delete", "/api/events/e1/tags/t1", "e1"],
    ["post", "/api/events/e1/imports/preview", "e1"],
    ["POST", "/api/events/e1/closeout", "e1"],
    ["POST", "/api/events/e1/lifecycle", "e1"],
    ["POST", "/api/events/e1/payments/refund", "e1"],
    ["POST", "/api/events/e1/forms/f1/test-submissions", "e1"],
    ["POST", "/api/events/e%201/tags", "e 1"],
  ])("%s %s is a write to %s", (method, pathname, expected) => {
    expect(archivedWriteTarget(method, pathname)).toEqual({ eventId: expected });
  });

  it.each([
    ["GET", "/api/events/e1/tags"],
    ["HEAD", "/api/events/e1"],
    ["OPTIONS", "/api/events/e1/tags"],
    ["get", "/api/events/e1/tags"],
    ["POST", "/api/events/e1/unarchive"],
    ["POST", "/api/events/e1/unarchive/"],
    ["POST", "/api/events/e1/archive"],
    ["DELETE", "/api/events/e1"],
    ["POST", "/api/events/e1/cancellation-policy/preview"],
    ["POST", "/api/events/e1/content/html-preview"],
    ["POST", "/api/events/e1/club-reports/columns/"],
    ["POST", "/api/events/e1/attendee-passes/resolve"],
    ["POST", "/api/events/e1/forms/f1/field-answer-counts"],
    ["POST", "/api/events/e1/general-link/teams/s1/similar-clubs"],
    ["PUT", "/api/attendee/area-clubs/events/e1/budget"],
    ["POST", "/api/attendee/area-clubs/tlt-staffing/e1/assignments"],
    ["POST", "/api/events"],
    ["POST", "/api/events/"],
    ["POST", "/api/event-clones"],
    ["POST", "/api/public/events/e1/registrations"],
    ["POST", "/api/admin/events/e1"],
  ])("%s %s is not refused", (method, pathname) => {
    expect(archivedWriteTarget(method, pathname)).toBeNull();
  });

  it("only exempts the read-only POSTs for POST", () => {
    expect(archivedWriteTarget("PUT", "/api/events/e1/club-reports/columns")).toEqual({ eventId: "e1" });
    expect(archivedWriteTarget("DELETE", "/api/events/e1/tags")).toEqual({ eventId: "e1" });
    expect(archivedWriteTarget("POST", "/api/events/e1/forms/f1/test-submissions")).not.toBeNull();
  });
});

function clientWith(findUnique: (args: unknown) => Promise<unknown>) {
  return { event: { findUnique: vi.fn(findUnique) } };
}

describe("refuseIfEventArchived (#159)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses an archived event with 409 and the shared message", async () => {
    database.getPrisma.mockReturnValue(clientWith(async () => ({ archivedAt: new Date("2026-10-01T00:00:00Z") })));
    const response = await refuseIfEventArchived("e1");
    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({ error: "EVENT_ARCHIVED", message: EVENT_ARCHIVED_READ_ONLY_MESSAGE });
  });

  it("passes an event that is not archived and one that does not exist", async () => {
    database.getPrisma.mockReturnValue(clientWith(async () => ({ archivedAt: null })));
    expect(await refuseIfEventArchived("e1")).toBeNull();
    database.getPrisma.mockReturnValue(clientWith(async () => null));
    expect(await refuseIfEventArchived("missing")).toBeNull();
  });

  it("lets a billing container through even though it is archived", async () => {
    database.getPrisma.mockReturnValue(clientWith(async () => ({ archivedAt: new Date("2026-10-01T00:00:00Z"), isBillingContainer: true })));
    expect(await refuseIfEventArchived("container_1")).toBeNull();
  });

  it("answers 503 and logs when the read fails", async () => {
    database.getPrisma.mockReturnValue(clientWith(async () => { throw new Error("db down"); }));
    const response = await refuseIfEventArchived("e1");
    expect(response?.status).toBe(503);
    expect((await response?.json()).error).toBe("EVENT_STATE_UNAVAILABLE");
    expect(database.logError).toHaveBeenCalled();
  });
});

const archivedRow = { archivedAt: new Date("2026-10-01T00:00:00Z"), isBillingContainer: false };
const member = { user: { id: "u1", globalRole: "STAFF" } };

describe("withRequestContext refuses writes to an archived event (#159)", () => {
  const handler = vi.fn(async () => Response.json({ ok: true }));
  const wrapped = withRequestContext(handler);
  const call = (method: string, pathname: string) =>
    wrapped(new Request(`https://events.imsda.test${pathname}`, { method }));

  beforeEach(() => {
    vi.clearAllMocks();
    database.getPrisma.mockReturnValue(clientWith(async () => archivedRow));
    access.getCurrentSession.mockResolvedValue(member);
    access.findActiveMembership.mockResolvedValue({ status: "ACTIVE" });
  });

  it("never calls the handler for a member's write", async () => {
    const response = await call("POST", "/api/events/e1/tags");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("EVENT_ARCHIVED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a system administrator without a membership", async () => {
    access.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: "SYSTEM_ADMIN" } });
    access.findActiveMembership.mockResolvedValue(null);
    expect((await call("PATCH", "/api/events/e1")).status).toBe(409);
  });

  it("gives a signed-out caller and a non-member what the route gives, with no event read", async () => {
    access.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call("POST", "/api/events/e1/tags")).status).toBe(200);
    access.getCurrentSession.mockResolvedValue(member);
    access.findActiveMembership.mockResolvedValue(null);
    expect((await call("POST", "/api/events/e1/tags")).status).toBe(200);
    access.findActiveMembership.mockResolvedValue({ status: "INACTIVE" });
    expect((await call("POST", "/api/events/e1/tags")).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(database.getPrisma).not.toHaveBeenCalled();
  });

  it("lets a read, the archive actions and the bare DELETE through without reading the event", async () => {
    expect((await call("GET", "/api/events/e1/tags")).status).toBe(200);
    expect((await call("POST", "/api/events/e1/unarchive")).status).toBe(200);
    expect((await call("DELETE", "/api/events/e1")).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(database.getPrisma).not.toHaveBeenCalled();
  });

  it("lets a write through when the event is not archived or is a billing container", async () => {
    database.getPrisma.mockReturnValue(clientWith(async () => ({ archivedAt: null, isBillingContainer: false })));
    expect((await call("POST", "/api/events/e1/tags")).status).toBe(200);
    database.getPrisma.mockReturnValue(clientWith(async () => ({ ...archivedRow, isBillingContainer: true })));
    expect((await call("POST", "/api/events/e1/invoices")).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("answers 503 when the caller cannot be recognised", async () => {
    access.getCurrentSession.mockRejectedValue(new Error("db down"));
    expect((await call("POST", "/api/events/e1/tags")).status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("a real route handler on an archived event (#159)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.getPrisma.mockReturnValue(clientWith(async () => archivedRow));
    access.getCurrentSession.mockResolvedValue(member);
    access.findActiveMembership.mockResolvedValue({ status: "ACTIVE", role: "EVENT_ADMIN", permissions: [] });
  });

  it("refuses a member's tag POST with 409 and creates nothing", async () => {
    const request = new Request("https://events.imsda.test/api/events/e1/tags", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
      body: JSON.stringify({ name: "Early" }),
    });
    const response = await tagsPost(request, { params: Promise.resolve({ eventId: "e1" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toBe(EVENT_ARCHIVED_READ_ONLY_MESSAGE);
    expect(access.createTag).not.toHaveBeenCalled();
  });
});

describe("every event write route goes through withRequestContext (#159)", () => {
  const roots = ["app/api/events/[eventId]"];
  const walk = (dir: string, files: string[] = []) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, files);
      else if (name === "route.ts") files.push(full);
    }
    return files;
  };
  const wrapped = (text: string) => /withRequestContext\(|mealRoute(<[^>]*>)?\(/.test(text);

  // `mealRoute` (modules/meals/api.ts) wraps its handler in withRequestContext.
  it("the wrapper itself uses withRequestContext", () => {
    expect(readFileSync(path.join(process.cwd(), "modules/meals/api.ts"), "utf8")).toMatch(/withRequestContext\(/);
  });

  it.each(roots)("no write export under %s bypasses it", (root) => {
    const files = walk(path.join(process.cwd(), root));
    const declared = /export\s+(?:const|async function|function)\s+(POST|PUT|PATCH|DELETE)\b[^\n]*/g;
    const bad: string[] = [];
    let writes = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(declared)) {
        writes += 1;
        if (!wrapped(match[0])) bad.push(`${path.relative(process.cwd(), file)} ${match[1]}`);
      }
      // `export { handler as POST }` and `export { POST } from ...` forms: the handler must be wrapped where it is defined.
      for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const item of match[1].split(",")) {
          const named = item.trim().match(/^(\w+)\s+as\s+(POST|PUT|PATCH|DELETE)$|^(POST|PUT|PATCH|DELETE)$/);
          if (!named) continue;
          writes += 1;
          const local = named[1] ?? named[3];
          const definition = source.match(new RegExp(`(?:const|function)\\s+${local}\\b[^\\n]*`));
          if (!definition || !wrapped(definition[0])) bad.push(`${path.relative(process.cwd(), file)} ${named[2] ?? named[3]}`);
        }
      }
    }
    expect(writes).toBeGreaterThan(200);
    expect(bad).toEqual([]);
  });
});

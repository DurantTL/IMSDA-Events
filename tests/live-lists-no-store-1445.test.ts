import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRosterAccess: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  listRoster: vi.fn(),
  addRosterMember: vi.fn(),
  updateRosterMember: vi.fn(),
  removeRosterMember: vi.fn(),
  listGuardiansByMember: vi.fn(),
  refreshBackgroundCheckMatchesSafely: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/club-rosters/access", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/access")>("@/modules/club-rosters/access");
  return { ...actual, requireRosterAccess: mocks.requireRosterAccess };
});
vi.mock("@/modules/club-rosters/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/repository")>("@/modules/club-rosters/repository");
  return {
    ...actual,
    listRoster: mocks.listRoster,
    addRosterMember: mocks.addRosterMember,
    updateRosterMember: mocks.updateRosterMember,
    removeRosterMember: mocks.removeRosterMember,
  };
});
vi.mock("@/modules/club-rosters/guardians-repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-rosters/guardians-repository")>("@/modules/club-rosters/guardians-repository");
  return { ...actual, listGuardiansByMember: mocks.listGuardiansByMember };
});
vi.mock("@/modules/background-checks/refresh-after-write", () => ({ refreshBackgroundCheckMatchesSafely: mocks.refreshBackgroundCheckMatchesSafely }));

import { GET as getRoster, POST as postRoster } from "@/app/api/attendee/clubs/[organizationId]/roster/route";
import { DELETE as deleteMember, PATCH as patchMember } from "@/app/api/attendee/clubs/[organizationId]/roster/[memberId]/route";
import { RosterAccessError } from "@/modules/club-rosters/access";
import { withRequestContext } from "@/lib/request-context";
import nextConfig from "@/next.config";
import { clubCapabilities, type ClubRole } from "@/modules/organizations/director-grants-domain";

const orgCtx = { params: Promise.resolve({ organizationId: "club-1" }) };
const memberCtx = { params: Promise.resolve({ organizationId: "club-1", memberId: "member-1" }) };

function accessFor(role: ClubRole) {
  return {
    state: "OPEN",
    club: { organizationId: "club-1", name: "Synthetic Club", role, sponsoringChurch: null },
    capabilities: clubCapabilities(role),
    actor: { kind: "ATTENDEE", accountId: "account-1", sessionId: "session-1" },
  };
}

const request = (method: string, body?: unknown) => new Request("https://events.imsda.test/api/attendee/clubs/club-1/roster", {
  method,
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const newMember = { firstName: "Test", lastName: "Youth", birthDate: "2014-12-06", attendeeType: "YOUTH", gender: "FEMALE" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.listRoster.mockResolvedValue([]);
  mocks.addRosterMember.mockResolvedValue({ memberId: "member-1", personId: "person-1" });
  mocks.updateRosterMember.mockResolvedValue({ personId: "person-1" });
  mocks.removeRosterMember.mockResolvedValue({ personId: null, nameKept: false });
  mocks.listGuardiansByMember.mockResolvedValue({});
  mocks.refreshBackgroundCheckMatchesSafely.mockResolvedValue(undefined);
});


describe("live lists are never cached (#1445, rule P2)", () => {
  const expected = "private, no-store, max-age=0";

  beforeEach(() => {
    mocks.requireRosterAccess.mockResolvedValue(accessFor("DIRECTOR"));
  });

  it("sends no-store on the roster list, and on every change that returns the list", async () => {
    const responses = [
      await getRoster(request("GET"), orgCtx),
      await postRoster(request("POST", newMember), orgCtx),
      await patchMember(request("PATCH", { firstName: "Renamed" }), memberCtx),
      await deleteMember(request("DELETE", { confirm: true }), memberCtx),
    ];
    for (const response of responses) {
      expect(response.status).toBeLessThan(300);
      expect(response.headers.get("Cache-Control")).toBe(expected);
    }
  });

  it("sends no-store on a refusal too, so a blocked list is not remembered either", async () => {
    mocks.requireRosterAccess.mockRejectedValue(new RosterAccessError("NOT_FOUND", 404, "No such club."));
    const response = await getRoster(request("GET"), orgCtx);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("every API response is current data (#1445, rule P2)", () => {
  it("withRequestContext adds no-store unless the handler chose its own Cache-Control", async () => {
    const plain = await withRequestContext(async () => Response.json({ ok: true }))(new Request("https://events.imsda.test/api/x"));
    expect(plain.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    const own = await withRequestContext(async () => new Response("a,b", { headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } }))(new Request("https://events.imsda.test/api/x"));
    expect(own.headers.get("Cache-Control")).toBe("private, no-store, max-age=0, must-revalidate");
  });

  it("next.config.ts marks every /api path no-store, so Cloudflare and browsers never keep a list", async () => {
    const rules = await nextConfig.headers!();
    const api = rules.find((rule) => rule.source === "/api/:path*");
    expect(api?.headers).toContainEqual({ key: "Cache-Control", value: "no-store" });
  });
});

const root = path.resolve(__dirname, "..");
function files(directory: string, extensions: string[], found: string[] = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) files(full, extensions, found);
    else if (extensions.some((extension) => full.endsWith(extension))) found.push(full);
  }
  return found;
}

describe("nothing in the app caches a live list (#1445, rule P2)", () => {
  it("every browser GET in a component asks the server (cache: \"no-store\")", () => {
    const offenders: string[] = [];
    for (const file of [...files(path.join(root, "components"), [".ts", ".tsx"]), ...files(path.join(root, "app"), [".tsx"])]) {
      const source = readFileSync(file, "utf8");
      if (!/\bfetch\(/.test(source)) continue;
      // In app/ only client components run in the browser; route handlers and server pages are not checked here.
      if (file.includes(`${path.sep}app${path.sep}`) && !/^\s*["']use client["']/.test(source)) continue;
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText() === "fetch") {
          const init = node.arguments[1];
          const text = init ? init.getText() : "";
          // A call with an options variable or spread is checked by hand; a literal init either names a method (a write) or says no-store.
          // Only a non-GET method is exempt; `method: "GET"` is a read. A shorthand `method,` names a variable, which is a write helper.
          const isWrite = /\bmethod\b/.test(text) && !/method\s*:\s*["']GET["']/i.test(text);
          if (!isWrite && !/cache\s*:\s*"no-store"/.test(text) && !(init && !ts.isObjectLiteralExpression(init)) && !/\.\.\./.test(text)) {
            offenders.push(`${path.relative(root, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });

  it("has no service worker or offline cache", () => {
    const workers = files(path.join(root, "public"), [".js", ".mjs", ".webmanifest", ".json"])
      .filter((file) => /(^|[\\/])(sw|service-worker|serviceworker|workbox)[^\\/]*$/i.test(file) || /\.webmanifest$/.test(file));
    expect(workers.map((file) => path.relative(root, file))).toEqual([]);
    const registrations = ["app", "components", "lib", "modules"]
      .flatMap((directory) => files(path.join(root, directory), [".ts", ".tsx"]))
      .filter((file) => /serviceWorker\s*\.\s*register|caches\.open\(/.test(readFileSync(file, "utf8")));
    expect(registrations.map((file) => path.relative(root, file))).toEqual([]);
  });

  it("has no Next data cache on pages, and no static route", () => {
    const offenders = files(path.join(root, "app"), [".ts", ".tsx"])
      // The Apple Pay domain file and the two embed scripts are static files, not lists.
      .filter((file) => !file.includes(".well-known") && !file.includes("/embed/embed"))
      .filter((file) => /unstable_cache|["']use cache["']|export const revalidate|force-static/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attendee: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.attendee }));

import { AccessRestricted } from "@/components/access-restricted";
import { clubAccessClosed } from "@/components/club-access-closed";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { NO_STAFF_ACCESS_PATH } from "@/modules/access/login-routing";

const root = process.cwd();

function walk(dir: string, accept: (file: string) => boolean, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, accept, found);
    else if (accept(full)) found.push(full);
  }
  return found;
}

describe("AccessRestricted names who to ask (rule 14)", () => {
  it("requires whoToAsk at the type level and renders one consistent sentence", () => {
    // @ts-expect-error whoToAsk is required: leaving it out must not compile.
    const withoutWho = { title: "Closed", detail: "Not for your role." } satisfies Parameters<typeof AccessRestricted>[0];
    expect(withoutWho.title).toBe("Closed");
    const html = renderToStaticMarkup(createElement(AccessRestricted, { title: "Closed", detail: "Not for your role.", whoToAsk: "your club director" }));
    expect(html).toContain("Ask your club director if you need access.");
    expect(html).toContain('href="/help"');
  });

  it("passes whoToAsk at every <AccessRestricted usage in app, components and modules", () => {
    const files = ["app", "components", "modules"].flatMap((dir) => walk(join(root, dir), (file) => file.endsWith(".tsx")));
    const missing: string[] = [];
    let uses = 0;
    for (const file of files) {
      if (file.endsWith(join("components", "access-restricted.tsx"))) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<AccessRestricted\b([\s\S]*?)\/>/g)) {
        uses += 1;
        if (!/\bwhoToAsk=/.test(match[1])) missing.push(`${relative(root, file)}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(uses).toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });

  it("renders an h1 and can hide the Help link where Help would loop back", () => {
    const page = renderToStaticMarkup(createElement(AccessRestricted, { title: "Closed", detail: "Why.", whoToAsk: "a system administrator", headingLevel: 1, showHelpLink: false }));
    expect(page).toContain("<h1>Closed</h1>");
    expect(page).not.toContain('href="/help"');
    expect(renderToStaticMarkup(createElement(AccessRestricted, { title: "Closed", detail: "Why.", whoToAsk: "x" }))).toContain("<h2>Closed</h2>");
    const noAccess = readFileSync(join(root, "app/no-access/page.tsx"), "utf8");
    expect(noAccess.match(/headingLevel=\{1\}/g)).toHaveLength(2);
    expect(noAccess).toContain("showHelpLink={false}");
  });

  it("uses the plain not-available state, not an ask for access, where nothing was denied", () => {
    const wrong = ["people/staff-invitations/page.tsx", "people/staff-invitations/approvals/page.tsx"].filter((file) => /AccessRestricted[^>]*aren't used for club events/.test(readFileSync(join(root, "app/(workspace)", file), "utf8")));
    expect(wrong).toEqual([]);
    expect(readFileSync(join(root, "app/(workspace)/people/staff-invitations/page.tsx"), "utf8")).toContain("<NotAvailableForEvent");
  });

  it("does not repeat the ask inside a detail sentence", () => {
    const files = walk(join(root, "app"), (file) => file.endsWith(".tsx"));
    const repeated: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<AccessRestricted\b([\s\S]*?)\/>/g)) {
        const detail = match[1].match(/detail="([^"]*)"/)?.[1] ?? "";
        if (/\bask\b/i.test(detail)) repeated.push(`${relative(root, file)}: ${detail}`);
      }
    }
    expect(repeated).toEqual([]);
  });
});

describe("club portal pages never go blank after an access check (rule 14, break 1)", () => {
  /** Every `return null` that is allowed in a club portal page, by file and line. None of them follows an access check. */
  const allowed: Record<string, string[]> = {
    "orders/print/page.tsx": ["if (rows.length === 0) return null;"],
    "page.tsx": ["if (actor?.kind === \"STAFF_ACTING\") return null;", "if (!accountId) return null;", "if (!isClubFormsRole(access.club.role)) return null;"],
    "roster/[memberId]/health/page.tsx": [
      "if (error instanceof HealthRecordError && error.code === \"FORBIDDEN\") return null;",
      "if (needsAck(error)) return null;",
    ],
    "club-info/page.tsx": ["if (!profile) return null;"],
    "forms/submissions/[submissionId]/page.tsx": ["if (error instanceof ClubFormError && error.code === \"SUBMISSION_NOT_FOUND\") return null;"],
    "forms/submissions/[submissionId]/roster/page.tsx": ["if (error instanceof ClubFormError && error.code === \"SUBMISSION_NOT_FOUND\") return null;"],
    "forms/[templateKey]/new/page.tsx": ["if (error instanceof ClubFormError) return null;"],
  };
  const clubRoot = join(root, "app/(public)/account/(portal)/clubs/[organizationId]");

  it("allows only the listed non-access `return null` lines", () => {
    const unexpected: string[] = [];
    for (const file of walk(clubRoot, (name) => name.endsWith("page.tsx"))) {
      const rel = relative(clubRoot, file);
      const okLines = allowed[rel] ?? [];
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (/return null\b/.test(line) && !okLines.includes(line.trim())) unexpected.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(unexpected).toEqual([]);
  });

  it("never returns null straight after a state check on the roster access", () => {
    for (const file of walk(clubRoot, (name) => name.endsWith("page.tsx"))) {
      expect(readFileSync(file, "utf8"), relative(clubRoot, file)).not.toMatch(/access\.state !== "(OPEN|OK)"\) return null/);
    }
  });

  it("says who to ask for a role without the section, and adds nothing where the layout already shows the step", () => {
    const html = renderToStaticMarkup(clubAccessClosed({ state: "NO_ROSTER" }) as never);
    expect(html).toContain("Ask your club director if you need access.");
    expect(html).toContain("Permission required");
    for (const state of ["OWN_SESSION_REQUIRED", "MFA_SETUP", "MFA_UNLOCK", "SIGN_IN", "NOT_FOUND"]) expect(clubAccessClosed({ state })).toBeNull();
  });
});

describe("a signed-in attendee on a staff page (rule 14, break 3)", () => {
  beforeEach(() => {
    mocks.attendee.mockReset();
    mocks.headers.mockReset();
    mocks.headers.mockResolvedValue(new Headers({ "x-imsda-request-target": "/people" }));
  });

  it("goes to the access page, not Staff sign in", async () => {
    mocks.attendee.mockResolvedValue({ account: { id: "acct", verifiedEmail: "leader@example.test" }, via: "attendee", sessionId: "s1" });
    expect(await staffLoginRedirectPath()).toBe(NO_STAFF_ACCESS_PATH);
  });

  it("keeps signed-out visitors, and staff acting through their attendee side, on the staff sign-in", async () => {
    mocks.attendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await staffLoginRedirectPath()).toMatch(/^\/login/);
    mocks.attendee.mockResolvedValue({ account: { id: "acct", verifiedEmail: "staff@example.test" }, via: "staff", sessionId: null });
    expect(await staffLoginRedirectPath()).toMatch(/^\/login/);
    mocks.attendee.mockRejectedValue(new Error("database unreachable"));
    expect(await staffLoginRedirectPath()).toMatch(/^\/login/);
  });

  it("the access page cannot send an attendee back to the redirect that sent them there (no loop)", () => {
    const page = readFileSync(join(root, "app/no-access/page.tsx"), "utf8");
    expect(page).toContain('attendee.via !== "attendee"');
    expect(NO_STAFF_ACCESS_PATH.startsWith("/no-access")).toBe(true);
  });
});

describe("the permission API error uses plain words (rule 14, break 8)", () => {
  it("keeps 403 and PERMISSION_DENIED but never shows the raw permission key", async () => {
    const { requirePermission } = await import("@/modules/access/authorization");
    const lookup = async () => ({ eventId: "evt", userId: "u1", role: "READ_ONLY_STAFF" as const, status: "ACTIVE" as const, permissions: [] });
    const denied = await requirePermission({ user: { id: "u1", email: "staff@example.test", displayName: "Staff" } }, "evt", "CONFIGURE_EVENT", lookup).catch((error: unknown) => error);
    expect(denied).toMatchObject({ status: 403, code: "PERMISSION_DENIED", message: "Your event role doesn't include this. Ask your event administrator if you need access." });
    expect((denied as Error).message).not.toMatch(/CONFIGURE_EVENT|permission is required/);
  });
});

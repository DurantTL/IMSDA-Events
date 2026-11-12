import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: () => null }));
vi.mock("@/modules/security/request-nonce", () => ({ getRequestNonce: async () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const session = vi.hoisted(() => ({ staff: null as { id: string } | null, attendee: { account: null, via: null } as { account: { id: string } | null; via: "attendee" | "staff" | null }, throws: false }));
vi.mock("@/modules/access/current-session", () => ({
  getCurrentSession: async () => { if (session.throws) throw new Error("down"); return { user: session.staff }; },
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => session.attendee }));

import { GET as getManifest } from "@/app/site.webmanifest/route";
import { GET as getLaunch } from "@/app/launch/route";
import { metadata as rootMetadata, viewport as rootViewport } from "@/app/layout";
import { metadata as embedMetadata } from "@/app/(public)/embed/layout";
import { metadata as workspaceMetadata } from "@/app/(workspace)/layout";
import { buildSiteManifest, SITE_APP_COLOR, SITE_LAUNCH_PATH, SITE_MANIFEST_PATH } from "@/lib/site-web-app";
import { STAFF_MANIFEST_PATH } from "@/lib/staff-web-app";

const root = process.cwd();

describe("site manifest (#1713)", () => {
  const manifest = buildSiteManifest();

  it("has a stable id, standalone display and the launch route as start_url", () => {
    expect(manifest).toMatchObject({ id: "/", start_url: SITE_LAUNCH_PATH, scope: "/", display: "standalone", name: "IMAdventist" });
    expect(manifest.theme_color).toBe(SITE_APP_COLOR);
    expect(JSON.stringify({ id: manifest.id, start_url: manifest.start_url, scope: manifest.scope })).not.toMatch(/[?#=]|token|session/i);
  });

  it("lists 192 and 512 icons plus a maskable one, all on disk", () => {
    const any = manifest.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
    expect(any).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
    for (const icon of manifest.icons) expect(existsSync(path.join(root, "public", icon.src))).toBe(true);
  });

  it("is served as public brand data with no cookie", async () => {
    const response = getManifest();
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual(manifest);
  });

  it("is linked from the root layout, replaced in the staff workspace and removed from embed pages", () => {
    expect(rootMetadata.manifest).toBe(SITE_MANIFEST_PATH);
    expect(rootMetadata.appleWebApp).toMatchObject({ capable: true, title: "IMAdventist" });
    expect(rootViewport.themeColor).toBe(SITE_APP_COLOR);
    expect(workspaceMetadata.manifest).toBe(STAFF_MANIFEST_PATH);
    expect(embedMetadata.manifest).toBeNull();
    expect(embedMetadata.appleWebApp).toBeNull();
  });

  it("is the only layout-level manifest outside the staff workspace and embed", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/^(layout|page)\.tsx$/.test(entry.name) && /\bmanifest\s*:/.test(readFileSync(full, "utf8"))) hits.push(path.relative(root, full).replaceAll("\\", "/"));
      }
    };
    walk(path.join(root, "app"));
    expect(hits.sort()).toEqual(["app/(public)/embed/layout.tsx", "app/(workspace)/layout.tsx", "app/layout.tsx"]);
  });
});

describe("launch route (#1713)", () => {
  beforeEach(() => { session.staff = null; session.attendee = { account: null, via: null }; session.throws = false; });
  const outcome = async () => {
    const response = await getLaunch();
    return { status: response.status, location: response.headers.get("location"), cache: response.headers.get("cache-control"), body: await response.text() };
  };

  it("sends a staff session to Home", async () => {
    session.staff = { id: "u1" };
    expect(await outcome()).toEqual({ status: 307, location: "/home", cache: "no-store", body: "" });
  });

  it("sends a staff session with an attendee account to Home too", async () => {
    session.staff = { id: "u1" };
    session.attendee = { account: { id: "a1" }, via: "attendee" };
    expect((await outcome()).location).toBe("/home");
  });

  it("sends a signed-in account to the account page", async () => {
    session.attendee = { account: { id: "a1" }, via: "attendee" };
    expect(await outcome()).toEqual({ status: 307, location: "/account", cache: "no-store", body: "" });
  });

  it("sends a signed-out visitor, and a failed lookup, to the public home page", async () => {
    expect(await outcome()).toEqual({ status: 307, location: "/", cache: "no-store", body: "" });
    session.throws = true;
    expect((await outcome()).location).toBe("/");
  });

  it("never reads a target from the request", () => {
    const source = readFileSync(path.join(root, "app/launch/route.ts"), "utf8");
    expect(source).toContain("export async function GET()");
    expect(source).not.toMatch(/searchParams|nextUrl|request\.url|\bnext\b\s*=/);
  });
});

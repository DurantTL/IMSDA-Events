import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: () => null }));
vi.mock("@/modules/security/request-nonce", () => ({ getRequestNonce: async () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
import { GET } from "@/app/staff.webmanifest/route";
import { metadata as rootMetadata } from "@/app/layout";
import { metadata as workspaceMetadata, viewport as workspaceViewport } from "@/app/(workspace)/layout";
import { buildStaffManifest, STAFF_MANIFEST_PATH } from "@/lib/staff-web-app";

const root = process.cwd();

describe("staff saved app (#1567)", () => {
  const manifest = buildStaffManifest();

  it("has a stable identity, scope and a fixed launch address", () => {
    expect(manifest).toMatchObject({ id: "/home", start_url: "/home", scope: "/", display: "standalone" });
    for (const value of [manifest.id, manifest.start_url]) expect(value).toMatch(/^\/[a-z-]*$/);
    expect(JSON.stringify({ id: manifest.id, start_url: manifest.start_url, scope: manifest.scope })).not.toMatch(/[?#=]|token|session/i);
  });

  it("lists icons that exist on disk with matching sizes", () => {
    for (const icon of manifest.icons) {
      expect(icon.purpose).toBe("any");
      expect(existsSync(path.join(root, "public", icon.src))).toBe(true);
    }
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("serves public brand data only, with no cookie", async () => {
    const response = GET();
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual(manifest);
  });

  it("links the manifest from the staff workspace only", () => {
    expect(workspaceMetadata.manifest).toBe(STAFF_MANIFEST_PATH);
    expect(workspaceMetadata.appleWebApp).toMatchObject({ capable: true, title: "IMAdventist" });
    expect(workspaceViewport.themeColor).toBeTruthy();
    expect(rootMetadata.manifest).toBeUndefined();
    expect(rootMetadata.appleWebApp).toBeUndefined();
  });

  it("adds no service worker, cache headers or storage to the route", () => {
    const source = readFileSync(path.join(root, "app/staff.webmanifest/route.ts"), "utf8");
    expect(source).not.toMatch(/cache-control|serviceWorker|caches\./i);
  });
});

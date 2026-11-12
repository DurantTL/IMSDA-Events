import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The installable web app (#1713) has no service worker and no Cache API use, so no account, health-record or payment page
 * is ever stored on a device by the app itself. A future service worker (push alerts, #1713) must exclude account,
 * health-record and payment pages from every cache and be added to this allowlist, with that review, in the same change.
 */
const ALLOWLIST: string[] = [];

const ROOTS = ["app", "components", "lib", "modules", "public"];
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const PATTERN = /serviceWorker\b|ServiceWorkerGlobalScope|\bcaches\s*\.\s*(?:open|match|matchAll|keys|has|delete)\s*\(|\bCacheStorage\b|\bworkbox\b/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : SOURCE.test(entry.name) ? [full] : [];
  });
}

describe("no service worker or Cache API (#1713)", () => {
  it("registers no service worker and uses no Cache API outside the allowlist", () => {
    const base = process.cwd();
    const offenders = ROOTS.flatMap((root) => files(path.join(base, root)))
      .map((file) => path.relative(base, file).replaceAll("\\", "/"))
      .filter((file) => !ALLOWLIST.includes(file))
      .filter((file) => PATTERN.test(readFileSync(path.join(base, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("has no service worker file anywhere in public/", () => {
    const names = files(path.join(process.cwd(), "public")).map((file) => path.basename(file).toLowerCase());
    expect(names.filter((name) => /^(?:sw|service-?worker|serviceworker|workbox[\w.-]*)\.[cm]?js$|^sw[-.]/.test(name))).toEqual([]);
  });
});

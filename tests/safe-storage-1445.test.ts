import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeStorage, safeGetItem, safeKeys, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";
import { rememberAttendeeAuthReturnPath, takeAttendeeAuthReturnPath } from "@/modules/attendee-accounts/sign-up-prefill";

/**
 * #1445: a privacy browser, blocked site data, a private window or an embedded frame can make `window.localStorage`
 * throw on the property read itself, or make a write throw. The page must render and work without storage.
 */

function stubWindow(storages: { localStorage?: () => Storage; sessionStorage?: () => Storage }) {
  const fake: Record<string, unknown> = {};
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(fake, name, { get: storages[name] ?? (() => { throw new DOMException("The operation is insecure.", "SecurityError"); }) });
  }
  vi.stubGlobal("window", fake);
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("safe storage helper", () => {
  it("returns nothing and never throws when the browser refuses storage", () => {
    stubWindow({});
    expect(getSafeStorage("local")).toBeNull();
    expect(getSafeStorage("session")).toBeNull();
    expect(safeGetItem("local", "k")).toBeNull();
    expect(safeSetItem("session", "k", "v")).toBe(false);
    expect(() => safeRemoveItem("local", "k")).not.toThrow();
    expect(safeKeys("local")).toEqual([]);
  });

  it("returns nothing when a write throws (storage full)", () => {
    const full = { ...memoryStorage(), setItem: () => { throw new DOMException("full", "QuotaExceededError"); } } as Storage;
    stubWindow({ localStorage: () => full });
    expect(safeSetItem("local", "k", "v")).toBe(false);
    expect(safeGetItem("local", "k")).toBeNull();
  });

  it("works normally when storage is there", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    stubWindow({ localStorage: () => local, sessionStorage: () => session });
    expect(safeSetItem("local", "a", "1")).toBe(true);
    expect(safeGetItem("local", "a")).toBe("1");
    expect(safeKeys("local")).toEqual(["a"]);
    safeRemoveItem("local", "a");
    expect(safeGetItem("local", "a")).toBeNull();
  });

  it("sign-in's return path survives blocked storage: nothing is remembered and nothing throws", () => {
    stubWindow({});
    expect(rememberAttendeeAuthReturnPath("/manage/abc_DEF-123")).toBe("/manage/abc_DEF-123");
    expect(takeAttendeeAuthReturnPath()).toBeNull();
  });

  it("sign-in's return path is remembered when storage works", () => {
    const session = memoryStorage();
    stubWindow({ sessionStorage: () => session });
    rememberAttendeeAuthReturnPath("/manage/abc_DEF-123");
    expect(takeAttendeeAuthReturnPath()).toBe("/manage/abc_DEF-123");
    expect(takeAttendeeAuthReturnPath()).toBeNull();
  });
});

const ROOTS = ["app", "components", "modules", "lib"];
const ACCESS = /\b(?:window\.)?(?:localStorage|sessionStorage|indexedDB)\b\s*(?:\.|\[)/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("every raw storage access is inside try/catch (or goes through lib/safe-storage)", () => {
  it("finds no unguarded localStorage, sessionStorage or IndexedDB access", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(process.cwd(), root))) {
        const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
        if (relative === "lib/safe-storage.ts") continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
          if (!ACCESS.test(line)) return;
          // A try { within the 14 lines above (or on this line) guards the access.
          const window = lines.slice(Math.max(0, index - 14), index + 1).join("\n");
          if (!/\btry\s*\{/.test(window)) offenders.push(`${relative}:${index + 1}: ${code}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

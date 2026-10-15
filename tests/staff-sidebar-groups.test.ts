import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sidebarActiveHref } from "@/components/staff-navigation";
import {
  dismissalAfterNavigation,
  getSidebarGroupsServerSnapshot,
  getSidebarGroupsSnapshot,
  readSidebarGroups,
  resetSidebarGroupsCache,
  resolveSidebarGroupOpen,
  setSidebarGroupOpen,
  sidebarGroupsStorageKey,
  subscribeSidebarGroups,
  writeSidebarGroups,
} from "@/components/sidebar-groups";

/** Collapsible sidebar groups (#964): saved state and the open rule. Synthetic data only. */

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe("saved group state", () => {
  it("round-trips the choices", () => {
    const storage = memory();
    expect(readSidebarGroups(storage)).toEqual({});
    writeSidebarGroups({ setup: true, reports: false }, storage);
    expect(storage.data.get(sidebarGroupsStorageKey)).toBe(JSON.stringify({ setup: true, reports: false }));
    expect(readSidebarGroups(storage)).toEqual({ setup: true, reports: false });
  });

  it("reads nothing saved from broken or unexpected content", () => {
    for (const raw of ["{", "null", "[1]", "\"x\"", "42", ""]) {
      const storage = memory();
      storage.data.set(sidebarGroupsStorageKey, raw);
      expect(readSidebarGroups(storage), raw).toEqual({});
    }
    const storage = memory();
    storage.data.set(sidebarGroupsStorageKey, JSON.stringify({ setup: "yes", reports: true }));
    expect(readSidebarGroups(storage)).toEqual({ reports: true });
  });

  it("never throws when storage is unavailable", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readSidebarGroups(broken)).toEqual({});
    expect(() => writeSidebarGroups({ setup: true }, broken)).not.toThrow();
    // No window in this environment: the default storage lookup also fails safe.
    expect(readSidebarGroups()).toEqual({});
    expect(() => writeSidebarGroups({ setup: true })).not.toThrow();
    expect(getSidebarGroupsServerSnapshot()).toEqual({});
  });
});

describe("open rule", () => {
  const open = (saved: boolean | undefined, containsCurrentPage: boolean, dismissedOnThisPage = false) =>
    resolveSidebarGroupOpen({ saved, containsCurrentPage, dismissedOnThisPage });

  it("is closed by default and follows the saved choice", () => {
    expect(open(undefined, false)).toBe(false);
    expect(open(false, false)).toBe(false);
    expect(open(true, false)).toBe(true);
  });

  it("opens by itself for the current page, even when saved closed", () => {
    expect(open(undefined, true)).toBe(true);
    expect(open(false, true)).toBe(true);
  });

  it("stays closed after the viewer closes it on the page they are on", () => {
    expect(open(true, true, true)).toBe(false);
    expect(open(undefined, true, true)).toBe(false);
  });
});

describe("parent pages reach the items that left the sidebar (#964)", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

  it("Registrations links Attendee list, and Imports only with MANAGE_IMPORTS", () => {
    const workspace = read("components/people-workspace.tsx");
    expect(workspace).toContain("/people/attendees?event=${encodeURIComponent(eventId)}");
    expect(workspace).toMatch(/\{canImport && <li><a href=\{`\/imports\?event=\$\{encodeURIComponent\(eventId\)\}`\}>/);
    expect(read("app/(workspace)/people/page.tsx")).toContain('canImport={permissions.includes("MANAGE_IMPORTS")}');
  });

  it("Payments links Promo codes on a page that already requires MANAGE_FINANCE", () => {
    expect(read("components/finance-workspace.tsx")).toContain("/more/promo-codes?event=${eventId}");
    expect(read("app/(workspace)/finance/page.tsx")).toContain('permissions.includes("MANAGE_FINANCE")');
  });
});

describe("closing a group lasts for one page", () => {
  const dismissed = { section: "setup", pathname: "/more/tags" };

  it("keeps it on the same page and forgets it on any navigation, including coming back", () => {
    expect(dismissalAfterNavigation(dismissed, "/more/tags", "/more/tags")).toBe(dismissed);
    let state: typeof dismissed | null = dismissed;
    state = dismissalAfterNavigation(state, "/more/tags", "/more/event-settings");
    expect(state).toBeNull();
    state = dismissalAfterNavigation(state, "/more/event-settings", "/more/tags");
    expect(state).toBeNull();
    // With nothing dismissed, the group opens for the page again.
    expect(resolveSidebarGroupOpen({ saved: undefined, containsCurrentPage: true, dismissedOnThisPage: false })).toBe(true);
  });
});

describe("which item a page lights", () => {
  it("lights the page's own item, its visible parent, or More when the parent is hidden", () => {
    const imports = { href: "/imports", sidebarParent: "/people" };
    expect(sidebarActiveHref({ href: "/finance" }, new Set(["/finance"]))).toBe("/finance");
    expect(sidebarActiveHref(imports, new Set(["/people", "/more"]))).toBe("/people");
    expect(sidebarActiveHref(imports, new Set(["/more"]))).toBe("/more");
  });
});

describe("store", () => {
  const data = new Map<string, string>();
  const handlers = new Set<(event: { key: string | null }) => void>();

  function stubBrowser() {
    data.clear();
    handlers.clear();
    resetSidebarGroupsCache();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      },
      addEventListener: (type: string, handler: (event: { key: string | null }) => void) => { if (type === "storage") handlers.add(handler); },
      removeEventListener: (type: string, handler: (event: { key: string | null }) => void) => { if (type === "storage") handlers.delete(handler); },
    });
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSidebarGroupsCache();
  });

  it("saves, notifies, and keeps the snapshot stable between changes", () => {
    stubBrowser();
    const listener = vi.fn();
    const unsubscribe = subscribeSidebarGroups(listener);
    const first = getSidebarGroupsSnapshot();
    expect(getSidebarGroupsSnapshot()).toBe(first);
    setSidebarGroupOpen("setup", true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSidebarGroupsSnapshot()).toEqual({ setup: true });
    expect(JSON.parse(data.get(sidebarGroupsStorageKey) ?? "{}")).toEqual({ setup: true });
    setSidebarGroupOpen("reports", true);
    setSidebarGroupOpen("setup", false);
    expect(getSidebarGroupsSnapshot()).toEqual({ setup: false, reports: true });
    unsubscribe();
  });

  it("still works in memory when storage throws", () => {
    stubBrowser();
    vi.stubGlobal("window", {
      localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const listener = vi.fn();
    const unsubscribe = subscribeSidebarGroups(listener);
    expect(() => setSidebarGroupOpen("setup", true)).not.toThrow();
    expect(getSidebarGroupsSnapshot()).toEqual({ setup: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("follows another tab through the storage event and removes the listener on unsubscribe", () => {
    stubBrowser();
    const listener = vi.fn();
    const unsubscribe = subscribeSidebarGroups(listener);
    expect(handlers.size).toBe(1);
    data.set(sidebarGroupsStorageKey, JSON.stringify({ reports: true }));
    handlers.forEach((handler) => handler({ key: sidebarGroupsStorageKey }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSidebarGroupsSnapshot()).toEqual({ reports: true });
    handlers.forEach((handler) => handler({ key: "something-else" }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(handlers.size).toBe(0);
  });
});

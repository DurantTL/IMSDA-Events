import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import {
  HOME_ROLE_DEFAULTS,
  defaultHomeLayout,
  moveAnnouncement,
  moveItem,
  resolveHomeLayout,
  sanitizeHomeLayoutInput,
} from "@/modules/system-admin/home-layout-domain";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const none: AdminRoles = { systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: [] };
const system: AdminRoles = { systemAdmin: true, clubsAdministrator: false, eventAdminEventIds: [] };
const clubs: AdminRoles = { ...none, clubsAdministrator: true };
const events: AdminRoles = { ...none, eventAdminEventIds: ["evt_1"] };
const eventsAndClubs: AdminRoles = { ...none, clubsAdministrator: true, eventAdminEventIds: ["evt_1"] };

const keys = (layout: { modules: { key: string; shown: boolean }[] }) => layout.modules.map((m) => `${m.key}:${m.shown ? "on" : "off"}`);

describe("Home layout defaults (#1705)", () => {
  it("keeps the defaults in one table", () => {
    expect(HOME_ROLE_DEFAULTS).toEqual({ SYSTEM_ADMIN: ["needs-you"], EVENTS_ADMIN: ["needs-you", "coming-up"], CLUBS_ADMIN: ["needs-you"] });
  });

  it("gives each role its own default set and lists the rest turned off", () => {
    expect(keys(resolveHomeLayout(null, system))).toEqual(["needs-you:on", "coming-up:off"]);
    expect(keys(resolveHomeLayout(null, clubs))).toEqual(["needs-you:on", "coming-up:off"]);
    expect(keys(resolveHomeLayout(null, events))).toEqual(["needs-you:on", "coming-up:on"]);
    expect(resolveHomeLayout(null, events).customized).toBe(false);
  });

  it("merges roles in System, Events, Clubs order without repeats", () => {
    expect(defaultHomeLayout(["EVENTS_ADMIN", "CLUBS_ADMIN"])).toEqual([{ key: "needs-you", shown: true }, { key: "coming-up", shown: true }]);
    expect(defaultHomeLayout(["CLUBS_ADMIN", "SYSTEM_ADMIN"])).toEqual([{ key: "needs-you", shown: true }, { key: "coming-up", shown: false }]);
    expect(keys(resolveHomeLayout(null, eventsAndClubs))).toEqual(["needs-you:on", "coming-up:on"]);
  });

  it("Reset is the same list as nothing saved", () => {
    const saved = [{ key: "coming-up", shown: true }, { key: "needs-you", shown: true }];
    expect(resolveHomeLayout(saved, events).customized).toBe(true);
    expect(resolveHomeLayout(null, events)).toEqual(resolveHomeLayout(undefined, events));
  });
});

describe("Home layout resolving (#1705)", () => {
  it("keeps a saved order and hidden modules in their place", () => {
    const layout = resolveHomeLayout([{ key: "coming-up", shown: false }, { key: "needs-you", shown: true }], events);
    expect(keys(layout)).toEqual(["coming-up:off", "needs-you:on"]);
    expect(layout.customized).toBe(true);
  });

  it("skips unknown and unusable keys, and repeats", () => {
    const layout = resolveHomeLayout([{ key: "money", shown: true }, { key: "needs-you", shown: true }, { key: "needs-you", shown: false }, null, 4, { key: 7 }], clubs);
    expect(keys(layout)).toEqual(["needs-you:on", "coming-up:off"]);
    expect(resolveHomeLayout([{ key: "needs-you", shown: true }], none).modules).toEqual([]);
  });

  it("never hides Needs you", () => {
    expect(keys(resolveHomeLayout([{ key: "needs-you", shown: false }], events))[0]).toBe("needs-you:on");
    expect(sanitizeHomeLayoutInput([{ key: "needs-you", shown: false }], events)).toEqual([{ key: "needs-you", shown: true }, { key: "coming-up", shown: false }]);
  });

  it("falls back to the defaults for malformed saved data", () => {
    for (const bad of ["x", 4, {}, [], [{ key: "nope" }], [null]]) {
      expect(resolveHomeLayout(bad, events)).toEqual(resolveHomeLayout(null, events));
    }
  });

  it("appends a newly usable module hidden at the end", () => {
    expect(keys(resolveHomeLayout([{ key: "needs-you", shown: true }], events))).toEqual(["needs-you:on", "coming-up:off"]);
  });

  it("rejects input that is not a usable list", () => {
    expect(sanitizeHomeLayoutInput("nope", events)).toBeNull();
    expect(sanitizeHomeLayoutInput([], events)).toBeNull();
    expect(sanitizeHomeLayoutInput([{ key: "money", shown: true }], events)).toBeNull();
    expect(sanitizeHomeLayoutInput(Array.from({ length: 500 }, () => ({ key: "coming-up", shown: true })), events)).toEqual([{ key: "coming-up", shown: true }, { key: "needs-you", shown: true }]);
  });

  it("moves items and words the move", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -4)).toEqual(["c", "a", "b"]);
    expect(moveAnnouncement("Coming up", 2, 6)).toBe("Coming up moved to position 2 of 6");
  });
});

// Actions: a fake store keyed by user id, and a session that tests set.
const store = new Map<string, unknown>();
const writes: string[] = [];
let sessionUser: { id: string; globalRole: string | null } | null = null;
let roles: AdminRoles = none;
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: sessionUser }) }));
vi.mock("@/modules/access/admin-roles", () => ({ resolveAdminRoles: async () => roles }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    staffHomeLayout: {
      findUnique: async ({ where }: { where: { userId: string } }) => (store.has(where.userId) ? { modules: store.get(where.userId) } : null),
      upsert: async ({ create }: { create: { userId: string; modules: unknown } }) => { writes.push(create.userId); store.set(create.userId, create.modules); },
      deleteMany: async ({ where }: { where: { userId: string } }) => { writes.push(where.userId); store.delete(where.userId); },
    },
  }),
}));

const { saveHomeLayoutAction, resetHomeLayoutAction } = await import("@/app/(workspace)/home/actions");
const { loadHomeLayout } = await import("@/modules/system-admin/home-layout-repository");

const swap = [{ key: "coming-up", shown: true }, { key: "needs-you", shown: true }];

beforeEach(() => { store.clear(); writes.length = 0; sessionUser = null; roles = none; });

describe("Home layout saving (#1705)", () => {
  it.each([["System admin", system], ["Clubs admin", clubs], ["Events admin for one event", events], ["Events and Clubs admin", eventsAndClubs]] as const)("saves and returns the layout for a %s", async (_name, held) => {
    sessionUser = { id: "user_a", globalRole: null };
    roles = held;
    const result = await saveHomeLayoutAction(swap);
    expect(result).toMatchObject({ ok: true });
    expect(writes).toEqual(["user_a"]);
    expect(keys(await loadHomeLayout("user_a", held))).toEqual(["coming-up:on", "needs-you:on"]);
    const reset = await resetHomeLayoutAction();
    expect(reset).toMatchObject({ ok: true, layout: { customized: false } });
    expect(store.has("user_a")).toBe(false);
  });

  it("refuses a person with no admin role and writes nothing", async () => {
    sessionUser = { id: "user_b", globalRole: null };
    expect(await saveHomeLayoutAction(swap)).toMatchObject({ ok: false });
    expect(await resetHomeLayoutAction()).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("refuses a signed-out request and writes nothing", async () => {
    roles = system;
    expect(await saveHomeLayoutAction(swap)).toMatchObject({ ok: false });
    expect(await resetHomeLayoutAction()).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("writes only the session user even when the input names another id", async () => {
    sessionUser = { id: "user_a", globalRole: null };
    roles = events;
    await saveHomeLayoutAction(Object.assign([...swap], { userId: "user_x" }).map((entry) => ({ ...entry, userId: "user_x" })));
    expect(writes).toEqual(["user_a"]);
    expect(store.has("user_x")).toBe(false);
  });

  it("refuses unusable input and never returns one person's layout for another", async () => {
    sessionUser = { id: "user_a", globalRole: null };
    roles = events;
    expect(await saveHomeLayoutAction("nope")).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
    await saveHomeLayoutAction(swap);
    expect(keys(await loadHomeLayout("user_b", events))).toEqual(["needs-you:on", "coming-up:on"]);
  });
});

describe("Home board render (#1705)", () => {
  it("shows Arrange, Customize, handle names and the shown cards for an admin", async () => {
    const { StaffHomeBoard } = await import("@/components/staff-home-board");
    const modules = resolveHomeLayout(null, events).modules;
    const html = renderToStaticMarkup(createElement(StaffHomeBoard, { modules, bodies: { "needs-you": "Body A", "coming-up": "Body B" } }));
    expect(html).toContain(">Arrange<");
    expect(html).toContain(">Customize<");
    expect(html).toContain("<h2");
    expect(html).toContain("Body A");
    expect(html).toContain('aria-live="polite"');
  });

  it("lists only shown modules as cards and says a shown one without a body is loading", async () => {
    const { StaffHomeBoard } = await import("@/components/staff-home-board");
    const modules = resolveHomeLayout(null, clubs).modules;
    const html = renderToStaticMarkup(createElement(StaffHomeBoard, { modules, bodies: { "needs-you": "Body A" } }));
    expect(html).toContain('data-module="needs-you"');
    expect(html).not.toContain('data-module="coming-up"');
  });

  it("gives every card a named 44px handle in Arrange mode", async () => {
    const { StaffHomeBoard } = await import("@/components/staff-home-board");
    const { readFileSync } = await import("node:fs");
    const modules = resolveHomeLayout(null, events).modules;
    const html = renderToStaticMarkup(createElement(StaffHomeBoard, { modules, bodies: { "needs-you": "A", "coming-up": "B" }, defaultArranging: true }));
    expect(html).toContain('aria-label="Move Needs you"');
    expect(html).toContain('aria-label="Move Coming up"');
    expect(html).toContain('aria-pressed="true"');
    const css = readFileSync("components/staff-home-board.module.css", "utf8");
    expect(css).toMatch(/\.handle \{[^}]*width: var\(--touch-target, 44px\)[^}]*touch-action: none/);
  });

  it("reorders shown modules into the slots shown ones held, so hidden keep their place", async () => {
    const { reorderShown } = await import("@/components/staff-home-board");
    const modules = [
      { key: "needs-you", label: "Needs you", shown: true, hideable: false },
      { key: "coming-up", label: "Coming up", shown: false, hideable: true },
    ] as const;
    expect(reorderShown([...modules], ["needs-you"]).map((m) => m.key)).toEqual(["needs-you", "coming-up"]);
  });
});

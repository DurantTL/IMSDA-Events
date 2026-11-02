import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { PortalHelpSearch, type PortalHubGuide } from "@/app/(public)/account/(portal)/help/portal-help-search";
import { filterGuides } from "@/modules/help/visibility";
import { visiblePortalGuides, type PortalHelpViewer } from "@/modules/help/portal-visibility";
import type { PrismaClient } from "@prisma/client";
import { pickOrphanedSamplePeople, restoreOtherClubs, setEventsPublished, walkthroughRosterPerson } from "@/scripts/support/help-walkthrough-fixtures";
import { RunStopped, runSetupSteps, throwIfStopping } from "@/scripts/support/walkthrough-setup";
import {
  applyRestoreState,
  databaseNameOf,
  isOwnRegularFile,
  readRestoreMarker,
  recoverFromLeftoverMarker,
  restoreMarkerFile,
  writeRestoreMarker,
  type RestoreState,
} from "@/scripts/support/walkthrough-restore";

/** Help search finds the walkthroughs (#1482, rules H5, S1, S4, S5), and a killed walkthrough run is repaired by the next one. */
const none: PortalHelpViewer = { hasAccount: true, directedClubs: [], isAreaCoordinator: false, acting: null };
const director: PortalHelpViewer = { ...none, directedClubs: [{ organizationId: "club_1", role: "DIRECTOR" }] };
const coordinator: PortalHelpViewer = { ...none, isAreaCoordinator: true };
const hubGuides = (viewer: PortalHelpViewer): PortalHubGuide[] =>
  visiblePortalGuides(viewer).map(({ id, title, summary, audience, keywords }) => ({ id, title, summary, audience, keywords }));
const found = (viewer: PortalHelpViewer, query: string) => filterGuides(hubGuides(viewer), query).map((guide) => guide.id);

describe("portal Help search", () => {
  it("finds the director walkthroughs by what a director would type", () => {
    expect(found(director, "step by step").filter((id) => id.startsWith("walkthrough-director-"))).toHaveLength(10);
    expect(found(director, "passkey")).toContain("walkthrough-director-two-step");
    expect(found(director, "roster")).toContain("walkthrough-director-roster");
    expect(found(director, "emailed code")).toContain("walkthrough-director-first-sign-in");
    expect(found(director, "forms help")).toContain("walkthrough-director-get-help");
  });

  it("finds the coordinator walkthroughs for a coordinator, and none of them for a director-only viewer", () => {
    expect(found(coordinator, "step by step").filter((id) => id.startsWith("walkthrough-coordinator-"))).toHaveLength(6);
    expect(found(coordinator, "no director")).toContain("walkthrough-coordinator-no-director");
    expect(found(coordinator, "points")).toContain("walkthrough-coordinator-points");
    for (const query of ["step by step", "points", "no director", "who's missing what", "monthly records", ""]) {
      expect(found(director, query).filter((id) => id.startsWith("walkthrough-coordinator-")), query).toEqual([]);
    }
  });

  it("sends the browser only id, title, summary, audience and keywords", () => {
    for (const guide of hubGuides(director)) expect(Object.keys(guide).sort()).toEqual(["audience", "id", "keywords", "summary", "title"]);
  });

  it("renders the whole list with a labelled search box and a polite count, which is what shows with JavaScript off", () => {
    const html = renderToStaticMarkup(createElement(PortalHelpSearch, { guides: hubGuides(director) }));
    expect(html).toContain("Search the guides");
    expect(html).toContain('type="search"');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/\d+ guides available\./);
    for (const guide of hubGuides(director)) expect(html, guide.id).toContain(`/account/help/${guide.id}`);
    expect(html).toContain("Your club");
    expect(html).not.toContain("Club coordination");
    expect(html).not.toContain("walkthrough-coordinator-");
  });
});

describe("restoring after a killed walkthrough run", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "imsda-restore-test-"));
  afterEach(() => rmSync(path.join(dir, "marker.json"), { force: true }));
  const state: RestoreState = {
    database: "imsda_events",
    hiddenClubs: ["club_a", "club_b"],
    hiddenEvents: ["evt_a"],
    templates: [{ key: "can_collecting_report", enabled: false, requirement: "NOT_REQUIRED", requiredRoles: [] }],
    passkeyRpId: null,
  };
  const fakePrisma = () => {
    const calls: string[] = [];
    const prisma = {
      clubFormTemplate: { updateMany: async (args: { where: { key: string }; data: { enabled: boolean } }) => void calls.push(`template ${args.where.key} enabled=${args.data.enabled}`) },
      organization: { updateMany: async (args: { where: { id: { in: string[] } }; data: { isActive: boolean } }) => void calls.push(`clubs ${args.where.id.in.join(",")} active=${args.data.isActive}`) },
      event: { updateMany: async (args: { where: { id: { in: string[] } }; data: { isPublished: boolean } }) => void calls.push(`events ${args.where.id.in.join(",")} published=${args.data.isPublished}`) },
      platformSettings: { update: async (args: { data: { passkeyRpId: string | null } }) => void calls.push(`passkey ${args.data.passkeyRpId}`) },
    } as unknown as PrismaClient;
    return { prisma, calls };
  };

  it("keeps the marker out of the repository", () => {
    expect(restoreMarkerFile({})).toBe(path.join(os.tmpdir(), `imsda-help-walkthroughs-restore-${os.userInfo().uid}.json`));
    expect(path.resolve(restoreMarkerFile({})).startsWith(path.resolve(process.cwd()))).toBe(false);
  });

  it("never writes over what is already there, and ignores a symlink or a file that is not the user's own", () => {
    const file = path.join(dir, "marker.json");
    writeRestoreMarker(file, state);
    expect(() => writeRestoreMarker(file, state)).toThrow(/Refusing to write/);
    expect(isOwnRegularFile(file)).toBe(true);
    rmSync(file);
    const target = path.join(dir, "target.json");
    writeFileSync(target, JSON.stringify(state));
    symlinkSync(target, file);
    expect(isOwnRegularFile(file)).toBe(false);
    expect(readRestoreMarker(file)).toBeNull();
    expect(() => writeRestoreMarker(file, state)).toThrow(/Refusing to write/);
    rmSync(target);
  });

  it("round-trips a saved state and refuses a broken one", () => {
    const file = path.join(dir, "marker.json");
    expect(readRestoreMarker(file)).toBeNull();
    writeRestoreMarker(file, state);
    expect(readRestoreMarker(file)).toEqual(state);
    writeFileSync(file, "{ not json");
    expect(readRestoreMarker(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ ...state, hiddenClubs: "club_a" }));
    expect(readRestoreMarker(file)).toBeNull();
  });

  it("puts back the templates, the hidden clubs and the passkey setting", async () => {
    const { prisma, calls } = fakePrisma();
    expect(await applyRestoreState(prisma, { ...state, passkeyRpId: "events.example.org" })).toEqual([]);
    expect(calls).toEqual(["template can_collecting_report enabled=false", "clubs club_a,club_b active=true", "events evt_a published=true", "passkey events.example.org"]);
  });

  it("restores from a leftover marker and removes it, so a killed run is repaired by the next", async () => {
    const file = path.join(dir, "marker.json");
    writeRestoreMarker(file, state);
    const { prisma, calls } = fakePrisma();
    expect(await recoverFromLeftoverMarker(prisma, file, "imsda_events", () => undefined)).toBe(true);
    expect(calls).toHaveLength(4);
    expect(existsSync(file)).toBe(false);
    // Nothing left to restore the second time.
    expect(await recoverFromLeftoverMarker(prisma, file, "imsda_events", () => undefined)).toBe(false);
  });

  it("leaves a marker from another database alone, and keeps one it could not apply", async () => {
    const file = path.join(dir, "marker.json");
    writeRestoreMarker(file, state);
    const other = fakePrisma();
    expect(await recoverFromLeftoverMarker(other.prisma, file, "some_other_db", () => undefined)).toBe(false);
    expect(other.calls).toEqual([]);
    expect(existsSync(file)).toBe(true);
    const broken = {
      clubFormTemplate: { updateMany: async () => { throw new Error("db down"); } },
      organization: { updateMany: async () => undefined },
      event: { updateMany: async () => undefined },
      platformSettings: { update: async () => undefined },
    } as unknown as PrismaClient;
    await expect(recoverFromLeftoverMarker(broken, file, "imsda_events", () => undefined)).rejects.toThrow(/db down/);
    expect(existsSync(file)).toBe(true);
  });

  it("reads a marker written before events were hidden as having none to put back", () => {
    const file = path.join(dir, "marker.json");
    const { hiddenEvents, ...older } = state;
    void hiddenEvents;
    writeFileSync(file, JSON.stringify(older));
    expect(readRestoreMarker(file)?.hiddenEvents).toEqual([]);
  });

  it("only ever updates club organisations and club events when it restores", async () => {
    const wheres: unknown[] = [];
    const prisma = {
      organization: { updateMany: async (args: { where: unknown }) => void wheres.push(args.where) },
      event: { updateMany: async (args: { where: unknown }) => void wheres.push(args.where) },
    } as unknown as PrismaClient;
    await restoreOtherClubs(prisma, ["a"]);
    await setEventsPublished(prisma, ["b"], true);
    expect(wheres).toEqual([{ id: { in: ["a"] }, type: "CLUB" }, { id: { in: ["b"] }, audience: "CLUB" }]);
  });

  it("reads the database name from the connection URL", () => {
    expect(databaseNameOf("postgresql://u:p@localhost:5432/imsda_events?schema=public")).toBe("imsda_events");
    expect(databaseNameOf(undefined)).toBe("");
  });
});

describe("stopping a run", () => {
  it("runs no setup write after the run was told to stop", async () => {
    let stop = false;
    const writes: string[] = [];
    const step = (name: string, stopAfter = false) => ({ name, run: async () => { writes.push(name); if (stopAfter) stop = true; } });
    await expect(runSetupSteps([step("passkeys"), step("clubs", true), step("events"), step("browser")], () => stop)).rejects.toBeInstanceOf(RunStopped);
    // The signal arrived during "clubs": that write finished, and nothing after it ran.
    expect(writes).toEqual(["passkeys", "clubs"]);
  });

  it("runs every step in order when nothing stops it, and checks before the very first write", async () => {
    const ran: string[] = [];
    expect(await runSetupSteps([{ name: "a", run: async () => void ran.push("a") }, { name: "b", run: async () => void ran.push("b") }], () => false)).toEqual(["a", "b"]);
    await expect(runSetupSteps([{ name: "x", run: async () => void ran.push("x") }], () => true)).rejects.toThrow(/stopped/);
    expect(ran).toEqual(["a", "b"]);
    expect(() => throwIfStopping(() => false)).not.toThrow();
    expect(() => throwIfStopping(() => true)).toThrow(RunStopped);
  });
});

describe("removing the people a run created", () => {
  const since = new Date("2026-11-02T12:00:00Z");
  const row = (id: string, over: Partial<{ firstName: string; lastName: string; createdAt: Date; rosterCount: number }> = {}) => ({
    id, firstName: walkthroughRosterPerson.firstName, lastName: walkthroughRosterPerson.lastName, createdAt: new Date("2026-11-02T12:05:00Z"), rosterCount: 0, ...over,
  });

  it("deletes the sample person this run created, and only that one", () => {
    const picked = pickOrphanedSamplePeople(
      [
        row("made_by_the_run"),
        row("same_name_made_by_hand_earlier", { createdAt: new Date("2026-10-01T09:00:00Z") }),
        row("same_name_on_a_roster", { rosterCount: 1 }),
        row("other_name", { firstName: "Someone" }),
        row("other_last_name", { lastName: "Else" }),
      ],
      since,
    );
    expect(picked).toEqual(["made_by_the_run"]);
  });

  it("keeps a same-name person with no link to this run", () => {
    expect(pickOrphanedSamplePeople([row("unlinked", { createdAt: new Date(since.getTime() - 1) })], since)).toEqual([]);
  });
});

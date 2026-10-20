import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isAccountEmailConfigured: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/communications/account-email", () => ({ isAccountEmailConfigured: mocks.isAccountEmailConfigured }));

import {
  getEffectiveDelivery,
  isPlatformEmailConfigured,
  loadEventEmailSettings,
  pauseFields,
  resolveEffectiveDelivery,
  resolveEventEmailSettings,
} from "@/modules/communications/effective-delivery";

const central = { name: "IMSDA Events", email: "events@imsda-events.test", replyTo: "office@imsda-events.test" };

function fakeClient(settings: Record<string, unknown> | null, platform: Record<string, unknown> | null = {
  defaultSenderName: central.name,
  defaultSenderEmail: central.email,
  defaultReplyToEmail: central.replyTo,
}) {
  return {
    eventMessageSettings: { findUnique: vi.fn(async () => settings) },
    platformSettings: { findUnique: vi.fn(async () => platform) },
  } as never;
}

beforeEach(() => {
  mocks.isAccountEmailConfigured.mockReset();
  mocks.isAccountEmailConfigured.mockReturnValue(true);
});

describe("effective delivery (#1043)", () => {
  it.each([
    { paused: true, platformConfigured: true, mode: "LOCAL_CAPTURE", reason: "PAUSED" },
    { paused: true, platformConfigured: false, mode: "LOCAL_CAPTURE", reason: "PAUSED" },
    { paused: false, platformConfigured: false, mode: "LOCAL_CAPTURE", reason: "NOT_CONFIGURED" },
    { paused: false, platformConfigured: true, mode: "EXTERNAL_EMAIL", reason: "ON" },
  ] as const)("paused=$paused configured=$platformConfigured -> $mode ($reason)", ({ paused, platformConfigured, mode, reason }) => {
    expect(resolveEffectiveDelivery({ paused, platformConfigured })).toEqual({ mode, reason });
  });

  it("is configured only with a central sender address and account email configured here", () => {
    expect(isPlatformEmailConfigured("events@imsda-events.test")).toBe(true);
    expect(isPlatformEmailConfigured("  ")).toBe(false);
    expect(isPlatformEmailConfigured(null)).toBe(false);
    mocks.isAccountEmailConfigured.mockReturnValue(false);
    expect(isPlatformEmailConfigured("events@imsda-events.test")).toBe(false);
    // An environment that cannot even be read fails closed: capture, never an unexpected send.
    mocks.isAccountEmailConfigured.mockImplementation(() => { throw new Error("invalid environment"); });
    expect(isPlatformEmailConfigured("events@imsda-events.test")).toBe(false);
  });

  it("the From address is always the central one; an event overrides only display name and reply-to", () => {
    const stored = { deliveryPaused: false, senderName: "IMSDA Women's Retreat", replyToEmail: "retreat@imsda-events.test", senderEmail: "old-event-sender@imsda-events.test" };
    const resolved = resolveEventEmailSettings(stored, central, true);
    expect(resolved.senderEmail).toBe(central.email);
    expect(resolved.senderName).toBe("IMSDA Women's Retreat");
    expect(resolved.replyToEmail).toBe("retreat@imsda-events.test");
    expect(resolved.replyToOverride).toBe("retreat@imsda-events.test");
    expect(resolved.deliveryMode).toBe("EXTERNAL_EMAIL");

    const plain = resolveEventEmailSettings({ deliveryPaused: false, senderName: " ", replyToEmail: null }, central, true);
    expect(plain.senderName).toBe(central.name);
    expect(plain.replyToEmail).toBe(central.replyTo);
    expect(plain.replyToOverride).toBeNull();
  });

  it("a paused event captures even when email is configured", () => {
    const resolved = resolveEventEmailSettings({ deliveryPaused: true, senderName: "Test event", replyToEmail: null }, central, true);
    expect(resolved).toMatchObject({ deliveryMode: "LOCAL_CAPTURE", deliveryReason: "PAUSED" });
  });

  it("loads the effective settings, treating a missing platform sender as not configured", async () => {
    const row = { eventId: "event-1", deliveryMode: "EXTERNAL_EMAIL", deliveryPaused: false, senderName: "Retreat", senderEmail: "stale@imsda-events.test", replyToEmail: null };
    const live = await loadEventEmailSettings(fakeClient(row), "event-1");
    expect(live).toMatchObject({ deliveryMode: "EXTERNAL_EMAIL", senderEmail: central.email });

    const noSender = await loadEventEmailSettings(fakeClient(row, { defaultSenderName: "IMSDA Events", defaultSenderEmail: null, defaultReplyToEmail: null }), "event-1");
    expect(noSender).toMatchObject({ deliveryMode: "LOCAL_CAPTURE", deliveryReason: "NOT_CONFIGURED", senderEmail: null });

    expect(await loadEventEmailSettings(fakeClient(null), "event-1")).toBeNull();
  });

  it("the stored deliveryMode column never decides: an old EXTERNAL_EMAIL row that is paused still captures", async () => {
    const row = { eventId: "event-1", deliveryMode: "EXTERNAL_EMAIL", deliveryPaused: true, senderName: "Retreat", senderEmail: null, replyToEmail: null };
    expect(await getEffectiveDelivery(fakeClient(row), "event-1")).toEqual({ mode: "LOCAL_CAPTURE", reason: "PAUSED", paused: true });
    const old = { ...row, deliveryMode: "LOCAL_CAPTURE", deliveryPaused: false };
    expect(await getEffectiveDelivery(fakeClient(old), "event-1")).toMatchObject({ mode: "EXTERNAL_EMAIL", paused: false });
  });

  it("an event with no settings row is not paused (a new event sends real email where configured)", async () => {
    expect(await getEffectiveDelivery(fakeClient(null), "event-1")).toEqual({ mode: "EXTERNAL_EMAIL", reason: "ON", paused: false });
  });

  it("pause fields record who and when, and clear on resume", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(pauseFields(true, "admin-1", now)).toEqual({ deliveryPaused: true, deliveryPausedAt: now, deliveryPausedByUserId: "admin-1" });
    expect(pauseFields(false, "admin-1", now)).toEqual({ deliveryPaused: false, deliveryPausedAt: null, deliveryPausedByUserId: null });
  });
});

/**
 * The guard: nothing reads `EventMessageSettings.deliveryMode` (or the retired `senderEmail`) from the database
 * except the effective-delivery function and the migration preview. Every other file gets delivery from
 * `modules/communications/effective-delivery.ts`.
 *
 * Rules, applied to every source file:
 *  - a read of `eventMessageSettings` (find*) must name a `select` that has neither column;
 *  - a write or count must not mention `deliveryMode`;
 *  - a `messageSettings` select or include on another model must be an object with a `select` that has neither column.
 */
const root = path.resolve(__dirname, "..");
const ALLOWED = new Set([
  "modules/communications/effective-delivery.ts",
  "modules/communications/central-email-preview.ts",
]);
const READ_METHODS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany"]);
const RETIRED = new Set(["deliveryMode", "senderEmail"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function propertyName(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment) {
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
}

function mentionsRetired(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if ((ts.isPropertyAssignment(child) || ts.isShorthandPropertyAssignment(child)) && RETIRED.has(propertyName(child))) found = true;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function selectOf(args: ts.NodeArray<ts.Expression> | readonly ts.Expression[]): ts.Expression | null {
  const first = args[0];
  if (!first || !ts.isObjectLiteralExpression(first)) return null;
  for (const property of first.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property) === "select") return property.initializer;
  }
  return null;
}

/** A `messageSettings` key is a read only inside a `select` or `include`; in a `where` or `data` it filters or writes. */
function isInSelectOrInclude(node: ts.Node): boolean {
  const owner = node.parent?.parent;
  return Boolean(owner && ts.isPropertyAssignment(owner) && ["select", "include"].includes(propertyName(owner)));
}

function settingsReadViolations(source: string, fileName = "source.ts"): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const at = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const target = node.expression.expression;
      if (ts.isPropertyAccessExpression(target) && target.name.text === "eventMessageSettings") {
        if (READ_METHODS.has(method)) {
          const select = selectOf(node.arguments);
          if (!select) problems.push(`line ${at(node)}: eventMessageSettings.${method} reads the whole row (including deliveryMode); use loadEventEmailSettings`);
          else if (mentionsRetired(select)) problems.push(`line ${at(node)}: eventMessageSettings.${method} selects a retired column`);
        } else if (mentionsRetired(node)) {
          problems.push(`line ${at(node)}: eventMessageSettings.${method} writes deliveryMode or senderEmail`);
        }
      }
    }
    if (ts.isPropertyAssignment(node) && propertyName(node) === "messageSettings" && isInSelectOrInclude(node)) {
      const value = node.initializer;
      const select = ts.isObjectLiteralExpression(value)
        ? value.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && propertyName(property) === "select")
        : undefined;
      if (!select) problems.push(`line ${at(node)}: messageSettings is read without a select; use loadEventEmailSettings`);
      else if (mentionsRetired(select.initializer)) problems.push(`line ${at(node)}: messageSettings selects a retired column`);
    }
    if (ts.isShorthandPropertyAssignment(node) && propertyName(node) === "messageSettings" && isInSelectOrInclude(node)) {
      problems.push(`line ${at(node)}: messageSettings is read without a select`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return problems;
}

describe("nothing reads EventMessageSettings.deliveryMode directly (#1043)", () => {
  it("every source file gets delivery from the effective-delivery function", () => {
    const files = ["app", "modules", "lib", "components", "integrations"]
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .filter((file) => !ALLOWED.has(path.relative(root, file).split(path.sep).join("/")));
    const offenders = files.flatMap((file) => {
      const relative = path.relative(root, file).split(path.sep).join("/");
      return settingsReadViolations(readFileSync(file, "utf8"), relative).map((problem) => `${relative}: ${problem}`);
    });
    expect(offenders).toEqual([]);
  }, 60_000);

  it("the guard itself flags the patterns it exists to stop", () => {
    expect(settingsReadViolations("await prisma.eventMessageSettings.findUnique({ where: { eventId } });")).toHaveLength(1);
    expect(settingsReadViolations("await tx.eventMessageSettings.findFirst({ where: { eventId }, select: { deliveryMode: true } });")).toHaveLength(1);
    expect(settingsReadViolations("await tx.eventMessageSettings.findUnique({ where: { eventId }, select: { senderEmail: true } });")).toHaveLength(1);
    expect(settingsReadViolations("await tx.eventMessageSettings.update({ where: { eventId }, data: { deliveryMode: \"EXTERNAL_EMAIL\" } });")).toHaveLength(1);
    expect(settingsReadViolations("await db.event.findMany({ select: { messageSettings: true } });")).toHaveLength(1);
    expect(settingsReadViolations("await db.event.findMany({ select: { messageSettings: { select: { deliveryMode: true } } } });")).toHaveLength(1);
  });

  it("the guard allows reads that do not touch the retired columns", () => {
    expect(settingsReadViolations("await tx.eventMessageSettings.findUnique({ where: { eventId }, select: { internalNotificationEmails: true } });")).toEqual([]);
    expect(settingsReadViolations("await tx.eventMessageSettings.findUnique({ where: { eventId }, select: { deliveryPaused: true } });")).toEqual([]);
    expect(settingsReadViolations("await tx.eventMessageSettings.update({ where: { eventId }, data: { senderName: \"x\" } });")).toEqual([]);
    expect(settingsReadViolations("await db.event.findMany({ select: { messageSettings: { select: { internalNotificationEmails: true } } } });")).toEqual([]);
    expect(settingsReadViolations("await db.event.findMany({ where: { messageSettings: { is: { deliveryPaused: true } } } });")).toEqual([]);
  });
});

describe("migration 20261114100000_central_email (#1043)", () => {
  const sql = readFileSync(path.join(root, "prisma/migrations/20261114100000_central_email/migration.sql"), "utf8");
  const statements = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

  it("is additive: nothing is dropped or deleted, and the old columns stay", () => {
    expect(statements).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN|RENAME/i);
    expect(statements).toMatch(/ADD COLUMN "deliveryPaused" BOOLEAN NOT NULL DEFAULT false/);
  });

  it("maps EXTERNAL_EMAIL to not paused and DISABLED and LOCAL_CAPTURE to paused", () => {
    const update = /UPDATE "EventMessageSettings"[\s\S]*?WHERE "deliveryMode" IN \(([^)]*)\);/.exec(statements);
    expect(update).not.toBeNull();
    const modes = update![1]!.split(",").map((mode) => mode.trim().replaceAll("'", "")).sort();
    expect(modes).toEqual(["DISABLED", "LOCAL_CAPTURE"]);
    expect(update![0]).toContain('"deliveryPaused" = true');
    expect(statements).not.toMatch(/"deliveryPaused" = false/);
  });

  it("gives an event with no settings a paused row so it cannot start sending", () => {
    const insert = /INSERT INTO "EventMessageSettings"[\s\S]*?WHERE NOT EXISTS[^;]*;/.exec(statements);
    expect(insert).not.toBeNull();
    expect(insert![0]).toContain("true");
    expect(insert![0]).toContain('FROM "Event" e');
  });

  it("is newer than every earlier migration", () => {
    const names = readdirSync(path.join(root, "prisma/migrations")).filter((name) => /^\d{14}_/.test(name)).sort();
    expect(names.at(-1)).toBe("20261114100000_central_email");
  });
});

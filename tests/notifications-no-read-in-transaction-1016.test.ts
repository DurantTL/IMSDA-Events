import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { notificationCatalog } from "@/modules/notifications/catalog";

/**
 * A notification switch is read BEFORE a transaction opens and passed in as a boolean (#1016). A read from inside a
 * transaction needs a second pool connection while the transaction holds one; in a registration rush every connection
 * is held by a waiter, so each submission would wait for the read to time out.
 *
 * The first version of this guard only looked for calls written inside `$transaction(...)` brackets, and would have
 * missed the original bug: helpers (`queuePermissionRequest`, `queueTransferNotification`, ...) that were CALLED from
 * inside transactions. So the guard is a closed list instead:
 *   1. only the files the catalog names as switch readers (plus the settings module itself) may call
 *      `isNotificationEnabled` or import the settings module; and
 *   2. no function that contains such a call may take a transaction or outbox client, and no call may sit inside a
 *      transaction or serializable wrapper callback of any name.
 * A helper that runs inside a transaction therefore cannot read a switch: it has to be given one.
 */

const root = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = ["modules", "app", "lib", "components"].flatMap((dir) => sourceFiles(path.join(root, dir)));
const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");

/** Files that may call the helper: the catalog's readers, and the module that defines it. */
const readers = new Set<string>([
  "modules/notifications/settings.ts",
  ...notificationCatalog.flatMap((entry) => entry.switchReadIn),
]);
/** The Notifications page, its route and component use the list and set functions (and a type), never the helper. */
const adminSurface = new Set<string>([
  "app/api/admin/notifications/route.ts",
  "app/(workspace)/admin/notifications/page.tsx",
  "components/notifications-workspace.tsx",
]);

const transactionParameter = /^tx$/i;
const transactionType = /\b(Tx|TransactionClient|Outbox)\b/;
const wrapperName = /transaction|serializable/i;

type Problem = { at: number; reason: string };

/** Every `isNotificationEnabled(...)` call in `source`, with the reasons it must not be where it is. */
function problemsIn(source: string, fileName = "source.ts"): Problem[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: Problem[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "isNotificationEnabled") {
      const at = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
        if (ts.isFunctionLike(parent)) {
          for (const parameter of parent.parameters) {
            const name = parameter.name.getText(sourceFile);
            const type = parameter.type?.getText(sourceFile) ?? "";
            if (transactionParameter.test(name) || transactionType.test(type)) {
              problems.push({ at, reason: `inside a function taking \`${name}${type ? `: ${type}` : ""}\`` });
            }
          }
        }
        if (ts.isCallExpression(parent) && parent !== node) {
          const callee = parent.expression.getText(sourceFile);
          if (wrapperName.test(callee) && parent.arguments.some((argument) => argument.pos <= node.pos && node.end <= argument.end)) {
            problems.push({ at, reason: `inside the callback of \`${callee}(...)\`` });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return problems;
}

describe("notification switches are never read inside a transaction (#1016)", () => {
  it("only the catalog's readers call isNotificationEnabled or import the settings module", () => {
    const strays = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const name = relative(file);
      const uses = /isNotificationEnabled/.test(source);
      const imports = /from "@\/modules\/notifications\/settings"/.test(source);
      if (uses && !readers.has(name)) return [`${name} calls isNotificationEnabled but is not a switchReadIn file`];
      if (imports && !readers.has(name) && !adminSurface.has(name)) return [`${name} imports the settings module but is not a switchReadIn file`];
      return [];
    });
    expect(strays).toEqual([]);
  });

  it("every file the catalog names really reads a switch (the list has no dead entries)", () => {
    for (const name of readers) {
      if (name === "modules/notifications/settings.ts") continue;
      expect(readFileSync(path.join(root, name), "utf8"), name).toMatch(/isNotificationEnabled\(\s*"[A-Z_]+"\s*\)/);
    }
  });

  it("no call sits inside a function taking a transaction or outbox client, or inside any transaction wrapper callback", () => {
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      if (!/isNotificationEnabled\s*\(/.test(source)) return [];
      return problemsIn(source, file).map((problem) => `${relative(file)}:${problem.at} ${problem.reason}`);
    });
    expect(offenders).toEqual([]);
  });

  it("finds the send sites it is meant to police", () => {
    const using = files.filter((file) => /isNotificationEnabled\s*\(/.test(readFileSync(file, "utf8")));
    expect(using.length).toBeGreaterThanOrEqual(10);
  });

  describe("the detector itself", () => {
    it("catches a call written inside a transaction callback", () => {
      const bad = "async function f() { return getPrisma().$transaction(async (tx) => { if (await isNotificationEnabled(\"X\")) { await tx.a.create({}); } }); }";
      expect(problemsIn(bad).length).toBeGreaterThan(0);
    });

    it("catches a helper that takes a transaction client, which is how the original bug reached a transaction", () => {
      const helper = "async function queuePermissionRequest(tx: Tx, input: Input) { if (!await isNotificationEnabled(\"TEAM_APPROVAL_REQUESTED\")) return []; return []; }";
      expect(problemsIn(helper).map((problem) => problem.reason)).toEqual(["inside a function taking `tx: Tx`"]);
      const outbox = "export async function queueSubmittedEmail(client: Outbox, to: string) { if (!await isNotificationEnabled(\"NEW_CLUB_APPLICATION\")) return []; }";
      expect(problemsIn(outbox).length).toBe(1);
      const prismaTx = "async function f(tx: Prisma.TransactionClient) { await isNotificationEnabled(\"X\"); }";
      expect(problemsIn(prismaTx).length).toBe(1);
    });

    it("catches wrappers of any name", () => {
      for (const wrapper of ["runSerializable", "withSerializableRetry", "mealTransaction", "serializable", "runSerializableOperation"]) {
        const source = `const r = await ${wrapper}(async (db) => { const on = await isNotificationEnabled("X"); return on; });`;
        expect(problemsIn(source).length, wrapper).toBeGreaterThan(0);
      }
    });

    it("allows a read before the transaction, passed in as a boolean", () => {
      const good = "async function f() { const on = await isNotificationEnabled(\"X\"); return getPrisma().$transaction(async (tx) => { if (on) await tx.a.create({}); }); }";
      expect(problemsIn(good)).toEqual([]);
    });
  });
});

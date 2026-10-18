import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A notification switch is read BEFORE a transaction opens and passed in (#1016). A read from inside a transaction
 * callback needs a second pool connection while the transaction holds one; in a registration rush every connection is
 * held by a waiter, so each submission would wait for the read to time out. This test fails if any call to
 * `isNotificationEnabled` sits inside the callback of a `$transaction`, `serializable` or `runSerializableOperation` call.
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

/** The index just past the parenthesis that closes the one at `open`, skipping strings, comments and template text. */
function closingParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index);
      if (index < 0) return source.length;
    } else if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index) + 1;
    } else if (char === '"' || char === "'") {
      for (index += 1; index < source.length && source[index] !== char; index += 1) {
        if (source[index] === "\\") index += 1;
      }
    } else if (char === "`") {
      for (index += 1; index < source.length && source[index] !== "`"; index += 1) {
        if (source[index] === "\\") index += 1;
        else if (source[index] === "$" && source[index + 1] === "{") {
          let braces = 0;
          for (; index < source.length; index += 1) {
            if (source[index] === "{") braces += 1;
            if (source[index] === "}") { braces -= 1; if (braces === 0) break; }
          }
        }
      }
    } else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

const transactionCalls = /(?:\$transaction|\bserializable|\brunSerializableOperation)\s*\(/g;

function callsInsideTransactions(source: string): number[] {
  const ranges: Array<[number, number]> = [];
  for (const match of source.matchAll(transactionCalls)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    ranges.push([open, closingParen(source, open)]);
  }
  const offenders: number[] = [];
  for (const match of source.matchAll(/isNotificationEnabled\s*\(/g)) {
    const at = match.index ?? 0;
    if (ranges.some(([start, end]) => at > start && at < end)) offenders.push(at);
  }
  return offenders;
}

describe("notification switches are never read inside a transaction (#1016)", () => {
  const files = ["modules", "app", "lib"].flatMap((dir) => sourceFiles(path.join(root, dir)));

  it("finds the send sites it is meant to police", () => {
    const using = files.filter((file) => /isNotificationEnabled\s*\(/.test(readFileSync(file, "utf8")));
    expect(using.length).toBeGreaterThanOrEqual(10);
  });

  it("has no isNotificationEnabled call inside a $transaction, serializable or runSerializableOperation callback", () => {
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return callsInsideTransactions(source).map((at) => `${path.relative(root, file)}:${source.slice(0, at).split("\n").length}`);
    });
    expect(offenders).toEqual([]);
  });

  it("would catch one (the detector itself works)", () => {
    const bad = "async function f() { return getPrisma().$transaction(async (tx) => { if (await isNotificationEnabled(\"X\")) { await tx.a.create({}); } }); }";
    const good = "async function f() { const on = await isNotificationEnabled(\"X\"); return getPrisma().$transaction(async (tx) => { if (on) await tx.a.create({}); }); }";
    expect(callsInsideTransactions(bad)).toHaveLength(1);
    expect(callsInsideTransactions(good)).toHaveLength(0);
    const viaHelper = "const r = await serializable(async (tx) => { const s = await isNotificationEnabled(\"X\"); return s; });";
    expect(callsInsideTransactions(viaHelper)).toHaveLength(1);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Site rule B9 (#1448): a delete or cancel never runs without an in-page confirm, and no browser prompt
 * (`window.prompt` / `window.confirm`) is used, because iOS Safari can swallow them silently (#466).
 * These are source scans, so a new offender fails here before it ships.
 */

const root = path.resolve(__dirname, "..");
const scanned = ["app", "components", "modules", "lib"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === ".next" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = scanned.flatMap((dir) => sourceFiles(path.join(root, dir))).map((full) => ({
  rel: path.relative(root, full).split(path.sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

/** Blanks out comments (keeping line numbers) so prose that mentions `window.confirm()` isn't flagged. */
function withoutComments(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (_match, lead: string) => lead);
}

function lineOf(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

/** Every file that may still call a browser dialog, with the reason it is allowed. */
const browserDialogAllowlist: Record<string, string> = {
  "components/use-unsaved-changes-guard.ts":
    "Leaving the page with unsaved edits: the browser's own beforeunload-style prompt is the last line of defence, not a delete or cancel.",
  "components/unsaved-changes-registry.ts":
    "Default confirm for in-app navigation away from unsaved edits; callers inject their own and tests replace it.",
};

describe("no browser prompts (#1448, B9)", () => {
  it("lists only allowlisted files that exist", () => {
    for (const rel of Object.keys(browserDialogAllowlist)) {
      expect(files.some((file) => file.rel === rel), `${rel} is allowlisted but missing`).toBe(true);
    }
  });

  it("never calls window.prompt or window.confirm outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.rel in browserDialogAllowlist) continue;
      const code = withoutComments(file.text);
      for (const match of code.matchAll(/\b(?:window|globalThis)\s*\.\s*(prompt|confirm)\s*\(/g)) {
        offenders.push(`${file.rel}:${lineOf(code, match.index)} window.${match[1]}()`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Client files that send a delete without a shared confirm of their own, with why that is fine. */
const unconfirmedDeleteAllowlist: Record<string, string> = {
  // Already confirm through their own in-page step (not the shared dialog).
  "components/more-launcher.tsx": "Turning a module off opens its own in-page 'Turn off' confirmation panel first.",
  "components/organization-directory-workspace.tsx": "Delete opens a type-the-name confirmation form before the request is sent.",
  "components/staff-passkey-manager.tsx": "Removing a passkey goes through startChange, which asks for confirmation and re-authentication first.",
  // Low-stakes by design: nothing is lost and the action is trivially reversible.
  "components/registration-notes-tags-panel.tsx": "Removes one tag chip; re-adding the tag restores it, no data is lost.",
  "components/session-manager.tsx": "Ends sessions only; no data is deleted and the devices can sign in again.",
};

const confirmMarkers = /\buseConfirm\b|\bConfirmDialog\b|\b(?:Delete|Remove|Archive|Cancel)\w*Dialog\b/;
const deleteSends = /method\s*:\s*["'`]DELETE["'`]|action\s*:\s*["'`]DELETE_\w*["'`]/g;

describe("deletes always confirm (#1448, B9)", () => {
  it("every client component that sends a delete also uses a confirm dialog", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!/^\s*["']use client["']/.test(file.text) || file.rel in unconfirmedDeleteAllowlist) continue;
      const code = withoutComments(file.text);
      if (confirmMarkers.test(code)) continue;
      for (const match of code.matchAll(deleteSends)) offenders.push(`${file.rel}:${lineOf(code, match.index)} ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("allowlist entries still exist", () => {
    for (const rel of Object.keys(unconfirmedDeleteAllowlist)) {
      expect(files.some((file) => file.rel === rel), `${rel} is allowlisted but missing`).toBe(true);
    }
  });
});

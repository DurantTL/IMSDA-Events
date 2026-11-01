import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Site rule B9 (#1448): a delete or cancel never runs without an in-page confirm, and no browser prompt
 * (`window.prompt` / `window.confirm`) is used, because iOS Safari can swallow them silently (#466).
 * These are source scans, so a new offender fails here before it ships. Scope: the delete check is a
 * file-level heuristic over client components (a file using any confirm dialog passes), and it covers deletes
 * only, not every cancel or other irreversible action.
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
    "A window.confirm shown on in-app link clicks when leaving a page with unsaved edits; it guards lost edits, not a delete or cancel.",
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
  "components/question-library-manager.tsx": "Delete swaps the row into an inline 'Delete <name>' / 'Keep it' confirmation with the consequence stated before the request is sent.",
  // Low-stakes by design: nothing is lost and the action is trivially reversible.
  "components/registration-notes-tags-panel.tsx": "Removes one tag chip; re-adding the tag restores it, no data is lost.",
  "components/session-manager.tsx": "Ends sessions only; no data is deleted and the devices can sign in again.",
};

const confirmMarkers = /\buseConfirm\b|\bConfirmDialog\b|\b(?:Delete|Remove|Archive|Cancel)\w*Dialog\b/;
// Any quoted "DELETE" (method: "DELETE", or the helper form call(url, "DELETE", ...)) or an action: "DELETE_…" body.
const deleteSends = /["'`]DELETE["'`]|action\s*:\s*["'`]DELETE_\w*["'`]/g;

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

describe("lifecycle dialog keeps its opener (#1448)", () => {
  it("the registration action row stays rendered while the lifecycle dialog is open, so focus can return to its button", () => {
    const people = files.find((file) => file.rel === "components/people-workspace.tsx")!.text;
    expect(people).toMatch(/\{canEdit && !addingAttendee && \(/);
    expect(people).not.toMatch(/canEdit && !addingAttendee && !lifecycleAction/);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule B6 guard scan (#1452): every component or page that renders a form with a
 * Save or Submit button either mounts `useUnsavedChangesGuard` or is on this list
 * with an honest reason. The list is not an excuse to stay unguarded:
 * "needs guard: follow-up #1468" entries are forms with several fields that are not
 * saved instantly and still need the one-line hook mount.
 */
const root = join(__dirname, "..");

const allowlist: Record<string, string> = {
  "app/(public)/account/(portal)/clubs/[organizationId]/exports/class-tracking/page.tsx": "search or filter",
  "app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx": "search or filter",
  "app/(public)/unsubscribe/[token]/page.tsx": "action button only, no typed fields",
  "app/(workspace)/admin/clubs/page.tsx": "search or filter",
  "app/(workspace)/admin/system-report/email-tester-card.tsx": "one field",
  "app/(workspace)/check-in/badges/page.tsx": "search or filter",
  "app/(workspace)/more/club-forms/page.tsx": "search or filter",
  "app/(workspace)/more/reports/clubs/check-in-book/page.tsx": "search or filter",
  "components/app-shell.tsx": "action button only, no typed fields",
  "components/area-club-search-form.tsx": "search or filter",
  "components/attendee-pass-grid.tsx": "action button only, no typed fields",
  "components/attendee-password-reset-form.tsx": "sign-in",
  "components/attendee-sign-in-form.tsx": "sign-in",
  "components/attendee-sign-up-form.tsx": "sign-in",
  "components/attendee-verify-by-address-form.tsx": "sign-in",
  "components/background-check-review-panel.tsx": "action button only, no typed fields",
  "components/cancellation-request-panel.tsx": "needs guard: follow-up #1468",
  "components/cancellation-requests-workspace.tsx": "action button only, no typed fields",
  "components/check-in-scanner.tsx": "action button only, no typed fields",
  "components/check-in-stations-panel.tsx": "action button only, no typed fields",
  "components/choice-answer-filter.tsx": "search or filter",
  "components/church-sponsor-flags.tsx": "action button only, no typed fields",
  "components/club-form-alert-recipients.tsx": "one field",
  "components/club-leaders-list.tsx": "search or filter",
  "components/clubs-year-selector.tsx": "search or filter",
  "components/desk-location-select.tsx": "saves instantly / autosave",
  "components/health-import-workspace.tsx": "one field",
  "components/health-privacy-acknowledgment.tsx": "action button only, no typed fields",
  "components/health-record-actions.tsx": "action button only, no typed fields",
  "components/import-workspace.tsx": "one field",
  "components/information-form-fill-in.tsx": "saves instantly / autosave",
  "components/login-form.tsx": "sign-in",
  "components/meal-closeout-review-form.tsx": "action button only, no typed fields",
  "components/mfa-manager.tsx": "sign-in",
  "components/module-request-form.tsx": "one field",
  "components/module-request-queue.tsx": "action button only, no typed fields",
  "components/organization-search-controls.tsx": "search or filter",
  "components/password-reset-form.tsx": "sign-in",
  "components/password-reset-request-form.tsx": "sign-in",
  "components/people-directory.tsx": "search or filter",
  "components/people-quick-filters.tsx": "search or filter",
  "components/public-lodging-assignment.tsx": "action button only, no typed fields",
  "components/public-registration-contact-form.tsx": "needs guard: follow-up #1468",
  "components/public-registration-recovery-form.tsx": "sign-in",
  "components/public-responsible-adult.tsx": "action button only, no typed fields",
  "components/public-shirt-size-confirmation.tsx": "action button only, no typed fields",
  "components/roster-unlock-form.tsx": "sign-in",
  "components/sign-in-code-form.tsx": "sign-in",
  "components/staff-account-menu.tsx": "action button only, no typed fields",
  "components/staff-monthly-records.tsx": "search or filter",
  "components/staff-passkey-manager.tsx": "sign-in",
  "components/system-phone-menu.tsx": "action button only, no typed fields",
  "components/system-readiness-workspace.tsx": "action button only, no typed fields",
  "components/two-step-recovery-form.tsx": "sign-in",
};

const followUp = "needs guard: follow-up #1468";

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

const rel = (path: string) => relative(root, path).split("\\").join("/");
const submitButton = /type=(?:"submit"|\{"submit"\})|<button(?![^>]*\btype=)[^>]*>|<SubmitButton/;

const sources = [...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "app"))].map((path) => ({
  path: rel(path),
  text: readFileSync(path, "utf8"),
}));

const withSubmitForm = sources.filter(({ text }) => text.includes("<form") && submitButton.test(text));
const guarded = (text: string) => text.includes("useUnsavedChangesGuard");

describe("unsaved changes guard scan (#1452, rule B6)", () => {
  it("finds the forms it is meant to scan", () => {
    expect(withSubmitForm.length).toBeGreaterThan(100);
    expect(withSubmitForm.some(({ text }) => guarded(text))).toBe(true);
  });

  it("every form with a Save or Submit button is guarded or allow-listed", () => {
    const unlisted = withSubmitForm.filter(({ path, text }) => !guarded(text) && !(path in allowlist)).map(({ path }) => path);
    expect(unlisted, "mount useUnsavedChangesGuard(dirty) in these, or allow-list them with a reason").toEqual([]);
  });

  it("every allow-list entry has a reason", () => {
    for (const [path, reason] of Object.entries(allowlist)) {
      expect(reason.trim().length, path).toBeGreaterThan(0);
    }
  });

  it("no allow-list entry is stale: it still has a form and still lacks the guard", () => {
    const byPath = new Map(sources.map((source) => [source.path, source.text]));
    for (const path of Object.keys(allowlist)) {
      const text = byPath.get(path);
      expect(text, `${path} no longer exists`).toBeDefined();
      expect(text!.includes("<form") && submitButton.test(text!), `${path} no longer has a form with a submit button`).toBe(true);
      expect(guarded(text!), `${path} now uses useUnsavedChangesGuard; remove it from the allow-list`).toBe(false);
    }
  });

  it("the forms named in #1452 are guarded", () => {
    for (const path of [
      "components/attendee-profile-form.tsx",
      "components/new-club-application-form.tsx",
      "components/public-registration-form.tsx",
      "components/club-roster-workspace.tsx",
      "components/invite-person.tsx",
      // Found by the club journeys (#1501): these three sat on the allow-list as "follow-up #1468" while a director's
      // typing was lost. Club forms a director fills in stay guarded; they never go back on the list.
      "components/club-profile-form.tsx",
      "components/club-report-form.tsx",
      "components/club-year-end-report-form.tsx",
      "components/club-form-fill-in.tsx",
      // Director and area coordinator club forms (#1468): never back on the allow-list.
      "components/club-form-roster-add.tsx",
      "components/club-forms-actions.tsx",
      "components/club-honors-workspace.tsx",
      "components/club-member-honors-dialog.tsx",
      "components/club-registration-workspace.tsx",
      "components/club-roster-carry-forward.tsx",
      "components/club-supply-stock-workspace.tsx",
      "components/club-team-workspace.tsx",
      "components/new-club-applications-queue.tsx",
      "components/health-record-form.tsx",
      "components/roster-export-builder.tsx",
      // #1468 round 2: attendee and public forms.
      "components/attendee-community-board.tsx",
      "components/group-registration-editor.tsx",
      "components/public-lodging-preferences.tsx",
      "components/staff-invitation-registration.tsx",
    ]) {
      expect(guarded(readFileSync(join(root, path), "utf8")), path).toBe(true);
    }
  });

  it("lists the forms that still need a guard", () => {
    const pending = Object.entries(allowlist).filter(([, reason]) => reason === followUp).map(([path]) => path);
    // Not a limit to raise: it only goes down as the follow-up mounts the hook.
    expect(pending.length).toBeLessThanOrEqual(2);
  });
});

describe("the guard asks in the page, not in the browser's own box", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  it("window.confirm appears only in the registry's no-dialog fallback", () => {
    for (const path of [
      "components/use-unsaved-changes-guard.ts",
      "components/link-guard.ts",
      "components/guarded-link.tsx",
      "components/unsaved-changes-dialog-host.tsx",
    ]) {
      expect(read(path), path).not.toMatch(/window\.confirm|[^.\w]confirm\(/);
    }
    const registry = read("components/unsaved-changes-registry.ts");
    expect(registry.match(/window\.confirm\(/g)).toHaveLength(1);
    const fallback = registry.slice(registry.indexOf("export function confirmLeave"));
    expect(fallback.slice(0, fallback.indexOf("\n}\n"))).toContain("window.confirm(message)");
    expect(fallback.slice(0, fallback.indexOf("\n}\n"))).toContain("if (leaveConfirmer) return leaveConfirmer(message)");
  });

  it("the dialog host is mounted once, in the root layout, with the shared dialog", () => {
    expect(read("app/layout.tsx")).toContain("<UnsavedChangesDialogHost />");
    const host = read("components/unsaved-changes-dialog-host.tsx");
    expect(host).toContain("<ConfirmDialog");
    expect(host).toContain('title="Leave without saving?"');
    expect(host).toContain('confirmLabel="Leave without saving"');
    expect(host).toContain('cancelLabel="Keep editing"');
    const mounts = sources.filter(({ text }) => text.includes("<UnsavedChangesDialogHost")).map(({ path }) => path);
    expect(mounts).toEqual(["app/layout.tsx"]);
  });
});

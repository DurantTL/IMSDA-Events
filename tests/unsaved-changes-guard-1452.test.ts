import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule B6 guard scan (#1452): every component or page that renders a form with a
 * Save or Submit button either mounts `useUnsavedChangesGuard` or is on this list
 * with an honest reason. The list is not an excuse to stay unguarded:
 * "needs guard: follow-up" entries are forms with several fields that are not
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
  "components/asset-closeout-workspace.tsx": "needs guard: follow-up",
  "components/asset-issue-desk.tsx": "needs guard: follow-up",
  "components/asset-return-panel.tsx": "needs guard: follow-up",
  "components/attendance-reconciliation-controls.tsx": "needs guard: follow-up",
  "components/attendee-community-board.tsx": "needs guard: follow-up",
  "components/attendee-configuration-workspace.tsx": "needs guard: follow-up",
  "components/attendee-pass-grid.tsx": "action button only, no typed fields",
  "components/attendee-password-reset-form.tsx": "sign-in",
  "components/attendee-sign-in-form.tsx": "sign-in",
  "components/attendee-sign-up-form.tsx": "sign-in",
  "components/attendee-verify-by-address-form.tsx": "sign-in",
  "components/background-check-review-panel.tsx": "action button only, no typed fields",
  "components/billing-responsibility-controls.tsx": "needs guard: follow-up",
  "components/calendar-admin-workspace.tsx": "needs guard: follow-up",
  "components/calendar-feeds-panel.tsx": "needs guard: follow-up",
  "components/cancellation-carry-out.tsx": "needs guard: follow-up",
  "components/cancellation-policy-workspace.tsx": "needs guard: follow-up",
  "components/cancellation-request-panel.tsx": "needs guard: follow-up",
  "components/cancellation-requests-workspace.tsx": "action button only, no typed fields",
  "components/check-in-scanner.tsx": "action button only, no typed fields",
  "components/check-in-station.tsx": "needs guard: follow-up",
  "components/check-in-stations-panel.tsx": "action button only, no typed fields",
  "components/choice-answer-filter.tsx": "search or filter",
  "components/church-location-form.tsx": "needs guard: follow-up",
  "components/church-pastor-contact.tsx": "needs guard: follow-up",
  "components/church-sponsor-flags.tsx": "action button only, no typed fields",
  "components/club-assignments-workspace.tsx": "needs guard: follow-up",
  "components/club-directors-workspace.tsx": "needs guard: follow-up",
  "components/club-form-alert-recipients.tsx": "one field",
  "components/club-form-create.tsx": "one field",
  "components/club-form-roster-add.tsx": "needs guard: follow-up",
  "components/club-forms-actions.tsx": "needs guard: follow-up",
  "components/club-honors-workspace.tsx": "needs guard: follow-up",
  "components/club-leaders-list.tsx": "search or filter",
  "components/club-meeting-notes.tsx": "dialog form with its own discard confirm",
  "components/club-member-honors-dialog.tsx": "needs guard: follow-up",
  "components/club-profile-form.tsx": "needs guard: follow-up",
  "components/club-registration-workspace.tsx": "needs guard: follow-up",
  "components/club-report-form.tsx": "needs guard: follow-up",
  "components/club-roster-carry-forward.tsx": "needs guard: follow-up",
  "components/club-supply-stock-workspace.tsx": "needs guard: follow-up",
  "components/club-team-workspace.tsx": "one field",
  "components/club-year-end-report-form.tsx": "needs guard: follow-up",
  "components/clubs-year-selector.tsx": "search or filter",
  "components/community-moderation-workspace.tsx": "needs guard: follow-up",
  "components/desk-location-select.tsx": "saves instantly / autosave",
  "components/duplicate-match-review-workspace.tsx": "needs guard: follow-up",
  "components/email-delivery-section.tsx": "needs guard: follow-up",
  "components/event-locations-panel.tsx": "needs guard: follow-up",
  "components/event-team-settings-panel.tsx": "needs guard: follow-up",
  "components/finance-workspace.tsx": "needs guard: follow-up",
  "components/form-template-copy.tsx": "one field",
  "components/group-registration-editor.tsx": "needs guard: follow-up",
  "components/health-import-workspace.tsx": "one field",
  "components/health-privacy-acknowledgment.tsx": "action button only, no typed fields",
  "components/health-record-actions.tsx": "action button only, no typed fields",
  "components/health-record-form.tsx": "needs guard: follow-up",
  "components/homepage-ministries-editor.tsx": "needs guard: follow-up",
  "components/honor-catalog-workspace.tsx": "needs guard: follow-up",
  "components/honor-seat-override.tsx": "needs guard: follow-up",
  "components/honor-watch-panel.tsx": "needs guard: follow-up",
  "components/honors-instructors-workspace.tsx": "needs guard: follow-up",
  "components/honors-schedule-board.tsx": "needs guard: follow-up",
  "components/honors-setup-workspace.tsx": "needs guard: follow-up",
  "components/import-workspace.tsx": "one field",
  "components/information-form-fill-in.tsx": "saves instantly / autosave",
  "components/information-forms-home.tsx": "needs guard: follow-up",
  "components/invoice-controls.tsx": "needs guard: follow-up",
  "components/invoice-ledger-controls.tsx": "needs guard: follow-up",
  "components/issued-assets-workspace.tsx": "needs guard: follow-up",
  "components/kitchen-counts-entry.tsx": "needs guard: follow-up",
  "components/lodging-assignments-panels.tsx": "needs guard: follow-up",
  "components/lodging-assignments-workspace.tsx": "needs guard: follow-up",
  "components/lodging-requests-workspace.tsx": "needs guard: follow-up",
  "components/lodging-workspace.tsx": "needs guard: follow-up",
  "components/login-form.tsx": "sign-in",
  "components/meal-closeout-review-form.tsx": "action button only, no typed fields",
  "components/meals-workspace.tsx": "needs guard: follow-up",
  "components/merchandise-admin-workspace.tsx": "dialog form with its own discard confirm",
  "components/mfa-manager.tsx": "sign-in",
  "components/module-request-form.tsx": "one field",
  "components/module-request-queue.tsx": "action button only, no typed fields",
  "components/new-club-applications-queue.tsx": "needs guard: follow-up",
  "components/notifications-workspace.tsx": "needs guard: follow-up",
  "components/organization-billing-contact.tsx": "needs guard: follow-up",
  "components/organization-directory-workspace.tsx": "needs guard: follow-up",
  "components/organization-search-controls.tsx": "search or filter",
  "components/password-reset-form.tsx": "sign-in",
  "components/password-reset-request-form.tsx": "sign-in",
  "components/people-directory.tsx": "search or filter",
  "components/people-quick-filters.tsx": "search or filter",
  "components/people-workspace.tsx": "needs guard: follow-up",
  "components/person-access-controls.tsx": "needs guard: follow-up",
  "components/public-lodging-assignment.tsx": "action button only, no typed fields",
  "components/public-lodging-preferences.tsx": "needs guard: follow-up",
  "components/public-registration-contact-form.tsx": "needs guard: follow-up",
  "components/public-registration-recovery-form.tsx": "sign-in",
  "components/public-responsible-adult.tsx": "action button only, no typed fields",
  "components/public-shirt-size-confirmation.tsx": "action button only, no typed fields",
  "components/question-library-manager.tsx": "one field",
  "components/registration-amendment-editor.tsx": "needs guard: follow-up",
  "components/registration-form-notifications-panel.tsx": "needs guard: follow-up",
  "components/registration-notes-tags-panel.tsx": "needs guard: follow-up",
  "components/roster-export-builder.tsx": "needs guard: follow-up",
  "components/roster-unlock-form.tsx": "sign-in",
  "components/scholarship-fund-workspace.tsx": "needs guard: follow-up",
  "components/sign-in-code-form.tsx": "sign-in",
  "components/staff-account-menu.tsx": "action button only, no typed fields",
  "components/staff-invitation-registration.tsx": "needs guard: follow-up",
  "components/staff-monthly-records.tsx": "search or filter",
  "components/staff-passkey-manager.tsx": "sign-in",
  "components/staff-workspace.tsx": "needs guard: follow-up",
  "components/system-phone-menu.tsx": "action button only, no typed fields",
  "components/system-readiness-workspace.tsx": "action button only, no typed fields",
  "components/tag-configuration-workspace.tsx": "needs guard: follow-up",
  "components/team-results-workspace.tsx": "needs guard: follow-up",
};

const followUp = "needs guard: follow-up";

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
    ]) {
      expect(guarded(readFileSync(join(root, path), "utf8")), path).toBe(true);
    }
  });

  it("lists the forms that still need a guard", () => {
    const pending = Object.entries(allowlist).filter(([, reason]) => reason === followUp).map(([path]) => path);
    // Not a limit to raise: it only goes down as the follow-up mounts the hook.
    expect(pending.length).toBeLessThanOrEqual(69);
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

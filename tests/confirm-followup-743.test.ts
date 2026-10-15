import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const codeOnly = (text: string) => text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");

/**
 * #743 follow-up: every confirmation in the UI goes through the in-page
 * ConfirmDialog (via `useConfirm`), names the object and the consequence, and
 * uses a specific action label. The two navigation guards keep the browser
 * prompt because they answer synchronously from a route-change interceptor.
 */
describe("confirmations use the shared dialog (#743)", () => {
  const guards = new Set(["use-unsaved-changes-guard.ts", "unsaved-changes-registry.ts"]);
  const componentFiles = readdirSync(path.join(root, "components")).filter((name) => /\.tsx?$/.test(name) && !guards.has(name));

  it("no component calls window.confirm() outside the navigation guards", () => {
    const offenders = componentFiles.filter((name) => /window\.confirm\(/.test(codeOnly(source(`components/${name}`))));
    expect(offenders).toEqual([]);
  });

  it("useConfirm resolves a promise and renders one ConfirmDialog", () => {
    const code = source("components/use-confirm.tsx");
    expect(code).toContain("<ConfirmDialog");
    expect(code).toContain("createConfirmController");
  });

  it.each([
    ["components/club-meeting-notes.tsx", "Delete meeting note from ${formatMeetingDate(note.meetingDate)}"],
    ["components/club-roster-workspace.tsx", "Remove ${member.firstName} ${member.lastName} from the roster"],
    ["components/passkey-manager.tsx", "Remove passkey \"${passkey.name}\""],
    ["components/event-locations-panel.tsx", "Delete ${location.name}"],
    ["components/honors-schedule-board.tsx", "Remove the room ${room.name}"],
    ["components/promo-code-workspace.tsx", "Deactivate ${promo.code}"],
    ["components/club-invites-workspace.tsx", "Cancel invite for ${invite.name || invite.email}"],
  ])("%s names its object in the action label", (file, label) => {
    expect(source(file)).toContain(label);
  });

  it("destructive confirmations use the destructive style", () => {
    for (const file of ["components/club-meeting-notes.tsx", "components/club-roster-workspace.tsx", "components/passkey-manager.tsx", "components/club-uniform-section.tsx"]) {
      expect(source(file)).toMatch(/destructive: true/);
    }
  });

  it("the CSV import still asks only when attendees already have answers", () => {
    const code = source("components/public-registration-form.tsx");
    expect(code).toContain("attendees.some((attendee) => hasResponses(attendee.responses))");
    expect(code).toMatch(/&& !\(await askConfirm\(\{/);
  });

  it("bulk uniform removal previews the count and who is affected before deleting", () => {
    const code = source("components/club-uniform-section.tsx");
    expect(code).toContain("title: `Remove ${pickedNeeded.length} ${noun}`");
    expect(code.indexOf("askConfirm")).toBeLessThan(code.indexOf("onRemove(pickedNeeded)"));
  });
});

describe("dialogs stack safely (#743)", () => {
  it("only the top-most dialog handles Escape and Tab", () => {
    const code = source("components/use-accessible-dialog.ts");
    expect(code).toContain("isTopDialog(token)");
    expect(source("components/confirm-dialog.tsx")).toContain("confirm-backdrop");
  });
});

describe("club-side save buttons show Submitting/Saving (#743)", () => {
  it.each([
    "components/club-report-form.tsx",
    "components/club-year-end-report-form.tsx",
    "components/club-roster-workspace.tsx",
    "components/club-meeting-notes.tsx",
    "components/club-profile-form.tsx",
    "components/club-form-fill-in.tsx",
  ])("%s uses SubmitButton", (file) => {
    expect(source(file)).toContain("<SubmitButton");
  });
});

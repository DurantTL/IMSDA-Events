import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getNotificationDefinition,
  isNotificationKey,
  notificationCatalog,
  notificationKeys,
} from "@/modules/notifications/catalog";

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("notification catalog (#1016)", () => {
  it("lists every key once, and the keys and the catalog agree", () => {
    expect(new Set(notificationKeys).size).toBe(notificationKeys.length);
    expect(notificationCatalog.map((entry) => entry.key)).toEqual([...notificationKeys]);
    for (const entry of notificationCatalog) {
      expect(getNotificationDefinition(entry.key)).toBe(entry);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.when.length).toBeGreaterThan(0);
      expect(entry.recipients.length).toBeGreaterThan(0);
      expect(entry.sourceNote.length).toBeGreaterThan(0);
    }
  });

  it("knows its own keys and nothing else", () => {
    expect(isNotificationKey("SIGN_IN_LOCKOUT_OFFICE_COPY")).toBe(true);
    expect(isNotificationKey("NOT_A_KEY")).toBe(false);
    expect(isNotificationKey(undefined)).toBe(false);
  });

  it("covers the ten send sites the issue traced, plus the club form alert (#1017), the information form response alert (#1222), the registration form notifications (#1081) the honor instructor class emails (#1098) and the honor watch summaries (#1099)", () => {
    expect(notificationKeys).toHaveLength(15);
    const built = notificationCatalog.filter((entry) => entry.built);
    expect(built).toHaveLength(15);
    const ready = notificationCatalog.find((entry) => entry.key === "CLUB_FORM_SUBMITTED");
    expect(ready?.built).toBe(true);
  });

  it("is wired into every built send site: each reader names its key and reads the switch", () => {
    for (const entry of notificationCatalog.filter((candidate) => candidate.built)) {
      expect(entry.switchReadIn.length, `${entry.key} has a file that reads its switch`).toBeGreaterThan(0);
      for (const file of entry.switchReadIn) {
        const source = read(file);
        expect(source, `${file} imports the helper`).toContain('from "@/modules/notifications/settings"');
        expect(source, `${file} reads ${entry.key}`).toMatch(new RegExp(`isNotificationEnabled\\(\\s*"${entry.key}"\\s*\\)`));
      }
    }
  });

  it("lists the club form alert as sent from the submission alert, with its recipients set on each form (#1017)", () => {
    const entry = notificationCatalog.find((candidate) => candidate.key === "CLUB_FORM_SUBMITTED");
    expect(entry?.sentFrom).toBe("modules/club-forms/submission-alert.ts");
    expect(entry?.recipients).toBe("Set on each club form.");
    expect(entry?.source).toEqual({ kind: "club-form-list" });
    expect(entry?.switchReadIn).toEqual(["modules/club-forms/links.ts", "modules/club-forms/open-applications.ts", "modules/club-forms/submissions.ts"]);
  });

  it("asks for a warning only before the lockout alert goes off", () => {
    const withWarning = notificationCatalog.filter((entry) => entry.confirmBeforeOff).map((entry) => entry.key);
    expect(withWarning).toEqual(["SIGN_IN_LOCKOUT_OFFICE_COPY"]);
    expect(getNotificationDefinition("SIGN_IN_LOCKOUT_OFFICE_COPY").confirmBeforeOff?.message)
      .toContain("You won't be told when accounts are locked");
  });

  it("names a platform address for exactly the three address alerts", () => {
    const fields = notificationCatalog
      .flatMap((entry) => (entry.source.kind === "platform-address" ? [entry.source.field] : []))
      .sort();
    expect(fields).toEqual(["newClubApplicationEmail", "securityAlertEmail", "supportContact"]);
  });
});

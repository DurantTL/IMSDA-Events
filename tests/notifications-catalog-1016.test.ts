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

  it("covers the ten send sites the issue traced, plus a switch ready for the club form alert", () => {
    expect(notificationKeys).toHaveLength(11);
    const built = notificationCatalog.filter((entry) => entry.built);
    expect(built).toHaveLength(10);
    const ready = notificationCatalog.find((entry) => entry.key === "CLUB_FORM_SUBMITTED");
    expect(ready?.built).toBe(false);
  });

  it("is wired into every built send site: the file names its key and checks the switch", () => {
    for (const entry of notificationCatalog.filter((candidate) => candidate.built)) {
      const source = read(entry.sentFrom);
      expect(source, `${entry.sentFrom} imports the helper`).toContain('from "@/modules/notifications/settings"');
      expect(source, `${entry.sentFrom} checks ${entry.key}`).toMatch(
        new RegExp(`isNotificationEnabled\\(\\s*(?:"${entry.key}"|templateKey)\\s*\\)`),
      );
    }
    // The two transfer notices share one queueing function and pass their template key, which is the notification key.
    const transfers = read("modules/club-transfers/repository.ts");
    expect(transfers).toContain('"MEMBER_TRANSFER_STARTED"');
    expect(transfers).toContain('"MEMBER_TRANSFER_COMPLETED"');
  });

  it("does not build the club form alert yet", () => {
    const entry = notificationCatalog.find((candidate) => candidate.key === "CLUB_FORM_SUBMITTED");
    expect(entry?.sentFrom).toBe("not built yet");
    for (const file of ["modules/club-forms/repository.ts", "modules/club-forms/submissions.ts"]) {
      try {
        expect(read(file)).not.toContain("CLUB_FORM_SUBMITTED");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
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

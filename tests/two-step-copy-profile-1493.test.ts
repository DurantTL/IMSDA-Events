import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Site rule A5 (docs/SITE-RULES.md, "Sign-in"), extended to the staff profile and the attendee settings page
 * (#1493): the panel that manages the authenticator app is called "two-step sign-in", never "two-factor
 * authentication", "2FA" or "MFA". Club directors see the attendee settings page.
 */

const files = [
  "app/(workspace)/profile/page.tsx",
  "app/(public)/account/(portal)/profile/page.tsx",
  "components/profile-view.tsx",
  "components/attendee-account-settings.tsx",
  "components/mfa-manager.tsx",
  "components/passkey-manager.tsx",
  "components/staff-passkey-manager.tsx",
  "app/api/auth/mfa/route.ts",
  "app/api/attendee/mfa/route.ts",
];
const otherNames = /two[- ]factor|\b2[- ]?fa\b|\bmfa\b(?!_|[A-Z])|multi[- ]factor|second factor|2[- ]step|two step\b|two-step verification|two-step authentication/i;

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** What a person can read: strings and JSX text, with comments, imports and identifiers left out. */
const readable = (file: string) => file.endsWith("route.ts")
  ? [...read(file).matchAll(/message:\s*("[^"\n]*"|`[^`]*`)/g)].map((match) => match[1]!) // a route speaks through its `message`
  : read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line))
    .join("\n")
    .match(/"[^"\n]*"|`[^`]*`|>[^<>{}]+</g)?.filter((piece) => !piece.includes("@/")) ?? [];

describe("A5 on the staff profile and attendee settings (#1493)", () => {
  it("calls it two-step sign-in everywhere these pages speak", () => {
    const wrong = files.flatMap((file) => readable(file)
      .filter((piece) => otherNames.test(piece.replace(/\/api\/\w+\/mfa\b|MFA_[A-Z_]+/g, "")))
      .map((piece) => `${file}: ${piece.slice(0, 80)}`));
    expect(wrong).toEqual([]);
  });

  it("titles the panel 'Two-step sign-in' by default", () => {
    expect(read("components/mfa-manager.tsx")).toContain('heading = "Two-step sign-in"');
  });

  it("catches another name (the scanner itself)", () => {
    expect(otherNames.test("Two-factor authentication")).toBe(true);
    expect(otherNames.test("Add a second factor")).toBe(true);
    expect(otherNames.test("Two-step sign-in")).toBe(false);
  });
});

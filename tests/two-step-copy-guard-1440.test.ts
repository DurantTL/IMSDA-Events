// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "./helpers/dom-render";
import { read } from "./helpers/css-source";

vi.mock("next/navigation", () => ({ usePathname: () => "/account/two-step", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { TwoStepGate } from "@/components/two-step-setup";

/**
 * Site rules A3, A4 and A5 (docs/SITE-RULES.md, "Sign-in"): the two-step gate page says why it is needed, lists the
 * passkey first marked "Easiest", and uses one name, "two-step sign-in". The gate is rendered in a real DOM with
 * synthetic account data; the page and its pieces are also scanned for the old names.
 */

const status = { required: true, status: "NONE", confirmedAt: null, lastVerifiedAt: null, unusedRecoveryCodes: 0 } as const;
const gate = (available: boolean) => createElement(TwoStepGate, {
  clubName: "Example Club",
  email: "director@example.test",
  mfaStatus: status,
  passkeySettings: { available, hasAuthenticator: false, passkeys: [] },
});

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const text = () => mounted!.container.textContent ?? "";
async function chooseHow() {
  const start = [...mounted!.container.querySelectorAll("button")].find((button) => /Set up two-step sign-in/.test(button.textContent ?? ""));
  expect(start, "the intro offers a Set up two-step sign-in button").toBeTruthy();
  await act(async () => { start!.click(); });
}

describe("A3: setup is easy and says why it is needed", () => {
  it("opens on the reason (young people's records) and one clear button, before any choice", async () => {
    mounted = await mount(gate(true));
    expect(text()).toContain("Why this is needed");
    expect(text()).toMatch(/records about young people/);
    expect(text()).toMatch(/health forms and medical notes/);
    expect(text()).toContain("Takes about two minutes");
    expect(text()).toContain("Set up two-step sign-in");
  });

  it("gives the same reason on the page that asks for the code, and sends setup only to the gate", () => {
    const page = read("app/(public)/account/two-step/page.tsx");
    expect(page.match(/Why this is needed/g)?.length).toBeGreaterThanOrEqual(1);
    expect(page).toMatch(/records about young people/);
    expect(page).toContain("<TwoStepGate");
  });
});

describe("A4: the passkey is listed first and marked Easiest", () => {
  it("lists the passkey option first, selected, with the Easiest chip on it only", async () => {
    mounted = await mount(gate(true));
    await chooseHow();
    const options = [...mounted.container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="method"]')];
    expect(options.map((option) => option.value)).toEqual(["passkey", "authenticator"]);
    expect(options[0]!.checked).toBe(true);
    const labels = options.map((option) => option.closest("label")!.textContent ?? "");
    expect(labels[0]).toContain("Easiest");
    expect(labels[1]).not.toContain("Easiest");
    expect(labels[1]).toContain("authenticator app");
  });

  it("goes straight to the authenticator when passkeys are not switched on, with no Easiest claim", async () => {
    mounted = await mount(gate(false));
    await chooseHow();
    expect(mounted.container.querySelector('input[name="method"]')).toBeNull();
    expect(text()).not.toContain("Easiest");
  });
});

describe("A5: one name on the gate page", () => {
  /** The gate page and the pieces it shows. The staff-side pages say "Two-factor authentication" and are not the gate. */
  const gateFiles = [
    "app/(public)/account/two-step/page.tsx",
    "components/two-step-setup.tsx",
    "components/roster-unlock-form.tsx",
    "components/passkey-unlock-button.tsx",
    "app/api/attendee/mfa/route.ts",
  ];
  const otherNames = /two[- ]factor|\b2[- ]?fa\b|\bmfa\b(?!_|[A-Z])|multi[- ]factor|2[- ]step|two step\b|two-step verification|two-step authentication/i;

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

  it("calls it two-step sign-in everywhere the gate speaks", () => {
    const wrong = gateFiles.flatMap((file) => readable(file)
      .filter((piece) => otherNames.test(piece.replace(/\/api\/\w+\/mfa\b|MFA_REQUEST_FAILED/g, "")))
      .map((piece) => `${file}: ${piece.slice(0, 80)}`));
    expect(wrong).toEqual([]);
  });

  it("uses the name in the gate's heading, button and finish screen", async () => {
    mounted = await mount(gate(true));
    expect(mounted.container.querySelector("h1")?.textContent).toContain("two-step sign-in");
    const source = read("components/two-step-setup.tsx");
    expect(source).toContain("Two-step sign-in is on");
  });

  it("catches another name (the scanner itself)", () => {
    expect(otherNames.test("Set up two-factor authentication")).toBe(true);
    expect(otherNames.test("Set up two-step sign-in")).toBe(false);
  });
});

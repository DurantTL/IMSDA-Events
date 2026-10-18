import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisabledHint, disabledHintId } from "@/components/disabled-hint";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("app/globals.css");

function luminance(hex: string) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!;

describe("site-wide focus ring (#1003)", () => {
  it("draws a solid navy 3px ring from the token, matching the modal close button", () => {
    expect(css).toMatch(/button:focus-visible,\s*a:focus-visible,\s*input:focus-visible,\s*select:focus-visible \{\s*outline: 3px solid var\(--focus-ring\);\s*outline-offset: 2px;/);
    expect(css).toMatch(/--focus-ring: var\(--imsda-navy\);/);
    expect(css).toMatch(/--focus-ring-on-dark: var\(--imsda-gold\);/);
    expect(css).not.toContain("rgba(240, 179, 35, 0.55)");
    // Same width, colour and offset as the close buttons.
    expect(css).toMatch(/\.modal-close-button:focus-visible \{ outline: 3px solid var\(--imsda-navy\); outline-offset: 2px; \}/);
  });

  it("is at least 3:1 on the light surfaces and, in gold, on the navy surfaces", () => {
    const navy = token("imsda-navy");
    const gold = token("imsda-gold");
    for (const light of ["#ffffff", token("paper"), "#fbfcfd", token("imsda-navy-soft")]) {
      expect(contrast(navy, light)).toBeGreaterThanOrEqual(3);
    }
    for (const dark of [navy, token("imsda-navy-deep")]) {
      expect(contrast(gold, dark)).toBeGreaterThanOrEqual(3);
    }
    // The old ring: gold at 55% on white was about 1.4:1.
    expect(contrast(gold, "#ffffff")).toBeLessThan(3);
  });

  it("turns gold on the dark navy surfaces", () => {
    expect(css).toMatch(/:is\(\.sidebar, [^)]*\.on-dark\)\s*:is\(button, a, input, select, summary, \[tabindex\]\):focus-visible \{\s*outline-color: var\(--focus-ring-on-dark\);/);
  });

  it("rings the label of a visually hidden file input", () => {
    expect(css).toMatch(/:is\(\.file-button, \.club-import-upload, \.file-drop\):has\(input\[type="file"\]:focus-visible\) \{\s*outline: 3px solid var\(--focus-ring\);/);
  });
});

describe("disabled buttons say why (#1003)", () => {
  it("links the button to the hint only while there is a reason", () => {
    expect(disabledHintId("Choose a location first.", "x-hint")).toBe("x-hint");
    expect(disabledHintId(null, "x-hint")).toBeUndefined();
    const shown = renderToStaticMarkup(createElement(DisabledHint, { id: "x-hint", reason: "Choose a location first." }));
    expect(shown).toContain('id="x-hint"');
    expect(shown).toContain("Choose a location first.");
    expect(renderToStaticMarkup(createElement(DisabledHint, { id: "x-hint", reason: null }))).toBe("");
  });

  const cases: Array<[string, string, string]> = [
    ["Continue with N people", "components/group-registration-editor.tsx", "group-editor-continue-hint"],
    ["Mark class completed", "components/club-earned-awards-workspace.tsx", "earned-class-hint"],
    ["Already handed out", "components/club-order-workspace.tsx", "club-order-handed-out-hint"],
    ["Export list (CSV)", "components/club-order-workspace.tsx", "club-order-nothing"],
    ["PBE group start Continue", "components/group-registration-flow.tsx", "group-flow-continue-hint"],
    ["Team start Continue", "components/general-link-registration-flow.tsx", "general-link-continue-hint"],
    ["Save format", "components/roster-export-builder.tsx", "roster-export-save-hint"],
  ];
  it.each(cases)("%s: the disabled button names its hint and the hint is rendered", (_label, file, id) => {
    const source = read(file);
    expect(source).toContain(`aria-describedby={disabledHintId(`);
    expect(source).toContain(`"${id}"`);
    // The id is used both on the button and on the hint element.
    expect(source.split(id).length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe("file choosers (#1003)", () => {
  it.each([
    "components/csv-import-dialog.tsx",
    "components/club-import-workspace.tsx",
    "components/eadventist-import-workspace.tsx",
    "components/background-check-import.tsx",
    "components/event-content-workspace.tsx",
    "components/message-attachments-field.tsx",
    "components/message-body-editor.tsx",
  ])("%s hides the raw file input behind a styled label and keeps its accept types", (file) => {
    const source = read(file);
    for (const match of source.matchAll(/<input\b[^>]*?type="file"[\s\S]*?\/>|<input\b(?:(?!\/>)[\s\S])*?type="file"\s*\/>/g)) {
      expect(match[0]).toContain("sr-only");
      expect(match[0]).toContain("accept");
    }
    expect(source).toMatch(/type="file"/);
  });

  it("the communications chooser buttons are visible secondary buttons", () => {
    expect(read("components/message-attachments-field.tsx")).toContain('className="secondary-button file-button"');
    expect(read("components/message-body-editor.tsx")).toContain('className="secondary-button file-button"');
  });
});

describe("email-selected dialog, announcement variant (#1003)", () => {
  it("uses the standard stacked form for its fields", () => {
    const source = read("components/selected-audience-dialog.tsx");
    expect(source).toContain('className="form-stack selected-audience-fields"');
    const stack = source.slice(source.indexOf('className="form-stack selected-audience-fields"'));
    expect(stack.indexOf("Announcement message")).toBeGreaterThan(0);
    expect(stack.indexOf("Announcement message")).toBeLessThan(stack.indexOf("Reviewing the selected registrations"));
  });
});

describe("staff loading state (#1003)", () => {
  it("has a loading.tsx in the workspace group so the sidebar and header stay", () => {
    const loading = read("app/(workspace)/loading.tsx");
    expect(loading).toContain("content-skeleton");
    expect(loading).toContain('role="status"');
    expect(loading).not.toContain("Loading IMSDA Events");
    expect(css).toMatch(/\.content-skeleton \{/);
  });
});

describe("auth pages on a phone (#1003)", () => {
  it("does not leave the phone tab-bar padding as a pale strip under the dark background", () => {
    expect(css).toMatch(/body:has\(\.auth-page\) \{ padding-bottom: 0; \}/);
    // The padding it overrides is the phone rule that reserves room for the bottom tab bar.
    expect(css).toMatch(/@media \(max-width: 800px\) \{\s*body \{ padding-bottom: calc\(73px \+ env\(safe-area-inset-bottom\)\); \}/);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("app/globals.css");

// Every opening <input ...> / <textarea ...> tag, up to its self-closing "/>".
function textControls(source: string, firstLine = 1) {
  const tags: string[] = [];
  for (const match of source.matchAll(/<(input|textarea)\b/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    if (line < firstLine) continue;
    const tag = source.slice(match.index, source.indexOf("/>", match.index));
    if (/type="(checkbox|radio|date|number)"/.test(tag)) continue;
    tags.push(tag);
  }
  return tags;
}

describe("form builders do not invite AutoFill (#1060)", () => {
  // The builder is split across components/registration-builder/. The live preview's
  // inputs (builder-preview.tsx) imitate the public form and are not builder fields.
  const registration = readdirSync(path.join(process.cwd(), "components/registration-builder"))
    .filter((file) => file.endsWith(".tsx") && file !== "builder-preview.tsx")
    .sort()
    .map((file) => read(`components/registration-builder/${file}`))
    .join("\n");
  const sets = [
    ["registration builder", textControls(registration)],
    ["club form builder", textControls(read("components/club-form-builder.tsx"))],
  ] as const;

  for (const [label, tags] of sets) {
    it(`${label}: every text input and textarea opts out with a neutral name`, () => {
      expect(tags.length).toBeGreaterThan(5);
      for (const tag of tags) {
        expect(tag).toContain('autoComplete="off"');
        const name = /\bname="([^"]+)"/.exec(tag)?.[1] ?? "";
        expect(name).toMatch(/^builder-/);
        expect(name).not.toMatch(/address|street|city|zip|postal|phone|email|contact|tel\b/i);
      }
    });
  }
});

describe("phone picker trigger (#1060)", () => {
  it("stays on one line with an ellipsis and a fixed chevron", () => {
    expect(css).toMatch(/\.searchable-select-trigger > span \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.searchable-select-trigger > span \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.searchable-select-trigger > svg \{[^}]*flex: 0 0 auto/);
  });

  it("draws one focus ring, not a wrapper ring plus a button ring", () => {
    expect(css).toMatch(/\.searchable-select-trigger:focus-visible \{ outline: 0/);
    expect(css).toMatch(/is-phone-trigger \.searchable-select-control:focus-within \{ box-shadow: none/);
  });
});

describe("phone step list (#1060)", () => {
  it("styles reached steps as pills and shows the hint only on phones", () => {
    expect(css).toMatch(/\.public-registration-step-hint \{ display: none/);
    expect(css).toMatch(/@media \(max-width: 768px\) \{ \.public-registration-step-hint \{ display: block/);
    expect(css).toMatch(/\.public-registration-progress li > button \{[^}]*border: 1\.5px solid[^}]*border-radius: 999px/);
    expect(css).toMatch(/\.public-registration-progress li > button:active/);
  });

  it("renders the hint only when a step is reachable", () => {
    const form = read("components/public-registration-form.tsx");
    expect(form).toContain("stepItems.some((item) => item.clickable)");
    expect(form).toContain("Tap a step to go back");
  });
});

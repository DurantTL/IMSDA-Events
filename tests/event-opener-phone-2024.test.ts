import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/** The Events area's "Open an event" picker on phones (#2024). */
describe("the Open an event picker on a phone", () => {
  const shell = read("components/app-shell.tsx");
  const css = read("components/staff-shell.module.css");
  // The phone block that holds the Switch picker's short label.
  const phone = css.slice(css.lastIndexOf("@media (max-width: 800px)", css.indexOf(".pickerShell .pickerPhoneLabel")));
  const phoneBlock = phone.slice(0, phone.indexOf("\n}\n"));

  it("marks the opener apart from the event bar's Switch picker", () => {
    expect(shell).toMatch(/className=\{`\$\{styles\.pickerShell\} \$\{styles\.openerShell\}`\}>\s*<select id="event-opener"/);
  });

  it("gives the opener its own full-width line with visible text, after the Switch picker's narrow, label-only rules", () => {
    const switchRule = phoneBlock.indexOf(".pickerShell select { width: 6.25rem; }");
    const openerRule = phoneBlock.indexOf(".openerShell select { width: 100%; color: var(--imsda-navy); }");
    expect(switchRule).toBeGreaterThan(-1);
    expect(openerRule).toBeGreaterThan(switchRule);
    expect(phoneBlock).toContain(".trailing:has(.openerShell) { flex: 1 1 100%; }");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** #2025 final cleanup: the weekly mobile run is a matrix, and two small layout fixes keep their rules. */
const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("mobile layout workflow matrix (#2025)", () => {
  const workflow = read(".github/workflows/mobile-layout.yml");

  it("runs the weekly and manual widths as one job each, and a pull request as one quick job", () => {
    expect(workflow).toContain(`fromJSON(github.event_name == 'pull_request' && '["360,1024"]' || '["360","390","768","1024"]')`);
    expect(workflow).toContain("MOBILE_LAYOUT_WIDTHS: ${{ matrix.widths }}");
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("timeout-minutes: 30");
  });

  it("keeps the pull request behavior: no screenshots, same trigger paths and cron", () => {
    expect(workflow).toContain("MOBILE_LAYOUT_NO_SHOTS: ${{ github.event_name == 'pull_request' && '1' || '0' }}");
    expect(workflow).toContain('cron: "47 9 * * 1"');
    expect(workflow).toContain('- "components/table-card-labels.tsx"');
  });

  it("gives each matrix job its own artifact name", () => {
    expect(workflow).toMatch(/name: mobile-layout-screenshots-\$\{\{ matrix\.widths/);
  });
});

describe("small layout fixes (#2025)", () => {
  const css = read("app/globals.css");

  it("pads only the reconciliation tile, not the amount span inside it", () => {
    expect(css).toMatch(/\.reconciliation-grid > span \{[^}]*padding: 12px 14px/);
    expect(css).not.toMatch(/\.reconciliation-grid span \{/);
  });

  it("gives the Account holder column room", () => {
    expect(css).toMatch(/\.roster-table td\[data-label="Account holder"\] \{[^}]*width: auto; min-width: 12rem/);
  });
});

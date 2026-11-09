import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refreshAfterRemember } from "@/components/shell-event-selection";

// #1745: saving the remembered event must not refresh a page whose address already names its event; that refresh could
// cancel a sort or filter the user chose right after the list opened.

describe("remembered event refresh (#1745)", () => {
  it("skips the refresh when the address names the event", () => {
    expect(refreshAfterRemember("event=evt_wr")).toBe(false);
    expect(refreshAfterRemember("?event=evt_wr&sort=name")).toBe(false);
    expect(refreshAfterRemember("sort=name&event=evt_wr")).toBe(false);
  });

  it("refreshes a page that relies on the remembered event", () => {
    expect(refreshAfterRemember("")).toBe(true);
    expect(refreshAfterRemember("sort=name")).toBe(true);
    expect(refreshAfterRemember("event=")).toBe(true);
  });

  it("never refreshes unconditionally after saving the event in the app shell", () => {
    const source = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
    expect(source).not.toMatch(/rememberLastUsedEvent\([^)]*\)\.then\(\(\) => router\.refresh\(\)\)/);
    expect(source).toMatch(/if \(refreshAfterRemember\(window\.location\.search\)\) router\.refresh\(\);/);
  });
});

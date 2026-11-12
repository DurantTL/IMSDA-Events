import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_PAGE_ACTIVE_WINDOW_MS, LIVE_PAGE_REFRESH_MS, shouldRefreshLivePage } from "@/components/live-page-refresh";
import { canApplyRefreshedRegistrations, syncAfterLocalSave, syncRefreshedRegistrations, type RegistrationsSync } from "@/modules/registrations/finance-view";

describe("live page refresh (#1577)", () => {
  const base = { visible: true, online: true, lastInputAt: 1_000_000, now: 1_000_000 + 60_000 };

  it("refreshes every 30 seconds", () => {
    expect(LIVE_PAGE_REFRESH_MS).toBe(30_000);
  });

  it("refreshes only a visible, online tab someone has touched recently", () => {
    expect(shouldRefreshLivePage(base)).toBe(true);
    expect(shouldRefreshLivePage({ ...base, visible: false })).toBe(false);
    expect(shouldRefreshLivePage({ ...base, online: false })).toBe(false);
    expect(shouldRefreshLivePage({ ...base, now: base.lastInputAt + LIVE_PAGE_ACTIVE_WINDOW_MS + 1 })).toBe(false);
  });

  it("is on Event home and Money", () => {
    for (const file of ["app/(workspace)/overview/page.tsx", "app/(workspace)/finance/page.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toContain("<LivePageRefresh />");
    }
  });
});

describe("Money list takes refreshed rows only when idle (#1577)", () => {
  const idle = { dialogOpen: false, typedWork: false, saving: false, reviewingRefund: false };

  it("applies when nothing is open, typed or saving", () => {
    expect(canApplyRefreshedRegistrations(idle)).toBe(true);
  });

  it("waits while a dialog is open, work is typed, a save runs or a refund is under review", () => {
    expect(canApplyRefreshedRegistrations({ ...idle, dialogOpen: true })).toBe(false);
    expect(canApplyRefreshedRegistrations({ ...idle, typedWork: true })).toBe(false);
    expect(canApplyRefreshedRegistrations({ ...idle, saving: true })).toBe(false);
    expect(canApplyRefreshedRegistrations({ ...idle, reviewingRefund: true })).toBe(false);
  });
});

describe("a held refresh never overwrites a local save (#1577)", () => {
  type Row = { id: string; received: number };
  const first: Row[] = [{ id: "r1", received: 0 }];

  it("applies a refresh when idle and holds it when busy", () => {
    const state = { seen: first, rows: first };
    const incoming: Row[] = [{ id: "r1", received: 10 }];
    expect(syncRefreshedRegistrations(state, incoming, true).rows).toBe(incoming);
    expect(syncRefreshedRegistrations(state, incoming, false)).toBe(state);
    expect(syncRefreshedRegistrations({ seen: incoming, rows: incoming }, incoming, true).rows).toBe(incoming);
  });

  it("refresh held, then a local save, then close: the saved row is kept", () => {
    let state: RegistrationsSync<Row> = { seen: first, rows: first };
    const held: Row[] = [{ id: "r1", received: 0 }];
    state = syncRefreshedRegistrations(state, held, false);
    expect(state.seen).toBe(first);
    state = syncAfterLocalSave(state, held, { id: "r1", received: 5000 });
    state = syncRefreshedRegistrations(state, held, true);
    expect(state.rows).toEqual([{ id: "r1", received: 5000 }]);
    const newer: Row[] = [{ id: "r1", received: 5000 }];
    expect(syncRefreshedRegistrations(state, newer, true).rows).toBe(newer);
  });
});

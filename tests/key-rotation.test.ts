import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: dependencies.getServerEnv }));

import { openSecret, sealSecret, sealedKeyVersion } from "@/lib/secret-box";
import {
  rotateSealedColumns,
  scanSealedColumns,
  type SealedColumnStore,
  type SealedRow,
} from "@/modules/security/key-rotation";
import { SEALED_COLUMNS, type SealedColumn } from "@/modules/security/sealed-columns";

const oldKey = "synthetic-old-key-0123456789-abcdefghijklmnopq";
const newKey = "synthetic-new-key-0123456789-abcdefghijklmnopq";
const lostKey = "synthetic-lost-key-0123456789-abcdefghijklmnop";

const columns = {
  code: SEALED_COLUMNS.find((column) => column.label === "SecurityCheckCode.sealedCode")!,
  health: SEALED_COLUMNS.find((column) => column.label === "HealthRecordField.sealedValue")!,
  feed: SEALED_COLUMNS.find((column) => column.label === "CalendarFeed.sealedUrl")!,
};

function setKeys(keys: { key: string; version: number; previous?: { key: string; version: number } }) {
  dependencies.getServerEnv.mockReturnValue({
    SECRET_ENCRYPTION_KEY: keys.key,
    SECRET_ENCRYPTION_KEY_VERSION: keys.version,
    SECRET_ENCRYPTION_PREVIOUS_KEY: keys.previous?.key,
    SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION: keys.previous?.version,
  });
}

/** An in-memory stand-in for the database, with compare-and-set writes. */
class FakeStore implements SealedColumnStore {
  rows = new Map<string, Map<string, { value: string; fields: Record<string, unknown> }>>();
  writes = 0;
  /** Called with the row just before a write, so a test can change it underneath the rotation. */
  beforeWrite: ((id: string) => void) | null = null;
  failWritesAfter = Infinity;

  put(column: SealedColumn, id: string, value: string, extra: Record<string, unknown> = {}) {
    const table = this.rows.get(column.label) ?? new Map();
    table.set(id, { value, fields: { id, ...extra } });
    this.rows.set(column.label, table);
  }

  value(column: SealedColumn, id: string) {
    return this.rows.get(column.label)!.get(id)!.value;
  }

  async readBatch(column: SealedColumn, afterId: string | null, take: number): Promise<SealedRow[]> {
    const table = this.rows.get(column.label) ?? new Map();
    return [...table.entries()]
      .filter(([id]) => afterId === null || id > afterId)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, take)
      .map(([id, row]) => ({ id, value: row.value, fields: { ...row.fields } }));
  }

  async replace(column: SealedColumn, row: SealedRow, next: { value: string; fingerprint?: string }) {
    this.beforeWrite?.(row.id);
    if (this.writes >= this.failWritesAfter) throw new Error("connection lost");
    const stored = this.rows.get(column.label)?.get(row.id);
    if (!stored || stored.value !== row.value) return false;
    stored.value = next.value;
    if (next.fingerprint !== undefined && column.fingerprint) stored.fields[column.fingerprint.column] = next.fingerprint;
    this.writes += 1;
    return true;
  }
}

function seedOld(store: FakeStore) {
  setKeys({ key: oldKey, version: 1 });
  for (const n of [1, 2, 3, 4, 5]) store.put(columns.code, `c${n}`, sealSecret(`12345${n}`, "security-check-code"));
  for (const n of [1, 2]) {
    store.put(columns.health, `h${n}`, sealSecret(JSON.stringify(`value ${n}`), `health-record:rec${n}:allergies`), {
      recordId: `rec${n}`,
      fieldKey: "allergies",
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("key check scan", () => {
  it("counts current, older and unreadable values without opening a way to see them", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: lostKey, version: 9 });
    store.put(columns.code, "c9", sealSecret("999999", "security-check-code"));
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    store.put(columns.code, "c6", sealSecret("123456", "security-check-code"));
    store.put(columns.code, "c7", "not-a-sealed-value");

    const [code, health] = await scanSealedColumns(store, { columns: [columns.code, columns.health], batchSize: 2 });
    expect(code).toEqual({ label: columns.code.label, total: 8, current: 1, older: 5, unreadable: 2 });
    expect(health).toEqual({ label: columns.health.label, total: 2, current: 0, older: 2, unreadable: 0 });
    expect(JSON.stringify([code, health])).not.toMatch(/c9|rec1|synthetic/);
  });

  it("counts an older value as unreadable when the previous key is not loaded", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: newKey, version: 2 });
    const [code] = await scanSealedColumns(store, { columns: [columns.code] });
    expect([code.older, code.unreadable]).toEqual([0, 5]);
  });

  it("treats a legacy-version value on version 1 as current when no rotation has happened", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: oldKey, version: 1 });
    const [code] = await scanSealedColumns(store, { columns: [columns.code] });
    expect([code.current, code.older, code.unreadable]).toEqual([5, 0, 0]);
  });
});

describe("rotation", () => {
  it("is a dry run without apply", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    const [code] = await rotateSealedColumns(store, { apply: false, columns: [columns.code] });
    expect(code).toMatchObject({ wouldRotate: 5, rotated: 0, alreadyCurrent: 0 });
    expect(store.writes).toBe(0);
  });

  it("re-seals every value with the current key under the same purpose", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    const results = await rotateSealedColumns(store, { apply: true, columns: [columns.code, columns.health], batchSize: 2 });
    expect(results.map((result) => [result.rotated, result.unreadable, result.skipped])).toEqual([[5, 0, 0], [2, 0, 0]]);
    setKeys({ key: newKey, version: 2 });
    expect(sealedKeyVersion(store.value(columns.code, "c3"))).toBe(2);
    expect(openSecret(store.value(columns.code, "c3"), "security-check-code")).toBe("123453");
    expect(JSON.parse(openSecret(store.value(columns.health, "h2"), "health-record:rec2:allergies"))).toBe("value 2");
  });

  it("resumes after a partial run and a rerun is a no-op", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    store.failWritesAfter = 2;
    const partial = await rotateSealedColumns(store, { apply: true, columns: [columns.code], batchSize: 2 });
    expect(partial[0]).toMatchObject({ rotated: 2, skipped: 3 });
    store.failWritesAfter = Infinity;

    const resumed = await rotateSealedColumns(store, { apply: true, columns: [columns.code], batchSize: 2 });
    expect(resumed[0]).toMatchObject({ rotated: 3, alreadyCurrent: 2, skipped: 0 });
    const writes = store.writes;
    const again = await rotateSealedColumns(store, { apply: true, columns: [columns.code], batchSize: 2 });
    expect(again[0]).toMatchObject({ rotated: 0, alreadyCurrent: 5, skipped: 0, unreadable: 0 });
    expect(store.writes).toBe(writes);
  });

  it("leaves a value that changed while it ran, and the next run picks it up if still old", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    store.beforeWrite = (id) => {
      if (id !== "c2") return;
      store.beforeWrite = null;
      // Someone re-seals the same code under the old key, so the value differs from what was read.
      setKeys({ key: oldKey, version: 1 });
      store.rows.get(columns.code.label)!.get("c2")!.value = sealSecret("123452", "security-check-code");
      setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    };
    const first = await rotateSealedColumns(store, { apply: true, columns: [columns.code] });
    expect(first[0]).toMatchObject({ rotated: 4, skipped: 1 });
    expect(sealedKeyVersion(store.value(columns.code, "c2"))).toBe(1);

    const second = await rotateSealedColumns(store, { apply: true, columns: [columns.code] });
    expect(second[0]).toMatchObject({ rotated: 1, skipped: 0, alreadyCurrent: 4 });
  });

  it("counts unreadable values, never stops for them, and leaves them as they are", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: lostKey, version: 9 });
    const lost = sealSecret("999999", "security-check-code");
    store.put(columns.code, "c0", lost);
    store.put(columns.code, "c6", "garbage");
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    const [code] = await rotateSealedColumns(store, { apply: true, columns: [columns.code] });
    expect(code).toMatchObject({ rotated: 5, unreadable: 2, skipped: 0 });
    expect(store.value(columns.code, "c0")).toBe(lost);
    expect(store.value(columns.code, "c6")).toBe("garbage");
  });

  it("recomputes a fingerprint from the opened value in the same write", async () => {
    const store = new FakeStore();
    setKeys({ key: oldKey, version: 1 });
    store.put(columns.feed, "f1", sealSecret("https://calendar.example.test/a.ics", "calendar-feed-url"), { urlFingerprint: "stale" });
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    const { fingerprintSecret } = await import("@/lib/secret-box");
    const [feed] = await rotateSealedColumns(store, { apply: true, columns: [columns.feed] });
    expect(feed.rotated).toBe(1);
    const row = (await store.readBatch(columns.feed, null, 10))[0];
    expect(row.fields.urlFingerprint).toBe(fingerprintSecret("https://calendar.example.test/a.ics", "calendar-feed-url"));
  });

  it("never reports a value, id or purpose", async () => {
    const store = new FakeStore();
    seedOld(store);
    setKeys({ key: newKey, version: 2, previous: { key: oldKey, version: 1 } });
    const results = await rotateSealedColumns(store, { apply: true });
    const text = JSON.stringify(results);
    expect(text).not.toMatch(/rec1|c1|123451|allergies/);
    // Every registry column is walked, including ones with no rows.
    expect(results.map((result) => result.label)).toEqual(SEALED_COLUMNS.map((column) => column.label));
  });
});

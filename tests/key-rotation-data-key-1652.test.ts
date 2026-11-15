import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: dependencies.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

import { resetDataKeyringForTests, setDataKeyStateForTests } from "@/lib/data-key/keyring";
import {
  DataKeyUnavailableError,
  dataSealedKeyring,
  fingerprintData,
  fingerprintSecret,
  openData,
  openSecret,
  sealData,
  sealSecret,
  sealedDataKeyVersion,
  sealedKeyVersion,
} from "@/lib/secret-box";
import {
  rotateSealedColumns,
  scanSealedColumns,
  type SealedColumnStore,
  type SealedRow,
} from "@/modules/security/key-rotation";
import { SEALED_COLUMNS, type SealedColumn } from "@/modules/security/sealed-columns";

const signInKey = "synthetic-sign-in-key-0123456789-abcdefghijklm";
const ikm1 = Buffer.alloc(32, 31);
const ikm2 = Buffer.alloc(32, 32);

const columns = {
  code: SEALED_COLUMNS.find((column) => column.label === "SecurityCheckCode.sealedCode")!,
  health: SEALED_COLUMNS.find((column) => column.label === "HealthRecordField.sealedValue")!,
  feed: SEALED_COLUMNS.find((column) => column.label === "CalendarFeed.sealedUrl")!,
};

class FakeStore implements SealedColumnStore {
  rows = new Map<string, Map<string, { value: string; fields: Record<string, unknown> }>>();
  replaced: { label: string; fingerprint?: string }[] = [];

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
    const stored = this.rows.get(column.label)?.get(row.id);
    if (!stored || stored.value !== row.value) return false;
    stored.value = next.value;
    if (next.fingerprint !== undefined && column.fingerprint) stored.fields[column.fingerprint.column] = next.fingerprint;
    this.replaced.push({ label: column.label, fingerprint: next.fingerprint });
    return true;
  }
}

function notSeparate() {
  setDataKeyStateForTests("not-separate");
}

function ready(version: number, previous?: { version: number; ikm: Buffer }) {
  setDataKeyStateForTests({ kind: "ready", ring: { current: { version, ikm: version === 1 ? ikm1 : ikm2 }, previous } });
}

/** Rows as a deployment has them just before the data key is turned on: everything on the sign-in key. */
function seedBeforeTheMove(store: FakeStore) {
  notSeparate();
  for (const n of [1, 2]) store.put(columns.code, `c${n}`, sealSecret(`12345${n}`, "security-check-code"));
  for (const n of [1, 2, 3]) {
    store.put(columns.health, `h${n}`, sealSecret(JSON.stringify(`value ${n}`), `health-record:rec${n}:allergies`), { recordId: `rec${n}`, fieldKey: "allergies" });
  }
  const url = "https://calendar.example.test/a.ics";
  store.put(columns.feed, "f1", sealSecret(url, "calendar-feed-url"), { urlFingerprint: fingerprintSecret(url, "calendar-feed-url") });
  return url;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDataKeyringForTests();
  dependencies.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: signInKey, SECRET_ENCRYPTION_KEY_VERSION: 1 });
});

describe("key check scan with a separate data key (#1652)", () => {
  it("counts personal-data values still on the sign-in key as older and as not moved, and leaves sign-in columns alone", async () => {
    const store = new FakeStore();
    seedBeforeTheMove(store);
    ready(1);
    store.put(columns.health, "h9", sealData(JSON.stringify("new"), "health-record:rec9:allergies"), { recordId: "rec9", fieldKey: "allergies" });

    const [code, health] = await scanSealedColumns(store, { columns: [columns.code, columns.health] });
    expect(code).toEqual({ label: columns.code.label, total: 2, current: 2, older: 0, onSignInKey: 0, unreadable: 0 });
    expect(health).toEqual({ label: columns.health.label, total: 4, current: 1, older: 3, onSignInKey: 3, unreadable: 0 });
  });

  it("treats an older data key version as older but not as on the sign-in key", async () => {
    const store = new FakeStore();
    ready(1);
    store.put(columns.health, "h1", sealData(JSON.stringify("x"), "health-record:rec1:allergies"), { recordId: "rec1", fieldKey: "allergies" });
    ready(2, { version: 1, ikm: ikm1 });
    const [health] = await scanSealedColumns(store, { columns: [columns.health] });
    expect([health.current, health.older, health.onSignInKey, health.unreadable]).toEqual([0, 1, 0, 0]);
  });

  it("counts every personal-data value as unreadable while the data key is unavailable", async () => {
    const store = new FakeStore();
    seedBeforeTheMove(store);
    setDataKeyStateForTests({ kind: "unavailable", reason: "access-denied" });
    const [health] = await scanSealedColumns(store, { columns: [columns.health] });
    expect([health.total, health.unreadable, health.current]).toEqual([3, 3, 0]);
  });

  it("scans personal-data columns as before while the key is not separate", async () => {
    const store = new FakeStore();
    seedBeforeTheMove(store);
    const [health] = await scanSealedColumns(store, { columns: [columns.health] });
    expect([health.current, health.older, health.onSignInKey]).toEqual([3, 0, 0]);
  });
});

describe("the one-time move to the data key (#1652)", () => {
  it("is a dry run without apply and counts what would move", async () => {
    const store = new FakeStore();
    seedBeforeTheMove(store);
    ready(1);
    const [health] = await rotateSealedColumns(store, { apply: false, columns: [columns.health] });
    expect(health).toMatchObject({ wouldRotate: 3, onSignInKey: 3, rotated: 0 });
    expect(store.replaced).toHaveLength(0);
  });

  it("re-seals personal-data values with the data key, recomputes the fingerprint, and leaves sign-in columns untouched", async () => {
    const store = new FakeStore();
    const url = seedBeforeTheMove(store);
    const codeBefore = store.value(columns.code, "c1");
    ready(1);
    const results = await rotateSealedColumns(store, { apply: true, columns: [columns.code, columns.health, columns.feed] });
    expect(results.map((result) => [result.label, result.rotated, result.alreadyCurrent, result.unreadable, result.skipped])).toEqual([
      [columns.code.label, 0, 2, 0, 0],
      [columns.health.label, 3, 0, 0, 0],
      [columns.feed.label, 1, 0, 0, 0],
    ]);
    expect(results[1].onSignInKey).toBe(3);

    expect(store.value(columns.code, "c1")).toBe(codeBefore);
    for (const id of ["h1", "h2", "h3"]) {
      const value = store.value(columns.health, id);
      expect(dataSealedKeyring(value)).toBe("data");
      expect(sealedDataKeyVersion(value)).toBe(1);
      expect(JSON.parse(openData(value, `health-record:rec${id.slice(1)}:allergies`))).toBe(`value ${id.slice(1)}`);
      expect(() => openSecret(value, `health-record:rec${id.slice(1)}:allergies`)).toThrow();
    }
    const feed = (await store.readBatch(columns.feed, null, 5))[0];
    expect(feed.fields.urlFingerprint).toBe(fingerprintData(url, "calendar-feed-url"));
    expect(feed.fields.urlFingerprint).not.toBe(fingerprintSecret(url, "calendar-feed-url"));

    const writes = store.replaced.length;
    const again = await rotateSealedColumns(store, { apply: true, columns: [columns.health, columns.feed] });
    expect(again.map((result) => [result.rotated, result.alreadyCurrent])).toEqual([[0, 3], [0, 1]]);
    expect(store.replaced).toHaveLength(writes);
    // The sign-in key version of untouched values is unchanged.
    expect(sealedKeyVersion(codeBefore)).toBe(1);
  });

  it("rotates the data key to a new version with the previous one loaded", async () => {
    const store = new FakeStore();
    ready(1);
    store.put(columns.health, "h1", sealData(JSON.stringify("x"), "health-record:rec1:allergies"), { recordId: "rec1", fieldKey: "allergies" });
    ready(2, { version: 1, ikm: ikm1 });
    const [health] = await rotateSealedColumns(store, { apply: true, columns: [columns.health] });
    expect(health).toMatchObject({ rotated: 1, onSignInKey: 0 });
    expect(sealedDataKeyVersion(store.value(columns.health, "h1"))).toBe(2);
  });

  it("refuses to write personal-data values while the data key is unavailable", async () => {
    const store = new FakeStore();
    seedBeforeTheMove(store);
    setDataKeyStateForTests({ kind: "unavailable", reason: "vault-unreachable" });
    await expect(rotateSealedColumns(store, { apply: true, columns: [columns.health] })).rejects.toBeInstanceOf(DataKeyUnavailableError);
    expect(store.replaced).toHaveLength(0);
    // A sign-in-only run does not need the data key.
    await expect(rotateSealedColumns(store, { apply: true, columns: [columns.code] })).resolves.toBeDefined();
  });

  it("works as before while the data key is not separate", async () => {
    const store = new FakeStore();
    seedBeforeTheMove(store);
    dependencies.getServerEnv.mockReturnValue({
      SECRET_ENCRYPTION_KEY: "synthetic-new-sign-in-key-0123456789-abcdefgh",
      SECRET_ENCRYPTION_KEY_VERSION: 2,
      SECRET_ENCRYPTION_PREVIOUS_KEY: signInKey,
      SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION: 1,
    });
    const [health] = await rotateSealedColumns(store, { apply: true, columns: [columns.health] });
    expect(health).toMatchObject({ rotated: 3, onSignInKey: 0 });
    expect(sealedKeyVersion(store.value(columns.health, "h1"))).toBe(2);
  });
});

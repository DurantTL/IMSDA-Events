import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as r2 from "@/integrations/backups/r2-read";
import { parseListObjectsV2 } from "@/integrations/backups/list-objects-xml";
import type { R2ReadConfig } from "@/integrations/backups/types";

const config: R2ReadConfig = {
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "SYNTHETICACCESSKEYID",
  secretAccessKey: "synthetic-secret-access-key-value",
  bucket: "synthetic-backups",
  prefix: "site/",
};

function page(entries: Array<{ key: string; at: string; size?: number }>, next?: string) {
  const contents = entries
    .map((e) => `<Contents><Key>${e.key}</Key><LastModified>${e.at}</LastModified>${e.size === undefined ? "" : `<Size>${e.size}</Size>`}</Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name><IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`;
}

const ok = (body: string) => new Response(body, { status: 200 });

afterEach(() => vi.useRealTimers());

describe("R2 read-only adapter (#1412)", () => {
  it("exports only the list and config functions", () => {
    expect(Object.keys(r2).sort()).toEqual(["R2_LIST_MAX_PAGES", "R2_LIST_TIMEOUT_MS", "R2ListError", "listBackupObjects", "resolveR2ReadConfig"].sort());
  });

  it("makes only signed GET requests with list-type=2 and the fixed endpoint", async () => {
    const seen: Request[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(input as Request);
      return ok(page([{ key: "site/a.sql.gz", at: "2026-10-31T03:00:00.000Z", size: 10 }]));
    });
    const listing = await r2.listBackupObjects(config, { fetch: fetchMock as unknown as typeof fetch });

    expect(listing.partial).toBe(false);
    expect(seen).toHaveLength(1);
    const request = seen[0];
    expect(request.method).toBe("GET");
    const url = new URL(request.url);
    expect(url.origin).toBe(`https://${config.accountId}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${config.bucket}`);
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("max-keys")).toBe("1000");
    expect(url.searchParams.get("prefix")).toBe("site/");
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=SYNTHETICACCESSKEYID\/\d{8}\/auto\/s3\/aws4_request/);
    expect(request.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(request.headers.get("authorization")).not.toContain(config.secretAccessKey);
  });

  it("follows continuation tokens and stops at the page cap as partial", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      expect(request.method).toBe("GET");
      urls.push(request.url);
      const n = urls.length;
      return ok(page([{ key: `site/${n}.sql`, at: "2026-10-31T03:00:00.000Z", size: n }], `token-${n}`));
    });
    const listing = await r2.listBackupObjects(config, { fetch: fetchMock as unknown as typeof fetch });
    expect(urls).toHaveLength(r2.R2_LIST_MAX_PAGES);
    expect(new URL(urls[1]).searchParams.get("continuation-token")).toBe("token-1");
    expect(new URL(urls[1]).searchParams.get("list-type")).toBe("2");
    expect(listing.partial).toBe(true);
    expect(listing.objects).toHaveLength(r2.R2_LIST_MAX_PAGES);
  });

  it("collects every page when the listing ends", async () => {
    const answers = [page([{ key: "site/a.sql", at: "2026-10-30T03:00:00.000Z", size: 1 }], "t"), page([{ key: "site/b.sql", at: "2026-10-31T03:00:00.000Z", size: 2 }])];
    const fetchMock = vi.fn(async () => ok(answers.shift() as string));
    const listing = await r2.listBackupObjects(config, { fetch: fetchMock as unknown as typeof fetch });
    expect(listing.objects.map((o) => o.size)).toEqual([1, 2]);
    expect(listing.partial).toBe(false);
  });

  it("reports a refused key for 401 and 403 without echoing the body", async () => {
    for (const status of [401, 403]) {
      const fetchMock = vi.fn(async () => new Response("<Error><Message>secret detail bucket-name</Message></Error>", { status }));
      const error = await r2.listBackupObjects(config, { fetch: fetchMock as unknown as typeof fetch }).catch((e) => e);
      expect(error).toBeInstanceOf(r2.R2ListError);
      expect(error.failure).toBe("refused");
      expect(error.message).not.toContain("secret detail");
    }
  });

  it("maps other statuses, garbage and network errors to generic failures", async () => {
    const failure = async (fetchMock: () => Promise<Response>) =>
      (await r2.listBackupObjects(config, { fetch: fetchMock as unknown as typeof fetch }).catch((e) => e)).failure;
    expect(await failure(async () => new Response("x", { status: 500 }))).toBe("bad_response");
    expect(await failure(async () => ok("<html>nope</html>"))).toBe("bad_response");
    expect(await failure(async () => { throw new TypeError("fetch failed"); })).toBe("unreachable");
  });

  it("times out the whole call", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      new Promise<Response>((_resolve, reject) => {
        (input as Request).signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
    const error = await r2.listBackupObjects(config, { fetch: fetchMock as unknown as typeof fetch, timeoutMs: 20 }).catch((e) => e);
    expect(error.failure).toBe("timeout");
  });

  it("refuses a malformed account id or bucket before any request", async () => {
    const fetchMock = vi.fn();
    for (const bad of [{ accountId: "short" }, { bucket: "Bad_Bucket" }, { bucket: "a/b" }]) {
      await expect(r2.listBackupObjects({ ...config, ...bad }, { fetch: fetchMock as unknown as typeof fetch })).rejects.toBeInstanceOf(r2.R2ListError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("R2 read configuration (#1412)", () => {
  const full = {
    BACKUP_R2_READ_ACCOUNT_ID: "0123456789ABCDEF0123456789abcdef",
    BACKUP_R2_READ_ACCESS_KEY_ID: "id",
    BACKUP_R2_READ_SECRET_ACCESS_KEY: "secret",
    BACKUP_R2_READ_BUCKET: "my-bucket",
  };

  it("is not connected when nothing is set, connected when all four are", () => {
    expect(r2.resolveR2ReadConfig({})).toEqual({ state: "not_connected" });
    expect(r2.resolveR2ReadConfig({ BACKUP_R2_READ_BUCKET: "  " })).toEqual({ state: "not_connected" });
    const state = r2.resolveR2ReadConfig({ ...full, BACKUP_R2_READ_PREFIX: " daily/ " });
    expect(state).toMatchObject({ state: "connected", config: { accountId: full.BACKUP_R2_READ_ACCOUNT_ID.toLowerCase(), prefix: "daily/" } });
  });

  it("names missing and invalid variables, never values", () => {
    const state = r2.resolveR2ReadConfig({ BACKUP_R2_READ_ACCOUNT_ID: "not-hex", BACKUP_R2_READ_BUCKET: "my-bucket" });
    expect(state).toEqual({
      state: "misconfigured",
      missing: ["BACKUP_R2_READ_ACCESS_KEY_ID", "BACKUP_R2_READ_SECRET_ACCESS_KEY"],
      invalid: ["BACKUP_R2_READ_ACCOUNT_ID"],
    });
    expect(JSON.stringify(state)).not.toContain("not-hex");
  });
});

describe("ListObjectsV2 XML reader (#1412)", () => {
  it("reads objects, truncation and the token, decoding entities", () => {
    const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b==</NextContinuationToken>
      <Contents><Key>dir/a&amp;b &lt;1&gt; &#65;&#x42;.sql</Key><LastModified>2026-10-31T03:00:00.000Z</LastModified><Size>1234</Size><ETag>&quot;x&quot;</ETag></Contents></ListBucketResult>`;
    const parsed = parseListObjectsV2(xml);
    expect(parsed.truncated).toBe(true);
    expect(parsed.nextToken).toBe("a&b==");
    expect(parsed.objects).toEqual([{ key: "dir/a&b <1> AB.sql", lastModified: new Date("2026-10-31T03:00:00.000Z"), size: 1234 }]);
  });

  it("skips entries missing a key or a valid time and nulls a bad size", () => {
    const xml = `<ListBucketResult><IsTruncated>false</IsTruncated>
      <Contents><LastModified>2026-10-31T03:00:00.000Z</LastModified></Contents>
      <Contents><Key>no-time.sql</Key></Contents>
      <Contents><Key>bad-time.sql</Key><LastModified>yesterday</LastModified></Contents>
      <Contents><Key>no-size.sql</Key><LastModified>2026-10-31T03:00:00.000Z</LastModified></Contents>
      <Contents><Key>neg.sql</Key><LastModified>2026-10-31T03:00:00.000Z</LastModified><Size>-5</Size></Contents></ListBucketResult>`;
    const parsed = parseListObjectsV2(xml);
    expect(parsed.truncated).toBe(false);
    expect(parsed.nextToken).toBeNull();
    expect(parsed.objects.map((o) => [o.key, o.size])).toEqual([["no-size.sql", null], ["neg.sql", null]]);
  });

  it("does not let an object key spoof the truncation flag and rejects non-listings", () => {
    const xml = `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>x</Key><LastModified>2026-10-31T03:00:00Z</LastModified></Contents></ListBucketResult>`;
    expect(parseListObjectsV2(xml).truncated).toBe(false);
    expect(() => parseListObjectsV2("<Error><Code>AccessDenied</Code></Error>")).toThrow();
    expect(() => parseListObjectsV2("")).toThrow();
  });
});

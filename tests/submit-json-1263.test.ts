import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_MAYBE_UPDATING_MESSAGE, SITE_UPDATING_MESSAGE, submitJson, unavailableMessage } from "@/lib/submit-json";

/**
 * The shared submit helper (#1263): a restart must read as "updating", never as a lost form, and a
 * retry must never repeat a request that may already have been handled. Synthetic data only.
 */
const html = (status: number) => () => new Response("<html><body>Bad Gateway</body></html>", { status, headers: { "Content-Type": "text/html" } });
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const networkError = () => { throw new TypeError("Failed to fetch"); };

function stubFetch(...steps: Array<() => Response>) {
  const fetchMock = vi.fn(async () => {
    const step = steps[Math.min(fetchMock.mock.calls.length - 1, steps.length - 1)]!;
    return step();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const quick = { wait: async () => undefined };
const body = { idempotencyKey: "11111111-1111-4111-8111-111111111111", answers: { first_name: "Alex" } };

afterEach(() => vi.unstubAllGlobals());

describe("submitJson classification (#1263)", () => {
  it("reports a bare network error as unavailable without retrying a non-idempotent request", async () => {
    const fetchMock = stubFetch(networkError);
    const result = await submitJson("/api/x", body, quick);
    // A bare network error on an unkeyed write may have reached the server: keep the input, say to check first.
    expect(result).toMatchObject({ ok: false, unavailable: true, body: { message: SITE_MAYBE_UPDATING_MESSAGE } });
    expect(SITE_MAYBE_UPDATING_MESSAGE).toBe("The site may be updating. Your answers are still here. Check whether it saved before you try again.");
    expect(unavailableMessage(result)).toBe(SITE_MAYBE_UPDATING_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network error once when the request is idempotent, with the same body", async () => {
    const fetchMock = stubFetch(networkError, json(200, { ok: true }));
    const wait = vi.fn(async () => undefined);
    const result = await submitJson("/api/x", body, { idempotent: true, wait, retryDelayMs: 4000 });
    expect(result).toMatchObject({ ok: true, status: 200, body: { ok: true } });
    expect(result.unavailable).toBeUndefined();
    expect(wait).toHaveBeenCalledWith(4000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![1].body).toBe(calls[1]![1].body);
    expect(JSON.parse(String(calls[1]![1].body)).idempotencyKey).toBe(body.idempotencyKey);
  });

  it("fires at most one automatic retry", async () => {
    const fetchMock = stubFetch(networkError);
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(result.unavailable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 502 gateway page once when the request is idempotent", async () => {
    const fetchMock = stubFetch(html(502), json(200, { done: true }));
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(result).toMatchObject({ ok: true, body: { done: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([502, 503, 504])("does NOT auto-retry a non-idempotent request after a %i page (the app may have committed)", async (status) => {
    const fetchMock = stubFetch(html(status), json(200, { done: true }));
    const result = await submitJson("/api/x", body, quick);
    expect(result).toMatchObject({ ok: false, status, unavailable: true, body: { message: SITE_MAYBE_UPDATING_MESSAGE } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives the exact issue wording when the request is keyed, because repeating it is safe", async () => {
    stubFetch(html(502));
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(unavailableMessage(result)).toBe("The site is updating. Your answers are still here — try again in a minute.");
    stubFetch(networkError);
    expect(unavailableMessage(await submitJson("/api/x", body, { idempotent: true, ...quick }))).toBe(SITE_UPDATING_MESSAGE);
  });

  it("gives the exact issue wording for the app's own UPDATING answer even without a key", async () => {
    stubFetch(json(503, { code: "UPDATING", message: SITE_UPDATING_MESSAGE }));
    expect(unavailableMessage(await submitJson("/api/x", body, quick))).toBe(SITE_UPDATING_MESSAGE);
  });

  it("gives the updating message when the idempotent 502 page repeats, after exactly two attempts", async () => {
    const fetchMock = stubFetch(html(502));
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(result).toMatchObject({ ok: false, status: 502, unavailable: true, body: { message: SITE_UPDATING_MESSAGE } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([503, 504])("treats a plain %i page as unavailable", async (status) => {
    stubFetch(html(status));
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(result).toMatchObject({ ok: false, status, unavailable: true, body: { message: SITE_UPDATING_MESSAGE } });
  });

  it("treats the app's own UPDATING answer as unavailable and retries it once, even without a key", async () => {
    const updating = json(503, { code: "UPDATING", message: "The site is updating. Your answers are still here — try again in a minute." });
    const fetchMock = stubFetch(updating, json(201, { created: true }));
    const result = await submitJson("/api/x", body, quick);
    expect(result).toMatchObject({ ok: true, status: 201 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stubFetch(updating);
    expect(await submitJson("/api/x", body, quick)).toMatchObject({ unavailable: true, body: { code: "UPDATING" } });
  });

  it("never retries a JSON 500 the app produced, even for an idempotent request", async () => {
    const fetchMock = stubFetch(json(500, { message: "Something real broke." }));
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(result).toMatchObject({ ok: false, status: 500, body: { message: "Something real broke." } });
    expect(result.unavailable).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes through an app-produced JSON 503 such as a busy lock, without a retry", async () => {
    const fetchMock = stubFetch(json(503, { error: "BUSY", message: "That is being updated right now." }));
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(result).toMatchObject({ status: 503, body: { error: "BUSY" } });
    expect(result.unavailable).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 404, 409, 422, 429])("never retries a %i", async (status) => {
    const fetchMock = stubFetch(json(status, { message: "Nope." }));
    const result = await submitJson("/api/x", body, { idempotent: true, ...quick });
    expect(result).toMatchObject({ ok: false, status, body: { message: "Nope." } });
    expect(result.unavailable).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call a 4xx page that is not JSON 'updating'", async () => {
    stubFetch(html(413));
    const result = await submitJson("/api/x", body, { fallbackMessage: "It could not be sent.", ...quick });
    expect(result.unavailable).toBeUndefined();
    expect(result.body.message).toContain("It could not be sent.");
    expect(result.body.message).toContain("413");
  });

  it("retries a crash page (HTML 500) only when idempotent", async () => {
    const plain = stubFetch(html(500));
    expect((await submitJson("/api/x", body, quick)).unavailable).toBe(true);
    expect(plain).toHaveBeenCalledTimes(1);
    const keyed = stubFetch(html(500), json(200, { ok: true }));
    expect((await submitJson("/api/x", body, { idempotent: true, ...quick })).ok).toBe(true);
    expect(keyed).toHaveBeenCalledTimes(2);
  });

  it("treats a timeout as neither unavailable nor retryable", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await submitJson("/api/x", body, { idempotent: true, timeoutMs: 15, fallbackMessage: "Failed.", ...quick });
    expect(result.ok).toBe(false);
    expect(result.unavailable).toBeUndefined();
    expect(result.body.message).toContain("Check whether it finished before trying again.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the method and a JSON body, or a FormData body untouched", async () => {
    const fetchMock = stubFetch(json(200, {}));
    await submitJson("/api/x", { a: 1 }, { method: "PATCH", ...quick });
    const [, patchInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    expect(patchInit.body).toBe('{"a":1}');
    const upload = new FormData();
    upload.set("data", "{}");
    await submitJson("/api/x", upload, quick);
    const [, formInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(formInit.body).toBe(upload);
    expect(formInit.headers).not.toHaveProperty("Content-Type");
  });
});

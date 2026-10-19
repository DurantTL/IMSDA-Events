import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSquareRefund, SquareAdapterError } from "@/modules/payments/square-adapter";
import { getSquareConfiguration } from "@/modules/payments/square-config-domain";

/** #171: the Square Refunds API call. The HTTP is mocked; Square is never called. Synthetic ids only. */

const configuration = getSquareConfiguration({
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_APPLICATION_ID: "sandbox-sq0idb-synthetic",
  SQUARE_LOCATION_ID: "SYNTHLOC",
  SQUARE_ACCESS_TOKEN: "synthetic-token",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "synthetic-key",
  APP_BASE_URL: "https://example.test",
});
const input = { paymentId: "sqpay_1", idempotencyKey: "cxr-abc", amountCents: 1234, currency: "USD" as const, reason: "Cancellation approved" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("createSquareRefund", () => {
  it("posts the payment, amount and idempotency key to the refunds endpoint", async () => {
    const fetcher = vi.fn(async () => json({ refund: { id: "sqr_1", status: "PENDING", payment_id: "sqpay_1", amount_money: { amount: 1234, currency: "USD" } } }));
    const result = await createSquareRefund(configuration, input, fetcher as unknown as typeof fetch);
    expect(result).toEqual({ id: "sqr_1", paymentId: "sqpay_1", status: "PENDING", amountCents: 1234, currency: "USD" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://connect.squareupsandbox.com/v2/refunds");
    expect(JSON.parse(String(init.body))).toEqual({ idempotency_key: "cxr-abc", payment_id: "sqpay_1", amount_money: { amount: 1234, currency: "USD" }, reason: "Cancellation approved" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-token");
  });

  it("refuses without calling Square when it is not configured or the amount is not positive", async () => {
    const fetcher = vi.fn();
    await expect(createSquareRefund({ ...configuration, paymentConfigured: false }, input, fetcher as never)).rejects.toMatchObject({ code: "SQUARE_NOT_CONFIGURED" });
    await expect(createSquareRefund(configuration, { ...input, amountCents: 0 }, fetcher as never)).rejects.toMatchObject({ code: "SQUARE_REQUEST_REJECTED", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats a network failure or a server error as uncertain and retryable, and a client error as final", async () => {
    await expect(createSquareRefund(configuration, input, (async () => { throw new TypeError("down"); }) as never)).rejects.toMatchObject({ code: "SQUARE_REQUEST_UNCERTAIN", retryable: true });
    await expect(createSquareRefund(configuration, input, (async () => json({ errors: [{ code: "INTERNAL_SERVER_ERROR", detail: "x" }] }, 500)) as never)).rejects.toMatchObject({ code: "SQUARE_REQUEST_UNCERTAIN", retryable: true });
    const rejected = await createSquareRefund(configuration, input, (async () => json({ errors: [{ code: "REFUND_AMOUNT_INVALID", detail: "Too much." }] }, 400)) as never).catch((error) => error);
    expect(rejected).toBeInstanceOf(SquareAdapterError);
    expect(rejected).toMatchObject({ code: "SQUARE_REQUEST_REJECTED", retryable: false, providerCode: "REFUND_AMOUNT_INVALID" });
  });

  it("rejects an incomplete success response as retryable, so it is checked in Square", async () => {
    await expect(createSquareRefund(configuration, input, (async () => json({ refund: { id: "sqr_1" } })) as never)).rejects.toMatchObject({ code: "SQUARE_INVALID_RESPONSE", retryable: true });
  });
});

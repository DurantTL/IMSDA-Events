import { beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logError,
}));

import { redactTokenPath } from "@/lib/request-context";
import { onRequestError } from "@/instrumentation";

describe("redactTokenPath", () => {
  it("hides the token in health record links", () => {
    expect(redactTokenPath("/health-records/abc123")).toBe("/health-records/[redacted]");
    expect(redactTokenPath("/api/public/health-records/abc123")).toBe("/api/public/health-records/[redacted]");
  });

  it("hides the token in a visiting club's invitation link", async () => {
    const { visitingClubInvitePath } = await import("@/modules/visiting-clubs/domain");
    expect(redactTokenPath(visitingClubInvitePath("invite-token-1"))).toBe("/account/visiting-club/[redacted]");
    expect(redactTokenPath("/account/visiting-club/abc123/next")).toBe("/account/visiting-club/[redacted]/next");
    expect(redactTokenPath("/account/visiting-clubs")).toBe("/account/visiting-clubs");
  });

  it("still hides the existing token paths and leaves ordinary paths alone", () => {
    expect(redactTokenPath("/manage/secret")).toBe("/manage/[redacted]");
    expect(redactTokenPath("/api/events/e1/registrations")).toBe("/api/events/e1/registrations");
    expect(redactTokenPath("/more/health-records/org-1/member-1")).toBe("/more/health-records/org-1/member-1");
  });
});

describe("onRequestError", () => {
  beforeEach(() => logError.mockClear());

  async function pathLoggedFor(path: string) {
    await onRequestError(
      new Error("boom"),
      { path, method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/x", routeType: "route", renderSource: undefined, revalidateReason: undefined } as never,
    );
    return logError.mock.calls.at(-1)?.[2]?.path;
  }

  it("logs a redacted path without the query string", async () => {
    expect(await pathLoggedFor("/health-records/abc123?x=1")).toBe("/health-records/[redacted]");
    expect(await pathLoggedFor("/manage/secret?next=/a")).toBe("/manage/[redacted]");
    expect(await pathLoggedFor("/account/visiting-club/secret?x=1")).toBe("/account/visiting-club/[redacted]");
    expect(await pathLoggedFor("/api/events/e1/payments?days=9")).toBe("/api/events/e1/payments");
  });
});

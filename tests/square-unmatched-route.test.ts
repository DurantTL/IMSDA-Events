import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getCurrentSession: vi.fn(),
  listUnmatchedSquarePayments: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/access/authorization")>()),
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/payments/square-match-repository", () => ({
  listUnmatchedSquarePayments: mocks.listUnmatchedSquarePayments,
  attachSquarePaymentToRegistration: vi.fn(),
  SquareMatchOperationError: class extends Error {},
}));

import { GET } from "@/app/api/events/[eventId]/payments/square-unmatched/route";

const call = () => GET(
  new Request("https://events.imsda.test/api/events/event-7/payments/square-unmatched?days=30"),
  { params: Promise.resolve({ eventId: "event-7" }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listUnmatchedSquarePayments.mockResolvedValue({ findings: [], examined: 0, unreachableSquare: false, environment: "x" });
});

describe("GET unmatched Square payments", () => {
  it("passes the URL's event and hides unattributed payments from event finance staff", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "u1", globalRole: null } });
    expect((await call()).status).toBe(200);
    expect(mocks.listUnmatchedSquarePayments).toHaveBeenCalledWith({ eventId: "event-7", includeUnattributed: false, days: 30 });
  });

  it("shows unattributed payments to system administrators only", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "u2", globalRole: "SYSTEM_ADMIN" } });
    await call();
    expect(mocks.listUnmatchedSquarePayments).toHaveBeenCalledWith({ eventId: "event-7", includeUnattributed: true, days: 30 });
  });
});

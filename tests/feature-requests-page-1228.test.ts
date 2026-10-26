import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentSession: vi.fn(), listPendingModuleRequests: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/event-modules/requests", () => ({ listPendingModuleRequests: mocks.listPendingModuleRequests }));
vi.mock("@/components/module-request-queue", () => ({
  ModuleRequestQueue: ({ requests }: { requests: unknown[] }) => createElement("div", {}, `${requests.length} in queue`),
}));

import FeatureRequestsPage from "@/app/(workspace)/admin/feature-requests/page";

const admin = { id: "u1", displayName: "Synthetic Admin", email: "admin@imsda-events.test", globalRole: "SYSTEM_ADMIN" };
const render = async () => renderToStaticMarkup(await FeatureRequestsPage());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.listPendingModuleRequests.mockResolvedValue([]);
});

describe("Feature requests page (#1228)", () => {
  it("is for system administrators only, reading nothing otherwise", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(render()).rejects.toThrow("redirect:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { ...admin, globalRole: null } });
    await expect(render()).rejects.toThrow("redirect:/no-access");
    expect(mocks.listPendingModuleRequests).not.toHaveBeenCalled();
  });

  it("shows the queue, an empty state and an unavailable state", async () => {
    mocks.listPendingModuleRequests.mockResolvedValue([{ id: "r1", eventId: "e1", eventName: "Synthetic", moduleTitle: "Lodging", requesterName: "Synthetic Director", reason: "Needed", createdAt: new Date("2026-10-20T00:00:00Z") }]);
    expect(await render()).toContain("1 in queue");
    mocks.listPendingModuleRequests.mockResolvedValue([]);
    expect(await render()).toContain("No requests are waiting.");
    mocks.listPendingModuleRequests.mockRejectedValue(new Error("down"));
    expect(await render()).toContain("could not be read just now");
  });
});

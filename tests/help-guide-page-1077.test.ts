import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ viewer: { isSystemAdmin: false, selectedEventId: "evt_synthetic", permissions: ["MANAGE_CHECK_IN"] } as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("@/modules/help/viewer", () => ({ loadHelpViewer: async () => mocks.viewer }));

import GuidePage, { generateMetadata } from "@/app/(workspace)/help/[guideId]/page";

/** The guide page answers a hidden guide exactly like an unknown id (#1077). Synthetic viewer. */
const call = (guideId: string) => GuidePage({ params: Promise.resolve({ guideId }), searchParams: Promise.resolve({}) });
const meta = async (guideId: string) => generateMetadata({ params: Promise.resolve({ guideId }), searchParams: Promise.resolve({}) });

beforeEach(() => { mocks.viewer = { isSystemAdmin: false, selectedEventId: "evt_synthetic", permissions: ["MANAGE_CHECK_IN"] }; });

describe("guide page", () => {
  it("gives a hidden guide and an unknown id the same not-found and the same title", async () => {
    await expect(call("invite-staff")).rejects.toThrow("NOT_FOUND");
    await expect(call("no-such-guide")).rejects.toThrow("NOT_FOUND");
    expect(await meta("invite-staff")).toEqual(await meta("no-such-guide"));
    expect(await meta("invite-staff")).toEqual({ title: "Help & learning" });
  });

  it("opens a visible guide and titles the tab with it", async () => {
    await expect(call("choose-workspace")).resolves.toBeTruthy();
    expect(await meta("choose-workspace")).toEqual({ title: "Choose System or Event workspace" });
  });
});

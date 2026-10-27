import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only each page's exported `metadata` is under test. The profile loader and
// session modules pull in most of the data layer (about 4 s cold), and nothing
// from them runs until a page renders, so stub them. The real pages still load.
vi.mock("@/modules/account-profile/load-profile", () => ({}));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({}));
vi.mock("@/components/profile-view", () => ({}));

// #646: both profile pages hold account details, so neither may be indexed or cached.
describe("profile pages are noindex, nocache (#646)", () => {
  it.each([
    ["/profile", () => import("@/app/(workspace)/profile/page")],
    ["/account/profile", () => import("@/app/(public)/account/(portal)/profile/page")],
  ])("%s sets robots index: false, follow: false, nocache: true", async (_name, load) => {
    const { metadata } = await load();
    expect(metadata.robots).toMatchObject({ index: false, follow: false, nocache: true });
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/use-confirm", () => ({ useConfirm: () => ({ confirm: async () => true, confirmDialog: null }) }));
vi.mock("@/components/profile-photo-resize", () => ({
  PROFILE_PHOTO_UNREADABLE: "That photo could not be read. Please choose a JPG or PNG.",
  shrinkProfilePhoto: async () => new Blob(["x"], { type: "image/jpeg" }),
}));

import { AdminProfilePhoto } from "@/components/admin-profile-photo";
import { ProfilePhotoCard } from "@/components/profile-photo-card";
import { buttonByText, click, flush, mount, type Mounted } from "./helpers/dom-render";

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

/** A fetch that stays pending until released, so the busy state can be read. */
function pendingFetch() {
  let release: (response: Response) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  return () => release(new Response("{}", { status: 200 }));
}

describe("profile photo buttons show their busy state (B10, #1640)", () => {
  it("Remove reads Removing… while the request runs", async () => {
    const release = pendingFetch();
    mounted = await mount(createElement(ProfilePhotoCard, { displayName: "Riley Staff", photo: { userId: "u1", version: 1, removedByStaffAt: null } }));
    await click(buttonByText(mounted.container, "Remove photo"));
    await flush();
    const busy = buttonByText(mounted.container, "Removing…");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    await act(async () => { release(); });
  });

  it("Add reads Saving… while the photo is shrunk and uploaded", async () => {
    const release = pendingFetch();
    mounted = await mount(createElement(ProfilePhotoCard, { displayName: "Riley Staff", photo: { userId: "u1", version: null, removedByStaffAt: null } }));
    const input = mounted.container.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "p.jpg", { type: "image/jpeg" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(buttonByText(mounted.container, "Saving…").getAttribute("aria-busy")).toBe("true");
    await act(async () => { release(); });
  });

  it("the administrator's Remove reads Removing… while the request runs", async () => {
    const release = pendingFetch();
    mounted = await mount(createElement(AdminProfilePhoto, { userId: "u1", version: 1, displayName: "Riley Staff" }));
    await click(buttonByText(mounted.container, "Remove photo"));
    await flush();
    expect(buttonByText(mounted.container, "Removing…").getAttribute("aria-busy")).toBe("true");
    await act(async () => { release(); });
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { MerchandiseAdminWorkspace } from "@/components/merchandise-admin-workspace";
import { buttonByText, click, flush, mount, type Mounted } from "./helpers/dom-render";

// #1581 (and #1108): the audience preview never shows one audience's cards under another audience's label. Synthetic data only.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/more/merchandise" }));

type Deferred = { resolve: (response: Response) => void };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const previewOf = (name: string) => ({ products: [{ id: `p-${name}`, name, description: null, artwork: null, variants: [{ id: `v-${name}`, label: "Adult", availability: { priceCents: 2000 } }] }] });

let pending: Record<string, Deferred[]>;
let immediate: Record<string, () => Response>;
let mounted: Mounted;

beforeEach(() => {
  pending = {};
  immediate = {};
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const audience = /audience=(\w+)/.exec(url)?.[1];
    if (audience) {
      if (immediate[audience]) return Promise.resolve(immediate[audience]());
      return new Promise<Response>((resolve) => { (pending[audience] ??= []).push({ resolve }); });
    }
    if (url.endsWith("/assets")) return Promise.resolve(json({ assets: [] }));
    return Promise.resolve(json({ eventId: "ev1", isEnabled: true, products: [{ id: "p1", name: "Camp tee", isEnabled: true, variants: [] }] }));
  }));
});
afterEach(async () => { await mounted?.unmount(); vi.unstubAllGlobals(); });

async function open() {
  immediate.registered = () => json(previewOf("Registered tee"));
  mounted = await mount(createElement(MerchandiseAdminWorkspace, { eventId: "ev1" }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  await flush();
}
const preview = () => mounted.container.querySelector("aside")!;

describe("the audience preview is truthful (#1581)", () => {
  it("shows the registered cards under Registered attendees once loaded", async () => {
    await open();
    expect(preview().textContent).toContain("Showing preview as Registered attendees.");
    expect(preview().textContent).toContain("Registered tee");
  });

  it("hides the previous audience's cards while a new audience loads", async () => {
    await open();
    await click(buttonByText(mounted.container, "Public"));
    expect(preview().textContent).toContain("Loading preview as Public");
    expect(preview().textContent).not.toContain("Registered tee");
    expect(preview().querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows only a failure, never the previous audience's cards, when the new audience fails", async () => {
    await open();
    immediate.anonymous = () => json({ message: "nope" }, 500);
    await click(buttonByText(mounted.container, "Public"));
    await flush();
    expect(preview().textContent).toContain("The preview could not be loaded");
    expect(preview().textContent).not.toContain("Registered tee");
    expect(preview().querySelector('[role="alert"]')).not.toBeNull();
  });

  it("ignores a slow earlier response once a later audience was chosen", async () => {
    await open();
    await click(buttonByText(mounted.container, "Public"));
    await click(buttonByText(mounted.container, "Staff"));
    await act(async () => { pending.staff![0]!.resolve(json(previewOf("Staff tee"))); });
    await flush();
    await act(async () => { pending.anonymous![0]!.resolve(json(previewOf("Public tee"))); });
    await flush();
    expect(preview().textContent).toContain("Showing preview as Staff.");
    expect(preview().textContent).toContain("Staff tee");
    expect(preview().textContent).not.toContain("Public tee");
    expect(preview().textContent).not.toContain("Registered tee");
  });
});

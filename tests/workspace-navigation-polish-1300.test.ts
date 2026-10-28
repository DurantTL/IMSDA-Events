// @vitest-environment jsdom
import { act, createElement as h, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContent, workspacePageKey } from "@/components/workspace-content";
import { registerUnsavedChanges } from "@/components/unsaved-changes-registry";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), linkPending: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return h("a", { ...props, href }, children);
  },
  useLinkStatus: () => ({ pending: mocks.linkPending }),
}));
import { GuardedLink } from "@/components/guarded-link";
import { NavigationLink } from "@/components/navigation-link";

let root: Root;
let container: HTMLDivElement;
let reduced = false;
let listeners: Set<() => void>;
let animate: ReturnType<typeof vi.fn>;
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  vi.clearAllMocks(); mocks.linkPending = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  reduced = false; listeners = new Set();
  window.matchMedia = vi.fn(() => ({
    get matches() { return reduced; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  window.matchMedia = originalMatchMedia;
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.unstubAllGlobals();
});
const render = async (node: React.ReactNode) => { await act(async () => { root.render(node); }); };
const frame = (key: string, child: React.ReactNode) => h(WorkspaceContent, { pageKey: key, children: child });

describe("staff page arrival", () => {
  it("does not flash on initial hydration, remount inputs or move keyboard focus on navigation", async () => {
    await render(frame("/admin?", h("input", { defaultValue: "original", "aria-label": "Synthetic draft" })));
    expect(animate).not.toHaveBeenCalled();
    const input = container.querySelector("input")!;
    input.value = "unsaved draft"; input.focus();
    await render(frame("/admin/clubs?", h("input", { defaultValue: "original", "aria-label": "Synthetic draft" })));
    expect(container.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("unsaved draft");
    expect(animate).toHaveBeenCalledWith([{ opacity: 0.86 }, { opacity: 1 }], expect.objectContaining({ duration: 160 }));
    expect(container.querySelector("#workspace-content")?.className).toBe("workspace-content");
  });

  it("fades the real streamed content after its skeleton leaves, without animating ordinary DOM updates", async () => {
    await render(frame("/admin?", h("div", { "data-workspace-loading": true }, "Loading")));
    expect(animate).not.toHaveBeenCalled();
    await render(frame("/admin?", h("p", null, "Ready")));
    expect(animate).toHaveBeenCalledTimes(1);
    await render(frame("/admin?", h("p", null, "A count updated")));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("cancels an interrupted arrival and does not stack effects during rapid page switching", async () => {
    await render(frame("a", h("p", null, "A")));
    await render(frame("b", h("p", null, "B")));
    const first = animate.mock.results[0]!.value;
    await render(frame("c", h("p", null, "C")));
    expect(first.cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("C");
  });

  it("respects reduced motion immediately and stops an effect when the preference changes", async () => {
    reduced = true;
    await render(frame("a", h("p", null, "A")));
    await render(frame("b", h("p", null, "B")));
    expect(animate).not.toHaveBeenCalled();
    reduced = false;
    await render(frame("c", h("p", null, "C")));
    const active = animate.mock.results[0]!.value;
    reduced = true; listeners.forEach((listener) => listener());
    expect(active.cancel).toHaveBeenCalled();
  });

  it("does not pulse while typing a search, but recognises year, view, event and pagination changes", () => {
    const key = (query: string) => workspacePageKey("/admin/clubs/summary", new URLSearchParams(query));
    expect(key("q=Cedar&sort=name")).toBe(key("q=Oak&sort=points"));
    expect(key("view=points")).not.toBe(key("view=directory"));
    expect(key("year=2024-25")).not.toBe(key("year=2026-27"));
    expect(key("event=one&page=2")).not.toBe(key("event=two&page=1"));
  });
});

describe("real pending navigation", () => {
  it("keeps native link props and announces only a genuinely pending Next link", async () => {
    const link = () => h(NavigationLink, { href: "/admin/clubs", prefetch: false, target: "_blank", download: "clubs.csv" }, "Open clubs");
    await render(link());
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/admin/clubs");
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank");
    expect(container.querySelector("a")?.getAttribute("download")).toBe("clubs.csv");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    mocks.linkPending = true; await render(link());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Opening page…");
    mocks.linkPending = false; await render(link());
    expect(container.querySelector('[data-navigation-pending="true"]')).toBeNull();
  });

  it("does not start navigation or a busy cue when the unsaved-change guard is cancelled", async () => {
    const unregister = registerUnsavedChanges("Synthetic unsaved draft");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await render(h(GuardedLink, { href: "/admin/clubs" }, "Clubs"));
      await act(async () => container.querySelector("a")!.click());
      expect(confirm).toHaveBeenCalledOnce();
      expect(mocks.push).not.toHaveBeenCalled();
      expect(container.querySelector('[data-navigation-pending="true"]')).toBeNull();
    } finally { unregister(); confirm.mockRestore(); }
  });

  it("keeps guarded navigation pending while its destination suspends, and clears a superseded route", async () => {
    const ready = new Set<string>();
    const release = new Map<string, () => void>();
    const waits = new Map(["/slow", "/latest"].map((path) => [path, new Promise<void>((resolve) => release.set(path, () => { ready.add(path); resolve(); }))]));
    function Page({ path }: { path: string }) {
      if (waits.has(path) && !ready.has(path)) throw waits.get(path);
      return h("p", { "data-page": path }, path);
    }
    function Harness() {
      const [path, setPath] = useState("/initial");
      mocks.push.mockImplementation((next: string) => setPath(next));
      return h("div", null,
        h(GuardedLink, { href: "/slow" }, "Slow"),
        h(GuardedLink, { href: "/latest" }, "Latest"),
        h(Suspense, { fallback: h("p", null, "Loading") }, h(Page, { path })),
      );
    }
    await render(h(Harness));
    await act(async () => container.querySelectorAll("a")[0]!.click());
    expect(container.querySelector('[data-navigation-pending="true"]')?.textContent).toBe("Opening page…");
    expect(container.querySelector('[data-page="/initial"]')).not.toBeNull();
    await act(async () => container.querySelectorAll("a")[1]!.click());
    await act(async () => release.get("/latest")!());
    expect(container.querySelector('[data-page="/latest"]')).not.toBeNull();
    expect(container.querySelector('[data-navigation-pending="true"]')).toBeNull();
    await act(async () => release.get("/slow")!());
    expect(container.querySelector('[data-page="/latest"]')).not.toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #996: a sticky action bar stays in the page until the reader has scrolled past an anchor (or, with none, a little),
 * then pins; its listeners are removed on unmount. The hook runs here with its React hooks stubbed and a fake window.
 */
const state = vi.hoisted(() => ({ value: false, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useState: (initial: boolean) => [state.value ?? initial, (next: boolean) => { state.value = next; }],
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
}));

import { isPinned, usePinAfterScroll } from "@/components/use-pin-after-scroll";

function fakeWindow(scrollY: number) {
  const listeners = new Map<string, () => void>();
  const frames: Array<() => void> = [];
  const fake = {
    scrollY,
    addEventListener: vi.fn((name: string, handler: () => void) => { listeners.set(name, handler); }),
    removeEventListener: vi.fn((name: string) => { listeners.delete(name); }),
    requestAnimationFrame: vi.fn((callback: () => void) => { frames.push(callback); return frames.length; }),
    cancelAnimationFrame: vi.fn(),
  };
  vi.stubGlobal("window", fake);
  return { fake, listeners, runFrames: () => { while (frames.length) frames.shift()!(); } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  state.value = false;
  state.effects = [];
});

describe("isPinned", () => {
  it("pins once the anchor's bottom edge is above the screen", () => {
    expect(isPinned(120, 0, 80)).toBe(false);
    expect(isPinned(0, 0, 80)).toBe(false);
    expect(isPinned(-1, 500, 80)).toBe(true);
  });

  it("with no anchor, pins after scrolling more than the threshold", () => {
    expect(isPinned(null, 80, 80)).toBe(false);
    expect(isPinned(null, 81, 80)).toBe(true);
  });
});

describe("usePinAfterScroll", () => {
  it("pins and unpins as the anchor scrolls away and back, and cleans up its listeners", () => {
    let bottom = 300;
    const anchor = { current: { getBoundingClientRect: () => ({ bottom }) } } as never;
    const win = fakeWindow(0);
    usePinAfterScroll(anchor);
    const cleanup = state.effects[0]!() as () => void;
    expect(state.value).toBe(false);
    expect(win.listeners.has("scroll")).toBe(true);
    expect(win.listeners.has("resize")).toBe(true);

    bottom = -40;
    win.listeners.get("scroll")!();
    win.runFrames();
    expect(state.value).toBe(true);

    bottom = 200;
    win.listeners.get("scroll")!();
    win.runFrames();
    expect(state.value).toBe(false);

    cleanup();
    expect(win.listeners.size).toBe(0);
  });

  it("with a null anchor follows the page's own scroll position", () => {
    const win = fakeWindow(10);
    usePinAfterScroll(null);
    state.effects[0]!();
    expect(state.value).toBe(false);
    win.fake.scrollY = 200;
    win.listeners.get("scroll")!();
    win.runFrames();
    expect(state.value).toBe(true);
  });

  it("stays unpinned while its anchor is not on the page", () => {
    fakeWindow(900);
    usePinAfterScroll({ current: null });
    state.effects[0]!();
    expect(state.value).toBe(false);
  });
});

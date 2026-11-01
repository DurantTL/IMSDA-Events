import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backGuardMarker,
  createBackGuard,
  createLinkNavigationListener,
  handleGuardedLinkClick,
  isNavigationConfirmed,
} from "@/components/link-guard";
import {
  allowNextNavigation,
  confirmLeave,
  consumeNavigationPass,
  guardedNavigate,
  hasNavigationPass,
  navigationPassWindowMs,
  registerUnsavedChanges,
  setLeaveConfirmer,
  subscribeUnsavedChanges,
} from "@/components/unsaved-changes-registry";

const cleanups: Array<() => void> = [];
const track = (undo: () => void) => {
  cleanups.push(undo);
  return undo;
};

// Each test starts later than the last pass window, so a pass left behind cannot leak in.
let clock = new Date("2026-11-01T12:00:00Z").getTime();
beforeEach(() => {
  clock += 60_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length) cleanups.pop()!();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("registry: leave dialog, subscribe and the one-shot pass (#1452)", () => {
  it("tells subscribers when a form becomes dirty or clean", () => {
    const listener = vi.fn();
    track(subscribeUnsavedChanges(listener));
    const unregister = registerUnsavedChanges("dirty");
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("asks through the installed dialog, and only runs navigate on Leave", async () => {
    track(registerUnsavedChanges("Unsaved settings"));
    const ask = vi.fn(async () => false);
    track(setLeaveConfirmer(ask));
    const navigate = vi.fn();
    const stay = guardedNavigate(navigate);
    expect(stay).toBeInstanceOf(Promise);
    expect(await stay).toBe(false);
    expect(ask).toHaveBeenCalledWith("Unsaved settings");
    expect(navigate).not.toHaveBeenCalled();

    ask.mockResolvedValueOnce(true);
    expect(await guardedNavigate(navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("runs a clean navigation at once without asking, and a sync confirm still returns a boolean", () => {
    const ask = vi.fn(async () => true);
    track(setLeaveConfirmer(ask));
    const navigate = vi.fn();
    expect(guardedNavigate(navigate)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    track(registerUnsavedChanges("dirty"));
    expect(guardedNavigate(navigate, () => false)).toBe(false);
    expect(guardedNavigate(navigate, () => true)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("removes the dialog when the host unmounts", () => {
    const off = setLeaveConfirmer(async () => true);
    off();
    // Only the node fallback remains (no window here), which does not block.
    return expect(confirmLeave("x")).resolves.toBe(true);
  });

  it("a confirmed leave passes once, so the same navigation is not asked twice", () => {
    track(registerUnsavedChanges("dirty"));
    const ask = vi.fn(async () => false);
    track(setLeaveConfirmer(ask));
    allowNextNavigation();
    const navigate = vi.fn();
    expect(guardedNavigate(navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(consumeNavigationPass()).toBe(false);
  });

  it("the pass expires, and beforeunload can see it without using it up", () => {
    allowNextNavigation();
    expect(hasNavigationPass()).toBe(true);
    expect(hasNavigationPass()).toBe(true);
    vi.setSystemTime(Date.now() + navigationPassWindowMs + 1);
    expect(hasNavigationPass()).toBe(false);
    expect(consumeNavigationPass()).toBe(false);
  });
});

function clickOn(link: object | null) {
  const event = {
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false,
    target: { closest: () => link },
    preventDefault: vi.fn(function (this: { defaultPrevented: boolean }) { this.defaultPrevented = true; }),
    stopPropagation: vi.fn(),
  };
  return event;
}
const anchor = () => ({
  target: "", href: "https://events.example.test/people",
  hasAttribute: () => false, getAttribute: () => "/people", click: vi.fn(),
});

describe("link listener with the in-page dialog (#1452)", () => {
  const currentHref = () => "https://events.example.test/profile";

  it("stops the click, asks, and on Leave sets the pass and follows the same link again", async () => {
    const link = anchor();
    const confirm = vi.fn(async () => true);
    const retrigger = vi.fn(() => {
      // The second click arrives with the pass set.
      const again = clickOn(link);
      listener(again);
      expect(again.preventDefault).not.toHaveBeenCalled();
      expect(isNavigationConfirmed(again)).toBe(true);
    });
    const listener = createLinkNavigationListener({ message: "Discard?", confirm, currentHref, isAllowed: () => false, retrigger });
    const first = clickOn(link);
    listener(first);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(first.stopPropagation).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith("Discard?");
    await flush();
    expect(retrigger).toHaveBeenCalledWith(link);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("clicks the link itself when no retrigger is given", async () => {
    const link = anchor();
    const listener = createLinkNavigationListener({ message: "m", confirm: async () => true, currentHref, isAllowed: () => false });
    listener(clickOn(link));
    await flush();
    expect(link.click).toHaveBeenCalledTimes(1);
    consumeNavigationPass();
  });

  it("Keep editing changes nothing: no pass, no second click", async () => {
    const link = anchor();
    const retrigger = vi.fn();
    const listener = createLinkNavigationListener({ message: "m", confirm: async () => false, currentHref, isAllowed: () => false, retrigger });
    const event = clickOn(link);
    listener(event);
    await flush();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(retrigger).not.toHaveBeenCalled();
    expect(hasNavigationPass()).toBe(false);
  });

  it("a second dirty form's listener does not ask again for a click already confirmed", () => {
    const link = anchor();
    const confirm = vi.fn(async () => true);
    const listener = createLinkNavigationListener({ message: "m", confirm, currentHref, isAllowed: () => false });
    allowNextNavigation();
    const event = clickOn(link);
    listener(event);
    listener(event);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("a synchronous confirm keeps the older behavior", () => {
    const link = anchor();
    const yes = clickOn(link);
    createLinkNavigationListener({ message: "m", confirm: () => true, currentHref, isAllowed: () => false })(yes);
    expect(yes.preventDefault).not.toHaveBeenCalled();
    expect(isNavigationConfirmed(yes)).toBe(true);
    const no = clickOn(link);
    createLinkNavigationListener({ message: "m", confirm: () => false, currentHref, isAllowed: () => false })(no);
    expect(no.preventDefault).toHaveBeenCalled();
  });

  it("ignores links that stay on the page, hash links and new-tab links", () => {
    const confirm = vi.fn(async () => true);
    const listener = createLinkNavigationListener({ message: "m", confirm, currentHref, isAllowed: () => false });
    for (const link of [
      { ...anchor(), href: currentHref() },
      { ...anchor(), getAttribute: () => "#top" },
      { ...anchor(), target: "_blank" },
    ]) listener(clickOn(link));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("GuardedLink click with the in-page dialog (#1452)", () => {
  const event = () => ({ defaultPrevented: false, preventDefault: vi.fn(), nativeEvent: { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false } });

  it("reports navigated or cancelled once the dialog is answered, and Cancel never runs", async () => {
    const run = vi.fn();
    const result = handleGuardedLinkClick({ event: event(), run, guard: async () => false });
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe("cancelled");
    expect(run).not.toHaveBeenCalled();
    expect(await handleGuardedLinkClick({ event: event(), run, guard: (go) => Promise.resolve().then(() => { go(); return true; }) })).toBe("navigated");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps returning a plain value for a sync guard", () => {
    expect(handleGuardedLinkClick({ event: event(), run: () => {}, guard: () => true })).toBe("navigated");
    expect(handleGuardedLinkClick({ event: event(), run: () => {}, guard: () => false })).toBe("cancelled");
  });
});

describe("Back guard (#1452)", () => {
  const url = "https://events.example.test/profile";
  function setup(initialMessage: string | null) {
    const entries = { message: initialMessage, state: { __NA: true, tree: "t" } as unknown };
    const history = {
      get state() { return entries.state; },
      pushState: vi.fn((state: unknown) => { entries.state = state; }),
      back: vi.fn(),
    };
    const ask = vi.fn(async () => false);
    const guard = createBackGuard({ history, href: () => url, message: () => entries.message, ask });
    return { entries, history, ask, guard };
  }
  const sentinelState = { __NA: true, tree: "t", [backGuardMarker]: true };
  const plainState = { __NA: true, tree: "t" };

  it("adds one entry when the page becomes dirty, a copy of Next's state, and only once", () => {
    const { history, guard } = setup("dirty");
    guard.onDirtyChange();
    guard.onDirtyChange();
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledWith(sentinelState, "", url);
  });

  it("does nothing while clean, and never touches entries Next did not create", () => {
    const clean = setup(null);
    clean.guard.onDirtyChange();
    expect(clean.history.pushState).not.toHaveBeenCalled();
    const foreign = setup("dirty");
    foreign.entries.state = { somethingElse: true };
    foreign.guard.onDirtyChange();
    expect(foreign.history.pushState).not.toHaveBeenCalled();
  });

  it("Back with unsaved edits asks; Keep editing puts the entry back and goes nowhere", async () => {
    const { history, ask, guard } = setup("dirty");
    guard.onDirtyChange();
    guard.onPopState({ state: plainState });
    expect(ask).toHaveBeenCalledWith("dirty");
    await flush();
    expect(history.back).not.toHaveBeenCalled();
    expect(history.pushState).toHaveBeenCalledTimes(2);
    // Back again asks again.
    guard.onPopState({ state: plainState });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("Leave goes back once more with the pass set, so nothing asks twice", async () => {
    const { history, ask, guard } = setup("dirty");
    ask.mockResolvedValueOnce(true);
    guard.onDirtyChange();
    guard.onPopState({ state: plainState });
    await flush();
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(hasNavigationPass()).toBe(true);
    // The popstate that back() causes is swallowed by the pass.
    guard.onPopState({ state: { __NA: true } });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("a form saved in place is skipped silently, with no question", () => {
    const { entries, history, ask, guard } = setup("dirty");
    guard.onDirtyChange();
    entries.message = null;
    guard.onPopState({ state: plainState });
    expect(ask).not.toHaveBeenCalled();
    expect(history.back).toHaveBeenCalledTimes(1);
  });

  it("Forward onto the extra entry of a page that is now clean steps past it", () => {
    const { entries, history, guard } = setup("dirty");
    entries.message = null;
    guard.onPopState({ state: sentinelState });
    expect(history.back).toHaveBeenCalledTimes(1);
  });

  it("saving while the question is open leaves as Back asked instead of re-adding the entry", async () => {
    const { entries, history, ask, guard } = setup("dirty");
    guard.onDirtyChange();
    ask.mockImplementationOnce(async () => { entries.message = null; return false; });
    guard.onPopState({ state: plainState });
    await flush();
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledTimes(1);
  });
});

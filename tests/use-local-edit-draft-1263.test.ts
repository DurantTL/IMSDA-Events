// @vitest-environment jsdom
import { createElement, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalEditDraft } from "@/components/use-local-edit-draft";
import { editDraftKey, saveEditDraft } from "@/lib/local-edit-draft";
import { mount, type Mounted } from "./helpers/dom-render";

/** The staff editor backup hook (#1263): per-backup tracking, restore refusal, clear once clean. Synthetic data only. */
const keyA = editDraftKey("builder", "evt:form-a");
const keyB = editDraftKey("builder", "evt:form-b");

type Props = { storageKey: string; version?: string; dirty: boolean; value?: unknown; accept?: boolean; onRestore?: (stored: unknown) => void };
function Harness(props: Props) {
  const backup = useLocalEditDraft({
    storageKey: props.storageKey,
    version: props.version ?? "1",
    value: props.value ?? { n: props.storageKey },
    dirty: props.dirty,
    onRestore: (stored) => { props.onRestore?.(stored); return props.accept ?? true; },
  });
  return createElement("p", { "data-restored": String(backup.restored) });
}

let mounted: Mounted | null = null;
const tick = (ms = 10) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const restoredFlag = () => mounted!.container.querySelector("p")!.getAttribute("data-restored");
const render = async (props: Props) => { await act(async () => { mounted!.root.render(createElement(Harness, props)); }); };

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe("useLocalEditDraft (#1263)", () => {
  it("restores the backup of a form the editor switches to, and does not wipe it first", async () => {
    saveEditDraft(window.localStorage, keyB, "1", { n: "saved-for-b" });
    const restored = vi.fn();
    mounted = await mount(createElement(Harness, { storageKey: keyA, dirty: false, onRestore: restored }));
    await tick();
    expect(restoredFlag()).toBe("false");
    // Switch to form B: the editor is clean (just opened), exactly the case that used to clear B's backup.
    await render({ storageKey: keyB, dirty: false, onRestore: restored });
    expect(window.localStorage.getItem(keyB)).not.toBeNull();
    await tick();
    expect(restored).toHaveBeenCalledWith({ n: "saved-for-b" });
    expect(restoredFlag()).toBe("true");
    expect(window.localStorage.getItem(keyB)).not.toBeNull();
  });

  it("drops the restored notice when the editor switches to a form with no backup", async () => {
    saveEditDraft(window.localStorage, keyA, "1", { n: "saved-for-a" });
    mounted = await mount(createElement(Harness, { storageKey: keyA, dirty: false }));
    await tick();
    expect(restoredFlag()).toBe("true");
    await render({ storageKey: keyB, dirty: false });
    await tick();
    expect(restoredFlag()).toBe("false");
  });

  it("removes a backup the editor refuses, and shows no notice", async () => {
    saveEditDraft(window.localStorage, keyA, "1", { n: "not-valid" });
    mounted = await mount(createElement(Harness, { storageKey: keyA, dirty: false, accept: false }));
    await tick();
    expect(restoredFlag()).toBe("false");
    expect(window.localStorage.getItem(keyA)).toBeNull();
  });

  it("writes only while dirty, and clears once the editor is clean again, even after a restore", async () => {
    saveEditDraft(window.localStorage, keyA, "1", { n: "saved-for-a" });
    mounted = await mount(createElement(Harness, { storageKey: keyA, dirty: false }));
    await tick();
    expect(restoredFlag()).toBe("true");
    // The restore is still pending as an unapplied copy until the editor has gone dirty once.
    expect(window.localStorage.getItem(keyA)).not.toBeNull();
    await render({ storageKey: keyA, dirty: true, value: { n: "edited" } });
    await tick(700);
    expect(JSON.parse(window.localStorage.getItem(keyA)!).value).toEqual({ n: "edited" });
    // Saved, or edited back to the saved state: clean again.
    await render({ storageKey: keyA, dirty: false, value: { n: "edited" } });
    await tick();
    expect(window.localStorage.getItem(keyA)).toBeNull();
  });

  it("writes nothing for an editor that was never edited", async () => {
    mounted = await mount(createElement(Harness, { storageKey: keyA, dirty: false }));
    await tick(1000);
    expect(window.localStorage.length).toBe(0);
  });
});

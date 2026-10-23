import { describe, expect, it } from "vitest";
import {
  COALESCE_MS, HISTORY_LIMIT, canRedo, canUndo, clearHistory, emptyHistory, recordEdit, redo, singleValueEditKey, undo,
} from "@/components/registration-builder/edit-history";
import { undoRedoShortcut, type UndoKeyEvent } from "@/components/registration-builder/shell-keys";

const keys = (overrides: Partial<UndoKeyEvent>): UndoKeyEvent => ({
  key: "z", shiftKey: false, metaKey: false, ctrlKey: true, altKey: false, defaultPrevented: false, fromTypingTarget: false, dialogOpen: false, ...overrides,
});

describe("edit history (#1134)", () => {
  it("starts empty and records a step per edit", () => {
    let history = emptyHistory<number>();
    expect(canUndo(history)).toBe(false);
    history = recordEdit(history, 1, null, 0);
    history = recordEdit(history, 2, null, 10);
    expect(history.past).toEqual([1, 2]);
    expect(canUndo(history)).toBe(true);
  });

  it("caps the history at 50 steps, dropping the oldest", () => {
    let history = emptyHistory<number>();
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) history = recordEdit(history, index, null, index);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(10);
    expect(history.past[HISTORY_LIMIT - 1]).toBe(HISTORY_LIMIT + 9);
  });

  it("coalesces edits to the same key within a second, not after, and not for another key", () => {
    let history = recordEdit(emptyHistory<string>(), "a", "title", 0);
    history = recordEdit(history, "ab", "title", 400);
    history = recordEdit(history, "abc", "title", 400 + COALESCE_MS);
    expect(history.past).toEqual(["a"]);
    history = recordEdit(history, "abcd", "title", 400 + COALESCE_MS + COALESCE_MS + 1);
    expect(history.past).toEqual(["a", "abcd"]);
    history = recordEdit(history, "x", "description", 100000);
    expect(history.past).toHaveLength(3);
    history = recordEdit(history, "y", null, 100001);
    history = recordEdit(history, "z", null, 100002);
    expect(history.past).toHaveLength(5);
  });

  it("undoes and redoes, moving the current value to the other stack", () => {
    let history = recordEdit(recordEdit(emptyHistory<string>(), "a", null, 0), "b", null, 5);
    const first = undo(history, "c")!;
    expect(first.value).toBe("b");
    expect(first.history.future).toEqual(["c"]);
    const second = undo(first.history, "b")!;
    expect(second.value).toBe("a");
    expect(undo(second.history, "a")).toBeNull();
    const back = redo(second.history, "a")!;
    expect(back.value).toBe("b");
    history = back.history;
    expect(canRedo(history)).toBe(true);
    expect(redo(redo(history, "b")!.history, "c")).toBeNull();
  });

  it("clears the redo stack after a new edit", () => {
    const stepped = undo(recordEdit(emptyHistory<string>(), "a", null, 0), "b")!.history;
    expect(canRedo(stepped)).toBe(true);
    expect(canRedo(recordEdit(stepped, "a", null, 10))).toBe(false);
    // Also when the edit coalesces into the previous step.
    const typing = recordEdit(recordEdit(emptyHistory<string>(), "a", "k", 0), "ab", "k", 10);
    const undone = undo(typing, "abc")!.history;
    expect(canRedo(recordEdit(undone, "a", "k", 20))).toBe(false);
  });

  it("does not coalesce across an undo", () => {
    const typing = recordEdit(emptyHistory<string>(), "a", "k", 0);
    const undone = undo(typing, "ab")!.history;
    const next = redo(undone, "a")!.history;
    expect(recordEdit(next, "ab", "k", 20).past).toHaveLength(2);
  });

  it("clears everything", () => {
    expect(clearHistory<string>()).toEqual(emptyHistory<string>());
  });
});

describe("single value edit key (#1134)", () => {
  const draft = { title: "Camp", sections: [{ id: "s1", fields: [{ id: "f1", label: "Name", required: true }] }] };
  it("names the one text value that changed", () => {
    const typed = { ...draft, sections: [{ id: "s1", fields: [{ id: "f1", label: "Names", required: true }] }] };
    expect(singleValueEditKey(draft, typed)).toBe("$.sections[0].fields[0].label");
    expect(singleValueEditKey(draft, { ...draft, title: "Camp 2" })).toBe("$.title");
  });
  it("is null for structural, boolean or multi-value changes", () => {
    expect(singleValueEditKey(draft, { ...draft, sections: [] })).toBeNull();
    expect(singleValueEditKey(draft, { ...draft, sections: [{ id: "s1", fields: [{ id: "f1", label: "Name", required: false }] }] })).toBeNull();
    expect(singleValueEditKey(draft, { ...draft, title: "X", sections: [{ id: "s2", fields: draft.sections[0]!.fields }] })).toBeNull();
    expect(singleValueEditKey(draft, draft)).toBeNull();
  });
});

describe("undo and redo shortcuts (#1134)", () => {
  it("maps Ctrl or Cmd+Z, Shift+Z and Ctrl+Y", () => {
    expect(undoRedoShortcut(keys({}))).toBe("undo");
    expect(undoRedoShortcut(keys({ ctrlKey: false, metaKey: true }))).toBe("undo");
    expect(undoRedoShortcut(keys({ shiftKey: true, key: "Z" }))).toBe("redo");
    expect(undoRedoShortcut(keys({ key: "y" }))).toBe("redo");
  });
  it("ignores plain keys, typing targets, dialogs, other handlers and Alt", () => {
    expect(undoRedoShortcut(keys({ ctrlKey: false }))).toBeNull();
    expect(undoRedoShortcut(keys({ fromTypingTarget: true }))).toBeNull();
    expect(undoRedoShortcut(keys({ dialogOpen: true }))).toBeNull();
    expect(undoRedoShortcut(keys({ defaultPrevented: true }))).toBeNull();
    expect(undoRedoShortcut(keys({ altKey: true }))).toBeNull();
    expect(undoRedoShortcut(keys({ key: "x" }))).toBeNull();
  });
});

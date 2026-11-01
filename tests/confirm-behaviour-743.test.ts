import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createConfirmController, type PendingConfirm } from "@/components/use-confirm";
import { isTopDialog, openDialogCount, pushOpenDialog, removeOpenDialog } from "@/components/use-accessible-dialog";
import { SubmitButton, submitButtonState } from "@/components/submit-button";
import { uniformNeedPreview } from "@/components/club-uniform-section";

const request = { title: "Delete Spring Camporee 2027", body: "Registrations are kept.", confirmLabel: "Delete Spring Camporee 2027", destructive: true };

function controller() {
  const states: Array<PendingConfirm | null> = [];
  const c = createConfirmController((pending) => states.push(pending));
  return { c, states };
}

describe("useConfirm controller (#743)", () => {
  it("resolves true on confirm and false on cancel, clearing the open request each time", async () => {
    const { c, states } = controller();
    const yes = c.request(request);
    expect(states.at(-1)?.confirmLabel).toBe("Delete Spring Camporee 2027");
    c.settle(true);
    await expect(yes).resolves.toBe(true);
    expect(states.at(-1)).toBeNull();

    const no = c.request(request);
    c.settle(false);
    await expect(no).resolves.toBe(false);
    expect(states.at(-1)).toBeNull();
  });

  it("a second request cancels the first and then owns the dialog", async () => {
    const { c, states } = controller();
    const first = c.request({ ...request, title: "First" });
    const second = c.request({ ...request, title: "Second" });
    await expect(first).resolves.toBe(false);
    expect(states.at(-1)?.title).toBe("Second");
    c.settle(true);
    await expect(second).resolves.toBe(true);
  });

  it("settling with nothing open is harmless", () => {
    const { c } = controller();
    expect(() => c.settle(true)).not.toThrow();
  });

  it("Cancel aborts the guarded action; Confirm runs it", async () => {
    const { c } = controller();
    let deleted = 0;
    const handler = async () => {
      if (!(await c.request(request))) return;
      deleted += 1;
    };
    const cancelled = handler();
    c.settle(false);
    await cancelled;
    expect(deleted).toBe(0);
    const confirmed = handler();
    c.settle(true);
    await confirmed;
    expect(deleted).toBe(1);
  });
});

describe("dialog stack (#743)", () => {
  it("only the top-most open dialog is the one that handles Escape", () => {
    const base = openDialogCount();
    const editor = pushOpenDialog();
    expect(isTopDialog(editor)).toBe(true);
    const confirmation = pushOpenDialog();
    expect(isTopDialog(confirmation)).toBe(true);
    expect(isTopDialog(editor)).toBe(false);
    removeOpenDialog(confirmation);
    expect(isTopDialog(editor)).toBe(true);
    removeOpenDialog(editor);
    expect(openDialogCount()).toBe(base);
  });

  it("removing a token twice, or one never pushed, changes nothing", () => {
    const base = openDialogCount();
    const token = pushOpenDialog();
    removeOpenDialog(token);
    removeOpenDialog(token);
    removeOpenDialog(Symbol("never"));
    expect(openDialogCount()).toBe(base);
  });
});

describe("SubmitButton (#743)", () => {
  const props = { label: "Submit report", submittingLabel: "Submitting…" };

  it("shows the busy label, a spinner and a disabled, busy button while submitting", () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { ...props, submitting: true }));
    expect(html).toContain("Submitting…");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("submit-button-spinner");
  });

  it("re-enables with its normal label after a failure", () => {
    expect(submitButtonState({ submitting: true, label: "Submit report" }).disabled).toBe(true);
    const html = renderToStaticMarkup(createElement(SubmitButton, { ...props, submitting: false }));
    expect(html).toContain("Submit report");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("submit-button-spinner");
  });

  it("the button not pressed stays disabled without showing the busy label", () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { ...props, label: "Save draft", disabled: true, submitting: false }));
    expect(html).toContain("Save draft");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Submitting…");
  });
});

describe("bulk uniform preview (#743)", () => {
  const needs = Array.from({ length: 7 }, (_, i) => ({ needId: `need-${i}`, firstName: "Sam", lastName: `Tester${i}`, itemName: "Neckerchief", size: i === 0 ? "M" : null }));

  it("lists the first five picked needs keyed by id and counts the rest", () => {
    const preview = uniformNeedPreview(needs, needs.map((n) => n.needId));
    expect(preview.rows.map((row) => row.needId)).toEqual(["need-0", "need-1", "need-2", "need-3", "need-4"]);
    expect(preview.rows[0].line).toBe("Sam Tester0, Neckerchief M");
    expect(preview.more).toBe(2);
  });

  it("two needs that read the same still get distinct keys", () => {
    const twins = [
      { needId: "a", firstName: "Sam", lastName: "Same", itemName: "Shirt", size: "S" },
      { needId: "b", firstName: "Sam", lastName: "Same", itemName: "Shirt", size: "S" },
    ];
    const preview = uniformNeedPreview(twins, ["a", "b"]);
    expect(new Set(preview.rows.map((row) => row.needId)).size).toBe(2);
  });
});

describe("useConfirm reason field (#1448)", () => {
  const ask = { title: "Cancel this order?", body: "Credited.", confirmLabel: "Cancel order", destructive: true, input: { label: "Why?", required: true } };

  it("ask resolves the trimmed text on confirm and null on cancel", async () => {
    const { c, states } = controller();
    const yes = c.ask(ask);
    expect(states.at(-1)?.input?.label).toBe("Why?");
    c.settle(true, "  duplicate order  ");
    await expect(yes).resolves.toBe("duplicate order");
    expect(states.at(-1)).toBeNull();

    const no = c.ask(ask);
    c.settle(false, "typed but cancelled");
    await expect(no).resolves.toBeNull();
  });

  it("a required field cannot be confirmed empty or blank, and the dialog stays open", async () => {
    const { c, states } = controller();
    const answer = c.ask(ask);
    c.settle(true, "");
    c.settle(true, "   ");
    c.settle(true);
    expect(states.at(-1)).not.toBeNull();
    c.settle(true, "ok");
    await expect(answer).resolves.toBe("ok");
  });

  it("an optional field may be confirmed empty, giving an empty string", async () => {
    const { c } = controller();
    const answer = c.ask({ ...ask, input: { label: "Link", type: "url" } });
    c.settle(true, "");
    await expect(answer).resolves.toBe("");
  });

  it("a second request cancels an open ask with null", async () => {
    const { c } = controller();
    const first = c.ask(ask);
    void c.request(request);
    await expect(first).resolves.toBeNull();
  });

  it("confirm() on a plain request still resolves a boolean", async () => {
    const { c } = controller();
    const answer = c.request(request);
    c.settle(true, "ignored");
    await expect(answer).resolves.toBe(true);
  });
});

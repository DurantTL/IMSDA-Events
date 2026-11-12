import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupChecklistPanel } from "@/components/setup-checklist-panel";
import { summarizeChecklist, type ChecklistStep } from "@/modules/setup-help/checklist";

const step = (id: string, done: boolean): ChecklistStep => ({
  id,
  label: `Step ${id}`,
  detail: `Do ${id}.`,
  done,
  href: `/s/${id}`,
  linkable: true,
  actionLabel: `Open ${id}`,
});

const render = (collapseDone: boolean, steps: ChecklistStep[]) =>
  renderToStaticMarkup(createElement(SetupChecklistPanel, { checklist: summarizeChecklist(steps), collapseDone, eyebrow: "Getting started", storageKey: "k", title: "Get set" }));

describe("setup checklist collapses finished steps on request (#1894)", () => {
  const steps = [step("a", true), step("b", false), step("c", true), step("d", false)];

  it("keeps open steps in order, then one disclosure holding the finished steps with their links", () => {
    const html = render(true, steps);
    expect(html).toContain("2 of 4 done");
    expect(html).toContain("2 finished steps");
    const details = html.slice(html.indexOf("<details"));
    expect(details).toContain('data-step="a"');
    expect(details).toContain('href="/s/c"');
    const before = html.slice(0, html.indexOf("<details"));
    expect(before.indexOf('data-step="b"')).toBeLessThan(before.indexOf('data-step="d"'));
    expect(before).not.toContain('data-step="a"');
    expect(before).not.toContain('data-step="c"');
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  it("uses the singular for one finished step and shows no disclosure when none are finished", () => {
    expect(render(true, [step("a", true), step("b", false)])).toContain("1 finished step<");
    expect(render(true, [step("a", false), step("b", false)])).not.toContain("<details");
  });

  it("leaves the list unchanged by default", () => {
    const html = render(false, steps);
    expect(html).not.toContain("<details");
    expect(html.indexOf('data-step="a"')).toBeLessThan(html.indexOf('data-step="b"'));
  });

  it("still renders nothing when every step is done", () => {
    expect(render(true, [step("a", true), step("b", true)])).toBe("");
  });
});

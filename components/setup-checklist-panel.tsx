"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronUp, Circle, ExternalLink } from "lucide-react";
import type { Checklist, ChecklistStep } from "@/modules/setup-help/checklist";

// Per-browser convenience. Storage can be blocked, so the choice then lasts for this page view only.
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function readCollapsed(key: string): boolean {
  const held = memory.get(key);
  if (held !== undefined) return held;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(key: string, value: boolean) {
  memory.set(key, value);
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // The in-memory copy still applies for now.
  }
  listeners.forEach((listener) => listener());
}

/**
 * The one setup checklist look (#743 event Dashboard, #1435 club directors and area coordinators): done and not-done
 * steps, each with a Set up link and, where there is one, a Help guide link; collapsible; gone when everything it can
 * track is done. Presentational only: the steps come already decided from data the page read.
 */
export function SetupChecklistPanel({
  checklist,
  eyebrow,
  title,
  storageKey,
  headingId = "setup-checklist",
  guide,
}: {
  checklist: Checklist;
  eyebrow: string;
  title: string;
  /** Where the per-browser "collapsed" choice is remembered. */
  storageKey: string;
  /** Prefix of the ids, so a page with a checklist and another landmark keeps them unique. */
  headingId?: string;
  /** A Help guide for the whole list (#1435); the event Dashboard passes none. */
  guide?: { href: string; label: string };
}) {
  const collapsed = useSyncExternalStore(subscribe, () => readCollapsed(storageKey), () => false);
  if (checklist.hidden) return null;

  return (
    <section className="panel setup-checklist" aria-labelledby={`${headingId}-title`}>
      <div className="setup-checklist-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={`${headingId}-title`}>{title}</h2>
          <p className="setup-checklist-progress" role="status">{checklist.doneCount} of {checklist.trackedCount} done</p>
        </div>
        <button
          aria-controls={`${headingId}-steps`}
          aria-expanded={!collapsed}
          className="text-button"
          onClick={() => writeCollapsed(storageKey, !collapsed)}
          type="button"
        >
          {collapsed ? <><ChevronDown aria-hidden="true" size={15} /> Show steps</> : <><ChevronUp aria-hidden="true" size={15} /> Hide steps</>}
        </button>
      </div>
      <ol className="setup-checklist-steps" hidden={collapsed} id={`${headingId}-steps`}>
        {checklist.steps.map((step) => <StepRow isNext={step.id === checklist.nextStepId} key={step.id} step={step} />)}
      </ol>
      {guide && !collapsed && <p className="field-help setup-checklist-guide"><Link className="text-button" href={guide.href}>{guide.label} <ArrowRight aria-hidden="true" size={14} /></Link></p>}
    </section>
  );
}

function StepAction({ step }: { step: ChecklistStep }) {
  if (!step.linkable) return <small className="setup-step-unavailable">{step.unavailableNote ?? "Not available yet."}</small>;
  return step.external
    ? <a className="text-button" href={step.href} rel="noreferrer" target="_blank">{step.actionLabel} <ExternalLink aria-hidden="true" size={14} /></a>
    : <Link className="text-button" href={step.href}>{step.actionLabel} <ArrowRight aria-hidden="true" size={14} /></Link>;
}

function StepRow({ step, isNext }: { step: ChecklistStep; isNext: boolean }) {
  const icon = step.reference
    ? <BookOpen aria-hidden="true" size={18} />
    : step.done ? <CheckCircle2 aria-hidden="true" size={18} /> : <Circle aria-hidden="true" size={18} />;
  const action = <StepAction step={step} />;
  return (
    <li className={`setup-step${step.done ? " is-done" : ""}${isNext ? " is-next" : ""}${step.reference ? " is-reference" : ""}`} data-step={step.id}>
      {icon}
      <span className="setup-step-copy">
        <strong>{step.label}</strong>
        <small>{step.done ? "Done" : step.detail}</small>
      </span>
      {step.helpHref ? (
        <span className="setup-step-actions">
          {action}
          <Link className="text-button" href={step.helpHref}>
            {step.helpLabel ?? "Help guide"}<span className="sr-only"> for {step.label}</span> <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </span>
      ) : action}
    </li>
  );
}

import type { ReactNode } from "react";
import { PageHeader, type TitledPageHeaderProps } from "@/components/page-header";

/** Where the person is in a flow. `label` names the step ("Who's going"). */
export type PageStep = { number: number; total: number; label: string };

/** The step line, in the same words the club registration steps use: "Step 2 of 3 · Each person's details". */
export function stepLine(step: PageStep): string {
  return `Step ${step.number} of ${step.total} · ${step.label}`;
}

/**
 * The step-by-step page template (#1772): header, the progress line, and one step at a time. The progress is the
 * header's eyebrow ("a step number" is the case the PageHeader spec gives for an eyebrow), so the title stays the
 * flow's name and the step never repeats it. A flow whose steps are kept by a client component and not known to the
 * server (the page can not say "Step 2") leaves `step` out and the eyebrow off.
 */
export function StepPage({
  header,
  step,
  children,
  footer,
}: {
  header: Omit<TitledPageHeaderProps, "eyebrow">;
  step?: PageStep;
  /** The current step only. */
  children: ReactNode;
  /** Back and Next for the step. */
  footer?: ReactNode;
}) {
  return (
    <section className="page-stack" data-page-template="step">
      <PageHeader {...header} eyebrow={step ? stepLine(step) : undefined} />
      <div data-template-slot="step">{children}</div>
      {footer}
    </section>
  );
}

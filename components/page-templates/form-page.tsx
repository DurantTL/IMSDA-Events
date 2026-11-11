import type { ReactNode } from "react";
import { PageHeader, type TitledPageHeaderProps } from "@/components/page-header";

/**
 * The form page template (#1772): header, notices (errors, carried context), the grouped fields, and the save bar slot.
 * The save bar is the shared `.event-savebar` with the words from `settingsSaveState` (Saved, Unsaved changes, Saving…,
 * Not saved), so "Saved" reads the same everywhere (rule B5). A form that already draws its own save bar (the event
 * settings form) passes itself as `children` and leaves `saveBar` empty.
 */
export function FormPage({
  header,
  notices,
  children,
  saveBar,
}: {
  header: TitledPageHeaderProps;
  /** The error summary, a carried-over context banner or a choice row above the form. */
  notices?: ReactNode;
  /** The form: one panel per group of fields. */
  children: ReactNode;
  /** The save bar and its "Saved" message, after the fields. */
  saveBar?: ReactNode;
}) {
  return (
    <section className="page-stack" data-page-template="form">
      <PageHeader {...header} />
      {notices}
      {children}
      {saveBar}
    </section>
  );
}

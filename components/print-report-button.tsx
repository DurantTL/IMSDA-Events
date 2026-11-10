"use client";

import { Printer } from "lucide-react";

export function PrintReportButton({
  label = "Print all reports",
  primary = false,
}: {
  label?: string;
  /** The page's one main action: a filled button instead of an outlined one. */
  primary?: boolean;
}) {
  return (
    <button
      className={`${primary ? "primary-button" : "secondary-button"} report-print-button`}
      type="button"
      onClick={() => window.print()}
    >
      <Printer aria-hidden="true" size={15} />
      {label}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { formatPrintTimestamp } from "@/modules/emergency-plans/domain";
import styles from "@/components/emergency-reference-sheet.module.css";

/**
 * The sheet's footer (#114): the version and published date, then when it was
 * printed. The printed time is refreshed as the print dialog opens, so a page
 * left open for an hour still carries the moment it came off the printer.
 */
export function EmergencyPrintFooter({ prefix, timezone, initialPrintedAt }: { prefix: string; timezone: string; initialPrintedAt: string }) {
  const [printedAt, setPrintedAt] = useState(() => new Date(initialPrintedAt));
  useEffect(() => {
    const refresh = () => setPrintedAt(new Date());
    window.addEventListener("beforeprint", refresh);
    return () => window.removeEventListener("beforeprint", refresh);
  }, []);
  return <p className={styles.footer}>{prefix}. Printed {formatPrintTimestamp(printedAt, timezone)}</p>;
}

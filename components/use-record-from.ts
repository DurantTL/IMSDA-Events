"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { recordFromParam } from "@/modules/club-reports/record-return-domain";

/**
 * The `from` a link into one club's record carries when the list is sorted in the browser (#1588): this page's own
 * address (year, month, filter, sort), rebuilt from allowed parameters only. Null on a page that is not a parent.
 */
export function useRecordFrom(): string | null {
  const pathname = usePathname();
  const search = useSearchParams();
  return recordFromParam(pathname ?? "", search ?? "");
}

"use client";

import { AccountPortalTabs } from "@/components/account-portal-tabs";
import { ErrorBoundaryView } from "@/components/error-boundary-view";

/** The failed page keeps the account tabs (#1555); its banner is gone with the page, so the row is drawn here. */
export default function SegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <AccountPortalTabs />
      <ErrorBoundaryView error={error} retry={retry} variant="portal" />
    </>
  );
}

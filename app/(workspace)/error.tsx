"use client";

import { OwnHeaderState } from "@/components/own-header-state";
import { ErrorBoundaryView } from "@/components/error-boundary-view";

export default function SegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <OwnHeaderState />
      <ErrorBoundaryView error={error} retry={retry} variant="workspace" />
    </>
  );
}

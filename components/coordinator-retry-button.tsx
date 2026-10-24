"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Re-runs the page's server reads in place (no full reload), for an "unavailable" state. */
export function CoordinatorRetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button aria-busy={pending} className="secondary-button" disabled={pending} onClick={() => startTransition(() => router.refresh())} type="button">
      {pending ? "Retrying…" : "Retry"}
    </button>
  );
}

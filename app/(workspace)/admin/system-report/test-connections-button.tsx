"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlugZap } from "lucide-react";

/**
 * "Test connections" in the System report's head, in the shared secondary-button look. It posts to the guarded route,
 * which runs the read-only tests, then reloads the page to show the stored results.
 */
export function TestConnectionsButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "failed">("idle");

  async function run() {
    setState("running");
    try {
      const response = await fetch("/api/admin/system-report/test-connections", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("rejected");
      setState("idle");
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  return (
    <button className="secondary-button" type="button" onClick={run} disabled={state === "running"} aria-busy={state === "running"}>
      <PlugZap aria-hidden="true" size={16} />
      {state === "running" ? "Testing…" : state === "failed" ? "Could not test. Try again" : "Test connections"}
    </button>
  );
}

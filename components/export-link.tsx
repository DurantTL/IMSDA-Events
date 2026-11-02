"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

/**
 * The one control for every CSV download (rule B11, #1458). Without script it is a plain `<a href download>` and the
 * browser downloads the file. With script it fetches the file, says "Preparing download…" while it works, saves the
 * file under the name the server chose, and, when the server refuses, shows the reason in plain words next to the link
 * instead of opening raw JSON.
 */

export type ExportStatus = { phase: "idle" | "preparing" | "failed"; message: string };

/**
 * A container that hides its links once one is clicked (the Actions menu) provides this, so the "Preparing download…"
 * and the failure message show beside the container's own control instead of inside the closed menu.
 */
export type ExportStatusSink = {
  report: (status: ExportStatus) => void;
  /** Called on mount by each link inside, so the container renders its live region before any text arrives; returns the cleanup. */
  register: () => () => void;
};
export const ExportStatusContext = createContext<ExportStatusSink | null>(null);

/** The words for a status, for whoever shows it. */
export function exportStatusText(status: ExportStatus): string {
  return status.phase === "preparing" ? "Preparing download…" : status.phase === "failed" ? status.message : "";
}

const plainStatusText: Record<number, string> = {
  401: "Sign in again to download this file.",
  403: "You don't have access to download this file.",
  404: "That file isn't available.",
  409: "That file can't be made right now.",
};

/** The file name the server sent, if any. */
export function fileNameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match ? match[1]! : null;
}

/** A plain-words reason for a refused download: the server's own message when it sent one, else a sentence for the status. Never raw JSON. */
export async function downloadErrorMessage(response: Pick<Response, "status" | "json">): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = body && typeof body === "object" ? (body as { message?: unknown }).message : null;
    if (typeof message === "string" && message.trim() !== "") return message.trim();
  } catch {
    // Not JSON: fall through to the sentence for the status.
  }
  return plainStatusText[response.status] ?? "The download didn't work. Try again.";
}

export function ExportLink({ href, children = "Download CSV", className }: { href: string; children?: ReactNode; className?: string }) {
  const [state, setLocalState] = useState<ExportStatus>({ phase: "idle", message: "" });
  const sink = useContext(ExportStatusContext);
  useEffect(() => sink?.register(), [sink]);
  const setState = (next: ExportStatus) => {
    setLocalState(next);
    sink?.report(next);
  };
  const busy = useRef(false);

  async function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle a new-tab or save-as click, and a page where fetch is unavailable.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || typeof fetch !== "function") return;
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setState({ phase: "preparing", message: "" });
    try {
      const response = await fetch(href, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        setState({ phase: "failed", message: await downloadErrorMessage(response) });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? "download.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ phase: "idle", message: "" });
    } catch {
      setState({ phase: "failed", message: "The download didn't work. Check your connection and try again." });
    } finally {
      busy.current = false;
    }
  }

  return (
    <>
      <a aria-busy={state.phase === "preparing" || undefined} className={className} download href={href} onClick={onClick}>{children}</a>
      {!sink && (
        <span aria-live="polite" className={state.phase === "failed" ? "form-error export-link-status" : "quiet-copy export-link-status"} role="status">
          {exportStatusText(state) ? ` ${exportStatusText(state)}` : ""}
        </span>
      )}
    </>
  );
}

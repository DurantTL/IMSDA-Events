"use client";

import { Component, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

/**
 * Live lists (rule P2, #1445) never go blank and never sit silently stale. If
 * the list's script breaks (blocked, a failed request, or a browser translator
 * that rewrote the page under React), the person sees one plain message and a
 * Reload button instead. Same notice and button the rest of the site uses.
 */
export function ReloadButton({ label = "Reload" }: { label?: string }) {
  return (
    <button className="secondary-button" onClick={() => window.location.reload()} type="button">
      <RotateCw aria-hidden="true" size={16} /> {label}
    </button>
  );
}

export function LiveListFailure({ listName, message }: { listName: string; message?: string }) {
  return (
    <div className="inline-notice error" role="alert">
      <p>{message ?? `The ${listName} could not be shown. Reload the page to see the current list.`}</p>
      <ReloadButton />
    </div>
  );
}

type BoundaryProps = { children: ReactNode; listName: string };

export class LiveListBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (this.state.failed) return <LiveListFailure listName={this.props.listName} />;
    return (
      <>
        {this.props.children}
        <noscript>
          <p className="inline-notice error" role="alert">
            This {this.props.listName} needs JavaScript to add or change people. Turn it on, or reload the page to see the current list.
          </p>
        </noscript>
      </>
    );
  }
}

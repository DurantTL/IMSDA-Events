"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { FileUp, Plus } from "lucide-react";
import styles from "@/components/catalog-workspace.module.css";

/**
 * The one filled action of a catalog page lives in the page header (rule D3), which the server page draws with the title
 * (rule D2). The workspace that owns the editor or the file chooser registers what the button does; the button reads it.
 */
/** `busy` swaps the label (a file is being read); `blocked` only holds clicks back while the workspace is working. */
type Action = { run: () => void; busy: boolean; blocked?: boolean };
type Registry = { action: Action | null; setAction: (action: Action | null) => void };

const ActionContext = createContext<Registry>({ action: null, setAction: () => {} });

export function CatalogActionProvider({ children }: { children: ReactNode }) {
  const [action, setActionState] = useState<Action | null>(null);
  const setAction = useCallback((next: Action | null) => setActionState((current) => (current && next && current.run === next.run && current.busy === next.busy && Boolean(current.blocked) === Boolean(next.blocked) ? current : next)), []);
  const value = useMemo(() => ({ action, setAction }), [action, setAction]);
  return <ActionContext.Provider value={value}>{children}</ActionContext.Provider>;
}

export function useRegisterCatalogAction() {
  return useContext(ActionContext).setAction;
}

/** The header's filled button. `icon` picks the glyph; `busyLabel` replaces the label while the workspace is working. */
export function CatalogHeaderButton({ label, busyLabel, icon }: { label: string; busyLabel?: string; icon: "add" | "upload" }) {
  const { action } = useContext(ActionContext);
  const busy = Boolean(action?.busy);
  const held = busy || Boolean(action?.blocked);
  const Icon = icon === "add" ? Plus : FileUp;
  // aria-disabled, not disabled: a keyboard user's focus stays on the button while the workspace is working.
  return (
    <button aria-disabled={held || undefined} className={`primary-button ${styles.held}`} onClick={() => { if (!held) action?.run(); }} type="button">
      <Icon aria-hidden="true" size={16} /> {busy && busyLabel ? busyLabel : label}
    </button>
  );
}

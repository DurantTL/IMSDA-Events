"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { FileUp, MapPin, Plus, Upload } from "lucide-react";
import styles from "@/components/organization-pages.module.css";

/**
 * The one filled action of a System organization page lives in the page header (rule D3), which the server page draws
 * with the title (rule D2). The workspace that owns the dialog, the file chooser or the lookup registers what the
 * button does and says; the button reads it. Before the script loads the button shows the page's own label.
 * `busy` swaps the label to `busyLabel`; `blocked` only holds clicks back (a choice is still needed).
 */
type Action = { run: () => void; busy: boolean; blocked?: boolean; label?: string; busyLabel?: string };
type Registry = { action: Action | null; setAction: (action: Action | null) => void };

const ActionContext = createContext<Registry>({ action: null, setAction: () => {} });

export function OrganizationActionProvider({ children }: { children: ReactNode }) {
  const [action, setActionState] = useState<Action | null>(null);
  const setAction = useCallback((next: Action | null) => setActionState((current) => (
    current && next && current.run === next.run && current.busy === next.busy && Boolean(current.blocked) === Boolean(next.blocked) && current.label === next.label && current.busyLabel === next.busyLabel ? current : next
  )), []);
  const value = useMemo(() => ({ action, setAction }), [action, setAction]);
  return <ActionContext.Provider value={value}>{children}</ActionContext.Provider>;
}

export function useRegisterOrganizationAction() {
  return useContext(ActionContext).setAction;
}

/** The header button's id, so a link lower on the page can move focus to it. */
export const HEADER_ACTION_ID = "organization-header-action";

const icons = { add: Plus, upload: FileUp, save: Upload, map: MapPin } as const;

/** The header's filled button. `icon` picks the glyph; `label` is shown until the workspace registers its own. */
export function OrganizationHeaderButton({ label, icon }: { label: string; icon: keyof typeof icons }) {
  const { action } = useContext(ActionContext);
  const busy = Boolean(action?.busy);
  const held = busy || Boolean(action?.blocked);
  const Icon = icons[icon];
  const shown = busy ? action?.busyLabel ?? action?.label ?? label : action?.label ?? label;
  // aria-disabled, not disabled: a keyboard user's focus stays on the button while the workspace is working.
  return (
    <button aria-disabled={held || undefined} id={HEADER_ACTION_ID} className={`primary-button ${styles.held}`} onClick={() => { if (!held) action?.run(); }} type="button">
      <Icon aria-hidden="true" size={16} /> {shown}
    </button>
  );
}

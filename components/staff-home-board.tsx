"use client";

import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { NavigationLink as Link } from "@/components/navigation-link";
import styles from "@/components/staff-home-board.module.css";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { QUICK_LINKS_MAX } from "@/modules/system-admin/home-quick-links-domain";
import { moveAnnouncement, moveItem, type HomeLayout, type HomeLayoutModule, type HomeModuleKey } from "@/modules/system-admin/home-layout-domain";

type Scope = "arrange" | "customize";

export type HomeLayoutResult = { ok: true; layout: HomeLayout } | { ok: false; message: string };

const failed: HomeLayoutResult = { ok: false, message: "Your layout could not be saved." };

async function callLayoutApi(method: "PUT" | "DELETE", body?: unknown): Promise<HomeLayoutResult> {
  try {
    const response = await fetch("/api/home/layout", {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) return failed;
    const data = (await response.json()) as { layout?: HomeLayout };
    return data.layout ? { ok: true, layout: data.layout } : failed;
  } catch {
    return failed;
  }
}

const saveLayout = (input: unknown) => callLayoutApi("PUT", { modules: input });
const resetLayout = () => callLayoutApi("DELETE");

/** Puts the shown modules into the slots the shown ones held, so hidden modules keep their place (#1705). */
export function reorderShown(modules: readonly HomeLayoutModule[], shownKeys: readonly HomeModuleKey[]): HomeLayoutModule[] {
  const byKey = new Map(modules.map((item) => [item.key, item]));
  let next = 0;
  return modules.map((item) => (item.shown ? byKey.get(shownKeys[next++])! : item));
}

export type QuickLinkOption = { key: string; label: string; href: string };

/** The Quick links card body: links to pages the person picked, or a short message with a button to pick some. */
function QuickLinksBody({ picks, options, onPick }: { picks: readonly string[]; options: readonly QuickLinkOption[]; onPick: () => void }) {
  const links = picks.map((key) => options.find((option) => option.key === key)).filter((option): option is QuickLinkOption => option !== undefined);
  if (links.length === 0) {
    return (
      <div className={styles.quickEmpty} data-testid="home-quick-links-empty">
        <p className={styles.loading}>No quick links yet. Pick the pages you open most.</p>
        <button type="button" className="secondary-button" onClick={onPick}>Choose links</button>
      </div>
    );
  }
  return (
    <ul className={styles.quickList} data-testid="home-quick-links">
      {links.map((link) => (
        <li key={link.key}><Link className={styles.quickLink} href={link.href}>{link.label}</Link></li>
      ))}
    </ul>
  );
}

export function StaffHomeBoard({ modules: initial, bodies, quickLinkOptions = [], defaultArranging = false, action = saveLayout, resetAction = resetLayout }: {
  modules: HomeLayoutModule[];
  /** Server-rendered module bodies by key; a shown module without one is still loading. */
  bodies: Partial<Record<HomeModuleKey, ReactNode>>;
  /** The pages this person may pick for Quick links, from the server. */
  quickLinkOptions?: QuickLinkOption[];
  /** Starts in Arrange mode (tests and previews). */
  defaultArranging?: boolean;
  action?: (input: unknown) => Promise<HomeLayoutResult>;
  resetAction?: () => Promise<HomeLayoutResult>;
}) {
  const router = useRouter();
  const [modules, setModules] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setModules(initial);
  }
  const [arranging, setArranging] = useState(defaultArranging);
  const [customizing, setCustomizing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState<{ scope: Scope; key: HomeModuleKey } | null>(null);
  const confirmed = useRef(initial);
  const latest = useRef(initial);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const dirty = useRef(false);
  const requestId = useRef(0);
  const needsRefresh = useRef(false);

  useEffect(() => {
    confirmed.current = initial;
  }, [initial]);
  useLayoutEffect(() => {
    latest.current = modules;
  }, [modules]);

  const dialogRef = useAccessibleDialog<HTMLDivElement>(customizing, () => setCustomizing(false));

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const handle = document.querySelector<HTMLElement>(`[data-handle="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    handle?.focus({ preventScroll: true });
  });

  const shownModules = modules.filter((item) => item.shown);
  const quickLinksModule = modules.find((item) => item.key === "quick-links");

  /** `refresh` is true for a show/hide change or a reset, so newly shown modules load; a move only applies the returned layout. */
  async function persist(next: HomeLayoutModule[], refresh: boolean, request: () => Promise<HomeLayoutResult> = () => action(next.map(({ key, shown, links }) => (links ? { key, shown, links } : { key, shown }))), onSaved?: () => void) {
    const id = ++requestId.current;
    if (refresh) needsRefresh.current = true;
    setError("");
    let result: HomeLayoutResult;
    try {
      result = await request();
    } catch {
      result = { ok: false, message: "Your layout could not be saved." };
    }
    // A later request has replaced this one: its answer is the one that counts.
    if (id !== requestId.current) return;
    if (!result.ok) {
      needsRefresh.current = false;
      setModules(confirmed.current);
      setError(`${result.message} Your last saved layout is showing.`);
      return;
    }
    confirmed.current = result.layout.modules;
    if (!dirty.current) apply(result.layout.modules);
    onSaved?.();
    if (needsRefresh.current) {
      needsRefresh.current = false;
      router.refresh();
    }
  }

  function apply(next: HomeLayoutModule[]) {
    setModules(next);
    latest.current = next;
  }

  function announceMove(scope: Scope, key: HomeModuleKey, next: HomeLayoutModule[]) {
    const list = scope === "arrange" ? next.filter((item) => item.shown) : next;
    const position = list.findIndex((item) => item.key === key);
    const label = next.find((item) => item.key === key)!.label;
    setMessage(moveAnnouncement(label, position + 1, list.length));
  }

  /** Moves a module to `to` within the scope's list; returns whether anything moved. */
  function moveTo(scope: Scope, key: HomeModuleKey, to: number) {
    const current = latest.current;
    const list = scope === "arrange" ? current.filter((item) => item.shown) : current;
    const from = list.findIndex((item) => item.key === key);
    const target = Math.max(0, Math.min(list.length - 1, to));
    if (from === -1 || from === target) return false;
    const moved = moveItem(list, from, target);
    const next = scope === "arrange" ? reorderShown(current, moved.map((item) => item.key)) : moved;
    apply(next);
    dirty.current = true;
    announceMove(scope, key, next);
    return true;
  }

  function commit() {
    if (!dirty.current) return;
    dirty.current = false;
    void persist(latest.current, false);
  }

  function handleKeyDown(scope: Scope, key: HomeModuleKey, event: KeyboardEvent<HTMLButtonElement>) {
    const list = scope === "arrange" ? latest.current.filter((item) => item.shown) : latest.current;
    const at = list.findIndex((item) => item.key === key);
    const to = event.key === "ArrowUp" ? at - 1 : event.key === "ArrowDown" ? at + 1 : event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    pendingFocus.current = `${scope}:${key}`;
    if (moveTo(scope, key, to)) commit();
  }

  function handlePointerDown(scope: Scope, key: HomeModuleKey, event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging({ scope, key });
  }

  function handlePointerMove(scope: Scope, key: HomeModuleKey, event: PointerEvent<HTMLButtonElement>) {
    if (!dragging || dragging.scope !== scope || dragging.key !== key) return;
    const list = scope === "arrange" ? latest.current.filter((item) => item.shown) : latest.current;
    let target = 0;
    for (const item of list) {
      if (item.key === key) continue;
      const element = itemRefs.current.get(`${scope}:${item.key}`);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      if (event.clientY > box.top + box.height / 2) target += 1;
    }
    moveTo(scope, key, target);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null);
    commit();
  }

  function toggle(key: HomeModuleKey, shown: boolean) {
    const next = latest.current.map((item) => (item.key === key && item.hideable ? { ...item, shown } : item));
    apply(next);
    void persist(next, true);
  }

  /** Adds or removes one Quick links pick; the list lives on the quick-links entry and saves right away. */
  function togglePick(linkKey: string, picked: boolean) {
    const next = latest.current.map((item) => {
      if (item.key !== "quick-links") return item;
      const current = item.links ?? [];
      const links = picked ? (current.includes(linkKey) || current.length >= QUICK_LINKS_MAX ? current : [...current, linkKey]) : current.filter((key) => key !== linkKey);
      return { ...item, links };
    });
    apply(next);
    void persist(next, false);
  }

  function reset() {
    void persist(latest.current, true, resetAction, () => setMessage("Home reset to the default layout"));
  }

  function handleFor(scope: Scope, item: HomeLayoutModule) {
    return (
      <button
        type="button"
        className={`icon-button ${styles.handle}`}
        aria-label={`Move ${item.label}`}
        data-handle={`${scope}:${item.key}`}
        onKeyDown={(event) => handleKeyDown(scope, item.key, event)}
        onPointerDown={(event) => handlePointerDown(scope, item.key, event)}
        onPointerMove={(event) => handlePointerMove(scope, item.key, event)}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripVertical aria-hidden="true" size={20} />
      </button>
    );
  }

  const registerRef = (id: string) => (element: HTMLElement | null) => {
    if (element) itemRefs.current.set(id, element);
    else itemRefs.current.delete(id);
  };

  return (
    <div className={styles.board} data-testid="staff-home-board">
      <div className={styles.toolbar} role="group" aria-label="Home layout">
        <button type="button" className="secondary-button" aria-pressed={arranging} data-testid="home-arrange" onClick={() => setArranging((value) => !value)}>
          {arranging ? "Done arranging" : "Arrange"}
        </button>
        <button type="button" className="secondary-button" aria-haspopup="dialog" data-testid="home-customize" onClick={() => setCustomizing(true)}>
          Customize
        </button>
      </div>
      {arranging ? <p className={styles.hint}>Drag a handle, or focus it and use the up and down arrow keys. Changes save as you go.</p> : null}
      {error ? <p className={styles.error} role="alert" data-testid="home-layout-error">{error}</p> : null}
      <ul className={styles.cards}>
        {shownModules.map((item) => (
          <li
            key={item.key}
            ref={registerRef(`arrange:${item.key}`)}
            className={styles.card}
            data-module={item.key}
            data-arranging={arranging ? "true" : undefined}
            data-dragging={dragging?.scope === "arrange" && dragging.key === item.key ? "true" : undefined}
          >
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{item.label}</h2>
              {arranging ? handleFor("arrange", item) : null}
            </div>
            <div className={styles.cardBody}>
              {item.key === "quick-links"
                ? <QuickLinksBody picks={item.links ?? []} options={quickLinkOptions} onPick={() => setCustomizing(true)} />
                : bodies[item.key] ?? <p className={styles.loading}>Loading {item.label}</p>}
            </div>
          </li>
        ))}
      </ul>
      <div className="sr-only" role="status" aria-live="polite" data-testid="home-layout-announcer">{message}</div>
      {customizing ? (
        <>
          <div className={styles.scrim} onClick={() => setCustomizing(false)} aria-hidden="true" />
          <div ref={dialogRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="home-customize-title" tabIndex={-1} data-testid="home-customize-panel">
            <div className={styles.panelHead}>
              <h2 id="home-customize-title" className={styles.panelTitle}>Customize Home</h2>
            </div>
            <div className={styles.panelBody}>
              <p className={styles.hint}>Choose what shows on Home and in what order. Hidden modules keep their place. Changes save right away.</p>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
              <ul className={styles.moduleList}>
                {modules.map((item) => (
                  <li
                    key={item.key}
                    ref={registerRef(`customize:${item.key}`)}
                    className={styles.moduleRow}
                    data-dragging={dragging?.scope === "customize" && dragging.key === item.key ? "true" : undefined}
                  >
                    {handleFor("customize", item)}
                    <label className={styles.moduleLabel}>
                      <input
                        type="checkbox"
                        checked={item.shown}
                        disabled={!item.hideable}
                        onChange={(event) => toggle(item.key, event.target.checked)}
                      />
                      <span>{item.label}</span>
                      {!item.hideable ? <span className={styles.always}>Always shown</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
              {quickLinksModule && quickLinkOptions.length > 0 ? (
                <fieldset className={styles.picks}>
                  <legend className={styles.picksTitle}>Quick links to show</legend>
                  <p className={styles.hint}>Up to {QUICK_LINKS_MAX} pages you can open.</p>
                  {quickLinkOptions.map((option) => {
                    const picked = (quickLinksModule.links ?? []).includes(option.key);
                    return (
                      <label key={option.key} className={styles.pickLabel}>
                        <input
                          type="checkbox"
                          checked={picked}
                          disabled={!picked && (quickLinksModule.links ?? []).length >= QUICK_LINKS_MAX}
                          onChange={(event) => togglePick(option.key, event.target.checked)}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
            </div>
            <div className={styles.panelFoot}>
              <button type="button" className="secondary-button" onClick={reset}>Reset to default</button>
              <button type="button" className="primary-button" onClick={() => setCustomizing(false)}>Close</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

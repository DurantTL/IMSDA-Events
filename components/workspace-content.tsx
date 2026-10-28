"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Text searches keep their input focus and do not repeatedly animate the results as someone types. */
export function workspacePageKey(pathname: string | null, search: { get(name: string): string | null }) {
  const context = new URLSearchParams();
  for (const name of ["event", "year", "view", "tab", "section", "page"]) {
    const value = search.get(name);
    if (value) context.set(name, value);
  }
  return `${pathname ?? ""}?${context}`;
}

/** Same content element as the shell, never keyed/remounted. Opacity leaves dialogs, focus and layout in place. */
export function WorkspaceContent({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const previousPage = useRef(pageKey);

  useEffect(() => {
    const content = element.current;
    if (!content) return;
    const preference = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let animation: Animation | null = null;
    const arrive = () => {
      animation?.cancel();
      if (!preference || preference.matches || typeof content.animate !== "function") return;
      animation = content.animate([{ opacity: 0.86 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
    };
    let loading = content.querySelector("[data-workspace-loading]") !== null;
    if (previousPage.current !== pageKey && !loading) arrive();
    previousPage.current = pageKey;

    // A streamed page may arrive after its URL commits: fade the real content when the fallback leaves.
    const observer = new MutationObserver(() => {
      const nextLoading = content.querySelector("[data-workspace-loading]") !== null;
      if (loading && !nextLoading) arrive();
      loading = nextLoading;
    });
    observer.observe(content, { childList: true, subtree: true });
    const stopMotion = () => { if (preference?.matches) animation?.cancel(); };
    preference?.addEventListener("change", stopMotion);
    return () => {
      observer.disconnect();
      preference?.removeEventListener("change", stopMotion);
      animation?.cancel();
    };
  }, [pageKey]);

  return <div className="workspace-content" id="workspace-content" ref={element}>{children}</div>;
}

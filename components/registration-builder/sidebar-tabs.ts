// The sidebar's tabs (#1132): which exist, which opens when a question is selected,
// and where arrow keys move. Pure, so the rules are testable without a browser.

export type SidebarTab = "questions" | "settings" | "rules" | "form-settings" | "history";
// Every panel the sidebar can hold, in tab order. A new panel (Caleb wants to keep adding modules, #1139) is one more entry
// here and one more `SidebarTabDefinition` in the shell; nothing else about the sidebar changes.
export const sidebarTabOrder: readonly SidebarTab[] = ["questions", "settings", "rules", "form-settings", "history"];

/**
 * Selecting a question, by any route, opens Question settings. Clearing the selection leaves the tab alone,
 * and so does an unchanged selection (a re-render must not pull someone back from Questions).
 */
export function tabAfterSelectionChange(current: SidebarTab, previousFieldId: string | null, nextFieldId: string | null): SidebarTab {
  return nextFieldId && nextFieldId !== previousFieldId ? "settings" : current;
}

/** The tab index an arrow, Home or End key moves to, wrapping at the ends; null for any other key. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": return (index + 1) % count;
    case "ArrowLeft": return (index - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

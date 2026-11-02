"use client";

import { createContext, useContext } from "react";
import type { HelpViewer } from "@/modules/help/visibility";

/**
 * The staff viewer as the shell already knows it (system administrator, selected event, that event's permissions),
 * shared with the pages below it (#1435). Setup help uses it to offer a Help guide link only when the viewer may open
 * that guide, and a Set up link only when the viewer's permission opens the page. It grants nothing: every page and
 * every guide still checks on the server. No provider (a test, a page outside the shell) means "unknown", so no
 * guide link and no cross-page link is offered.
 */
const StaffViewerContext = createContext<HelpViewer | null>(null);

export const StaffViewerProvider = StaffViewerContext.Provider;

export function useStaffViewer(): HelpViewer | null {
  return useContext(StaffViewerContext);
}

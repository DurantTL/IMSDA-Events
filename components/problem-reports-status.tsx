"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * One polite status region for the Problem reports page (#1483). It lives at page level, outside the list, so it is still
 * there when a refresh turns a row into "Completed" and removes that row's button. A button writes to it with `announce`.
 */
const AnnounceContext = createContext<(message: string) => void>(() => {});

export function useProblemReportAnnouncer() {
  return useContext(AnnounceContext);
}

export function ProblemReportsStatusProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  return (
    <AnnounceContext.Provider value={setMessage}>
      {children}
      <div className="sr-only" role="status">{message}</div>
    </AnnounceContext.Provider>
  );
}

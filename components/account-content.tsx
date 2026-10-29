"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceContent, workspacePageKey } from "@/components/workspace-content";

/** The same mounted content surface and reduced-motion behavior as the staff shell. */
export function AccountContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  return <WorkspaceContent className="account-content" id="account-content" pageKey={workspacePageKey(pathname, search)}>{children}</WorkspaceContent>;
}

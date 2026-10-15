import "server-only";

import { redirect } from "next/navigation";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";

export const UNIFIED_SIGN_IN_PATH = "/sign-in";

/**
 * `/sign-in` with the old page's query string carried over (`next`, `error`).
 * Only single string values are carried; a repeated parameter is dropped, as the
 * old pages already do. Pure, so it is tested without a request.
 */
export function unifiedSignInPathFor(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const key of ["next", "error"] as const) {
    const value = params[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `${UNIFIED_SIGN_IN_PATH}?${text}` : UNIFIED_SIGN_IN_PATH;
}

/**
 * For `/login` and `/account/sign-in` (#554, ADR 0013, slice (c)): with the
 * one-sign-in switch on they send everyone to `/sign-in`; with it off they do
 * nothing and the old page renders exactly as before. The switch is read per
 * request. A failure to read it counts as off, so the old pages stay usable.
 */
export async function redirectToUnifiedSignInWhenEnabled(
  params: Record<string, string | string[] | undefined>,
): Promise<void> {
  let enabled = false;
  try {
    enabled = await isUnifiedSignInEnabled();
  } catch {
    enabled = false;
  }
  if (enabled) redirect(unifiedSignInPathFor(params));
}

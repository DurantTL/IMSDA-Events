import { headers } from "next/headers";

/**
 * The CSP nonce `proxy.ts` set on this request (#1401), for a script tag a
 * server component renders. Reading request headers also makes the page
 * dynamic, which a nonce requires.
 */
export async function getRequestNonce() {
  return (await headers()).get("x-nonce") ?? undefined;
}

import "server-only";

import { headers } from "next/headers";
import { REQUEST_TARGET_HEADER } from "@/modules/access/login-routing";
import { attendeeSignInPathFor, signInCodePathFor, twoStepPathFor } from "@/modules/attendee-accounts/return-destination";

async function requestTarget(): Promise<string | null> {
  try {
    return (await headers()).get(REQUEST_TARGET_HEADER);
  } catch {
    return null;
  }
}

/** Where a signed-out request to an account page goes: sign-in, then back here (#568). */
export async function attendeeSignInRedirectPath(): Promise<string> {
  return attendeeSignInPathFor(await requestTarget());
}

/** Where a request that still owes the second step goes: the challenge, then back here (#568). */
export async function twoStepRedirectPath(): Promise<string> {
  return twoStepPathFor(await requestTarget());
}

/** Where a request that still owes the emailed sign-in code goes: the code page, then back here (#1410). */
export async function signInCodeRedirectPath(): Promise<string> {
  return signInCodePathFor(await requestTarget());
}

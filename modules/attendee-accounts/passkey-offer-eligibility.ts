import "server-only";

import { getPrisma } from "@/lib/prisma";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { passkeysConfigured } from "@/modules/attendee-accounts/passkeys";
import { passkeyOfferEligible } from "@/modules/attendee-accounts/passkey-offer";
import { resolveStation } from "@/modules/checkin-stations/repository";

/** Computed on the server for the registration page; the browser only adds its own support check. */
export async function passkeyOfferForPage() {
  const { account, via } = await getCurrentAttendee();
  if (!account) return false;
  const [passkeysOn, passkeyCount, station] = await Promise.all([
    passkeysConfigured(),
    getPrisma().attendeePasskey.count({ where: { accountId: account.id, revokedAt: null } }),
    resolveStation(),
  ]);
  return passkeyOfferEligible({ passkeysOn, signedInAs: via, passkeyCount, onCheckInStation: Boolean(station) });
}

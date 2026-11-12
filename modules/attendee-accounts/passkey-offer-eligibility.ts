import "server-only";

import { cookies } from "next/headers";
import { getPrisma } from "@/lib/prisma";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { passkeysConfigured } from "@/modules/attendee-accounts/passkeys";
import { passkeyOfferEligible } from "@/modules/attendee-accounts/passkey-offer";
import { CHECK_IN_STATION_COOKIE_NAME } from "@/modules/checkin-stations/domain";

/** Computed on the server for the registration page; the browser only adds its own support check. */
export async function passkeyOfferForPage() {
  // Any station cookie marks a check-in station device, even one whose station has since ended.
  const onCheckInStation = Boolean((await cookies()).get(CHECK_IN_STATION_COOKIE_NAME)?.value);
  const { account, via } = await getCurrentAttendee();
  if (!account || onCheckInStation) return false;
  const [passkeysOn, passkeyCount] = await Promise.all([
    passkeysConfigured(),
    getPrisma().attendeePasskey.count({ where: { accountId: account.id, revokedAt: null } }),
  ]);
  return passkeyOfferEligible({ passkeysOn, signedInAs: via, passkeyCount, onCheckInStation });
}

import { cookies } from "next/headers";
import { logError } from "@/lib/logger";
import { signOutThisBrowser } from "@/modules/account-merge/sign-out";
import { CHECK_IN_STATION_COOKIE_NAME } from "@/modules/checkin-stations/domain";
import { stationJson, stationPostHandler } from "@/modules/checkin-stations/http";
import { stopStation } from "@/modules/checkin-stations/repository";

/**
 * A deliberate Stop (#1577) stops the station and signs this device's staff session out, the same way the normal
 * sign-out does. A station that is already stopped answers 401 before this runs, so that case never signs anyone out.
 * Every cookie, the station's included, is cleared through `cookies()`, which Next merges into this response.
 */
export const POST = stationPostHandler({}, async ({ station }) => {
  await stopStation(station);
  let signedOut = false;
  try {
    signedOut = await signOutThisBrowser("staff");
  } catch (error) {
    logError("Signing out at station stop failed", error);
  }
  // The station is stopped and the cookies are cleared either way; a failed revoke is logged by the sign-out.
  // Cleared through the same store as the sign-out's cookies: Next rewrites a raw Set-Cookie header once the store
  // has changes, which would drop Max-Age.
  (await cookies()).set(CHECK_IN_STATION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  return stationJson({ stopped: true, signedOut });
});

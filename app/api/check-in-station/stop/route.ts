import { logError } from "@/lib/logger";
import { signOutThisBrowser } from "@/modules/account-merge/sign-out";
import { CHECK_IN_STATION_COOKIE_NAME } from "@/modules/checkin-stations/domain";
import { stationJson, stationPostHandler } from "@/modules/checkin-stations/http";
import { stopStation } from "@/modules/checkin-stations/repository";

/**
 * A deliberate Stop (#1577) stops the station and signs this device's staff session out, the same way the normal
 * sign-out does. A station that is already stopped answers 401 before this runs, so that case never signs anyone out.
 * The sign-out clears its cookies through `cookies()`, which Next merges into this response next to the station cookie.
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
  const response = stationJson({ stopped: true, signedOut });
  response.headers.append(
    "Set-Cookie",
    `${CHECK_IN_STATION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return response;
});

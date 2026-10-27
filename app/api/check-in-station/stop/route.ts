import { CHECK_IN_STATION_COOKIE_NAME } from "@/modules/checkin-stations/domain";
import { stationJson, stationPostHandler } from "@/modules/checkin-stations/http";
import { stopStation } from "@/modules/checkin-stations/repository";

export const POST = stationPostHandler({}, async ({ station }) => {
  await stopStation(station);
  const response = stationJson({ stopped: true });
  response.headers.append(
    "Set-Cookie",
    `${CHECK_IN_STATION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return response;
});

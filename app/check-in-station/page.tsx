import type { Metadata } from "next";
import { CheckInStationScreen } from "@/components/check-in-station";
import { STATION_INACTIVE_MESSAGE } from "@/modules/checkin-stations/domain";
import { resolveStation } from "@/modules/checkin-stations/repository";
import styles from "@/components/check-in-station.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check-in station",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The staff-run check-in station (#892). It lives outside the staff workspace on purpose: it never reads the staff
 * session and never redirects to sign-in. A device is only a station while its own cookie names an active one.
 */
export default async function CheckInStationPage() {
  const station = await resolveStation();
  if (!station) {
    return (
      <main className={styles.cisShell}>
        <section className={styles.cisCard}>
          <h1>Check-in station</h1>
          <p>{STATION_INACTIVE_MESSAGE}</p>
        </section>
      </main>
    );
  }
  return (
    <CheckInStationScreen
      eventName={station.eventName}
      stationLabel={station.station.label}
      canRecordPayments={station.capabilities.canRecordPayments}
    />
  );
}

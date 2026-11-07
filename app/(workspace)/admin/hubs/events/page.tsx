import type { Metadata } from "next";
import { AdminHubPage } from "../hub-page";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

export default function AdminHubEventsPage() {
  return <AdminHubPage hub="events" />;
}

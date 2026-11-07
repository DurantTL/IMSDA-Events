import type { Metadata } from "next";
import { AdminHubPage } from "../hub-page";

export const metadata: Metadata = { title: "Clubs" };
export const dynamic = "force-dynamic";

export default function AdminHubClubsPage() {
  return <AdminHubPage hub="clubs" />;
}

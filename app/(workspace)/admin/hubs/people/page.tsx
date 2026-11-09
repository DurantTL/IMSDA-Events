import type { Metadata } from "next";
import { AdminHubPage } from "../hub-page";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default function AdminHubPeoplePage() {
  return <AdminHubPage hub="people" />;
}

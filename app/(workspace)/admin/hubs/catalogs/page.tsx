import type { Metadata } from "next";
import { AdminHubPage } from "../hub-page";

export const metadata: Metadata = { title: "Catalogs and settings" };
export const dynamic = "force-dynamic";

export default function AdminHubCatalogsPage() {
  return <AdminHubPage hub="catalogs" />;
}

import type { Metadata } from "next";
import { AdminHubPage } from "../hub-page";

export const metadata: Metadata = { title: "Forms" };
export const dynamic = "force-dynamic";

export default function AdminHubFormsPage() {
  return <AdminHubPage hub="forms" />;
}

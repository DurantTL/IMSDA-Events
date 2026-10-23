import type { Metadata } from "next";
import { connection } from "next/server";
import { InformationFormPublicPage } from "@/components/information-form-public-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Event form",
  robots: { index: false, follow: false },
};

/** An event information form's public address (#1150). The event must itself be public. */
export default async function EventInformationFormPage({ params }: { params: Promise<{ eventSlug: string; slug: string }> }) {
  await connection();
  const { eventSlug, slug } = await params;
  return <InformationFormPublicPage target={{ slug, eventSlug }} />;
}

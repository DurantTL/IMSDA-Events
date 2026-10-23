import type { Metadata } from "next";
import { connection } from "next/server";
import { InformationFormPublicPage } from "@/components/information-form-public-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Form",
  robots: { index: false, follow: false },
};

/** A general information form's public address (#1150). */
export default async function GeneralInformationFormPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  return <InformationFormPublicPage target={{ slug }} />;
}

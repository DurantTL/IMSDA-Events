import type { Metadata } from "next";
import { renderPublicClubForms } from "@/components/public-club-forms-view";
import { getPublishedPublicClubFormsSettings } from "@/modules/club-forms/public-index-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Club forms",
  description: "Pathfinder club forms for the Iowa-Missouri Conference, by when in the year they are used and who fills them in.",
  alternates: { canonical: "/clubs/forms" },
  robots: { index: true, follow: true },
};

/** The public Club forms list (#1221), drawn from the published staff settings (#1562). See `renderPublicClubForms`. */
export default async function PublicClubFormsPage() {
  return renderPublicClubForms(await getPublishedPublicClubFormsSettings());
}

import type { Metadata } from "next";
import { PublicHomePage } from "@/components/public-home-page";
import { getPublishedHubContent } from "@/modules/site-content/hub-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IMSDA Events",
  description: "Register for Iowa-Missouri Conference events, manage your club, and see the conference calendar.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

/**
 * The public front door (#373, #1251, #111). It draws the published hub content through `PublicHomePage`, the same
 * component the staff preview draws the draft with. With nothing published the content is the built-in default.
 */
export default async function Home() {
  // Called as a function (not rendered as an element) so the page stays one plain async component.
  return PublicHomePage({ content: await getPublishedHubContent() });
}

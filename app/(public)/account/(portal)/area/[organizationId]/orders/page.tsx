import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Club Orders are not an Area Coordinator's to see (owner decision, Oct 14, 2026; #918). This
 * route used to show a club's order helper list and supplies view-only. It now answers 404 to
 * everyone, and the loaders behind it (`/api/attendee/clubs/<id>/orders`, `.../supplies`,
 * `.../uniforms`) refuse an Area Coordinator too (`requireClubOrdersAccess`). A club's own
 * Orders screen is under `/account/clubs/<id>/orders`.
 */
export default function AreaClubOrdersPage() {
  notFound();
}

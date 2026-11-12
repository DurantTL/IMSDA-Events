import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { NavigationLink as Link } from "@/components/navigation-link";
import { TltListsEditor } from "@/components/tlt-lists-editor";
import { currentTltDirector } from "@/modules/tlt-directory/access";
import { listTltLists } from "@/modules/tlt-directory/repository";

export const metadata: Metadata = { title: "TLT lists", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/** The TLT director's two managed lists (#1686): position types and help-area tags. Same gate as the directory. */
export default async function TltListsPage() {
  if (!(await currentTltDirector())) notFound();
  const lists = await listTltLists();
  return (
    <section className="public-manage-card page-stack">
      <CoordinatorSectionHeading eyebrow="TLT directory" title="Position types and tags">
        <p>Add, rename or retire. A retired entry stays on the TLTs who have it and is no longer offered for new choices. Nothing is deleted.</p>
      </CoordinatorSectionHeading>
      <p><Link className="secondary-button" href="/account/area-clubs/tlt">Back to the directory</Link></p>
      <TltListsEditor positions={lists.positions} tags={lists.tags} />
    </section>
  );
}

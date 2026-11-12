import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { NavigationLink as Link } from "@/components/navigation-link";
import { TltMoveUp } from "@/components/tlt-move-up";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { currentTltDirector } from "@/modules/tlt-directory/access";
import { readTltMoveUp } from "@/modules/tlt-directory/repository";

export const metadata: Metadata = { title: "TLT year move-up", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/** The club-year move-up review (#1686): the TLT director sees the proposed moves and confirms. Same gate as the directory. */
export default async function TltMoveUpPage() {
  if (!(await currentTltDirector())) notFound();
  const plan = await readTltMoveUp();
  return (
    <section className="public-manage-card page-stack">
      <CoordinatorSectionHeading eyebrow={`Club year ${yearLabel(plan.clubYear)}`} title="TLT year move-up">
        <p>At the start of a club year, each TLT can move up one year. Check the list, untick anyone who should stay, then confirm. Nothing moves until you confirm.</p>
      </CoordinatorSectionHeading>
      <p><Link className="secondary-button" href="/account/area-clubs/tlt">Back to the directory</Link></p>
      <TltMoveUp plan={plan} />
    </section>
  );
}

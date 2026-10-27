import { screenshotCaption, screenshotIsStale, screenshotStaleNote } from "@/modules/help/screenshot";
import type { GuideScreenshot } from "@/modules/help/types";
import styles from "@/app/(workspace)/help/help.module.css";

/** A synthetic screenshot under a guide's steps (#1259), always labelled as sample data, with a stale note when due. */
export function GuideScreenshotFigure({ guide }: { guide: { lastReviewed: string; screenshot?: GuideScreenshot } }) {
  const shot = guide.screenshot;
  if (!shot) return null;
  return (
    <figure className={styles.figure}>
      {/* A small static file from public/: next/image optimization adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={shot.alt} className={styles.figureImage} height={450} loading="lazy" src={shot.src} width={800} />
      <figcaption className={styles.figureCaption}>
        {screenshotCaption}
        {screenshotIsStale(guide) && <span className={styles.figureStale}> {screenshotStaleNote}</span>}
      </figcaption>
    </figure>
  );
}

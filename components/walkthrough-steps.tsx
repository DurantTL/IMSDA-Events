import { screenshotCaption, screenshotStaleNote } from "@/modules/help/screenshot";
import { walkthroughDesktopMinWidth, walkthroughImage } from "@/modules/help/walkthrough-images";
import type { WalkthroughStep } from "@/modules/help/types";
import styles from "@/app/(workspace)/help/help.module.css";

/**
 * The Steps of a walkthrough guide (#1482): the usual numbered list, each step a short instruction followed by a picture of
 * the real screen. Phones get the phone picture and wider screens the desktop one. Every picture is labelled as sample data,
 * and says so when the guide was reviewed after the pictures were captured (same note as a single screenshot).
 */
export function WalkthroughSteps({ guideId, steps, lastReviewed, capturedFor }: { guideId: string; steps: readonly WalkthroughStep[]; lastReviewed: string; capturedFor: string | null }) {
  const stale = capturedFor === null || lastReviewed > capturedFor;
  return (
    <ol className={styles.steps}>
      {steps.map((step, index) => {
        const phone = walkthroughImage(guideId, index, step.id, "phone");
        const desktop = walkthroughImage(guideId, index, step.id, "desktop");
        return (
          <li className={styles.stepWithPicture} key={step.id}>
            <span>{step.text}</span>
            <figure className={styles.figure}>
              <picture>
                <source media={`(min-width: ${walkthroughDesktopMinWidth}px)`} srcSet={desktop.src} width={desktop.width} height={desktop.height} />
                {/* A small static file from public/: next/image optimization adds nothing here. */}
                <img alt={step.alt} className={styles.figureImage} height={phone.height} loading="lazy" src={phone.src} width={phone.width} />
              </picture>
              <figcaption className={styles.figureCaption}>
                {screenshotCaption}
                {stale && <span className={styles.figureStale}> {screenshotStaleNote}</span>}
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ol>
  );
}

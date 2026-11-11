/**
 * Guide example pictures (#1885): the single picture under a guide's steps (`screenshot` in `portal-guides.ts`), taken in the
 * walkthrough style (#1869): a phone-size crop with the purple outline and numbered gold ring on the control one guide step names.
 * `npm run help:screenshots` retakes each one while it runs the walkthrough it borrows its screen from, so the picture always
 * comes from the seeded synthetic database. Pure data: the capture script and the tests read it.
 */
export type GuideExamplePicture = {
  guideId: string;
  /** The walkthrough (and its step) whose screen and marked control the picture shows. */
  walkthroughId: string;
  stepId: string;
  /** The number of the guide step the mark points to, 1-based, so the ring matches the guide's own list. */
  guideStepNumber: number;
  /** Site path of the picture under `public/`. */
  src: string;
};

export const guideExamplePictures: readonly GuideExamplePicture[] = [
  {
    guideId: "director-monthly-record",
    walkthroughId: "walkthrough-director-monthly-records",
    stepId: "open-month",
    guideStepNumber: 3,
    src: "/help/monthly-records-example.webp",
  },
];

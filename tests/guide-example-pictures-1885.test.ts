import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guideExamplePictures } from "@/modules/help/guide-example-pictures";
import { portalGuides } from "@/modules/help/portal-guides";
import { findWalkthrough } from "@/modules/help/walkthroughs";
import { walkthroughImageFileSize, walkthroughImageBudgets } from "@/modules/help/walkthrough-images";

/** Guide example pictures (#1885): retaken in the walkthrough style by `npm run help:screenshots`. */
describe("guide example pictures", () => {
  it.each(guideExamplePictures)("$guideId matches its guide, its walkthrough step and the phone picture size", (example) => {
    const guide = portalGuides.find((item) => item.id === example.guideId)!;
    const file = walkthroughImageFileSize("phone");
    expect(guide.screenshot).toMatchObject({ src: example.src, width: file.width, height: file.height });
    expect(guide.steps[example.guideStepNumber - 1]).toBeTruthy();
    expect(guide.screenshot!.alt).toContain(`marked ${example.guideStepNumber}`);
    expect(findWalkthrough(example.walkthroughId)!.steps.map((step) => step.id)).toContain(example.stepId);
    const path = join(process.cwd(), "public", example.src);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).length).toBeLessThan(walkthroughImageBudgets.phone.target);
  });
});

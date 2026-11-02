import manifest from "@/public/help/walkthroughs/manifest.json";
import type { WalkthroughManifest } from "@/modules/help/walkthrough-check";

/** The manifest the capture script wrote, bundled so a guide page can say when its pictures were captured. */
export const walkthroughManifest: WalkthroughManifest = manifest;

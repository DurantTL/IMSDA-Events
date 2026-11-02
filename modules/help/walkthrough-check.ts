import type { WalkthroughDefinition } from "@/modules/help/walkthroughs";

/**
 * The stale-picture warning for walkthroughs (#1482). Pure: it compares the manifest the capture script wrote
 * (`public/help/walkthroughs/manifest.json`) with hashes of the source files as they are now. `npm run help:check` prints the
 * result as warnings: a changed page should prompt `npm run help:screenshots`, not fail an unrelated pull request.
 */
export type WalkthroughManifestEntry = {
  /** `YYYY-MM-DD` the pictures were captured. */
  capturedFor: string;
  /** sha256 over the walkthrough's declared source files (sorted path + content) when it was captured. */
  sourceHash: string;
};

export type WalkthroughManifest = Record<string, WalkthroughManifestEntry>;

export type WalkthroughWarningKind = "not-captured" | "stale-pictures" | "missing-source";

export type WalkthroughWarning = {
  walkthroughId: string;
  kind: WalkthroughWarningKind;
  message: string;
};

export function checkWalkthroughManifest(input: {
  walkthroughs: readonly Pick<WalkthroughDefinition, "id">[];
  manifest: WalkthroughManifest;
  /** The hash of each walkthrough's source files now, or null when one of the declared files does not exist. */
  currentHashes: Record<string, string | null>;
}): WalkthroughWarning[] {
  const warnings: WalkthroughWarning[] = [];
  for (const { id } of input.walkthroughs) {
    const entry = input.manifest[id];
    const current = input.currentHashes[id];
    if (current === null || current === undefined) {
      warnings.push({ walkthroughId: id, kind: "missing-source", message: `Walkthrough "${id}" lists a source file that does not exist. Fix sourceFiles in modules/help/walkthroughs.ts.` });
      continue;
    }
    if (!entry) {
      warnings.push({ walkthroughId: id, kind: "not-captured", message: `Walkthrough "${id}" has no entry in the screenshot manifest. Run: npm run help:screenshots` });
    } else if (entry.sourceHash !== current) {
      warnings.push({ walkthroughId: id, kind: "stale-pictures", message: `Walkthrough "${id}": the pages it shows changed since its pictures were captured on ${entry.capturedFor}. Run: HELP_SHOTS_ONLY=${id} npm run help:screenshots` });
    }
  }
  return warnings;
}

/** The date a walkthrough's pictures were captured, or null when it has none. */
export function walkthroughCapturedFor(manifest: WalkthroughManifest, id: string): string | null {
  const value = manifest[id]?.capturedFor;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WalkthroughManifest } from "@/modules/help/walkthrough-check";
import { walkthroughImageRoot } from "@/modules/help/walkthrough-images";
import type { WalkthroughDefinition } from "@/modules/help/walkthroughs";

/** Node only: reads the source files and manifest for the stale-picture warning and the capture script. */

/** sha256 over the declared source files: each sorted path and its content. Null when a declared file is missing. */
export function walkthroughSourceHash(definition: Pick<WalkthroughDefinition, "sourceFiles">, root = process.cwd()): string | null {
  const hash = createHash("sha256");
  for (const file of [...definition.sourceFiles].sort()) {
    const full = join(root, file);
    if (!existsSync(full) || !statSync(full).isFile()) return null;
    hash.update(`${file}\0`);
    hash.update(readFileSync(full));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export const walkthroughManifestFile = (root = process.cwd()) => join(root, "public", walkthroughImageRoot, "manifest.json");

export function readWalkthroughManifest(root = process.cwd()): WalkthroughManifest {
  const file = walkthroughManifestFile(root);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as WalkthroughManifest) : {};
  } catch {
    return {};
  }
}

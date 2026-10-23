// The version-state chips in the editor's top bar (#1139). Always text, and a
// live version and a newer draft are both shown when both exist.
import type { FormVersionView } from "./builder-types";

export type VersionChipKind = "live" | "draft" | "withdrawn" | "viewing-old" | "unsaved";
export type VersionChip = { kind: VersionChipKind; text: string };

type VersionLike = Pick<FormVersionView, "status" | "versionNumber">;

export function versionStateChips({ versions, selected, isHistorical, dirty }: {
  versions: VersionLike[];
  selected: VersionLike;
  isHistorical: boolean;
  dirty: boolean;
}): VersionChip[] {
  const chips: VersionChip[] = [];
  const live = versions.find((version) => version.status === "PUBLISHED");
  const draft = versions.find((version) => version.status === "DRAFT");
  if (isHistorical) chips.push({ kind: "viewing-old", text: `Viewing old version ${selected.versionNumber} (read-only)` });
  if (live) chips.push({ kind: "live", text: `Live (version ${live.versionNumber})` });
  if (draft) chips.push({ kind: "draft", text: `Draft (version ${draft.versionNumber})` });
  // Nothing live and no draft: the open version is archived, which the page calls withdrawn, and still has to be named.
  if (!isHistorical && !live && !draft) chips.push({ kind: "withdrawn", text: `Withdrawn (version ${selected.versionNumber})` });
  if (dirty) chips.push({ kind: "unsaved", text: "Unsaved changes" });
  return chips;
}

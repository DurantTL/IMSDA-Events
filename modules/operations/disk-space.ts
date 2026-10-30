import "server-only";

import { statfs } from "node:fs/promises";
import path from "node:path";
import { storageRoot } from "@/modules/events/asset-storage";

/**
 * Free space on the disk the uploads live on (#1357). Only a percentage and a size ever leave this file: never the
 * path. The directory is the uploads root (`ASSET_STORAGE_DIR`); backups are written by a separate container, so this
 * is the disk the app itself writes to. If the uploads directory does not exist yet, the app's working directory is
 * on the same volume in a normal deployment, so it is read instead.
 */
export type DiskSpace = { percentFree: number; freeBytes: number; totalBytes: number };

type StatFs = (target: string) => Promise<{ bavail: number | bigint; blocks: number | bigint; bsize: number | bigint }>;

export async function readDiskSpace(read: StatFs = statfs, directory: string = storageRoot()): Promise<DiskSpace> {
  let stats;
  try {
    stats = await read(directory);
  } catch {
    stats = await read(path.resolve(/*turbopackIgnore: true*/ process.cwd()));
  }
  const blocks = Number(stats.blocks);
  const free = Number(stats.bavail) * Number(stats.bsize);
  const total = blocks * Number(stats.bsize);
  if (!Number.isFinite(blocks) || !Number.isFinite(free) || blocks <= 0 || total <= 0) {
    throw new Error("The disk reported no usable size.");
  }
  return { percentFree: (free / total) * 100, freeBytes: free, totalBytes: total };
}

/**
 * Paging across ordered runs (#1492). Some orders cannot be written as one database `orderBy` (rows with no category last;
 * a status worked out from several columns). Each run is queried on its own, and a page is a window over the runs laid end
 * to end: given how many rows each run holds, this says which slice of which run makes up rows `skip` to `skip + take`.
 * Pure, so the paging maths is testable without a database.
 */
export type SegmentWindow = { segment: number; skip: number; take: number };

export function segmentWindows(counts: readonly number[], skip: number, take: number): SegmentWindow[] {
  const windows: SegmentWindow[] = [];
  let before = 0;
  let remaining = take;
  counts.forEach((count, segment) => {
    const start = Math.max(0, skip - before);
    const available = count - start;
    before += count;
    if (remaining <= 0 || available <= 0) return;
    const size = Math.min(available, remaining);
    windows.push({ segment, skip: start, take: size });
    remaining -= size;
  });
  return windows;
}

/**
 * Pure rules for reversible soft-merges (#127). No Prisma calls: resolution
 * takes a loader so the chain, cycle and depth rules are testable without a
 * database. A merge is a link from a secondary person to a primary; reads
 * follow ACTIVE links to the ultimate primary ("canonical") person.
 */

/** Most links a read will follow (and a merge will allow beneath one primary). */
export const MAX_MERGE_CHAIN_DEPTH = 25;

export const PERSON_MERGE_REASON_MIN_LENGTH = 5;

export class PersonMergeResolutionError extends Error {
  constructor(
    public readonly code: "CYCLE" | "DEPTH_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "PersonMergeResolutionError";
  }
}

/** Maps a secondary person id to its ACTIVE primary, for the ids asked about. */
export type LinkLoader = (secondaryIds: string[]) => Promise<Map<string, string>>;

/**
 * Follows ACTIVE links from every id to its ultimate primary, one batched
 * lookup per hop. Throws (never loops) on a cycle or a chain longer than
 * `maxDepth`. An id with no link resolves to itself.
 */
export async function resolveCanonicalIds(
  personIds: string[],
  loadLinks: LinkLoader,
  maxDepth: number = MAX_MERGE_CHAIN_DEPTH,
): Promise<Map<string, string>> {
  const cursor = new Map<string, string>();
  const visited = new Map<string, Set<string>>();
  const settled = new Set<string>();
  for (const id of personIds) {
    cursor.set(id, id);
    visited.set(id, new Set([id]));
  }

  for (let hops = 0; hops <= maxDepth; hops += 1) {
    const pending = [...new Set([...cursor].filter(([id]) => !settled.has(id)).map(([, at]) => at))];
    if (pending.length === 0) break;
    const links = await loadLinks(pending);
    for (const [id, at] of cursor) {
      if (settled.has(id)) continue;
      const next = links.get(at);
      if (next === undefined) {
        settled.add(id);
        continue;
      }
      if (hops === maxDepth) {
        throw new PersonMergeResolutionError("DEPTH_EXCEEDED", `A merge chain is longer than ${maxDepth} links.`);
      }
      const seen = visited.get(id)!;
      if (seen.has(next)) {
        throw new PersonMergeResolutionError("CYCLE", "A merge cycle was found while resolving a person.");
      }
      seen.add(next);
      cursor.set(id, next);
    }
  }
  return cursor;
}

export type MergeMemberNode = { personId: string; mergeId: string; parentPersonId: string; depth: number };

/** Loads the ACTIVE merges whose primary is one of the given ids. */
export type ChildLoader = (primaryIds: string[]) => Promise<Array<{ id: string; primaryPersonId: string; secondaryPersonId: string }>>;

/**
 * Everyone merged (directly or through a chain) beneath `rootId`, breadth
 * first, with the height of that tree (0 when nothing is merged under it).
 * Throws on a cycle or a tree deeper than `maxDepth`.
 */
export async function collectMergedMembers(
  rootId: string,
  loadChildren: ChildLoader,
  maxDepth: number = MAX_MERGE_CHAIN_DEPTH,
): Promise<{ members: MergeMemberNode[]; height: number }> {
  const seen = new Set<string>([rootId]);
  const members: MergeMemberNode[] = [];
  let frontier = [rootId];
  let depth = 0;
  while (frontier.length > 0) {
    const rows = await loadChildren(frontier);
    if (rows.length === 0) break;
    depth += 1;
    if (depth > maxDepth) {
      throw new PersonMergeResolutionError("DEPTH_EXCEEDED", `A merge chain is longer than ${maxDepth} links.`);
    }
    const next: string[] = [];
    for (const row of rows) {
      if (seen.has(row.secondaryPersonId)) {
        throw new PersonMergeResolutionError("CYCLE", "A merge cycle was found while listing merged people.");
      }
      seen.add(row.secondaryPersonId);
      members.push({ personId: row.secondaryPersonId, mergeId: row.id, parentPersonId: row.primaryPersonId, depth });
      next.push(row.secondaryPersonId);
    }
    frontier = next;
  }
  return { members, height: depth };
}

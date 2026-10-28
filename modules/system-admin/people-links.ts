/**
 * When a "See all of this person's access" link may show (#1277). Pure: the caller passes who is acting and who is
 * viewing. It only decides whether to draw a link; the People & access pages gate themselves.
 */
type Actor = { kind: "ATTENDEE" } | { kind: "STAFF_ACTING"; userId: string };
type Viewer = { user: { id: string } | null; scope: "full" | "clubs" | null };

/** The club Team page: only staff acting as the club's director, and only when that staff user may open People & access. */
export function clubTeamPeopleLinkAllowed(actor: Actor, viewer: Viewer): boolean {
  return actor.kind === "STAFF_ACTING" && viewer.scope !== null && viewer.user?.id === actor.userId;
}

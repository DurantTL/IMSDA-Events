import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { ClubOrderError } from "@/modules/club-orders/repository";

/**
 * The class-history routes' errors (#1011): `clubOrderApiError`, except that a
 * person who isn't on this club's roster (or has moved away) is a 404, the
 * same answer the page gives, so another club's person is never confirmed.
 */
export function classHistoryApiError(error: unknown, action: string) {
  if (error instanceof ClubOrderError && error.code === "MEMBER_NOT_ON_ROSTER") {
    return Response.json({ error: error.code, message: error.message }, { status: 404 });
  }
  return clubOrderApiError(error, action);
}

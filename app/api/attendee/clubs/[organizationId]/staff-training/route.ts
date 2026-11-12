import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readRosterJson } from "@/modules/club-rosters/api-errors";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubStaffTrainingRateLimit } from "@/modules/rate-limit/service";
import { requireStaffTrainingAccess, staffTrainingRateLimitKey } from "@/modules/staff-training/access";
import { staffTrainingApiError } from "@/modules/staff-training/api-errors";
import { addStaffTrainingRecord } from "@/modules/staff-training/repository";
import { parseStaffTrainingAdd } from "@/modules/staff-training/schemas";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ organizationId: string }> };

/**
 * The club's director or deputy records a certification or workshop for an adult on the roster (#1697). Only while the
 * club has staff training records switched on; another club, a registrar, a reporter, an Area Coordinator and staff
 * without an act-as get a refusal. Every add is audited.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const now = new Date();
    const { actor } = await requireStaffTrainingAccess(organizationId, now);
    const rateLimit = await checkClubStaffTrainingRateLimit(request, staffTrainingRateLimitKey(actor), organizationId);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many changes. Try again later." }, { status: 429 }), rateLimit);
    }
    const input = parseStaffTrainingAdd(await readRosterJson(request), now);
    const record = await addStaffTrainingRecord(organizationId, input, actor, now);
    return applyRateLimitHeaders(Response.json({ record }, { status: 201 }), rateLimit);
  } catch (error) {
    return staffTrainingApiError(error, "Adding a staff training record");
  }
}

export const POST = withRequestContext(postHandler);

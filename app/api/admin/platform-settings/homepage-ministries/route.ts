import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getHomepageMinistriesForAdmin, updateHomepageMinistries } from "@/modules/system-admin/homepage-ministries";
import { homepageMinistriesInputSchema } from "@/modules/system-admin/homepage-ministries-domain";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/** The homepage ministry tiles (#1251): system administrators only, like the other platform-settings writes. */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can change the homepage ministries." },
    { status: 403 },
  );
}

async function getHandler() {
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  return Response.json(await getHomepageMinistriesForAdmin());
}

async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const input = homepageMinistriesInputSchema.parse(await request.json());
    return Response.json(await updateHomepageMinistries(input, user.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "INVALID_HOMEPAGE_MINISTRIES", message: error.issues[0]?.message ?? "Review the tiles and try again.", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400 });
    }
    logError("Updating the homepage ministries failed", error);
    return Response.json(
      { error: "HOMEPAGE_MINISTRIES_UPDATE_FAILED", message: "The homepage ministries could not be saved." },
      { status: 500 },
    );
  }
}

export const GET = withRequestContext(getHandler);
export const PATCH = withRequestContext(patchHandler);

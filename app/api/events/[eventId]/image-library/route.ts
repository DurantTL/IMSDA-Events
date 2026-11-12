import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { authorizeImageLibrary, imageLibraryApiError, libraryViewer } from "@/modules/events/image-library-http";
import {
  addUploadToLibrary,
  getLibraryImageRecord,
  listLibraryImages,
  listLibraryTags,
} from "@/modules/events/image-library";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string }> };

function dateParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function getHandler(request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const access = await authorizeImageLibrary(eventId);
    const params = new URL(request.url).searchParams;
    const year = Number(params.get("year"));
    const [images, tags] = await Promise.all([
      listLibraryImages(eventId, {
        q: params.get("q") ?? undefined,
        tag: params.get("tag") ?? undefined,
        year: Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : undefined,
        from: dateParam(params.get("from")),
        to: dateParam(params.get("to")),
        includeRetired: params.get("includeRetired") === "true",
      }, libraryViewer(access)),
      listLibraryTags(),
    ]);
    return Response.json({ images, tags });
  } catch (error) {
    return imageLibraryApiError(error, "Listing the image library");
  }
}

async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await authorizeImageLibrary(eventId);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "FILE_REQUIRED", message: "Choose an image to upload." }, { status: 400 });
    }
    const added = await addUploadToLibrary(file, access.user.id, eventId);
    const image = await getLibraryImageRecord(eventId, added.id, libraryViewer(access));
    return Response.json({ image, created: added.created }, { status: added.created ? 201 : 200 });
  } catch (error) {
    return imageLibraryApiError(error, "Uploading to the image library");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);

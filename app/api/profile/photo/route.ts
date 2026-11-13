import { withRequestContext } from "@/lib/request-context";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentSession } from "@/modules/access/current-session";
import { MAX_PROFILE_PHOTO_BYTES, ProfilePhotoError } from "@/modules/profile-photos/processing";
import { removeOwnProfilePhoto, saveOwnProfilePhoto } from "@/modules/profile-photos/repository";

/** Room for the multipart boundary and part headers around one photo at the size limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_UPLOAD_BODY_BYTES = MAX_PROFILE_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES;

function signedOut() {
  return Response.json({ error: "UNAUTHENTICATED", message: "Sign in to change your photo." }, { status: 401 });
}

/** The signed-in staff member's own photo: add or replace it. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { user } = await getCurrentSession();
    if (!user) return signedOut();
    // The size is checked against the declared length before the body is read.
    const declaredLength = request.headers.get("content-length");
    if (declaredLength === null || !/^\d+$/.test(declaredLength)) {
      return Response.json({ error: "LENGTH_REQUIRED", message: "The upload must state its size." }, { status: 411 });
    }
    if (Number(declaredLength) > MAX_UPLOAD_BODY_BYTES) {
      return Response.json({ error: "PHOTO_TOO_LARGE", message: "Photos must be 5 MB or smaller." }, { status: 413 });
    }
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "FILE_REQUIRED", message: "Choose a photo to upload." }, { status: 400 });
    }
    const saved = await saveOwnProfilePhoto(user.id, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ version: saved.version }, { status: 201 });
  } catch (error) {
    if (error instanceof ProfilePhotoError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.code === "TOO_LARGE" ? 413 : 422 });
    }
    logError("Saving a profile photo failed.", error);
    return Response.json({ error: "PHOTO_SAVE_FAILED", message: "The photo could not be saved. Please try again." }, { status: 500 });
  }
}

/** Removes the signed-in staff member's own photo and deletes the stored files. */
async function deleteHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { user } = await getCurrentSession();
    if (!user) return signedOut();
    await removeOwnProfilePhoto(user.id);
    return Response.json({ removed: true });
  } catch (error) {
    logError("Removing a profile photo failed.", error);
    return Response.json({ error: "PHOTO_REMOVE_FAILED", message: "The photo could not be removed. Please try again." }, { status: 500 });
  }
}

export const POST = withRequestContext(postHandler);
export const DELETE = withRequestContext(deleteHandler);

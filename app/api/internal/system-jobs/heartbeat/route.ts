import { getServerEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import {
  HOST_JOB_HEARTBEAT_MAX_BODY_BYTES,
  isAuthorizedHostJobRequest,
  parseHostJobHeartbeat,
} from "@/modules/operations/host-job-heartbeat";
import { recordJobRun } from "@/modules/operations/sweep-heartbeat-repository";

/**
 * Host job heartbeats (#1382): the server's own timers report one run each, so the System report can show them. A
 * machine endpoint like the outbox sweep: bearer token (`HOST_JOB_HEARTBEAT_TOKEN`), no session, no same-origin check.
 * Always 401 when no token is configured. Errors are generic and never echo the input.
 */
async function postHandler(request: Request) {
  if (!isAuthorizedHostJobRequest(request, getServerEnv().HOST_JOB_HEARTBEAT_TOKEN)) {
    return Response.json(
      { error: "HEARTBEAT_NOT_AUTHORIZED", message: "A valid credential is required." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  const raw = declared > HOST_JOB_HEARTBEAT_MAX_BODY_BYTES ? null : await request.text().catch(() => null);
  const heartbeat = raw === null ? null : parseHostJobHeartbeat(raw);
  if (!heartbeat) {
    return Response.json(
      { error: "HEARTBEAT_INVALID", message: "The heartbeat was not accepted." },
      { status: 400 },
    );
  }

  try {
    await recordJobRun(heartbeat.job, heartbeat.outcome, heartbeat.summary);
  } catch (error) {
    logError("Could not record a host job heartbeat", error);
    return Response.json(
      { error: "HEARTBEAT_NOT_RECORDED", message: "The heartbeat could not be recorded." },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}

export const POST = withRequestContext(postHandler);

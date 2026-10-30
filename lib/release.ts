import "server-only";

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

function cleanReleaseSha(value: string | undefined) {
  const candidate = value?.trim().split(/\s+/, 1)[0];
  return candidate && /^[a-f0-9]{7,64}$/i.test(candidate) ? candidate : null;
}

function nextBuildId() {
  try {
    const value = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

export function getReleaseIdentity(environment = process.env) {
  return {
    sha: cleanReleaseSha(
      environment.APP_RELEASE_SHA ?? environment.XCLOUD_DEPLOYED_COMMIT,
    ),
    buildId: nextBuildId(),
  };
}

/**
 * When this release went live, as far as the server can tell, without any secret: when the running process started
 * (from its uptime) and when the build was written (the modification time of `.next/BUILD_ID`). Either is `null` when
 * it cannot be read, so a caller shows it as unavailable. Kept out of `getReleaseIdentity` because `/api/health` is
 * public and returns that object whole.
 */
export function getReleaseTimes(now = new Date()) {
  const uptimeSeconds = process.uptime();
  let builtAt: Date | null = null;
  try {
    builtAt = statSync(path.join(process.cwd(), ".next", "BUILD_ID")).mtime;
  } catch {
    builtAt = null;
  }
  return {
    startedAt: Number.isFinite(uptimeSeconds) ? new Date(now.getTime() - uptimeSeconds * 1000) : null,
    builtAt,
  };
}

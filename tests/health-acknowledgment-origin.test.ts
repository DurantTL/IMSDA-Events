import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The privacy acknowledgment POST (#923) with the real `rejectCrossOriginRequest`
 * (not a mock): a cross-origin request is refused before the body is read or
 * the viewer is resolved.
 */

const state = vi.hoisted(() => ({
  ackViewer: vi.fn(),
  recordAck: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ HEALTH_RECORDS_ENABLED: true, APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/health-records/access", () => ({ resolveAcknowledgmentViewer: state.ackViewer }));
vi.mock("@/modules/health-records/acknowledgment", () => ({ recordHealthPrivacyAcknowledgment: state.recordAck }));

import * as acknowledgmentRoute from "@/app/api/health-records/acknowledgment/route";
import { HEALTH_PRIVACY_ACK_VERSION } from "@/modules/health-records/acknowledgment-domain";

function post(origin: string | null) {
  return new Request("https://events.imsda.test/api/health-records/acknowledgment", {
    method: "POST",
    body: JSON.stringify({ as: "ATTENDEE", version: HEALTH_PRIVACY_ACK_VERSION }),
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
  });
}

beforeEach(() => {
  state.ackViewer.mockReset();
  state.recordAck.mockReset();
});

describe("POST /api/health-records/acknowledgment origin check (#923)", () => {
  it.each([["a foreign origin", "https://evil.example"], ["no origin header", null]])("refuses %s with 403 and records nothing", async (_name, origin) => {
    const response = await acknowledgmentRoute.POST(post(origin));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "INVALID_REQUEST_ORIGIN" });
    expect(state.ackViewer).not.toHaveBeenCalled();
    expect(state.recordAck).not.toHaveBeenCalled();
  });

  it("accepts the workspace's own origin", async () => {
    state.ackViewer.mockResolvedValue({ kind: "CLUB_REGISTRAR", accountId: "acct-reg" });
    state.recordAck.mockResolvedValue({ version: HEALTH_PRIVACY_ACK_VERSION, alreadyAcknowledged: false });
    const response = await acknowledgmentRoute.POST(post("https://events.imsda.test"));
    expect(response.status).toBe(200);
    expect(state.recordAck).toHaveBeenCalledTimes(1);
  });
});

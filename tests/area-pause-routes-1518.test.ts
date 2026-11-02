import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireClubCapability: vi.fn(),
  checkPublicPaymentRateLimit: vi.fn(),
  checkPublicRegistrationRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/club-rosters/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/club-rosters/access")>()),
  requireClubCapability: mocks.requireClubCapability,
}));
vi.mock("@/modules/rate-limit/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/rate-limit/service")>()),
  checkPublicPaymentRateLimit: mocks.checkPublicPaymentRateLimit,
  checkPublicRegistrationRateLimit: mocks.checkPublicRegistrationRateLimit,
}));

import { resetAreaPauseCache } from "@/modules/system-admin/area-pause";
import { POST as clubNotesPost } from "@/app/api/attendee/clubs/[organizationId]/notes/route";
import { POST as managePaymentPost } from "@/app/api/public/manage/[token]/payment/route";
import { POST as generalRegistrationPost } from "@/app/api/public/events/[eventSlug]/general-registrations/route";

function pausedClient(keys: string[]) {
  return {
    notificationSetting: {
      findMany: vi.fn(async () => keys.map((key) => ({ key, enabled: true }))),
    },
  };
}

const post = (url: string) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: "{}",
});

beforeEach(() => {
  vi.clearAllMocks();
  resetAreaPauseCache();
});

describe("a paused area refuses a real route before its own code runs (#1518)", () => {
  it("club portal: a club notes POST", async () => {
    mocks.getPrisma.mockReturnValue(pausedClient(["AREA_PAUSE:CLUB_PORTAL"]));
    const response = await clubNotesPost(post("https://events.imsda.test/api/attendee/clubs/org_1/notes"), { params: Promise.resolve({ organizationId: "org_1" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("AREA_PAUSED");
    expect(mocks.requireClubCapability).not.toHaveBeenCalled();
  });

  it("payments: a manage-link payment POST", async () => {
    mocks.getPrisma.mockReturnValue(pausedClient(["AREA_PAUSE:PAYMENTS"]));
    const response = await managePaymentPost(post("https://events.imsda.test/api/public/manage/tok_1/payment"), { params: Promise.resolve({ token: "tok_1" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("AREA_PAUSED");
    expect(mocks.checkPublicPaymentRateLimit).not.toHaveBeenCalled();
  });

  it("event registration: a public general registration POST", async () => {
    mocks.getPrisma.mockReturnValue(pausedClient(["AREA_PAUSE:EVENTS_REGISTRATION"]));
    const response = await generalRegistrationPost(post("https://events.imsda.test/api/public/events/spring/general-registrations"), { params: Promise.resolve({ eventSlug: "spring" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("AREA_PAUSED");
    expect(mocks.checkPublicRegistrationRateLimit).not.toHaveBeenCalled();
  });

  it("a different area's pause does not stop the route (the handler's own code runs)", async () => {
    mocks.getPrisma.mockReturnValue(pausedClient(["AREA_PAUSE:PAYMENTS"]));
    mocks.requireClubCapability.mockRejectedValue(new Error("stop here"));
    const response = await clubNotesPost(post("https://events.imsda.test/api/attendee/clubs/org_1/notes"), { params: Promise.resolve({ organizationId: "org_1" }) });
    expect(response.status).not.toBe(503);
    expect(mocks.requireClubCapability).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stationCookie: undefined as string | undefined,
  session: { account: { id: "acct_1" }, via: "attendee" } as { account: { id: string } | null; via: "attendee" | "staff" | null },
  passkeysOn: true,
  passkeyCount: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "imsda_check_in_station" && state.stationCookie ? { value: state.stationCookie } : undefined) }),
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => state.session }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: async () => state.passkeysOn }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ attendeePasskey: { count: async () => state.passkeyCount } }) }));

import { passkeyOfferForPage } from "@/modules/attendee-accounts/passkey-offer-eligibility";

describe("passkey offer decision for the registration page (#219)", () => {
  beforeEach(() => {
    state.stationCookie = undefined;
    state.session = { account: { id: "acct_1" }, via: "attendee" };
    state.passkeysOn = true;
    state.passkeyCount = 0;
  });

  it("offers it to a signed-in attendee with passkeys on and none saved", async () => {
    expect(await passkeyOfferForPage()).toBe(true);
  });

  it("never offers it without an account", async () => {
    state.session = { account: null, via: null };
    expect(await passkeyOfferForPage()).toBe(false);
  });

  it("never offers it on a check-in station device", async () => {
    state.stationCookie = "station-token";
    expect(await passkeyOfferForPage()).toBe(false);
  });

  it("does not offer it to staff viewing an attendee account", async () => {
    state.session = { account: { id: "acct_1" }, via: "staff" };
    expect(await passkeyOfferForPage()).toBe(false);
  });

  it("does not offer it when passkeys are off or one is already saved", async () => {
    state.passkeysOn = false;
    expect(await passkeyOfferForPage()).toBe(false);
    state.passkeysOn = true;
    state.passkeyCount = 1;
    expect(await passkeyOfferForPage()).toBe(false);
  });
});

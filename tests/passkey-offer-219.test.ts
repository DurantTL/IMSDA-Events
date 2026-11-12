import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSKEY_OFFER_PATH,
  passkeyOfferEligible,
  passkeyOfferSnoozeValue,
  passkeyOfferSnoozed,
} from "@/modules/attendee-accounts/passkey-offer";

const base = { passkeysOn: true, signedInAs: "attendee" as const, passkeyCount: 0, onCheckInStation: false };

describe("passkey offer eligibility (#219)", () => {
  it("offers only to a signed-in attendee with no passkey while passkeys are on", () => {
    expect(passkeyOfferEligible(base)).toBe(true);
    expect(passkeyOfferEligible({ ...base, passkeysOn: false })).toBe(false);
    expect(passkeyOfferEligible({ ...base, signedInAs: null })).toBe(false);
    expect(passkeyOfferEligible({ ...base, signedInAs: "staff" })).toBe(false);
    expect(passkeyOfferEligible({ ...base, passkeyCount: 1 })).toBe(false);
    expect(passkeyOfferEligible({ ...base, onCheckInStation: true })).toBe(false);
  });

  it("links to Account > Security", () => {
    expect(PASSKEY_OFFER_PATH).toBe("/account/security");
  });
});

describe("Not now snooze (#219)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("hides for 30 days then shows again", () => {
    const stored = passkeyOfferSnoozeValue(new Date());
    expect(passkeyOfferSnoozed(stored, new Date())).toBe(true);
    vi.setSystemTime(new Date("2026-12-11T11:59:00Z"));
    expect(passkeyOfferSnoozed(stored, new Date())).toBe(true);
    vi.setSystemTime(new Date("2026-12-12T12:00:00Z"));
    expect(passkeyOfferSnoozed(stored, new Date())).toBe(false);
  });

  it("ignores missing, unreadable or future values", () => {
    expect(passkeyOfferSnoozed(null, new Date())).toBe(false);
    expect(passkeyOfferSnoozed("abc", new Date())).toBe(false);
    expect(passkeyOfferSnoozed(String(Date.now() + 86_400_000), new Date())).toBe(false);
  });
});

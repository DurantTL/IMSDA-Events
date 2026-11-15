import { describe, expect, it } from "vitest";
import { emailIsClubEmail, previewEmailLookChoice } from "@/modules/communications/email-layout";

// The staff previews and delivery share one definition of club email (#283 follow-up). Synthetic values only.
const CURRENT = { primary: "#1b4d3e", accent: "#f0b323", eventName: "Sample Camporee" };
const STAMPED = { primary: "#4a1d5e", accent: "#f0b323", eventName: "Sample Camporee" };

describe("club email", () => {
  it("is a club-only template, or a registration-dependent one for a club registration or club director", () => {
    expect(emailIsClubEmail("CLUB_DRAFT_REMINDER")).toBe(true);
    expect(emailIsClubEmail("REGISTRATION_CONFIRMATION_PAID")).toBe(false);
    expect(emailIsClubEmail("REGISTRATION_CONFIRMATION_PAID", { clubRegistration: true })).toBe(true);
    expect(emailIsClubEmail("REGISTRATION_CONFIRMATION_PAID", { recipientKind: "CLUB_DIRECTOR" })).toBe(true);
    expect(emailIsClubEmail("SYSTEM_TEST_EMAIL", { clubRegistration: true })).toBe(false);
  });
});

describe("the look a staff preview draws", () => {
  const club = { templateKey: "REGISTRATION_CONFIRMATION_PAID", clubLinked: true };
  const plain = { templateKey: "REGISTRATION_CONFIRMATION_PAID", clubLinked: false };

  it("shows no look for a club message or club-context template while the switch is off", () => {
    expect(previewEmailLookChoice({ ...club, currentLook: CURRENT, useCurrentWhenUnstamped: true })).toBeNull();
    expect(previewEmailLookChoice({ templateKey: "CLUB_DRAFT_REMINDER", currentLook: CURRENT, useCurrentWhenUnstamped: true })).toBeNull();
  });

  it("shows the current look for club email once the switch is on", () => {
    expect(previewEmailLookChoice({ ...club, currentLook: CURRENT, useCurrentWhenUnstamped: true, clubEmailsUseRegistrationLook: true })).toBe(CURRENT);
  });

  it("keeps a look already stamped on the message, whatever the switch says", () => {
    expect(previewEmailLookChoice({ ...club, stampedLook: STAMPED, currentLook: CURRENT, useCurrentWhenUnstamped: false })).toBe(STAMPED);
  });

  it("does not touch non-club email, and shows none for a message that would not be stamped", () => {
    expect(previewEmailLookChoice({ ...plain, currentLook: CURRENT, useCurrentWhenUnstamped: true })).toBe(CURRENT);
    expect(previewEmailLookChoice({ ...plain, currentLook: CURRENT, useCurrentWhenUnstamped: false })).toBeNull();
    expect(previewEmailLookChoice({ ...plain, currentLook: null, useCurrentWhenUnstamped: true })).toBeNull();
  });
});

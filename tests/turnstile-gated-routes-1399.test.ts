import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #1399: every gated route calls requireTurnstile with its expected action, after its rate limit. Static, no network.
 * #1480: and with its fallback for a blocked check: an emailed code on sign-in, sign-up and reset, a strictly limited
 * tokenless submission on the public forms.
 */
const routes: Array<[string, string, "email-code" | "public-form"]> = [
  ["app/api/sign-in/route.ts", "staffSignIn", "email-code"],
  ["app/api/auth/login/route.ts", "staffSignIn", "email-code"],
  ["app/api/attendee/sign-in/route.ts", "attendeeSignIn", "email-code"],
  ["app/api/attendee/sign-up/route.ts", "attendeeSignUp", "email-code"],
  ["app/api/auth/password-reset/request/route.ts", "forgotPassword", "email-code"],
  ["app/api/attendee/password-reset/request/route.ts", "forgotPassword", "email-code"],
  ["app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route.ts", "registration", "public-form"],
  ["app/api/public/events/[eventSlug]/general-registrations/route.ts", "registration", "public-form"],
  ["app/api/public/events/[eventSlug]/group-registrations/route.ts", "groupRegistration", "public-form"],
  ["app/api/public/club-applications/route.ts", "clubApplication", "public-form"],
  ["app/api/public/club-form-applications/[templateKey]/route.ts", "clubApplication", "public-form"],
  ["app/api/public/registration-recovery/route.ts", "registrationRecovery", "public-form"],
  ["app/api/public/information-forms/route.ts", "informationForm", "public-form"],
];

describe("gated routes", () => {
  it.each(routes)("%s checks the %s action after its rate limit", (path, action) => {
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(new RegExp(`requireTurnstile\\(request, \\{\\s*action: TURNSTILE_ACTIONS\\.${action}\\b`));
    expect(source.indexOf("RateLimit(")).toBeGreaterThan(-1);
    expect(source.indexOf("requireTurnstile(request")).toBeGreaterThan(source.indexOf("RateLimit("));
  });

  it.each(routes)("%s passes the %s action's %s fallback (#1480)", (path, _action, kind) => {
    const source = readFileSync(path, "utf8");
    const call = source.slice(source.indexOf("requireTurnstile(request"), source.indexOf("requireTurnstile(request") + 300);
    expect(call).toContain(`fallback: { kind: "${kind}"`);
  });

  // The fallback only applies once the honeypot passed: forms that have a honeypot field parse it first.
  it.each([
    "app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route.ts",
    "app/api/public/events/[eventSlug]/general-registrations/route.ts",
    "app/api/public/events/[eventSlug]/group-registrations/route.ts",
    "app/api/public/club-applications/route.ts",
  ])("%s checks its honeypot (the schema's website field) before requireTurnstile (#1480)", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source.search(/(publicRegistrationInputSchema|newClubApplicationInputSchema)\.parse\(/)).toBeGreaterThan(-1);
    expect(source.search(/(publicRegistrationInputSchema|newClubApplicationInputSchema)\.parse\(/)).toBeLessThan(source.indexOf("requireTurnstile(request"));
  });

  it("leaves the promo-code route ungated", () => {
    expect(readFileSync("app/api/public/events/[eventSlug]/forms/[formSlug]/promo-code/route.ts", "utf8")).not.toContain("requireTurnstile");
  });
});

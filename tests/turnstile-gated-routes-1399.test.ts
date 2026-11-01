import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** #1399: every gated route calls requireTurnstile with its expected action, after its rate limit. Static, no network. */
const routes: Array<[string, string]> = [
  ["app/api/sign-in/route.ts", "staffSignIn"],
  ["app/api/auth/login/route.ts", "staffSignIn"],
  ["app/api/attendee/sign-in/route.ts", "attendeeSignIn"],
  ["app/api/attendee/sign-up/route.ts", "attendeeSignUp"],
  ["app/api/auth/password-reset/request/route.ts", "forgotPassword"],
  ["app/api/attendee/password-reset/request/route.ts", "forgotPassword"],
  ["app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route.ts", "registration"],
  ["app/api/public/events/[eventSlug]/general-registrations/route.ts", "registration"],
  ["app/api/public/events/[eventSlug]/group-registrations/route.ts", "groupRegistration"],
  ["app/api/public/club-applications/route.ts", "clubApplication"],
  ["app/api/public/club-form-applications/[templateKey]/route.ts", "clubApplication"],
  ["app/api/public/registration-recovery/route.ts", "registrationRecovery"],
  ["app/api/public/information-forms/route.ts", "informationForm"],
];

describe("gated routes", () => {
  it.each(routes)("%s checks the %s action after its rate limit", (path, action) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain(`requireTurnstile(request, { action: TURNSTILE_ACTIONS.${action} })`);
    expect(source.indexOf("RateLimit(")).toBeGreaterThan(-1);
    expect(source.indexOf("requireTurnstile(request")).toBeGreaterThan(source.indexOf("RateLimit("));
  });

  it("leaves the promo-code route ungated", () => {
    expect(readFileSync("app/api/public/events/[eventSlug]/forms/[formSlug]/promo-code/route.ts", "utf8")).not.toContain("requireTurnstile");
  });
});

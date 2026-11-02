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

  // The fallback only applies once the honeypot passed: every public fallback route parses a schema that carries the
  // hidden `website` field before it calls requireTurnstile.
  const honeypotRoutes: Array<[string, RegExp, string[]]> = [
    ["app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route.ts", /publicRegistrationInputSchema\.parse\(/, ["modules/forms/public-domain.ts"]],
    ["app/api/public/events/[eventSlug]/general-registrations/route.ts", /publicRegistrationInputSchema\.parse\(/, ["modules/forms/public-domain.ts"]],
    ["app/api/public/events/[eventSlug]/group-registrations/route.ts", /publicRegistrationInputSchema\.parse\(/, ["modules/forms/public-domain.ts"]],
    ["app/api/public/club-applications/route.ts", /newClubApplicationInputSchema\.parse\(/, ["modules/club-applications/domain.ts"]],
    ["app/api/public/club-form-applications/[templateKey]/route.ts", /openApplicationSubmitSchema\.parse\(/, ["modules/club-forms/open-applications-domain.ts"]],
    ["app/api/public/information-forms/route.ts", /bodySchema\.safeParse\(/, ["app/api/public/information-forms/route.ts"]],
    ["app/api/public/registration-recovery/route.ts", /requestSchema\.parse\(/, ["app/api/public/registration-recovery/route.ts"]],
  ];

  it.each(honeypotRoutes)("%s checks its honeypot before requireTurnstile (#1480)", (path, parseCall, schemaFiles) => {
    const source = readFileSync(path, "utf8");
    expect(source.search(parseCall)).toBeGreaterThan(-1);
    expect(source.search(parseCall)).toBeLessThan(source.indexOf("requireTurnstile(request"));
    for (const file of schemaFiles) expect(readFileSync(file, "utf8")).toMatch(/website: (z\.literal\(""|honeypotFieldSchema)/);
  });

  it("the code request route carries the honeypot too", () => {
    expect(readFileSync("app/api/security-check/email-code/route.ts", "utf8")).toContain("website: honeypotFieldSchema");
  });

  it("leaves the promo-code route ungated", () => {
    expect(readFileSync("app/api/public/events/[eventSlug]/forms/[formSlug]/promo-code/route.ts", "utf8")).not.toContain("requireTurnstile");
  });
});

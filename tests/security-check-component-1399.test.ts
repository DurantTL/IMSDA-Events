import { createRef, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  isSecurityCheckRejection,
  SecurityCheck,
  type SecurityCheckHandle,
} from "@/components/security-check/security-check";

/** #1399: the one Security check component. Server render only; the widget itself is Cloudflare's. */

describe("SecurityCheck", () => {
  it("renders nothing while Turnstile is off", () => {
    const ref = createRef<SecurityCheckHandle>();
    expect(renderToStaticMarkup(createElement(SecurityCheck, { config: null, action: "registration", handleRef: ref }))).toBe("");
  });

  it("renders a labelled group with a message region announced as an alert", () => {
    const ref = createRef<SecurityCheckHandle>();
    const html = renderToStaticMarkup(createElement(SecurityCheck, { config: { siteKey: "synthetic-site-key", nonce: "abc" }, action: "registration", handleRef: ref }));
    expect(html).toContain('role="group"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    const labelId = /aria-labelledby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${labelId}"`);
    expect(html).toContain("Security check");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("synthetic-site-key");
  });

  it("recognises the server's rejection codes only", () => {
    expect(isSecurityCheckRejection({ code: "security_check_failed" })).toBe(true);
    expect(isSecurityCheckRejection({ error: "security_check_missing" })).toBe(true);
    expect(isSecurityCheckRejection({ error: "RATE_LIMITED" })).toBe(false);
    expect(isSecurityCheckRejection(null)).toBe(false);
  });
});

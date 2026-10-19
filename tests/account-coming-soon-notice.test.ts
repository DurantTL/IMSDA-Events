import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACCOUNT_COMING_SOON_TEXT, AccountComingSoonNotice } from "@/components/account-coming-soon-notice";

describe("account coming-soon notice", () => {
  it("says accounts work now, more is coming, and none is needed to register", () => {
    const html = renderToStaticMarkup(createElement(AccountComingSoonNotice));
    expect(html).toContain("more account features are coming soon");
    expect(html).toContain("You never need an account to register");
    expect(ACCOUNT_COMING_SOON_TEXT).toMatch(/confirmation code or private email link/);
  });

  it("is shown everywhere an account is offered", () => {
    for (const file of [
      "app/(public)/account/sign-up/page.tsx",
      "components/attendee-sign-in-form.tsx",
      "components/public-registration-form.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain("<AccountComingSoonNotice />");
    }
  });
});

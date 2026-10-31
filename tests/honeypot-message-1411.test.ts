import { describe, expect, it } from "vitest";
import { publicRegistrationInputSchema } from "@/modules/forms/public-domain";

describe("honeypot message (#1411 A7)", () => {
  it("shows a plain message, not the raw literal error", () => {
    const result = publicRegistrationInputSchema.shape.website.safeParse("autofilled");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("We couldn't send this form. Clear your browser's autofill and try again.");
    expect(publicRegistrationInputSchema.shape.website.safeParse("").success).toBe(true);
  });
});

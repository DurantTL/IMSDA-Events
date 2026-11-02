import { describe, expect, it } from "vitest";
import { openApplicationSubmitSchema } from "@/modules/club-forms/open-applications-domain";
import { publicRegistrationInputSchema } from "@/modules/forms/public-domain";
import { honeypotFieldSchema } from "@/modules/security/honeypot";

describe("honeypot message (#1411 A7)", () => {
  it("shows a plain message, not the raw literal error", () => {
    const result = publicRegistrationInputSchema.shape.website.safeParse("autofilled");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("We couldn't send this form. Clear your browser's autofill and try again.");
    expect(publicRegistrationInputSchema.shape.website.safeParse("").success).toBe(true);
  });

  it("keeps the plain message on the shared honeypot and the club form application (#1480)", () => {
    for (const schema of [honeypotFieldSchema, openApplicationSubmitSchema.shape.website]) {
      const result = schema.safeParse("autofilled");
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe("We couldn't send this form. Clear your browser's autofill and try again.");
      expect(schema.safeParse("").success).toBe(true);
      expect(schema.safeParse(undefined).success).toBe(true);
    }
  });
});

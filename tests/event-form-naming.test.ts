import { describe, expect, it } from "vitest";
import { formIndexToNameAfterEvent, confirmationMessageForEvent, eventRegistrationFormTitle, renameFormDefinitionForEvent } from "@/modules/forms/event-form-naming";
import { slugify } from "@/modules/forms/slug";

describe("event form naming (#1406)", () => {
  it("titles the form after the event and derives the web address from it", () => {
    const title = eventRegistrationFormTitle("Mock Run Retreat 2027");
    expect(title).toBe("Mock Run Retreat 2027 registration");
    expect(slugify(title)).toBe("mock-run-retreat-2027-registration");
  });

  it("keeps a long event name within the 120-character title limit", () => {
    const title = eventRegistrationFormTitle("A".repeat(120));
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith(" registration")).toBe(true);
  });

  it("rewrites the phrase in a confirmation message and leaves the rest alone", () => {
    expect(confirmationMessageForEvent("Your Women’s Retreat registration has been received. Watch your email.", "Mock Run Retreat 2027"))
      .toBe("Your Mock Run Retreat 2027 registration has been received. Watch your email.");
    expect(confirmationMessageForEvent("Thank you. Your club registration has been received.", "Fall Camporee 2027"))
      .toBe("Thank you. Your Fall Camporee 2027 registration has been received.");
  });

  it("leaves a message with no phrase unchanged", () => {
    expect(confirmationMessageForEvent("Your registration has been received.", "Mock Run")).toBe("Your registration has been received.");
    expect(confirmationMessageForEvent("Thank you. Your RSVP has been received.", "Mock Run")).toBe("Thank you. Your RSVP has been received.");
  });

  it("does not treat a dollar sign in the name as a replacement pattern", () => {
    expect(confirmationMessageForEvent("Your Camp registration has been received.", "Spend $& Save")).toBe("Your Spend $& Save registration has been received.");
  });

  it("renames a whole definition without touching other fields", () => {
    const renamed = renameFormDefinitionForEvent({ title: "Women’s Retreat 2026 registration", confirmationMessage: "Your Women’s Retreat registration has been received.", other: 1 }, "Mock Run Retreat 2027");
    expect(renamed).toEqual({ title: "Mock Run Retreat 2027 registration", confirmationMessage: "Your Mock Run Retreat 2027 registration has been received.", other: 1 });
  });

  it("picks the registration form only when exactly one title ends in registration", () => {
    expect(formIndexToNameAfterEvent(["Volunteer sign-up", "Women’s Retreat 2026 registration"])).toBe(1);
    expect(formIndexToNameAfterEvent(["A registration", "B Registration"])).toBeNull();
    expect(formIndexToNameAfterEvent(["Volunteer sign-up"])).toBeNull();
  });

  it("rewrites the confirmation but keeps the title when the form is not renamed", () => {
    expect(renameFormDefinitionForEvent({ title: "Volunteer sign-up", confirmationMessage: "Your Old registration has been received." }, "New 2027", false))
      .toEqual({ title: "Volunteer sign-up", confirmationMessage: "Your New 2027 registration has been received." });
  });
});

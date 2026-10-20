/**
 * Synthetic registrations for the registration PDF tests and the committed sample (#1082). Every name, address and
 * number here is made up. The Spring Camporee club registration is the model case: it is the bundled form template, so
 * the sample follows the real form.
 */

import { getFormTemplate, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import type { RegistrationPdfAttendee, RegistrationPdfSource } from "@/modules/registration-pdf/model";

const FIRST_NAMES = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Gray", "Harper", "Indigo", "Jules", "Kai", "Logan"];
const LAST_NAMES = ["Example", "Sample", "Testwell", "Placeholder", "Demoson", "Mockridge"];
const ROLES = ["Pathfinder", "Pathfinder", "Pathfinder", "TLT", "TLT", "Staff", "Pathfinder", "Child", "Pathfinder", "Staff", "Pathfinder", "TLT"];

export function springCamporeeDefinition(): RegistrationFormDefinition {
  const template = getFormTemplate("spring_camporee_export");
  if (!template) throw new Error("The Spring Camporee template is missing.");
  return template.definition as RegistrationFormDefinition;
}

export function springCamporeeAttendees(count = 12): RegistrationPdfAttendee[] {
  return Array.from({ length: count }, (_, index) => {
    const role = ROLES[index % ROLES.length]!;
    const age = role === "Staff" ? 34 + index : role === "Child" ? 7 : 10 + (index % 7);
    return {
      name: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[index % LAST_NAMES.length]}`,
      ageOnEventDate: age,
      responses: {
        first_name: FIRST_NAMES[index % FIRST_NAMES.length],
        last_name: LAST_NAMES[index % LAST_NAMES.length],
        attendee_age: age,
        gender: index % 2 === 0 ? "Female" : "Male",
        attendee_type: role,
        first_time_camper: index % 3 === 0,
        ...(role === "Staff" ? { medical_personnel: index === 5, master_guide_investiture: index === 9 } : {}),
        // Dietary needs print (owner decision, Caleb, Oct 20, 2026); a medical or accessibility need never does.
        dietary_needs: index === 0 ? "Synthetic: no peanuts" : "",
        medical_or_accessibility_need: "Yes",
      },
    };
  });
}

export function springCamporeeSource(overrides: Partial<RegistrationPdfSource> = {}): RegistrationPdfSource {
  return {
    eventName: "Spring Camporee 2027",
    eventDates: "April 16-18, 2027",
    eventLocation: "Example Camp, 100 Sample Road, Exampleville, ZZ 00000",
    formTitle: "Spring Camporee club registration",
    definition: springCamporeeDefinition(),
    registrationResponses: {
      club_name: "Maple Grove Pathfinders",
      director_name: "Dana Sample",
      church_name: "Maple Grove Example Church",
      email: "dana.sample@example.test",
      phone: "(555) 010-0199",
      tents: "Four tents: two 10x12, two 8x10",
      trailers: "One 20 ft trailer",
      kitchen_canopy: "One 10x20 canopy",
      total_sqft: 2400,
      camp_next_to: "Oak Ridge Adventurers",
      duty_areas: ["Flag raising / lowering", "Bathroom clean-up"],
      flag_slots: ["Thursday evening", "Friday morning"],
      bathroom_days: ["Friday", "Saturday"],
      special_activities: ["Lead mixer Thursday night at vespers", "Special music, poem or skit — Friday vespers"],
      friday_special_type: "Skit",
      friday_special_name: "The Synthetic Samaritan",
      friday_av_equipment: ["Computer", "AUX"],
      sponsoring_meals: "Yes",
      meal_sponsorship_count: 10,
      meal_times: ["Friday lunch", "Friday supper"],
      partner_club: "Oak Ridge Adventurers",
      event_ribbons: "Yes",
      sabbath_skit: "A Walk With Placeholder",
      baptism_names: "Two example names, kept private for this sample.",
      // Never shown, whatever the form says.
      promo_code: "SYNTHETIC10",
    },
    attendees: springCamporeeAttendees(),
    clubName: "Maple Grove Pathfinders",
    teamName: null,
    registrantName: "Dana Sample",
    submittedOn: "March 2, 2027",
    // Spring Camporee is church-billed: the registrant sees the per-person price, never a total (#621).
    fees: { kind: "CHURCH_BILLED", lines: ["$25 per person. Your church is billed after the event.", "Meal sponsorship credit: -$40"] },
    ...overrides,
  };
}

/** A small self-pay roster form (Honors Weekend style) with a sensitive question, a birth date and a payment choice. */
export function selfPayDefinition(): RegistrationFormDefinition {
  const field = (key: string, label: string, type: string, scope: "REGISTRATION" | "ATTENDEE", extra: Record<string, unknown> = {}) => ({
    id: `f_${key}`, key, label, helpText: "", type, scope, required: false, options: [], ...extra,
  });
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic Honors Weekend registration",
    description: "",
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 8, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" },
    payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Card" },
    sections: [
      { id: "contact", title: "Contact", description: "", fields: [
        field("email", "Email", "EMAIL", "REGISTRATION", { required: true }),
        field("payment_method", "How will you pay?", "RADIO", "REGISTRATION", { options: ["Card", "Check"] }),
        field("promo_code", "Promo code", "TEXT", "REGISTRATION"),
      ] },
      { id: "people", title: "Who is coming", description: "", fields: [
        field("first_name", "First name", "TEXT", "ATTENDEE", { required: true }),
        field("last_name", "Last name", "TEXT", "ATTENDEE", { required: true }),
        field("attendee_age", "Age", "NUMBER", "ATTENDEE"),
        field("birth_date", "Birth date", "DATE", "ATTENDEE"),
        field("allergies", "Allergies", "TEXT", "ATTENDEE"),
        field("class_choice", "Honors class", "SELECT", "ATTENDEE", { options: ["Knots", "Birds"], optionLabels: { Knots: "Knot Tying", Birds: "Bird Study" } }),
      ] },
    ],
  });
}

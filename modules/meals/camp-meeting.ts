import type { TemplateMeals } from "@/modules/meals/clone-domain";

/**
 * Camp Meeting 2026 (CM26-IMSDA) as meal definitions (#210). The event starts on a Tuesday, so day offset 0 is Tuesday.
 * Breakfast Wednesday to Saturday ($7 adult / $6 child), lunch Wednesday to Friday ($8 / $7; Saturday lunch is
 * donation-only and sells no ticket), supper Tuesday to Saturday ($8 / $7). Tickets are bought as quantities per meal
 * and age group, so the prices belong to the meal type. The conference-paid plan is for staff, pastor and volunteer
 * registrations (#804): every ticketed meal is included and the café's use of it is billed to the conference, at the
 * same per-meal rates, which a person can change. Prices are the 2026 ones the form already carried; staff review them.
 */
const days = ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const service = (name: string, mealType: "BREAKFAST" | "LUNCH" | "SUPPER", dayOffset: number, startTime: string, endTime: string, ticketing: "TICKETED" | "DONATION_ONLY" = "TICKETED") =>
  ({ name, mealType, dayOffset, startTime, endTime, location: "Cafeteria", ticketing, capacity: null });

const services = [
  ...days.slice(1).map((day, index) => service(`${day} breakfast`, "BREAKFAST", index + 1, "07:30", "08:30")),
  ...days.slice(1, 4).map((day, index) => service(`${day} lunch`, "LUNCH", index + 1, "12:00", "13:00")),
  service("Saturday lunch (donation)", "LUNCH", 4, "12:00", "13:00", "DONATION_ONLY"),
  ...days.map((day, index) => service(`${day} supper`, "SUPPER", index, "17:30", "18:30")),
];

const prices = (adult: Record<"BREAKFAST" | "LUNCH" | "SUPPER", number>, child: Record<"BREAKFAST" | "LUNCH" | "SUPPER", number>) => [
  ...(["BREAKFAST", "LUNCH", "SUPPER"] as const).flatMap((mealType) => [
    { mealType, ageGroup: "ADULT" as const, attendeeTypeCode: null, amountCents: adult[mealType] },
    { mealType, ageGroup: "CHILD" as const, attendeeTypeCode: null, amountCents: child[mealType] },
  ]),
];

const rates = { adult: { BREAKFAST: 700, LUNCH: 800, SUPPER: 800 }, child: { BREAKFAST: 600, LUNCH: 700, SUPPER: 700 } };

export const campMeetingMeals: TemplateMeals = {
  services,
  plans: [
    {
      code: "meal-tickets", name: "Meal tickets", description: "Tickets bought on the registration form or added by staff. Saturday lunch is donation-only.",
      payer: "ATTENDEE", isDefaultTicketPlan: true, includesAllServices: true, defaultEntitlement: "PAID", services: [], prices: prices(rates.adult, rates.child),
    },
    {
      code: "conference-paid", name: "Conference-paid (staff, pastors, volunteers)",
      description: "Every ticketed meal is included. The café's use of each meal is billed to the conference, not the attendee.",
      payer: "CONFERENCE", isDefaultTicketPlan: false, includesAllServices: true, defaultEntitlement: "INCLUDED", services: [], prices: prices(rates.adult, rates.child),
    },
  ],
};

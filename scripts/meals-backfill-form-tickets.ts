/**
 * Records the meal tickets existing registrations already bought on their registration form as meal selections
 * (#210), for an event that has just been given a meal ticket plan. The registration totals do not change: the form
 * priced those tickets when the registration was made, so every entry is IN_REGISTRATION_PRICING.
 *
 * It reads each registration's latest answers (an amendment's if there is one, else the submission's) and its latest
 * pricing snapshot, then runs the same `syncFormMealSelections` the submission and the amendment run, so a second run
 * changes nothing. It is a human-run operation: it does a dry run unless `--apply` is given, prints counts only (no
 * names, emails or answers), and is never run by the app, a deploy or an agent against production data.
 *
 *   npx tsx --require ./scripts/support/allow-server-only.cjs scripts/meals-backfill-form-tickets.ts --event <eventId>
 *   npx tsx --require ./scripts/support/allow-server-only.cjs scripts/meals-backfill-form-tickets.ts --event <eventId> --apply
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { syncFormMealSelections } from "@/modules/meals/selection-repository";
import { ticketQuantitiesFromAnswers } from "@/modules/meals/domain";

loadEnvConfig(process.cwd());

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function main() {
  const args = process.argv.slice(2);
  const eventId = args[args.indexOf("--event") + 1];
  const apply = args.includes("--apply");
  if (!args.includes("--event") || !eventId) throw new Error("Pass --event <eventId>.");
  const prisma = new PrismaClient();
  try {
    const plan = await prisma.eventMealPlan.findFirst({ where: { eventId, isDefaultTicketPlan: true, isActive: true }, select: { id: true } });
    if (!plan) throw new Error("This event has no active meal ticket plan. Create it first (More > Meals).");
    const registrations = await prisma.registration.findMany({
      where: { eventId, status: { in: ["SUBMITTED", "CONFIRMED", "WAITLISTED"] }, publicFormSubmission: { isNot: null } },
      select: {
        id: true,
        publicFormSubmission: { select: { formVersionId: true, responses: true, pricingSnapshot: true } },
        operations: { where: { type: "AMENDMENT" }, orderBy: { createdAt: "desc" }, take: 1, select: { afterSnapshot: true } },
        mealSelections: { where: { source: "REGISTRATION_FORM", status: "ACTIVE" }, select: { id: true } },
      },
    });
    const totals = { registrations: registrations.length, withTickets: 0, alreadyRecorded: 0, wouldCreate: 0, created: 0 };
    for (const registration of registrations) {
      const submission = registration.publicFormSubmission!;
      const amended = record(registration.operations[0]?.afterSnapshot);
      const responses = Object.keys(record(amended.registrationResponses)).length > 0 ? record(amended.registrationResponses) : record(submission.responses);
      const pricing = Object.keys(record(amended.pricingSnapshot)).length > 0 ? record(amended.pricingSnapshot) : record(submission.pricingSnapshot);
      const lineItems = (Array.isArray(pricing.lineItems) ? pricing.lineItems : []).map(record)
        .filter((line): line is { key: string; amountCents: number } => typeof line.key === "string" && typeof line.amountCents === "number");
      const tickets = ticketQuantitiesFromAnswers(responses);
      if (tickets.length === 0) continue;
      totals.withTickets += 1;
      if (registration.mealSelections.length > 0) { totals.alreadyRecorded += 1; continue; }
      totals.wouldCreate += tickets.length;
      if (!apply) continue;
      const result = await prisma.$transaction((tx) => syncFormMealSelections(tx, { eventId, registrationId: registration.id, formVersionId: submission.formVersionId, responses, lineItems, previousResponses: null }));
      totals.created += result.created;
    }
    console.log(JSON.stringify({ eventId, mode: apply ? "apply" : "dry-run", ...totals }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

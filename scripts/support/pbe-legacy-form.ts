/**
 * The Pathfinder Bible Experience form as it stood before #1044: a Role question (Pathfinder, TLT, Coach) on each roster
 * person, a Yes/No photo release, and a roster that could also list coaches. The form now lists team members only, with no
 * role question and the release as a notice, but registrations made on the older form version keep their Coach answers and
 * must keep listing coaches without counting them. The verification scripts that exercise coaches put these fields back on
 * the event's form version to stand in for an older form version. Synthetic only.
 */
import type { PrismaClient } from "@prisma/client";

type Section = { id: string; fields: Array<Record<string, unknown>> };
type Definition = { attendeeRoster?: Record<string, unknown>; sections: Section[] };

export async function restoreLegacyPbeFields(prisma: PrismaClient, eventId: string) {
  const forms = await prisma.registrationForm.findMany({ where: { eventId }, include: { versions: true } });
  for (const form of forms) {
    for (const version of form.versions) {
      const definition = JSON.parse(JSON.stringify(version.definition)) as Definition;
      definition.attendeeRoster = { ...definition.attendeeRoster, maxAttendees: 20, attendeeLabel: "Team member or coach", addButtonLabel: "Add another team member or coach" };
      const roster = definition.sections.find((section) => section.id === "pbe_roster");
      const confirmation = definition.sections.find((section) => section.id === "pbe_confirmation");
      if (!roster || !confirmation) throw new Error("The Pathfinder Bible Experience form has no roster or confirmation section.");
      if (!roster.fields.some((field) => field.key === "attendee_type")) {
        roster.fields.splice(3, 0, {
          id: "pbe_member_role", key: "attendee_type", label: "Role", helpText: "", type: "RADIO", scope: "ATTENDEE", required: true, options: ["Pathfinder", "TLT", "Coach"],
        });
      }
      if (!confirmation.fields.some((field) => field.key === "photo_video_release")) {
        confirmation.fields.push({
          id: "pbe_release", key: "photo_video_release", label: "Photo, video and liability release", helpText: "", type: "RADIO", scope: "REGISTRATION", required: true, options: ["Yes", "No"],
        });
      }
      await prisma.registrationFormVersion.update({ where: { id: version.id }, data: { definition: definition as never } });
    }
  }
}

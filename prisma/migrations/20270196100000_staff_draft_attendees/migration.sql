-- #1510: the people attending on a staff-started registration (phone, paper or walk-in). Additive only: one new column
-- with a default, so every existing draft reads as having no people yet. It holds only the attendee answers the
-- browser-draft rule allows (names, attendee type, shirt size, paid or limited choices), and is cleared on submit and
-- on discard, like the answers beside it.

-- AlterTable
ALTER TABLE "StaffRegistrationDraft" ADD COLUMN "attendees" JSONB NOT NULL DEFAULT '[]';

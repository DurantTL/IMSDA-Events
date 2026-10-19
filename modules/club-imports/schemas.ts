import { z } from "zod";

const name = z.string().trim().max(80);

/** One club as the administrator confirmed it in the preview (#376). */
export const clubImportItemSchema = z.object({
  /** "CLUB_LIST" rows come from the club-list JSON (#1038): club only, no people, no invites, no roster year. */
  kind: z.enum(["REGISTRATION", "CLUB_LIST"]).default("REGISTRATION"),
  sourceKey: z.string().trim().regex(/^(form-\d+|club-list):[A-Za-z0-9_-]{1,40}$/),
  /** Club-list only: the club's older names; an existing club is found by any of them. */
  matchNames: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  /** Club-list only: the existing club the preview matched (or the administrator picked), or null for none. Confirm refuses when the directory now says something else. */
  existingClubId: z.string().trim().max(40).nullable().default(null),
  /** Club-list only: a new club is created active or not. */
  isActive: z.boolean().default(true),
  /** Club-list only: change an existing club's church to `churchId` (the "update church" tick). */
  updateChurch: z.boolean().default(false),
  entryId: z.string().trim().min(1).max(40),
  clubYear: z.string().regex(/^\d{4}-\d{2}$/).refine((value) => (Number(value.slice(0, 4)) + 1) % 100 === Number(value.slice(5)), "Choose a valid club year."),
  clubName: z.string().trim().min(2, "Every imported club needs a name.").max(120),
  /** An existing church, or null with `newChurchName` to create one, or neither for none. */
  churchId: z.string().trim().max(40).nullable(),
  newChurchName: z.string().trim().max(160).default(""),
  invites: z.array(z.object({
    role: z.enum(["DIRECTOR", "DEPUTY"]),
    name: z.string().trim().max(160).default(""),
    email: z.string().trim().toLowerCase().pipe(z.email("Check the invite email addresses.")),
  }).strict()).max(4),
  people: z.array(z.object({
    firstName: name.min(1, "Every person needs a first name."),
    lastName: name.min(1, "Every person needs a last name. Fix it in the preview or skip them."),
    attendeeType: z.enum(["STAFF", "YOUTH", "ADULT"]),
    role: z.string().trim().max(60).default(""),
    classLevel: z.enum(["FRIEND", "COMPANION", "EXPLORER", "RANGER", "VOYAGER", "GUIDE", "TLT", "MASTER_GUIDE"]).nullable(),
    reportedAge: z.number().int().min(0).max(99).nullable(),
    /** "Keep both" (#541): add this person even though an earlier person in the file has the same name and section. */
    keepBoth: z.boolean().default(false),
  }).strict()).max(300),
}).strict().refine((item) => item.kind !== "CLUB_LIST" || (item.people.length === 0 && item.invites.length === 0 && !item.newChurchName), {
  message: "A club-list row creates only the club: no people, no invites, and no new church.",
});

export const clubImportConfirmSchema = z.object({
  clubs: z.array(clubImportItemSchema).min(1, "Choose at least one club to import.").max(500),
}).strict().refine((payload) => payload.clubs.length <= 400 || payload.clubs.every((club) => club.kind === "CLUB_LIST"), {
  message: "Import at most 400 form 89 registrations at a time. A club list may have up to 500 clubs.",
  path: ["clubs"],
});

const clubYear = z.string().regex(/^\d{4}-\d{2}$/, "Choose a valid club year.");

/** "Move this import to another club year" (#541): preview first, then move. */
export const importYearMoveSchema = z.object({
  fromYear: clubYear,
  toYear: clubYear,
  mode: z.enum(["preview", "move"]),
}).strict();

export type ClubImportItem = z.infer<typeof clubImportItemSchema>;

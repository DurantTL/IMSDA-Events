import { z } from "zod";
import { MASTER_GUIDE_MENTOR_MAX_LENGTH } from "@/modules/master-guide/domain";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date as year-month-day.");
const mentorName = z.string().trim().max(MASTER_GUIDE_MENTOR_MAX_LENGTH, `Keep the mentor's name under ${MASTER_GUIDE_MENTOR_MAX_LENGTH + 1} characters.`).transform((value) => value || null);

export const addCandidateSchema = z.object({
  personId: z.string().trim().min(1).max(64),
  startedOn: calendarDate,
  mentorName: mentorName.optional(),
}).strict();

export const updateCandidateSchema = z.object({
  startedOn: calendarDate,
  mentorName: mentorName.optional(),
}).strict();

export const areaApprovalSchema = z.object({
  candidateId: z.string().trim().min(1).max(64),
}).strict();

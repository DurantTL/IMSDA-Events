import type { FormTemplate, RegistrationFormField } from "@/modules/forms/definition";

/**
 * The four Adventurer club forms (#1222) as information form templates. Each is a starting point: a system administrator
 * creates an information form from it in Admin → Information forms, edits it if needed and publishes it. The field lists
 * and wording come from the conference's own forms.
 *
 * They are information forms, so they pass the same refusal check as any other: no roster, health, medical or other
 * sensitive question. The annual registration's member list is the one exception (#1222): repeating rows of exactly name, age, level and what
 * the member is working on, allowed by `memberListRefusals` in `modules/information-forms/definition.ts`.
 * Nothing here imports `modules/information-forms/definition.ts`, which keeps the form definition module free of a cycle.
 */

export const ADVENTURER_LEVELS = ["Little Lamb", "Eager Beaver", "Busy Bee", "Sunbeam", "Builder", "Helping Hand"] as const;

/** The conference Youth Department contact line the application keeps from the original form. */
export const ADVENTURER_YOUTH_CONTACT = "Questions? Call the Youth Department at (515) 223-1197 or email youth@imsda.org";

function field(id: string, key: string, label: string, type: RegistrationFormField["type"], required = false, extra: Partial<RegistrationFormField> = {}): RegistrationFormField {
  return { id: `field_${id}`, key, label, helpText: "", type, scope: "REGISTRATION", required, options: [], ...extra };
}

/** First and last name as two short fields under one heading, e.g. "Pastor — First name". */
function nameFields(prefix: string, group: string, required: boolean): RegistrationFormField[] {
  return [
    field(`${prefix}_first`, `${prefix}_first_name`, "First name", "TEXT", required, { group }),
    field(`${prefix}_last`, `${prefix}_last_name`, "Last name", "TEXT", required, { group }),
  ];
}

const wholeNumber = { ageBounds: { minimumAge: 0, maximumAge: 1000 } } as const;

const yesNo = ["Yes", "No"];

const adventurerClubApplication: FormTemplate = {
  key: "adventurer_club_application",
  name: "Adventurer Program Club Application",
  description: "A new Adventurer club's application to the conference: sponsoring church, leader, and the church board's typed signatures.",
  audience: "Information",
  definition: {
    title: "Adventurer Program Club Application",
    description: "To be completed one time only by the Adventurer Leader of a NEW CLUB, signed by the church board of the sponsoring church, and submitted to the conference office.",
    confirmationMessage: "Thank you. Your application has been received by the conference office.",
    sections: [
      { id: "adv_app_club", title: "The club", description: "", fields: [
        field("app_church", "sponsoring_church", "Sponsoring church", "TEXT", true),
        ...nameFields("pastor", "Pastor", true),
        ...nameFields("leader", "Elected Adventurer leader", true),
        field("app_address", "leader_address", "Address", "ADDRESS", true),
        field("app_email", "leader_email", "Email", "EMAIL", true),
        field("app_phone", "leader_phone", "Phone", "PHONE", true),
      ] },
      { id: "adv_app_signatures", title: "Church board signatures", description: ADVENTURER_YOUTH_CONTACT, fields: [
        field("app_date", "application_date", "Date", "DATE", true),
        field("app_sig_pastor", "signature_church_pastor", "Church Pastor (type your full name to sign)", "TEXT", true),
        field("app_sig_elder", "signature_head_elder", "Head Elder (type your full name to sign)", "TEXT", true),
        field("app_sig_clerk", "signature_church_clerk", "Church Clerk (type your full name to sign)", "TEXT", true),
        field("app_sig_director", "signature_club_director", "Club Director (type your full name to sign)", "TEXT", true),
        field("app_sig_board_1", "signature_board_member_1", "Other Board Member 1 (type your full name to sign)", "TEXT", false),
        field("app_sig_board_2", "signature_board_member_2", "Other Board Member 2 (type your full name to sign)", "TEXT", false),
        field("app_sig_board_3", "signature_board_member_3", "Other Board Member 3 (type your full name to sign)", "TEXT", false),
        field("app_sig_board_4", "signature_board_member_4", "Other Board Member 4 (type your full name to sign)", "TEXT", false),
      ] },
    ],
  },
};

const adventurerMonthlyReport: FormTemplate = {
  key: "adventurer_monthly_report",
  name: "Adventurer Monthly Report",
  description: "The Adventurer director's monthly report: meeting details, members by class, and the month's points typed in by the director.",
  audience: "Information",
  definition: {
    title: "Adventurer Monthly Report",
    description: "",
    confirmationMessage: "Thank you. Your monthly report has been received.",
    sections: [
      { id: "adv_rep_director", title: "Director and club", description: "", fields: [
        ...nameFields("director", "Director's name", true),
        field("rep_club", "club_and_church_name", "Club & church name", "TEXT", true),
        field("rep_month", "reporting_month", "Reporting month", "TEXT", true, { helpText: "For example, October 2026." }),
        field("rep_phone", "director_phone", "Director phone", "PHONE", false),
        field("rep_email", "director_email", "Director email", "EMAIL", true),
      ] },
      { id: "adv_rep_meeting", title: "Regular meeting", description: "", fields: [
        field("rep_adventurers", "number_of_adventurers", "Number of Adventurers", "NUMBER", false, wholeNumber),
        field("rep_staff", "number_of_staff", "Number of staff", "NUMBER", false, wholeNumber),
        field("rep_time", "meeting_time", "Meeting time", "TEXT", false),
        field("rep_day", "meeting_day", "Meeting day", "SELECT", false, { options: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Sabbath"] }),
      ] },
      { id: "adv_rep_classes", title: "How many in each class", description: "", fields: ADVENTURER_LEVELS.map((level) => (
        field(`rep_class_${level.toLowerCase().replaceAll(" ", "_")}`, `class_${level.toLowerCase().replaceAll(" ", "_")}`, level, "NUMBER", false, wholeNumber)
      )) },
      { id: "adv_rep_points", title: "Monthly points", description: "Type in the points your club earned. Nothing here is added up for you.", fields: [
        field("rep_hours", "hours_in_meetings", "Hours in meetings this month", "NUMBER", false, { helpText: "One point per hour, maximum 4 points.", ageBounds: { minimumAge: 0, maximumAge: 1000 } }),
        field("rep_class_work", "working_on_class_work", "Working on class work?", "RADIO", false, { options: yesNo, helpText: "Yes = one point." }),
        field("rep_awards", "working_on_awards", "Working on awards?", "RADIO", false, { options: yesNo, helpText: "One point per award, maximum 3 points." }),
        field("rep_award_list", "awards_list", "Please list the awards", "LONG_TEXT", false, { conditional: { fieldKey: "working_on_awards", operator: "EQUALS", value: "Yes" } }),
        field("rep_trips", "field_trips_or_activities", "Field trips or extra-curricular activities", "LONG_TEXT", false, { helpText: "Describe them. One point possible." }),
        field("rep_child_activity", "child_family_activity", "Held a child and family activity?", "RADIO", false, { options: yesNo, helpText: "Yes = one point." }),
        field("rep_family_network", "family_network_meeting", "Held a Family Network Meeting?", "RADIO", false, { options: yesNo, helpText: "Yes = 2 points." }),
        field("rep_family_topics", "family_network_topics", "Please describe topics", "LONG_TEXT", false, { conditional: { fieldKey: "family_network_meeting", operator: "EQUALS", value: "Yes" } }),
      ] },
      { id: "adv_rep_events", title: "Events and projects", description: "", fields: [
        field("rep_events", "events_held_or_attended", "Please mark if your club held or participated in any of the following this month", "MULTISELECT", false, {
          helpText: "10 points each.",
          options: ["Induction Blessing Service", "Investiture", "Fun Day", "Adventurer Family Campout at Sunnydale", "Adventurer Sabbath", "Leadership Summit at Camp Heritage", "Awards Day"],
        }),
        field("rep_outreach", "outreach_projects", "Evangelistic, outreach or service projects this month?", "LONG_TEXT", false, { helpText: "Describe them. 3 bonus points." }),
        field("rep_total", "total_points", "Total points earned this month", "NUMBER", true, { helpText: "Please add your total points for this month.", ageBounds: { minimumAge: 0, maximumAge: 1000 } }),
      ] },
    ],
  },
};

const adventurerPhotoRelease: FormTemplate = {
  key: "adventurer_photo_video_release",
  name: "Adventurer Club Photo and Video Release",
  description: "Permission to use photographs and videos of a child at an Adventurer club, with typed signatures.",
  audience: "Information",
  definition: {
    title: "Adventurer Club Photo and Video Release",
    description: "",
    confirmationMessage: "Thank you. Your release has been received.",
    sections: [
      { id: "adv_rel_signers", title: "Signatures", description: "", fields: [
        field("rel_signer", "signer_name", "Name of person signing", "TEXT", true),
        field("rel_signer_sig", "signer_signature", "Typed signature of person signing", "TEXT", true),
        field("rel_signer_date", "signer_date", "Date", "DATE", true),
        field("rel_minor", "minor_name", "Name of minor", "TEXT", true),
        field("rel_minor_sig", "minor_signature", "Minor's typed signature", "TEXT", true),
        field("rel_minor_date", "minor_date", "Date", "DATE", true),
        field("rel_club", "club_name", "Club name", "TEXT", true),
        field("rel_director_email", "director_email", "Club director's email", "EMAIL", true, { helpText: "So the youth department knows which club this is for." }),
      ] },
    ],
  },
};

const adventurerAnnualRegistration: FormTemplate = {
  key: "adventurer_annual_registration",
  name: "Annual Adventurer Club Registration",
  description: "Each school year before October 1: the club, its leaders and assistants, and the member list (name, age, level, working on).",
  audience: "Information",
  definition: {
    title: "Annual Adventurer Club Registration",
    description: "To be completed and submitted to the conference office each school year before October 1 by the Adventurer Leader. This form registers your club with the conference office for the current year, updates contact information for newsletters, and qualifies your club to be invited to conference-wide Adventurer events.",
    confirmationMessage: "Thank you. Your club's registration has been received.",
    sections: [
      { id: "adv_reg_club", title: "The club", description: "", fields: [
        field("reg_club", "club_name", "Club name", "TEXT", true),
        field("reg_church", "sponsoring_church", "Sponsoring church", "TEXT", true),
      ] },
      { id: "adv_reg_leader", title: "Leader", description: "", fields: [
        ...nameFields("leader", "Leader's name", true),
        field("reg_leader_address", "leader_address", "Address", "ADDRESS", false),
        field("reg_leader_phone", "leader_phone", "Phone", "PHONE", false),
        field("reg_leader_email", "leader_email", "Email", "EMAIL", true),
      ] },
      { id: "adv_reg_coleader", title: "Co-leader", description: "", fields: [
        ...nameFields("coleader", "Co-leader's name", false),
        field("reg_coleader_address", "coleader_address", "Address", "ADDRESS", false),
        field("reg_coleader_phone", "coleader_phone", "Phone", "PHONE", false),
        field("reg_coleader_email", "coleader_email", "Email", "EMAIL", false),
      ] },
      { id: "adv_reg_assistants", title: "Other assistants", description: "", fields: [
        field("reg_assistants", "other_assistants", "Other assistants", "LONG_TEXT", false, { helpText: "One person per line: name, address, email, phone." }),
      ] },
      { id: "adv_reg_members", title: "Club members", description: "", fields: [
        field("reg_members", "members", "Club members", "MEMBER_LIST", false, {
          helpText: "One row per member: name, age, level and what they are working on this year. Nothing else about a child is collected here.",
          options: [...ADVENTURER_LEVELS],
          memberColumns: [
            { key: "name", label: "Name", type: "TEXT", required: true },
            { key: "age", label: "Age", type: "NUMBER", required: true },
            { key: "level", label: "Adventurer level", type: "SELECT", required: true },
            { key: "working_on", label: "Working on this year", type: "TEXT", required: false },
          ],
        }),
      ] },
    ],
  },
};

export const adventurerInformationTemplates: FormTemplate[] = [
  adventurerClubApplication,
  adventurerMonthlyReport,
  adventurerPhotoRelease,
  adventurerAnnualRegistration,
];

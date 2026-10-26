import type { RosterMapping } from "@/modules/club-forms/roster-mapping";
import { buildYearNominationTemplate, tltApplicationTemplate, type FormTemplate, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";

/**
 * The seeded club form templates (the first four, #610; six more, #1221) (#610, with the field-level specs from
 * #608). Each `definition` uses the registration-form definition schema and
 * field types unchanged; what the schema cannot carry lives beside it:
 *
 * - `sectionNotes`: display-only paragraphs per section id (the Pathfinder
 *   Pledge and Law, approval and waiver text, instructions);
 * - `sensitiveFieldKeys`: answers sealed at rest, shown to a club's director
 *   and deputies and to staff with VIEW_SENSITIVE_DATA, "Restricted" to Area
 *   Coordinators, and left out of CSVs;
 * - `staffOnlyFieldKeys`: office-use fields a private-link filler never sees.
 *
 * Bump `version` when a definition changes; `npm run club-forms:sync` (run by
 * `docker-entrypoint.sh` after migrations, and by hand locally) then updates
 * the stored row through `syncClubFormTemplates` and, for a field that became
 * sensitive, re-seals existing answers first. It never touches `enabled`.
 * Until it has run, saves to the behind form are refused.
 *
 * Wording that #610 summarises rather than quotes (the membership
 * application's statement, waiver and five cooperation points, and the
 * Pledge and Law) is drafted here from those summaries and the standard
 * Pathfinder texts. A human must compare it with the conference's official
 * Word forms before a system administrator enables that template.
 */

export type ClubFormTemplateSeed = {
  key: string;
  name: string;
  description: string;
  version: number;
  sortOrder: number;
  definition: RegistrationFormDefinition;
  sectionNotes: Record<string, string[]>;
  sensitiveFieldKeys: string[];
  /** Birth-date fields: sensitive, and readable only by the club's leaders and system administrators. */
  birthDateFieldKeys: string[];
  staffOnlyFieldKeys: string[];
  printLayout: "STANDARD" | "PASSENGER_LIST";
  /**
   * The pre-filled "Add to roster" mapping (#721), always off here: an
   * administrator turns it on per form in the builder. Used until the template
   * has its own stored mapping. Field keys only; see `roster-mapping.ts`.
   */
  rosterMapping?: RosterMapping;
};

type FieldExtra = Partial<RegistrationFormField>;

function field(
  key: string,
  label: string,
  type: RegistrationFormField["type"],
  required = false,
  extra: FieldExtra = {},
): RegistrationFormField {
  return {
    id: `f_${key}`,
    key,
    label,
    helpText: "",
    type,
    scope: "REGISTRATION",
    required,
    options: [],
    ...extra,
  };
}

const text = (key: string, label: string, required = false, extra: FieldExtra = {}) => field(key, label, "TEXT", required, extra);
const longText = (key: string, label: string, required = false, extra: FieldExtra = {}) => field(key, label, "LONG_TEXT", required, extra);
const phone = (key: string, label: string, required = false, extra: FieldExtra = {}) => field(key, label, "PHONE", required, extra);
const date = (key: string, label: string, required = false, extra: FieldExtra = {}) => field(key, label, "DATE", required, extra);
const yesNo = (key: string, label: string, required = false, extra: FieldExtra = {}) => field(key, label, "RADIO", required, { options: ["Yes", "No"], ...extra });
const money = (key: string, label: string, extra: FieldExtra = {}) => field(key, label, "NUMBER", false, { helpText: "Dollars, entered by the club.", ...extra });
/** A signing or application date: filled in with today's date (Chicago), read-only on a private link (#719). */
const today: FieldExtra = { autoDate: "TODAY" };
const whenYes = (fieldKey: string): FieldExtra => ({ conditional: { fieldKey, operator: "EQUALS", value: "Yes" } });

/** The roster's gender (#721): Male or Female, required. Not sensitive. */
const genderField = () => field("gender", "Gender", "RADIO", true, { options: ["Male", "Female"] });

const churchField = (required: boolean) => field("church", "Church", "SELECT", required, { optionSource: "CHURCHES_DIRECTORY" });
const churchOther = () => text("church_other", "Church name", true, { conditional: { fieldKey: "church", operator: "EQUALS", value: "Not listed" } });

function section(id: string, title: string, fields: RegistrationFormField[], description = "") {
  return { id, title, description, fields };
}

// ---------------------------------------------------------------------------
// 1. Pathfinder Club Membership Application

const pledge = "The Pathfinder Pledge: By the grace of God, I will be pure and kind and true. I will keep the Pathfinder Law. I will be a servant of God and a friend to all.";
const law = "The Pathfinder Law: The Pathfinder Law is for me to keep the morning watch, do my honest part, care for my body, keep a level eye, be courteous and obedient, walk softly in the sanctuary, keep a song in my heart, and go on God's errands.";

const membershipApplication: ClubFormTemplateSeed = {
  key: "pathfinder_membership_application",
  name: "Pathfinder Club Membership Application",
  description: "An applicant's membership application with the parent or guardian's approval, waiver and signatures.",
  version: 3,
  sortOrder: 10,
  printLayout: "STANDARD",
  // #721: the youth roster fields this form knows. The class names match the roster's; the applicant's phone is the
  // family's, so it pre-fills the first guardian's phone (the director can change it on the review screen). The
  // roster has no address field, so the address is not mapped.
  rosterMapping: {
    enabled: false,
    rosterType: "YOUTH",
    fields: { fullName: "full_name", birthDate: "birth_date", gender: "gender", classLevel: "ay_class" },
    guardians: [
      { name: "father_guardian_signature", relationshipLabel: "Father or guardian", phone: "phone" },
      { name: "mother_guardian_signature", relationshipLabel: "Mother or guardian" },
    ],
  },
  sensitiveFieldKeys: ["birth_date"],
  birthDateFieldKeys: ["birth_date"],
  // v2 (#719): the fee amounts are entered by the club, so a private-link filler never sees them. Signing dates fill in automatically in the same version.
  staffOnlyFieldKeys: ["registration_fee", "club_dues", "insurance_fee"],
  sectionNotes: {
    sec_applicant: [
      "I would like to join the Pathfinder Club named below. If I am accepted, I will do my best to take part and to live by the Pathfinder Pledge and Law.",
      pledge,
      law,
    ],
    sec_approval: [
      "Parent or guardian approval. The applicant is at least in the 5th grade.",
      "Waiver of claims. We waive and release any claim against the club, its sponsoring church and the Iowa-Missouri Conference of Seventh-day Adventists, and their leaders and volunteers, for injury, illness or loss that happens during club activities, except where the law does not allow a claim to be waived.",
      "We agree to cooperate with the club in these five ways: (1) to see that the applicant attends meetings and activities on time and prepared; (2) to support the club's rules, the Pathfinder Pledge and the Pathfinder Law; (3) to keep the club leaders informed of changes in health, contact details or family circumstances; (4) to pick up the applicant promptly after activities, or to arrange safe transportation; (5) to pay the fees listed for registration, club dues and insurance.",
    ],
  },
  definition: {
    title: "Pathfinder Club Membership Application",
    description: "Membership application for one applicant. The parent or guardian approves and signs.",
    confirmationMessage: "Thank you. The membership application has been received.",
    sections: [
      section("sec_applicant", "Applicant", [
        text("club_name", "Pathfinder Club name", true),
        text("applicant_signature", "Applicant signature (type your full name)", true, { helpText: "Typing your name here is your signature." }),
        date("applicant_signature_date", "Date signed by applicant", true, today),
      ]),
      section("sec_fees", "Fees", [
        money("registration_fee", "Registration fee ($)"),
        money("club_dues", "Club dues ($)"),
        money("insurance_fee", "Insurance ($)"),
      ], "Amounts the club enters."),
      section("sec_details", "Applicant details", [
        text("full_name", "Applicant name", true),
        // v3 (#721): the roster needs a gender, so the form asks for it. Two choices, as the roster has.
        genderField(),
        phone("phone", "Phone", true),
        field("ay_class", "AY class", "SELECT", true, { options: ["Friend", "Companion", "Explorer", "Ranger", "Voyager", "Guide"] }),
        text("street", "Street address", true),
        text("city", "City", true),
        text("state", "State", true),
        text("zip", "ZIP", true),
        text("school", "School"),
        field("grade", "Grade", "SELECT", true, { options: ["5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"] }),
        churchField(true),
        churchOther(),
        yesNo("been_pathfinder", "I have been a Pathfinder", true),
        text("been_pathfinder_where", "Where?", false, whenYes("been_pathfinder")),
        yesNo("dad_master_guide", "Dad is a Master Guide"),
        yesNo("dad_been_pathfinder", "Dad has been a Pathfinder"),
        yesNo("mother_master_guide", "Mother is a Master Guide"),
        yesNo("mother_been_pathfinder", "Mother has been a Pathfinder"),
      ]),
      section("sec_approval", "Parent or guardian approval", [
        text("certified_name", "We hereby certify that (applicant name)", true),
        date("birth_date", "was born on", true),
        text("father_guardian_signature", "Father or guardian signature (type full name)", true, { optionalWhen: { fieldKey: "mother_guardian_signature", operator: "NOT_EMPTY", value: "" } }),
        text("father_guardian_occupation", "Father or guardian occupation"),
        text("mother_guardian_signature", "Mother or guardian signature (type full name)", true, { optionalWhen: { fieldKey: "father_guardian_signature", operator: "NOT_EMPTY", value: "" } }),
        text("mother_guardian_occupation", "Mother or guardian occupation"),
        field("approval_agreement", "We have read and agree to the approval, waiver and cooperation statements above.", "CHECKBOX", true),
        date("application_date", "Date of application", true, today),
      ]),
    ],
  },
};

// ---------------------------------------------------------------------------
// 2. Pathfinder Staff/Volunteer Service Information Form

function rows<T>(count: number, build: (index: number) => T[]) {
  return Array.from({ length: count }, (_, index) => build(index + 1)).flat();
}

const childFields = rows(5, (n) => [
  text(`child_${n}_name`, `Child ${n} name`),
  date(`child_${n}_birth_date`, `Child ${n} birth date`),
]);
const experienceFields = rows(3, (n) => [
  text(`experience_${n}_position`, `${n}. Position or type of work`),
  text(`experience_${n}_organization`, `${n}. Church or organization`),
  text(`experience_${n}_dates`, `${n}. Dates of service`),
]);
const honorRoles = ["T - Teach", "A - Assist", "I - Interested in team teaching"];
const honorFields = rows(8, (n) => [
  text(`honor_${n}_name`, `${n}. Honor or craft`),
  field(`honor_${n}_role`, `${n}. T, A or I`, "SELECT", false, { options: honorRoles }),
]);
const referenceHeadings = ["1. Pastor", "2. Local reference", "3. Other reference"];
// v4 (#856): each reference is its own group (row) with plain labels. Keys and answers are unchanged.
const referenceFields = rows(3, (n) => {
  const group = referenceHeadings[n - 1];
  return [
    text(`reference_${n}_name`, "Name", true, { group }),
    text(`reference_${n}_address`, "Address", true, { group }),
    phone(`reference_${n}_phone`, "Phone", true, { group }),
  ];
});

const staffForm: ClubFormTemplateSeed = {
  key: "pathfinder_staff_service_information",
  name: "Pathfinder Staff/Volunteer Service Information Form",
  description: "A staff or volunteer's record, health history, experience, honors to teach, conduct disclosure and references.",
  version: 4,
  sortOrder: 20,
  printLayout: "STANDARD",
  // #721: staff are added as staff roster members, from the name and birth date. The health and conduct answers
  // are sensitive and can never be mapped.
  rosterMapping: {
    enabled: false,
    rosterType: "STAFF",
    fields: { fullName: "full_name", birthDate: "birth_date", gender: "gender" },
    guardians: [],
  },
  sensitiveFieldKeys: [
    "birth_date",
    ...[1, 2, 3, 4, 5].map((n) => `child_${n}_birth_date`),
    "health_limitation",
    "health_limitation_how",
    "conduct_accused",
    "conduct_explanation",
    "conduct_date_place",
    "conduct_type",
    "conduct_verifier_name",
    "conduct_verifier_street",
    "conduct_verifier_city",
    "conduct_verifier_state",
    "conduct_verifier_zip",
    "conduct_verifier_phone",
  ],
  birthDateFieldKeys: ["birth_date", ...[1, 2, 3, 4, 5].map((n) => `child_${n}_birth_date`)],
  staffOnlyFieldKeys: ["office_date_received", "office_date_approved", "office_recommendation", "office_signature"],
  sectionNotes: {
    sec_office: ["For office use only. This form is for club files only."],
    sec_health: ["Health history. Only the club's director and deputies, and conference staff with sensitive-data access, can read these answers."],
    sec_conduct: ["Unlawful conduct. Only the club's director and deputies, and conference staff with sensitive-data access, can read these answers."],
    sec_experience: ["List experience that might qualify you for Pathfinder staff (Pathfinder or Adventurer, Scouts, Sabbath School, and so on)."],
    sec_honors: ["List honors or crafts you are interested in teaching. T = Teach, A = Assist, I = Interested in team teaching."],
    sec_references: ["List three people who know you well enough to recommend you."],
  },
  definition: {
    title: "Pathfinder Staff/Volunteer Service Information Form",
    description: "This form is for club files only.",
    confirmationMessage: "Thank you. Your service information form has been received.",
    sections: [
      section("sec_office", "Office use only", [
        date("office_date_received", "Date received"),
        date("office_date_approved", "Date approved"),
        field("office_recommendation", "Recommendation", "SELECT", false, { options: ["Recommended", "Not recommended", "Recommended with conditions noted"] }),
        text("office_signature", "Office signature (type full name)"),
      ]),
      section("sec_record", "I. Date of record", [
        text("full_name", "Name", true),
        date("birth_date", "Birth date", true),
        genderField(),
        text("street", "Street address", true),
        text("city", "City", true),
        text("state", "State", true),
        text("zip", "ZIP", true),
        phone("phone_home", "Home phone", false, { helpText: "For use only in emergency or with permission." }),
        phone("phone_work", "Work phone", false, { helpText: "For use only in emergency or with permission." }),
        phone("phone_cell", "Cell phone", false, { helpText: "For use only in emergency or with permission." }),
        field("email", "Email", "EMAIL", true),
        churchField(true),
        churchOther(),
        field("club", "Pathfinder club", "SELECT", true, { optionSource: "CLUBS_DIRECTORY" }),
        text("club_other", "Club name", true, { conditional: { fieldKey: "club", operator: "EQUALS", value: "Not listed" } }),
        field("marital_status", "Marital status", "SELECT", false, { options: ["Married", "Single", "Divorced"] }),
        text("spouse_name", "Spouse's name"),
      ]),
      section("sec_children", "Children", childFields, "Up to five children."),
      section("sec_health", "II. Health history", [
        yesNo("health_limitation", "Do you now have or have you had injury or sickness that might limit your involvement in Pathfinder Club activities?", true),
        longText("health_limitation_how", "How would it hinder?", true, whenYes("health_limitation")),
      ]),
      section("sec_education", "III. Educational record", [
        text("highest_degree", "Highest degree or diploma"),
        field("degree_year", "Year received", "NUMBER", false, { ageBounds: { minimumAge: 1900, maximumAge: 2100 } }),
        text("degree_school", "School that granted it"),
        text("college_major", "College major"),
        text("college_minor", "College minor"),
      ]),
      section("sec_experience", "IV. Experience", experienceFields, "Up to three rows."),
      section("sec_honors", "V. Award instruction ability", honorFields, "Up to eight rows."),
      section("sec_conduct", "VI. Unlawful conduct", [
        yesNo("conduct_accused", "Have you been accused, charged, or disciplined for any unlawful sexual conduct, child abuse, and/or child sexual abuse?", true),
        longText("conduct_explanation", "Explanation", true, whenYes("conduct_accused")),
        text("conduct_date_place", "Date and place", true, whenYes("conduct_accused")),
        text("conduct_type", "Type of conduct", true, whenYes("conduct_accused")),
        text("conduct_verifier_name", "Reference or professional who can verify suitability: name", true, whenYes("conduct_accused")),
        text("conduct_verifier_street", "Verifier street address", true, whenYes("conduct_accused")),
        text("conduct_verifier_city", "Verifier city", true, whenYes("conduct_accused")),
        text("conduct_verifier_state", "Verifier state", true, whenYes("conduct_accused")),
        text("conduct_verifier_zip", "Verifier ZIP", true, whenYes("conduct_accused")),
        phone("conduct_verifier_phone", "Verifier phone", true, whenYes("conduct_accused")),
      ]),
      section("sec_references", "VII. References", referenceFields),
      section("sec_signature", "Signature", [
        text("signature", "Signature (type your full name)", true, { helpText: "Typing your name here is your signature." }),
        date("signature_date", "Date", true, today),
        field("signature_acknowledgment", "I confirm that the answers on this form are true and that typing my name is my signature.", "CHECKBOX", true),
      ]),
    ],
  },
};

// ---------------------------------------------------------------------------
// 3. Off-Premises Permission Slip

const permissionSlip: ClubFormTemplateSeed = {
  key: "off_premises_permission_slip",
  name: "Off-Premises Permission Slip",
  description: "A parent or guardian's permission for a child to take part in one off-premises club activity, with medical and emergency details.",
  version: 2,
  sortOrder: 30,
  printLayout: "STANDARD",
  sensitiveFieldKeys: ["physician_name", "physician_phone", "clinic_name", "clinic_phone", "emergency_contact_phone"],
  birthDateFieldKeys: [],
  staffOnlyFieldKeys: [],
  sectionNotes: {
    sec_permission: [
      "I hereby give my permission for my child to participate in the pre-planned activity named below, on the date given.",
    ],
    sec_medical: ["Medical and emergency information. Only the club's director and deputies, and conference staff with sensitive-data access, can read these answers."],
  },
  definition: {
    title: "Iowa-Missouri Conference, Pathfinder/Adventurer Club, Permission Slip for Off-Premises Activities",
    description: "Permission Slip for Off-Premises Activities.",
    confirmationMessage: "Thank you. The permission slip has been received.",
    sections: [
      section("sec_child", "Child and family", [
        text("child_name", "Child's name", true),
        text("street", "Address", true),
        text("city", "City", true),
        text("state", "State", true),
        text("zip", "ZIP", true),
        phone("phone", "Phone", true),
      ]),
      section("sec_permission", "Permission to participate in off-premises club activities", [
        text("activity", "I hereby give my permission for my child to participate in the pre-planned activity of", true),
        date("activity_date", "On the date of", true),
        text("ride_with", "I give my child permission to ride with", true),
      ]),
      section("sec_parent", "Parent or guardian", [
        text("parent_signature", "Signed name (type your full name)", true, { helpText: "Typing your name here is your signature." }),
        date("parent_signature_date", "Date", true, today),
        text("relationship", "Relationship to the Pathfinder or Adventurer", true),
        longText("parent_address_if_different", "Address, if different from above"),
      ]),
      section("sec_medical", "Medical and emergency", [
        text("physician_name", "Physician's name"),
        phone("physician_phone", "Physician's phone"),
        text("clinic_name", "Clinic"),
        phone("clinic_phone", "Clinic phone"),
        phone("emergency_contact_phone", "Emergency contact phone number", true),
      ]),
    ],
  },
};

// ---------------------------------------------------------------------------
// 4. Transportation Passenger List

const passengerSections = [
  [1, 6], [7, 12], [13, 18], [19, 20],
].map(([first, last]) => section(
  `sec_passengers_${first}_${last}`,
  `Passengers ${first} to ${last}`,
  rows(last - first + 1, (offset) => {
    const n = first + offset - 1;
    return [
      text(`passenger_${n}_name`, `Passenger ${n} name`, n === 1),
      phone(`passenger_${n}_phone`, `Passenger ${n} phone`),
      text(`passenger_${n}_emergency_contact`, `Passenger ${n} emergency contact (name and phone)`),
    ];
  }),
));

const passengerList: ClubFormTemplateSeed = {
  key: "transportation_passenger_list",
  name: "Transportation Passenger List",
  description: "A roll-call sheet for one trip: contacts, up to 20 passengers with emergency contacts, and printable roll-call columns 1 to 5.",
  version: 1,
  sortOrder: 40,
  printLayout: "PASSENGER_LIST",
  sensitiveFieldKeys: Array.from({ length: 20 }, (_, index) => `passenger_${index + 1}_emergency_contact`),
  birthDateFieldKeys: [],
  staffOnlyFieldKeys: [],
  sectionNotes: {
    sec_contacts: [
      "Enter the name and emergency contact of each passenger. The club director needs a copy and the driver needs a copy. At each stop before driving away, take roll call.",
    ],
  },
  definition: {
    title: "Transportation Passenger List",
    description: "Enter the name and emergency contact of each passenger.",
    confirmationMessage: "Thank you. The passenger list has been received.",
    sections: [
      section("sec_contacts", "Contacts", [
        text("contact_name", "Club director's or central contact's name", true),
        phone("contact_cell", "Contact's cell phone", true),
        text("driver_name", "Driver's name", true),
        phone("driver_cell", "Driver's cell phone", true),
      ]),
      ...passengerSections,
    ],
  },
};

// ---------------------------------------------------------------------------
// 5 to 10. TLT, "of the Year", recommendation, can collecting and photo release (#1221)

/**
 * The TLT Application and the two "of the Year" nominations reuse the event
 * templates from #606 as they are (every field type they use, including
 * ADDRESS, MULTISELECT and the clubs directory, is already filled in and
 * validated by club forms). Only the key and the seed details differ: club
 * form keys must not equal an event template key.
 */
function fromEventTemplate(
  template: FormTemplate,
  seed: Pick<ClubFormTemplateSeed, "key" | "name" | "description" | "sortOrder">,
): ClubFormTemplateSeed {
  return {
    ...seed,
    version: 1,
    printLayout: "STANDARD",
    sectionNotes: {},
    sensitiveFieldKeys: [],
    birthDateFieldKeys: [],
    staffOnlyFieldKeys: [],
    definition: {
      ...template.definition,
      sections: template.definition.sections.map((candidate) => ({
        ...candidate,
        fields: candidate.fields.map((item) => {
          // The club form fill-in shows a checkbox's label, not its placeholder (event forms show the placeholder as the
          // statement). So the statement becomes the label; its wording is unchanged.
          if (item.type !== "CHECKBOX" || !item.placeholder) return item;
          const { placeholder, ...rest } = item;
          return { ...rest, label: placeholder };
        }),
      })),
    },
  };
}

const tltApplication = fromEventTemplate(tltApplicationTemplate, {
  key: "club_tlt_application",
  name: "TLT Application",
  description: "The Conference TLT application. The director sends the teen a private link; it is also kept in the club's files.",
  sortOrder: 50,
});

const pathfinderOfTheYear = fromEventTemplate(buildYearNominationTemplate("Pathfinder"), {
  key: "club_pathfinder_of_the_year",
  name: "Pathfinder of the Year nomination",
  description: "The director's nomination: nominee, attendance, classes, Good Conduct Award and five essay questions.",
  sortOrder: 60,
});

const tltOfTheYear = fromEventTemplate(buildYearNominationTemplate("TLT"), {
  key: "club_tlt_of_the_year",
  name: "TLT of the Year nomination",
  description: "The director's nomination: nominee, attendance, classes, Good Conduct Award and five essay questions.",
  sortOrder: 70,
});

const tltRecommendation: ClubFormTemplateSeed = {
  key: "tlt_program_recommendation",
  name: "TLT Program Recommendation",
  description: "A recommendation for a TLT applicant, sent by private link to the person recommending them. Only the club's director, Area Coordinators and conference staff read it; never the applicant.",
  version: 1,
  sortOrder: 80,
  printLayout: "STANDARD",
  sensitiveFieldKeys: [],
  birthDateFieldKeys: [],
  staffOnlyFieldKeys: [],
  sectionNotes: {
    sec_affirmation: ["I affirm that this is my honest evaluation of the applicant, offered in support of their participation in the TLT Program."],
    sec_applicant: [
      "Please complete this recommendation on behalf of the applicant named below. Your honest evaluation helps the Iowa-Missouri Conference TLT leadership.",
      "TLT Pledge: Loving the Lord Jesus, I promise to take an active part in the work of the Teen Leadership Training program, doing what I can to help others and to finish the work of the gospel in all the world.",
    ],
  },
  definition: {
    title: "TLT Program Recommendation",
    description: "Recommendation for a Conference TLT applicant.",
    confirmationMessage: "Thank you. Your recommendation has been received.",
    sections: [
      section("sec_applicant", "Applicant information", [
        text("applicant_name", "Applicant's name", true),
        // Club forms have no way to prefill a field on a private link, so the club is typed, as in the membership
        // application. The link's page names the club the form was sent for.
        text("club_name", "Pathfinder club", true),
      ]),
      section("sec_recommender", "Your information", [
        text("recommender_name", "Your name", true),
        field("recommender_email", "Your email", "EMAIL", true),
      ]),
      section("sec_questions", "Questions", [
        longText("known_how_long", "How do you know the applicant, and for how long?", true),
        longText("qualities", "What qualities does the applicant bring to the program?", true),
        longText("relates_to_people", "How does the applicant relate to people?", true),
        longText("responds_to_stress", "How does the applicant respond to stress?", true),
        longText("potential_problems", "Does the applicant have any potential problems that might hinder his/her participation?"),
      ]),
      section("sec_affirmation", "Affirmation", [
        // The statement is over the 120-character label limit, so it is the section's note and the checkbox affirms it.
        field("honest_evaluation", "I affirm the statement above.", "CHECKBOX", true),
        text("signature", "Type your full name as your signature", true),
      ]),
    ],
  },
};

const wholeNumber = { ageBounds: { minimumAge: 0, maximumAge: 100000 } };

const canCollecting: ClubFormTemplateSeed = {
  key: "can_collecting_report",
  name: "Can Collecting Report",
  description: "The club's report of its can and food collection project: participants, hours, food, cash and baskets.",
  version: 1,
  sortOrder: 90,
  printLayout: "STANDARD",
  sensitiveFieldKeys: [],
  birthDateFieldKeys: [],
  staffOnlyFieldKeys: [],
  sectionNotes: {},
  definition: {
    title: "Can Collecting Report",
    description: "Report on the club's can collecting project.",
    confirmationMessage: "Thank you. The can collecting report has been received.",
    sections: [
      section("sec_club", "Club", [
        text("club_name", "Club", true),
        text("director_name", "Director", true),
        text("submitted_by", "Person submitting report", true),
        date("report_date", "Date", true),
        churchField(true),
        churchOther(),
      ]),
      section("sec_report", "Report", [
        yesNo("included_picture", "Did you include a picture of your collection and your club?", true),
        field("pathfinders_participating", "Number of Pathfinders participating", "NUMBER", false, wholeNumber),
        field("staff_participating", "Number of staff participating", "NUMBER", false, wholeNumber),
        field("total_hours", "Total hours spent on the project", "NUMBER", false, { helpText: "Hours × each participant: for example, 5 participants × 2 hours = 10 hours" }),
        field("cans_collected", "Total number of cans/food collected", "NUMBER", false, wholeNumber),
        money("cash_collected", "Total amount of cash collected ($)", { helpText: "Dollars." }),
        field("baskets_distributed", "Total number of food baskets distributed", "NUMBER", false, wholeNumber),
      ]),
    ],
  },
};

const photoRelease: ClubFormTemplateSeed = {
  key: "pathfinder_photo_video_release",
  name: "Pathfinder Club Photo and Video Release",
  description: "A parent or guardian's photo and video release for a minor, sent by the director as a private link.",
  version: 1,
  sortOrder: 100,
  printLayout: "STANDARD",
  sensitiveFieldKeys: [],
  birthDateFieldKeys: [],
  staffOnlyFieldKeys: [],
  sectionNotes: {
    // Caleb's text, verbatim (issue #1221 comment). It is over the 2,000-character note limit, so it is two notes
    // split at a sentence break; the two joined with one space are the original text.
    sec_release: [
      "I hereby grant permission and authorize the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs the irrevocable right to use, reproduce and publish photographs and videos taken of me and/or the undersigned minor children, and our names, for use for all purposes, in any form, and in any and all media, including, without limitation, printed publications, websites, and outreach purposes, in any manner or in any medium. I understand that such photographs and video recordings of me may be placed on the Internet. I release the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs from any expectation of confidentiality for the undersigned minor children and myself and attest that I am the parent or legal guardian of the children listed below and that I have the authority to consent and allow the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs to use their photographs, videos, and names.",
      "I acknowledge that since participation is voluntary, neither the minor children nor I will receive any financial compensation. I agree that participation in any publication and website produced by the Iowa-Missouri Conference of Seventhday Adventists and its affiliated Pathfinder Clubs confers no rights of ownership to me whatsoever and I hereby waive the right to approve the final product. I release the Iowa-Missouri Conference of Seventh-day Adventists, its affiliated Pathfinder Clubs, its contractors, and its employees from liability for any claims by me or any third party in connection with my participation or the participation of the undersigned minor children. I agree that all such portraits, pictures, photographs, video and audio recordings, and any reproductions thereof, and all plates, negatives, recording tape and digital files are and shall remain the property of the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs. This release is binding on me and my heirs, assigns and personal representatives."
    ],
  },
  definition: {
    title: "Pathfinder Club Photo and Video Release",
    description: "Photo and video release for a minor.",
    confirmationMessage: "Thank you. The photo and video release has been received.",
    sections: [
      section("sec_release", "Release", [
        text("minor_name", "Name of minor", true, { helpText: "First and last name." }),
        text("minor_signature", "Minor's typed signature", true, { helpText: "Typing your name here is your signature." }),
        text("guardian_signature", "Parent/guardian typed signature", true, { helpText: "Typing your name here is your signature." }),
        date("release_date", "Date", true, today),
        field("email", "Your email", "EMAIL", false, { helpText: "For the confirmation." }),
      ]),
    ],
  },
};

export const clubFormTemplateSeeds: readonly ClubFormTemplateSeed[] = [
  membershipApplication,
  staffForm,
  permissionSlip,
  passengerList,
  tltApplication,
  pathfinderOfTheYear,
  tltOfTheYear,
  tltRecommendation,
  canCollecting,
  photoRelease,
];

import { describe, expect, it } from "vitest";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { allFields, templateSpecProblems, validateClubFormAnswers } from "@/modules/club-forms/domain";
import { formTemplates, registrationFormDefinitionSchema } from "@/modules/forms/definition";

/** #1221: the six new club form templates. Synthetic data only. */

// Caleb's release text, copied from his comment on issue 1221, including its one remaining "Seventhday".
const RELEASE_TEXT = "I hereby grant permission and authorize the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs the irrevocable right to use, reproduce and publish photographs and videos taken of me and/or the undersigned minor children, and our names, for use for all purposes, in any form, and in any and all media, including, without limitation, printed publications, websites, and outreach purposes, in any manner or in any medium. I understand that such photographs and video recordings of me may be placed on the Internet. I release the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs from any expectation of confidentiality for the undersigned minor children and myself and attest that I am the parent or legal guardian of the children listed below and that I have the authority to consent and allow the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs to use their photographs, videos, and names. I acknowledge that since participation is voluntary, neither the minor children nor I will receive any financial compensation. I agree that participation in any publication and website produced by the Iowa-Missouri Conference of Seventhday Adventists and its affiliated Pathfinder Clubs confers no rights of ownership to me whatsoever and I hereby waive the right to approve the final product. I release the Iowa-Missouri Conference of Seventh-day Adventists, its affiliated Pathfinder Clubs, its contractors, and its employees from liability for any claims by me or any third party in connection with my participation or the participation of the undersigned minor children. I agree that all such portraits, pictures, photographs, video and audio recordings, and any reproductions thereof, and all plates, negatives, recording tape and digital files are and shall remain the property of the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs. This release is binding on me and my heirs, assigns and personal representatives.";

function seed(key: string) {
  const found = clubFormTemplateSeeds.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no seed ${key}`);
  return { ...found, definition: registrationFormDefinitionSchema.parse(found.definition) };
}
const fieldsOf = (key: string) => allFields(seed(key).definition);
const requiredKeys = (key: string) => fieldsOf(key).filter((field) => field.required).map((field) => field.key);
const labels = (key: string) => fieldsOf(key).map((field) => field.label);

const newKeys = [
  "club_tlt_application",
  "club_pathfinder_of_the_year",
  "club_tlt_of_the_year",
  "tlt_program_recommendation",
  "can_collecting_report",
  "pathfinder_photo_video_release",
];

describe("the six new club form templates (#1221)", () => {
  it("are valid, version 1, in order after the first four, and never share a key with an event form template", () => {
    const eventKeys = new Set(formTemplates.map((template) => template.key));
    newKeys.forEach((key, index) => {
      const template = seed(key);
      expect(template.version).toBe(1);
      expect(template.sortOrder).toBe(50 + index * 10);
      expect(templateSpecProblems(template), key).toEqual([]);
      expect(eventKeys.has(key), key).toBe(false);
    });
  });

  it("reuse the event TLT Application and nominations without rewording them", () => {
    const eventLabels = (key: string) => formTemplates.find((template) => template.key === key)!.definition.sections.flatMap((section) => section.fields.map((field) => field.label));
    expect(labels("club_pathfinder_of_the_year")).toEqual(eventLabels("pathfinder_of_the_year"));
    expect(labels("club_tlt_of_the_year")).toEqual(eventLabels("tlt_of_the_year"));
    // Checkboxes carry their statement as the label here (the club fill-in shows labels); every other label is unchanged.
    expect(labels("club_tlt_application").filter((label) => !/^I /.test(label))).toEqual(
      eventLabels("tlt_application").filter((label) => label !== "Accuracy and commitment" && label !== "Application approval"),
    );
    expect(labels("club_tlt_application")).toContain("I affirm that the information above is accurate and I am committed to participating in the TLT Program.");
    expect(labels("club_tlt_application")).toContain("I understand that to attend the retreat, I need to have completed my application and have been approved.");
    expect(seed("club_tlt_of_the_year").definition.title).toBe("TLT of the Year nomination");
    expect(seed("club_pathfinder_of_the_year").definition.title).toBe("Pathfinder of the Year nomination");
    expect(requiredKeys("club_pathfinder_of_the_year")).toContain("essay_why");
  });

  it("shows every checkbox statement as its label, since the club form does not show a placeholder", () => {
    for (const key of newKeys) {
      for (const field of fieldsOf(key)) {
        if (field.type === "CHECKBOX") expect(field.placeholder, `${key}.${field.key}`).toBeUndefined();
      }
    }
  });

  it("builds the TLT Program Recommendation from the issue", () => {
    const template = seed("tlt_program_recommendation");
    expect(template.definition.sections.map((section) => section.title)).toEqual(["Applicant information", "Your information", "Questions", "Affirmation"]);
    expect(requiredKeys("tlt_program_recommendation")).toEqual([
      "applicant_name", "club_name", "recommender_name", "recommender_email",
      "known_how_long", "qualities", "relates_to_people", "responds_to_stress", "honest_evaluation", "signature",
    ]);
    expect(fieldsOf("tlt_program_recommendation").find((field) => field.key === "potential_problems")).toMatchObject({
      label: "Does the applicant have any potential problems that might hinder his/her participation?",
      type: "LONG_TEXT",
      required: false,
    });
    expect(labels("tlt_program_recommendation")).toContain("Type your full name as your signature");
    expect(template.sectionNotes.sec_applicant.join(" ")).toContain("TLT Pledge: Loving the Lord Jesus, I promise to take an active part in the work of the Teen Leadership Training program, doing what I can to help others and to finish the work of the gospel in all the world.");
    expect(template.sectionNotes.sec_affirmation).toEqual(["I affirm that this is my honest evaluation of the applicant, offered in support of their participation in the TLT Program."]);
    expect(template.staffOnlyFieldKeys).toEqual([]);
  });

  it("builds the Can Collecting Report from the issue, with whole-number counts and no mailing or fax line", () => {
    const template = seed("can_collecting_report");
    expect(labels("can_collecting_report")).toEqual(expect.arrayContaining([
      "Club", "Director", "Person submitting report", "Date", "Church",
      "Did you include a picture of your collection and your club?",
      "Number of Pathfinders participating", "Number of staff participating",
      "Total hours spent on the project",
      "Total number of cans/food collected", "Total amount of cash collected ($)", "Total number of food baskets distributed",
    ]));
    expect(fieldsOf("can_collecting_report").find((field) => field.key === "total_hours")!.helpText).toBe("Hours × each participant: for example, 5 participants × 2 hours = 10 hours");
    expect(fieldsOf("can_collecting_report").find((field) => field.key === "included_picture")!.options).toEqual(["Yes", "No"]);
    expect(JSON.stringify(template.definition) + JSON.stringify(template.sectionNotes)).not.toMatch(/fax|mail/i);
    const answers = {
      club_name: "Example Pathfinders", director_name: "Pat Sample", submitted_by: "Pat Sample", report_date: "2026-10-20",
      church: "Not listed", church_other: "Example SDA Church", included_picture: "Yes",
    };
    // The church list is filled in from the directory at run time, so its own check is left out here.
    const problems = (extra: Record<string, unknown> = {}) => validateClubFormAnswers(template.definition, { ...answers, ...extra }).filter((issue) => !issue.key.startsWith("church"));
    expect(problems()).toEqual([]);
    expect(problems({ pathfinders_participating: 2.5 })).not.toEqual([]);
    expect(problems({ pathfinders_participating: 12, cans_collected: 340, cash_collected: 25.5 })).toEqual([]);
  });

  it("carries the photo and video release exactly as Caleb gave it, split only at a sentence break", () => {
    const notes = seed("pathfinder_photo_video_release").sectionNotes.sec_release;
    expect(notes.every((note) => note.length <= 2000)).toBe(true);
    expect(notes.join(" ")).toBe(RELEASE_TEXT);
    expect(notes[0].startsWith("I hereby grant permission and authorize the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Pathfinder Clubs the irrevocable right")).toBe(true);
    expect(notes[notes.length - 1].endsWith("This release is binding on me and my heirs, assigns and personal representatives.")).toBe(true);
    expect(notes.join(" ")).toContain("Seventhday Adventists");
  });

  it("asks the release's questions, drops the director's email, and needs the minor, both signatures and the date", () => {
    expect(requiredKeys("pathfinder_photo_video_release")).toEqual(["minor_name", "minor_signature", "guardian_signature", "release_date"]);
    expect(labels("pathfinder_photo_video_release")).toEqual(["Name of minor", "Minor's typed signature", "Parent/guardian typed signature", "Date", "Your email"]);
    expect(fieldsOf("pathfinder_photo_video_release").find((field) => field.key === "release_date")!.autoDate).toBe("TODAY");
    expect(fieldsOf("pathfinder_photo_video_release").find((field) => field.key === "email")!.type).toBe("EMAIL");
  });
});

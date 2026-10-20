import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRegistrationPdfModel } from "@/modules/registration-pdf/model";
import { renderRegistrationPdf } from "@/modules/registration-pdf/render";
import { selfPayDefinition, springCamporeeSource } from "./support/registration-pdf-fixture";

/**
 * The synthetic sample PDFs under docs/samples (#1082), for the event office to check readability. Made from made-up
 * names only. This test remakes them and compares: if the layout or the rules for what is shown change, it fails until
 * the samples are remade with `WRITE_REGISTRATION_PDF_SAMPLES=1 npx vitest run tests/registration-pdf-sample.test.ts`.
 */

const GENERATED_AT = new Date("2027-03-02T18:00:00.000Z");
const directory = path.join(process.cwd(), "docs", "samples");

const samples = [
  {
    file: "registration-pdf-sample.pdf",
    make: () => renderRegistrationPdf({ model: buildRegistrationPdfModel(springCamporeeSource()), updated: false, generatedAt: GENERATED_AT, timezone: "America/Chicago" }),
  },
  {
    file: "registration-pdf-sample-updated.pdf",
    make: () => renderRegistrationPdf({
      model: buildRegistrationPdfModel({
        ...springCamporeeSource(),
        eventName: "Synthetic Honors Weekend",
        eventDates: "October 8-10, 2027",
        eventLocation: "Example Academy, 1 Sample Lane, Exampleville, ZZ 00000",
        formTitle: "Synthetic Honors Weekend registration",
        definition: selfPayDefinition(),
        registrationResponses: { email: "pat.example@example.test", payment_method: "Card", promo_code: "SYNTHETIC10" },
        attendees: [
          { name: "Avery Example", ageOnEventDate: 12, responses: { first_name: "Avery", last_name: "Example", attendee_age: 12, birth_date: "2015-04-01", allergies: "Synthetic: never printed", class_choice: "Knots" } },
          { name: "Blake Sample", ageOnEventDate: 15, responses: { first_name: "Blake", last_name: "Sample", attendee_age: 15, class_choice: "Birds" } },
        ],
        clubName: null,
        registrantName: "Pat Example",
        submittedOn: "September 1, 2027",
        fees: {
          kind: "AMOUNTS",
          lines: [{ label: "Honors Weekend fee (Avery Example)", amountCents: 4000 }, { label: "Honors Weekend fee (Blake Sample)", amountCents: 4000 }, { label: "Promo code discount", amountCents: -1000 }],
          totalCents: 7000,
          paidCents: 2000,
          owedCents: 5000,
        },
      }),
      updated: true,
      generatedAt: new Date("2027-09-05T15:00:00.000Z"),
      timezone: "America/Chicago",
    }),
  },
];

describe("registration PDF samples (#1082)", () => {
  for (const sample of samples) {
    it(`${sample.file} is what the generator makes today`, async () => {
      const bytes = Buffer.from(await sample.make());
      const target = path.join(directory, sample.file);
      if (process.env.WRITE_REGISTRATION_PDF_SAMPLES === "1") {
        mkdirSync(directory, { recursive: true });
        writeFileSync(target, bytes);
      }
      expect(existsSync(target), "Remake the samples with WRITE_REGISTRATION_PDF_SAMPLES=1.").toBe(true);
      expect(readFileSync(target).equals(bytes), "The committed sample is out of date. Remake it with WRITE_REGISTRATION_PDF_SAMPLES=1.").toBe(true);
    });
  }
});

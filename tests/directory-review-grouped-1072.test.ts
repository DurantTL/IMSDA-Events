import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));

import { listDirectoryReviewEntries } from "@/modules/forms/directory-review";
import { notListedCompanionKey } from "@/modules/forms/definition";
import { generalLinkClubOtherKey } from "@/modules/general-link-registrations/domain";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

// Synthetic: the "Not listed" companion is shown by an All group, so a rule with more than one member still counts (#1072).
const field = (key: string, patch: Record<string, unknown>) => ({ id: `f_${key}`, key, label: key, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...patch });
const groupedDefinition = {
  title: "Honors Weekend registration",
  description: "",
  confirmationMessage: "Done",
  sections: [{
    id: "sec_club",
    title: "Club",
    description: "",
    fields: [
      field("club_name", { label: "Pathfinder club", type: "SELECT", optionSource: "CLUBS_DIRECTORY" }),
      field("church_name", { label: "Church", type: "SELECT", optionSource: "CHURCHES_DIRECTORY" }),
      field("club_name_other", { label: "Club not listed", required: true, conditionalGroup: { match: "ALL", conditions: [
        { fieldKey: "club_name", operator: "EQUALS", value: "Not listed" },
        { fieldKey: "church_name", operator: "NOT_EMPTY", value: "" },
      ] } }),
    ],
  }],
};

beforeEach(() => vi.clearAllMocks());

describe("grouped Not listed companions (#1072)", () => {
  it("the general link finds a companion whose group has the Not listed member", () => {
    const definition = registrationFormDefinitionSchema.parse(groupedDefinition);
    expect(generalLinkClubOtherKey(definition, "club_name")).toBe("club_name_other");
    expect(generalLinkClubOtherKey(definition, "church_name")).toBeNull();
  });

  it("the helper needs EQUALS unless the lenient directory-review form is asked for", () => {
    const fields = [{ key: "other", conditional: { fieldKey: "club", operator: "NOT_EQUALS", value: "Not listed" } }];
    expect(notListedCompanionKey(fields, "club")).toBeNull();
    expect(notListedCompanionKey(fields, "club", { anyOperator: true })).toBe("other");
    expect(notListedCompanionKey([{ key: "plain" }], "club")).toBeNull();
  });

  it("directory review reads the typed name from a grouped companion", async () => {
    dependencies.getPrisma.mockReturnValue({
      registrationForm: { findMany: vi.fn().mockResolvedValue([{ versions: [{ id: "version-1", definition: groupedDefinition }] }]) },
      publicRegistrationSubmission: { findMany: vi.fn().mockResolvedValue([{
        formVersionId: "version-1",
        responses: { club_name: "Not listed", club_name_other: "Made-Up Club" },
        registration: { id: "registration-1", confirmationCode: "REG-1" },
      }]) },
    });
    expect(await listDirectoryReviewEntries("event-1")).toEqual([{
      registrationId: "registration-1",
      confirmationCode: "REG-1",
      source: "CLUBS_DIRECTORY",
      fieldLabel: "Pathfinder club",
      freeText: "Made-Up Club",
    }]);
  });
});

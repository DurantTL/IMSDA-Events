import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

export const draftBase = { helpText: "", options: [] as string[], scope: "REGISTRATION" as const, required: false };

export const draftDefinition = registrationFormDefinitionSchema.parse({
  title: "Synthetic camp form",
  description: "Synthetic.",
  confirmationMessage: "Received.",
  sections: [{
    id: "details",
    title: "Details",
    description: "",
    fields: [
      { ...draftBase, id: "fld1", key: "first_name", label: "First name", type: "TEXT", required: true },
      { ...draftBase, id: "fld2", key: "last_name", label: "Last name", type: "TEXT", required: true },
      { ...draftBase, id: "fld3", key: "email", label: "Email", type: "EMAIL", required: true },
      { ...draftBase, id: "fld4", key: "phone", label: "Phone", type: "PHONE" },
      { ...draftBase, id: "fld5", key: "shirt_size", label: "Shirt size", type: "SELECT", options: ["S", "M", "L"] },
      { ...draftBase, id: "fld6", key: "birth_date", label: "Birth date", type: "DATE", required: true },
      { ...draftBase, id: "fld7", key: "allergies", label: "Allergies", type: "TEXT" },
      { ...draftBase, id: "fld8", key: "notes", label: "Notes", type: "LONG_TEXT" },
      { ...draftBase, id: "fld9", key: "waiver", label: "I agree to the waiver", type: "CHECKBOX", required: true },
      { ...draftBase, id: "fld10", key: "home", label: "Home address", type: "ADDRESS" },
    ],
  }],
});


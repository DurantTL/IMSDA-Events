import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import {
  FORM_NOTIFICATIONS_MAX_PER_FORM,
  LOCATION_CONDITION_KEY,
  checkNotificationRecipients,
  conditionFieldChoices,
  isAllowedConditionKey,
  notificationsPutSchema,
  type FormNotificationConfig,
  type NotificationInput,
} from "@/modules/registration-form-notifications/domain";

/**
 * Reading and saving a registration form's notifications (#1081). The route has already checked the permission
 * (CONFIGURE_EVENT: event administrators, and system administrators who pass every check); everything that decides what
 * is stored is checked here, on the server, against the form's own definition.
 */

export class FormNotificationError extends Error {
  constructor(message: string, readonly code: "FORM_NOT_FOUND" | "INVALID_NOTIFICATIONS") {
    super(message);
    this.name = "FormNotificationError";
  }
}

export type FormNotificationsPanel = {
  notifications: FormNotificationConfig[];
  /** What a condition may look at, and what a notification may include. Nothing sensitive is offered. */
  fields: Array<{ key: string; label: string; options: string[] }>;
  sections: Array<{ id: string; title: string }>;
  locations: Array<{ id: string; name: string }>;
};

function toConfig(row: { id: string; name: string; recipients: string[]; conditionFieldKey: string | null; conditionOperator: string | null; conditionValue: string | null; sectionIds: string[] }): FormNotificationConfig {
  const operator = row.conditionOperator === "NOT_EQUALS" ? "NOT_EQUALS" : "EQUALS";
  return {
    id: row.id,
    name: row.name,
    recipients: row.recipients,
    condition: row.conditionFieldKey ? { fieldKey: row.conditionFieldKey, operator, value: row.conditionValue ?? "" } : null,
    sectionIds: row.sectionIds,
  };
}

/** The form's latest definition that parses: what the panel offers is the form as it is being built. */
async function loadForm(eventId: string, formId: string) {
  const form = await getPrisma().registrationForm.findFirst({
    where: { id: formId, eventId },
    select: {
      id: true,
      versions: { orderBy: { versionNumber: "desc" }, select: { definition: true } },
      notifications: { orderBy: { position: "asc" } },
    },
  });
  if (!form) throw new FormNotificationError("That registration form was not found.", "FORM_NOT_FOUND");
  let definition: RegistrationFormDefinition | null = null;
  for (const version of form.versions) {
    const parsed = registrationFormDefinitionSchema.safeParse(version.definition);
    if (parsed.success) {
      definition = parsed.data;
      break;
    }
  }
  return { form, definition };
}

function panelFor(definition: RegistrationFormDefinition | null, notifications: FormNotificationConfig[], locations: Array<{ id: string; name: string }>): FormNotificationsPanel {
  return {
    notifications,
    fields: definition ? conditionFieldChoices(definition) : [],
    sections: definition ? definition.sections.map((section) => ({ id: section.id, title: section.title })) : [],
    locations,
  };
}

async function eventLocations(eventId: string) {
  return getPrisma().eventLocation.findMany({ where: { eventId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
}

export async function getFormNotificationsPanel(eventId: string, formId: string): Promise<FormNotificationsPanel> {
  const { form, definition } = await loadForm(eventId, formId);
  return panelFor(definition, form.notifications.map(toConfig), await eventLocations(eventId));
}

/**
 * Replaces the form's whole notification list. Rows keep their id when the request names it (so what each one already
 * sent is remembered), new ones are created, and rows left out are removed. Audited with ids and counts only: never an
 * address, a name or a condition value.
 */
export async function replaceFormNotifications(eventId: string, formId: string, actorUserId: string, body: unknown): Promise<FormNotificationsPanel> {
  const parsed = notificationsPutSchema.safeParse(body);
  if (!parsed.success) throw new FormNotificationError(parsed.error.issues[0]?.message ?? "The notifications could not be read.", "INVALID_NOTIFICATIONS");
  const { form, definition } = await loadForm(eventId, formId);
  if (!definition) throw new FormNotificationError("Fix this form's questions and save it before adding notifications.", "INVALID_NOTIFICATIONS");
  const locations = await eventLocations(eventId);
  const sectionIds = new Set(definition.sections.map((section) => section.id));
  const existingIds = new Set(form.notifications.map((row) => row.id));
  const allLocationIds = new Set((await getPrisma().eventLocation.findMany({ where: { eventId }, select: { id: true } })).map((row) => row.id));

  const checked = parsed.data.notifications.map((input: NotificationInput, index) => {
    const label = `Notification ${index + 1}`;
    const recipients = checkNotificationRecipients(input.recipients);
    if (!recipients.ok) throw new FormNotificationError(`${label}: ${recipients.message}`, "INVALID_NOTIFICATIONS");
    if (input.id && !existingIds.has(input.id)) throw new FormNotificationError(`${label} no longer exists. Reload the page and try again.`, "INVALID_NOTIFICATIONS");
    if (input.condition) {
      if (!isAllowedConditionKey(definition, input.condition.fieldKey)) {
        throw new FormNotificationError(`${label}: choose a question from the list for the condition.`, "INVALID_NOTIFICATIONS");
      }
      if (input.condition.fieldKey === LOCATION_CONDITION_KEY && !allLocationIds.has(input.condition.value)) {
        throw new FormNotificationError(`${label}: choose one of this event's locations.`, "INVALID_NOTIFICATIONS");
      }
    }
    const chosenSections = [...new Set(input.sectionIds)];
    if (chosenSections.some((id) => !sectionIds.has(id))) {
      throw new FormNotificationError(`${label}: a chosen section is not in this form.`, "INVALID_NOTIFICATIONS");
    }
    return { input, emails: recipients.emails, sections: chosenSections, index };
  });
  if (checked.length > FORM_NOTIFICATIONS_MAX_PER_FORM) {
    throw new FormNotificationError(`A form has at most ${FORM_NOTIFICATIONS_MAX_PER_FORM} notifications.`, "INVALID_NOTIFICATIONS");
  }

  const saved = await getPrisma().$transaction(async (tx) => {
    const keptIds = checked.flatMap((entry) => (entry.input.id ? [entry.input.id] : []));
    const removed = await tx.registrationFormNotification.deleteMany({ where: { formId, id: { notIn: keptIds } } });
    const ids: string[] = [];
    for (const entry of checked) {
      const data = {
        position: entry.index,
        name: entry.input.name,
        recipients: entry.emails,
        conditionFieldKey: entry.input.condition?.fieldKey ?? null,
        conditionOperator: entry.input.condition?.operator ?? null,
        conditionValue: entry.input.condition?.value ?? null,
        sectionIds: entry.sections,
      };
      if (entry.input.id) {
        await tx.registrationFormNotification.update({ where: { id: entry.input.id }, data });
        ids.push(entry.input.id);
      } else {
        const created = await tx.registrationFormNotification.create({ data: { ...data, formId }, select: { id: true } });
        ids.push(created.id);
      }
    }
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "REGISTRATION_FORM_NOTIFICATIONS_CHANGED",
      entityType: "RegistrationForm",
      entityId: formId,
      summary: "Changed a registration form's notifications.",
      // Ids and counts only: never an address, a notification name or a condition value.
      metadata: {
        formId,
        notificationIds: ids,
        notificationCount: ids.length,
        removedCount: removed.count,
        recipientCount: checked.reduce((sum, entry) => sum + entry.emails.length, 0),
        conditionCount: checked.filter((entry) => entry.input.condition).length,
        sectionFilterCount: checked.filter((entry) => entry.sections.length > 0).length,
      },
    }, tx);
    return tx.registrationFormNotification.findMany({ where: { formId }, orderBy: { position: "asc" } });
  });
  return panelFor(definition, saved.map(toConfig), locations);
}

/**
 * Where each Event settings value comes from (#1258, from #1076). Derived from the real data on every render, never
 * hardcoded per field:
 * - "central": the event has no value of its own and uses the one set on Platform settings or Email.
 * - "override": the event's own value differs from the central one, so the event's value is used.
 * - "template": the platform default was copied into the event when it was created, and the event still matches it.
 *   Changing Platform settings later never rewrites the event (see `createEvent`), so it is a copy, not a link.
 *
 * Pure and client-safe: it only compares values the page already has.
 */
export type SettingOwnershipSource = "central" | "override" | "template";

export type SettingOwnership = {
  source: SettingOwnershipSource;
  /** The short badge text. */
  label: string;
  /** One plain sentence saying what that means for this value. */
  detail: string;
};

export const settingOwnershipLabels: Record<SettingOwnershipSource, string> = {
  central: "Central value",
  override: "Event override",
  template: "Template copy",
};

function ownership(source: SettingOwnershipSource, detail: string): SettingOwnership {
  return { source, label: settingOwnershipLabels[source], detail };
}

export type EventPlatformDefaults = {
  defaultTimezone: string;
  defaultAttendeeEditPolicy: "TIERED" | "VERIFY_EVERY_EDIT";
};

export type EventEmailSender = {
  /** The event's display name as resolved (the event's own, else the central one). */
  senderName: string;
  /** The event's own reply-to, blank when it uses the central one. */
  replyToOverride: string | null;
  central: { name: string; replyTo: string | null };
};

const policyLabels: Record<EventPlatformDefaults["defaultAttendeeEditPolicy"], string> = {
  VERIFY_EVERY_EDIT: "email a code for every edit",
  TIERED: "allow low-risk answers without a code",
};

export function timezoneOwnership(value: string, defaults: EventPlatformDefaults, describe: (zone: string) => string = (zone) => zone): SettingOwnership {
  return value === defaults.defaultTimezone
    ? ownership("template", `Copied from the platform default (${describe(defaults.defaultTimezone)}) when the event was created. Changing the platform default later does not change this event.`)
    : ownership("override", `This event uses its own timezone; the platform default is ${describe(defaults.defaultTimezone)}.`);
}

export function attendeeEditPolicyOwnership(value: EventPlatformDefaults["defaultAttendeeEditPolicy"], defaults: EventPlatformDefaults): SettingOwnership {
  return value === defaults.defaultAttendeeEditPolicy
    ? ownership("template", `Copied from the platform default (${policyLabels[defaults.defaultAttendeeEditPolicy]}) when the event was created. Changing the platform default later does not change this event.`)
    : ownership("override", `This event's own choice; the platform default is to ${policyLabels[defaults.defaultAttendeeEditPolicy]}.`);
}

export function emailDisplayNameOwnership(sender: EventEmailSender): SettingOwnership {
  return sender.senderName.trim() === sender.central.name.trim()
    ? ownership("central", `Email uses the central sender name, ${sender.central.name}. The From address is always the central one.`)
    : ownership("override", `Email from this event shows ${sender.senderName} instead of the central sender name, ${sender.central.name}.`);
}

export function emailReplyToOwnership(sender: EventEmailSender): SettingOwnership {
  const override = sender.replyToOverride?.trim() ?? "";
  if (override) {
    return ownership("override", `Replies go to ${override} instead of ${sender.central.replyTo ? `the central reply-to, ${sender.central.replyTo}` : "no central reply-to"}.`);
  }
  return ownership("central", sender.central.replyTo ? `Replies go to the central reply-to, ${sender.central.replyTo}.` : "No reply-to is set, so replies go to the central From address.");
}

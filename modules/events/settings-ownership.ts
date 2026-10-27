/**
 * How each saved Event settings value relates to the central one (#1258, from #1076). Derived from the real data on every
 * render, and it only says what can be checked by comparing values: the data does not record whether a value was copied
 * at creation or chosen later, so nothing here claims when or how it was set.
 * - "central": the event's saved value is the same as the central value (Platform settings or the central sender).
 * - "override": the event's saved value differs from the central one, so the event's own value is used.
 * Compared against the SAVED event, never the unsaved draft, so a label never describes something not yet saved.
 *
 * Pure and client-safe.
 */
export type SettingOwnershipSource = "central" | "override";

export type SettingOwnership = {
  source: SettingOwnershipSource;
  /** The short badge text. */
  label: string;
  /** One plain sentence saying what that means for this value. */
  detail: string;
};

export const settingOwnershipLabels: Record<SettingOwnershipSource, string> = {
  central: "Same as central",
  override: "Event override",
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

const aheadOfChange = "Changing the platform default does not change an existing event.";

export function timezoneOwnership(savedValue: string, defaults: EventPlatformDefaults, describe: (zone: string) => string = (zone) => zone): SettingOwnership {
  return savedValue === defaults.defaultTimezone
    ? ownership("central", `Same as the platform default (${describe(defaults.defaultTimezone)}). ${aheadOfChange}`)
    : ownership("override", `Differs from the platform default (${describe(defaults.defaultTimezone)}). ${aheadOfChange}`);
}

export function attendeeEditPolicyOwnership(savedValue: EventPlatformDefaults["defaultAttendeeEditPolicy"], defaults: EventPlatformDefaults): SettingOwnership {
  return savedValue === defaults.defaultAttendeeEditPolicy
    ? ownership("central", `Same as the platform default (${policyLabels[defaults.defaultAttendeeEditPolicy]}). ${aheadOfChange}`)
    : ownership("override", `Differs from the platform default (${policyLabels[defaults.defaultAttendeeEditPolicy]}). ${aheadOfChange}`);
}

export function emailDisplayNameOwnership(sender: EventEmailSender): SettingOwnership {
  return sender.senderName.trim() === sender.central.name.trim()
    ? ownership("central", `Same as the central sender name, ${sender.central.name}. The From address is always the central one.`)
    : ownership("override", `Differs from the central sender name (${sender.central.name}): email from this event shows ${sender.senderName}.`);
}

export function emailReplyToOwnership(sender: EventEmailSender): SettingOwnership {
  const override = sender.replyToOverride?.trim() ?? "";
  if (override && override !== (sender.central.replyTo ?? "").trim()) {
    return ownership("override", `Differs from the central reply-to (${sender.central.replyTo || "none set"}): replies go to ${override}.`);
  }
  return ownership("central", sender.central.replyTo ? `Same as the central reply-to, ${sender.central.replyTo}.` : "No reply-to is set, so replies go to the central From address.");
}

/**
 * What staff control on the public Club forms page (#1562): per form, shown or hidden, its group, its order and the
 * short line under its name, plus the "Before you begin" intro. Pure, so the editor, the API and the public page share
 * one set of rules. The fixed list in `public-index-domain.ts` stays the source of every form and every link; these
 * settings are laid over it by item id and can never add an item or a link.
 */

import { z } from "zod";
import { publicClubFormGroups, type PublicClubFormGroup } from "@/modules/club-forms/public-index-domain";

export const defaultPublicClubFormsIntro =
  "Director forms ask you to sign in and choose your club. For a form sent by private link, ask your club director. Forms that are not available or are closed have no link to open.";

export const publicClubFormsLimits = { intro: 600, description: 200, items: 100 } as const;

export const publicClubFormGroupIds = publicClubFormGroups.map((group) => group.id);

export type PublicClubFormSettingItem = { id: string; shown: boolean; groupId: string; description: string };
export type PublicClubFormsSettings = { intro: string; items: PublicClubFormSettingItem[] };

const itemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  shown: z.boolean(),
  groupId: z.string().refine((value) => publicClubFormGroupIds.includes(value), "Choose one of the groups on the page."),
  description: z.string().trim().min(1, "Each form needs a short description.").max(publicClubFormsLimits.description, `A description can be at most ${publicClubFormsLimits.description} characters.`),
});

export const publicClubFormsSettingsSchema = z.object({
  intro: z.string().trim().min(1, "The intro text cannot be empty.").max(publicClubFormsLimits.intro, `The intro can be at most ${publicClubFormsLimits.intro} characters.`),
  items: z.array(itemSchema).max(publicClubFormsLimits.items),
});

/** The first problem in plain words. */
export function publicClubFormsProblem(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the settings and try again.";
}

/** Parses stored or submitted settings; null when they do not fit the rules. */
export function parsePublicClubFormsSettings(value: unknown): PublicClubFormsSettings | null {
  const parsed = publicClubFormsSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Today's page: every built-in form shown, in its built-in group and order, with its built-in line. */
export function defaultPublicClubFormsSettings(): PublicClubFormsSettings {
  return {
    intro: defaultPublicClubFormsIntro,
    items: publicClubFormGroups.flatMap((group) => group.items.map((item) => ({ id: item.id, shown: true, groupId: group.id, description: item.who }))),
  };
}

/**
 * The settings with every built-in form present once: stored entries first (unknown ids dropped, repeats ignored), then
 * any built-in form the stored settings do not mention, shown, in its built-in group. The editor starts from this.
 */
export function completePublicClubFormsSettings(settings: PublicClubFormsSettings | null): PublicClubFormsSettings {
  const defaults = defaultPublicClubFormsSettings();
  if (!settings) return defaults;
  const known = new Map(defaults.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const items: PublicClubFormSettingItem[] = [];
  for (const stored of settings.items) {
    if (!known.has(stored.id) || seen.has(stored.id)) continue;
    seen.add(stored.id);
    items.push(stored);
  }
  for (const item of defaults.items) if (!seen.has(item.id)) items.push(item);
  return { intro: settings.intro, items };
}

/**
 * The groups the public page draws: the fixed list with the settings laid over it. Hidden forms are left out, a form
 * moves to its chosen group in the chosen order, and its line is the stored description. Everything else about an item
 * (its kind, its link target, its template) comes from the fixed list, so hiding or moving can never add a link.
 */
export function applyPublicClubFormsSettings(settings: PublicClubFormsSettings | null): PublicClubFormGroup[] {
  const complete = completePublicClubFormsSettings(settings);
  const fixed = new Map(publicClubFormGroups.flatMap((group) => group.items.map((item) => [item.id, item] as const)));
  return publicClubFormGroups.map((group) => ({
    id: group.id,
    title: group.title,
    items: complete.items.flatMap((entry) => {
      const item = fixed.get(entry.id);
      return item && entry.shown && entry.groupId === group.id ? [{ ...item, who: entry.description }] : [];
    }),
  }));
}

/** The intro the public page shows. */
export function publicClubFormsIntro(settings: PublicClubFormsSettings | null): string {
  return settings?.intro ?? defaultPublicClubFormsIntro;
}

/** What differs between two settings, in words for the audit row (form ids and field names only, never text). */
export function changedPublicClubFormsKeys(before: PublicClubFormsSettings | null, after: PublicClubFormsSettings): string[] {
  const a = completePublicClubFormsSettings(before);
  const b = completePublicClubFormsSettings(after);
  const keys: string[] = [];
  if (a.intro !== b.intro) keys.push("intro");
  // Order is compared within each group, among the forms that stay in it, so moving one form does not flag the rest.
  const previous = new Map(a.items.map((item) => [item.id, item]));
  const nextGroup = new Map(b.items.map((item) => [item.id, item.groupId]));
  const stays = (item: PublicClubFormSettingItem) => previous.get(item.id)?.groupId === nextGroup.get(item.id);
  const position = (settings: PublicClubFormsSettings, id: string, groupId: string) =>
    settings.items.filter((entry) => entry.groupId === groupId && stays(entry)).findIndex((entry) => entry.id === id);
  for (const item of b.items) {
    const old = previous.get(item.id);
    if (!old) continue;
    if (old.shown !== item.shown) keys.push(`${item.id}:shown`);
    if (old.groupId !== item.groupId) keys.push(`${item.id}:group`);
    if (old.description !== item.description) keys.push(`${item.id}:description`);
    if (old.groupId === item.groupId && position(a, item.id, item.groupId) !== position(b, item.id, item.groupId)) keys.push(`${item.id}:order`);
  }
  return keys;
}

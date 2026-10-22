import { buildRegistrationEmbedCode } from "@/modules/forms/embed";

export const SAVED_SHARE_ADDRESS_NOTE = "Public links use the saved address. Save changes to update them.";

type ShareFields = { slug: string; name: string };

/** Public links always come from the last server-saved slug, never the typed one. */
export function publicEventPath(saved: Pick<ShareFields, "slug">) {
  return `/events/${encodeURIComponent(saved.slug)}`;
}

export function embedPath(saved: Pick<ShareFields, "slug">, formSlug: string) {
  return `/embed/${saved.slug}/${formSlug}`;
}

export function shareAddressDiffers(draft: Pick<ShareFields, "slug">, saved: Pick<ShareFields, "slug">) {
  return draft.slug !== saved.slug;
}

/** Copied feedback belongs to one saved address and form; a different address shows nothing. */
export function isCopiedFor(
  copied: { eventSlug: string; formSlug: string } | null,
  saved: Pick<ShareFields, "slug">,
  formSlug: string,
) {
  return copied !== null && copied.eventSlug === saved.slug && copied.formSlug === formSlug;
}

export async function copySavedEmbedCode(input: {
  origin: string;
  saved: ShareFields;
  formSlug: string;
  writeText: (text: string) => Promise<void>;
}): Promise<{ ok: true; copied: { eventSlug: string; formSlug: string } } | { ok: false }> {
  const code = buildRegistrationEmbedCode({
    origin: input.origin,
    eventSlug: input.saved.slug,
    formSlug: input.formSlug,
    eventName: input.saved.name,
  });
  try {
    await input.writeText(code);
    return { ok: true, copied: { eventSlug: input.saved.slug, formSlug: input.formSlug } };
  } catch {
    return { ok: false };
  }
}

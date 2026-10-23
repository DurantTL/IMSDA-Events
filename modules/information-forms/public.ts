import "server-only";

import { InformationFormScope, InformationFormStatus, InformationFormVersionStatus } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { parseStoredInformationFormDefinition, type InformationFormDefinition } from "@/modules/information-forms/definition";
import { getPublicEventLanding } from "@/modules/events/public-repository";

/**
 * What a visitor to an information form's public address sees (#1150). Only OPEN and CLOSED forms with a published
 * version exist publicly; drafts, unknown slugs and forms of an event that is not public are all "not found", so the
 * address says nothing about what staff are still preparing.
 */

export type PublicInformationFormTarget = { slug: string; eventSlug?: string };

export type PublicInformationFormView =
  | { state: "NOT_FOUND" }
  | { state: "NOT_YET_OPEN"; id: string; name: string; opensAt: Date; eventName: string | null }
  | { state: "CLOSED"; id: string; name: string; eventName: string | null }
  | {
    state: "OPEN";
    form: { id: string; name: string; fillAccess: "ANYONE_WITH_LINK" | "SIGNED_IN"; closesAt: Date | null; definition: InformationFormDefinition };
    eventName: string | null;
  };

export function publicInformationFormPath(target: PublicInformationFormTarget) {
  return target.eventSlug
    ? `/events/${encodeURIComponent(target.eventSlug)}/forms/${encodeURIComponent(target.slug)}`
    : `/forms/${encodeURIComponent(target.slug)}`;
}

/** A stable key for rate limits: one per public address. */
export function publicInformationFormKey(target: PublicInformationFormTarget) {
  return `${target.eventSlug ?? "general"}/${target.slug}`;
}

export async function resolvePublicInformationForm(target: PublicInformationFormTarget, now = new Date()): Promise<PublicInformationFormView> {
  let eventName: string | null = null;
  if (target.eventSlug) {
    // The existing public lookup: published and not archived.
    const landing = await getPublicEventLanding(target.eventSlug);
    if (!landing) return { state: "NOT_FOUND" };
    eventName = landing.event.name;
  }
  const form = await getPrisma().informationForm.findFirst({
    where: {
      slug: target.slug,
      ...(target.eventSlug
        ? { scope: InformationFormScope.EVENT, event: { slug: target.eventSlug, isPublished: true, archivedAt: null } }
        : { scope: InformationFormScope.GENERAL, eventId: null }),
      status: { in: [InformationFormStatus.OPEN, InformationFormStatus.CLOSED] },
    },
    include: { versions: { where: { status: InformationFormVersionStatus.PUBLISHED }, take: 1 } },
  });
  const version = form?.versions[0];
  if (!form || !version) return { state: "NOT_FOUND" };
  if (form.status === InformationFormStatus.CLOSED || (form.closesAt && form.closesAt <= now)) return { state: "CLOSED", id: form.id, name: form.name, eventName };
  if (form.opensAt && form.opensAt > now) return { state: "NOT_YET_OPEN", id: form.id, name: form.name, opensAt: form.opensAt, eventName };
  return {
    state: "OPEN",
    eventName,
    form: { id: form.id, name: form.name, fillAccess: form.fillAccess, closesAt: form.closesAt, definition: parseStoredInformationFormDefinition(version.definition) },
  };
}

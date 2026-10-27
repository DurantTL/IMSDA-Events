import { publicEventPath, shareAddressDiffers, SAVED_SHARE_ADDRESS_NOTE } from "@/modules/events/share-links";

/**
 * The short "Public page and links" overview at the top of Step 3 (#448). Pure and
 * read-only: it describes what is saved, never what is typed, so it can never
 * offer a working link to an event that is not public.
 */

export const CREATE_NOT_PUBLIC_TEXT = "Not public yet. Save the draft, then publish.";
export const DRAFT_NOT_PUBLIC_TEXT = "Not public yet: a draft. Publish it from the readiness panel.";
export const ARCHIVED_TEXT = "Archived: hidden from the public site.";
export const PUBLIC_TEXT = "Public";
export const LINK_WORKS_AFTER_PUBLISH_TEXT = "Works once the event is published.";
export const CREATE_PAGE_ADDRESS_TEXT = "Your page address once saved and published.";
export const CREATE_CALENDAR_NOTE = "Chosen in the features step above.";
export const CHANGE_ON_FEATURES_LABEL = "Change on Event features";

export type PublicPageOverviewInput =
  | { mode: "create"; typedSlug: string; showOnCalendar: boolean }
  | {
      mode: "edit";
      eventId: string;
      published: boolean;
      archivedAt: string | null;
      savedSlug: string;
      typedSlug: string;
      showOnCalendar: boolean;
    };

export type PublicPageOverview = {
  isPublic: boolean;
  status: { label: string; text: string };
  page: {
    label: string;
    /** The path to show; null when there is nothing to show yet. */
    path: string | null;
    /** Set only when the event is public: the one case where the path is a link. */
    href: string | null;
    note: string | null;
    addressNote: string | null;
  };
  calendar: { label: string; text: string; note: string | null; href: string | null; linkLabel: string | null };
};

export function featuresHref(eventId: string) {
  return `/more/features?event=${encodeURIComponent(eventId)}`;
}

export function getPublicPageOverview(input: PublicPageOverviewInput): PublicPageOverview {
  if (input.mode === "create") {
    const slug = input.typedSlug.trim();
    return {
      isPublic: false,
      status: { label: "Public or not", text: CREATE_NOT_PUBLIC_TEXT },
      page: {
        label: "Page link",
        path: slug ? publicEventPath({ slug }) : null,
        href: null,
        note: slug ? CREATE_PAGE_ADDRESS_TEXT : null,
        addressNote: null,
      },
      calendar: {
        label: "Show on calendar",
        text: input.showOnCalendar ? "On the calendar once published" : "Hidden",
        note: CREATE_CALENDAR_NOTE,
        href: null,
        linkLabel: null,
      },
    };
  }

  const archived = Boolean(input.archivedAt);
  const isPublic = input.published && !archived;
  const path = input.savedSlug ? publicEventPath({ slug: input.savedSlug }) : null;
  const statusText = archived ? ARCHIVED_TEXT : isPublic ? PUBLIC_TEXT : DRAFT_NOT_PUBLIC_TEXT;
  const calendarText = !input.showOnCalendar
    ? isPublic ? "Hidden from the calendar" : "Hidden"
    : isPublic ? "On the calendar" : "On the calendar once published";
  return {
    isPublic,
    status: { label: "Public or not", text: statusText },
    page: {
      label: "Page link",
      path,
      href: isPublic ? path : null,
      note: isPublic ? null : LINK_WORKS_AFTER_PUBLISH_TEXT,
      addressNote: isPublic && shareAddressDiffers({ slug: input.typedSlug }, { slug: input.savedSlug })
        ? SAVED_SHARE_ADDRESS_NOTE
        : null,
    },
    calendar: {
      label: "Show on calendar",
      text: calendarText,
      note: null,
      href: featuresHref(input.eventId),
      linkLabel: CHANGE_ON_FEATURES_LABEL,
    },
  };
}

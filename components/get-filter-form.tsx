"use client";

import { type ComponentProps, type SubmitEvent } from "react";
import { isCurrentAddress, searchAsYouTypeHref, useListNavigation } from "@/components/search-as-you-type";
import styles from "./get-filter-form.module.css";

/** The address a plain GET form would go to: its action's path plus its fields, empty ones left out, page back to 1. */
export function filterFormHref(action: string, fields: Iterable<[string, FormDataEntryValue]>, resetParams: string[] = ["page"]) {
  return searchAsYouTypeHref(action, "", fields, { resetParams });
}

/**
 * A filter form that stays a plain GET form (#1557, rule G1: one helper for every list filter). Without script the browser
 * submits it as usual. With script, Apply updates the list in place: it pushes the new address (so Back and shared links
 * keep the filters, rule B2), does not scroll to the top, and marks the form `aria-busy` while the new list loads.
 * A submit button with its own `formaction`, `formmethod` or `formtarget`, a form with a `target`, or a form with
 * a non-GET method keeps the browser's own behaviour.
 */
export function GetFilterForm({ children, className, onSubmit, resetParams, ...props }: Omit<ComponentProps<"form">, "method"> & { resetParams?: string[] }) {
  const { go, pending } = useListNavigation();
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    onSubmit?.(event);
    if (event.defaultPrevented) return;
    const form = event.currentTarget;
    const submitter = event.nativeEvent.submitter;
    if (props.target || submitter?.hasAttribute("formaction") || submitter?.hasAttribute("formmethod") || submitter?.hasAttribute("formtarget")) return;
    event.preventDefault();
    const path = new URL(form.action || window.location.href, window.location.href).pathname;
    const href = filterFormHref(path, new FormData(form).entries() as Iterable<[string, FormDataEntryValue]>, resetParams);
    // Applying the same filters again must not stack an entry or reload.
    if (isCurrentAddress(href)) return;
    go(href, "push");
  };
  return (
    <form {...props} aria-busy={pending || undefined} className={[className, pending ? styles.busy : ""].filter(Boolean).join(" ") || undefined} method="get" onSubmit={handleSubmit}>
      {children}
    </form>
  );
}

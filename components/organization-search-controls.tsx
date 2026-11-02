"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPager } from "@/components/list-pager";
import { useSearchAsYouType, useSyncSearchField } from "@/components/search-as-you-type";
import { listSearchParams, ORGANIZATION_SEARCH_MAX_LENGTH } from "@/modules/organizations/search";

type Option = { value: string; label: string };

/** `sort` and `dir` are set only on a list that sorts (the directory, #1458); they ride along when the search or a filter changes. */
export type OrganizationListState = { q: string; kind: string; status: string; sort?: string; dir?: string };

// Kept here so existing importers keep working; the one implementation is components/search-as-you-type.tsx (#1431).
export { SEARCH_DEBOUNCE_MS, syncFieldValue } from "@/components/search-as-you-type";

export function organizationListHref(basePath: string, state: OrganizationListState, page = 1) {
  const params = listSearchParams({ q: state.q, kind: state.kind, status: state.status, page });
  if (state.sort) { params.set("sort", state.sort); params.set("dir", state.dir || "asc"); }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * The shared filter bar of the Clubs and churches page and the organization
 * directory (#723): a search box, Kind and Status, and the Filter button. It is
 * a plain GET form, so it works before the script loads and Enter submits it.
 * With script, typing updates the list after a short pause (replace) and a Kind or
 * Status change adds a history entry (push); the query lives in the URL, so Back and
 * shared links keep it.
 */
export function OrganizationSearchControls({
  basePath,
  kindOptions,
  placeholder,
  searchLabel,
  state,
  statusOptions,
}: {
  basePath: string;
  kindOptions: Option[];
  placeholder: string;
  searchLabel: string;
  state: OrganizationListState;
  statusOptions: Option[];
}) {
  const { formProps, formRef, cancel } = useSearchAsYouType({ ignoreValues: { status: "ALL" }, pathname: basePath });
  useSyncSearchField(formRef, "q", state.q);
  useSyncSearchField(formRef, "kind", state.kind);
  useSyncSearchField(formRef, "status", state.status);

  return (
    <form
      {...formProps}
      action={basePath}
      className="org-filter-bar"
      method="get"
      role="search"
    >
      <label className="org-filter-field org-filter-search">
        <span>{searchLabel}</span>
        <input
          autoComplete="off"
          defaultValue={state.q}
          maxLength={ORGANIZATION_SEARCH_MAX_LENGTH}
          name="q"
          placeholder={placeholder}
          type="search"
        />
      </label>
      <label className="org-filter-field">
        <span>Kind</span>
        <select defaultValue={state.kind} name="kind">
          {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="org-filter-field">
        <span>Status</span>
        <select data-default-value="ALL" defaultValue={state.status} name="status">
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {state.sort && <><input name="sort" type="hidden" value={state.sort} /><input name="dir" type="hidden" value={state.dir || "asc"} /></>}
      <button className="secondary-button org-filter-submit" type="submit">Filter</button>
      {/* Rule B2 (#1456): shown whenever a search or filter is set, and a search still waiting on its pause cannot put it back. */}
      {(state.q !== "" || state.kind !== "" || state.status !== "ALL") && (
        <Link className="secondary-button org-filter-submit" href={basePath} onClick={cancel}>Clear filters</Link>
      )}
    </form>
  );
}

/** Previous/next paging that keeps the search and filters in the URL. */
export function OrganizationListPager({
  basePath,
  page,
  pageCount,
  pageSize,
  state,
  total,
}: {
  basePath: string;
  page: number;
  pageCount: number;
  pageSize: number;
  state: OrganizationListState;
  total: number;
}) {
  const router = useRouter();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <ListPager
      label="Organization pages"
      onPage={(next) => router.push(organizationListHref(basePath, state, next))}
      slice={{ from, page, pageCount, to, total }}
    />
  );
}

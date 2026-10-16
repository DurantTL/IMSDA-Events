import Link from "next/link";
import { Search, X } from "lucide-react";
import {
  activeFilterKeys,
  hasActiveFilters,
  serializeOperationsSearchQuery,
  type OperationsSearchQuery,
  type SearchFilterDescriptor,
  type SearchIssue,
} from "@/modules/registrations/operations-search-domain";

export type OperationsSearchSummary = {
  total: number;
  page: number;
  pageCount: number;
  issues: SearchIssue[];
};

const filterLabels: Record<string, string> = {
  status: "Status",
  attendeeType: "Attendee type",
  source: "Source",
  location: "Location",
  organization: "Organization",
  waitlist: "Waitlist",
  payment: "Payment",
  checkIn: "Check-in",
  tag: "Tag",
  sort: "Sort",
  size: "Page size",
  page: "Page",
  answerQuestion: "Answer filter",
  answerValue: "Answer filter",
  search: "Search",
  q: "Search",
  answer: "Form answer",
};

function humanize(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Server-side search and filters for the People list (#180). A plain GET form,
 * so the whole search lives in the URL, works before any script loads, and
 * reads back through the same parser the server uses. It renders only the
 * filters the server says this viewer may use on this event; the server
 * enforces the same rule again on every request, so a hand-edited URL gets no
 * further than this form does. Whatever the URL already holds that the form
 * has no single control for (a second answer, several values of one filter,
 * the sort and page size) rides along as hidden fields, so searching again
 * never quietly drops part of the search.
 */
export function OperationsSearchBar({
  eventId,
  basePath,
  filters,
  query,
  summary,
  carry,
}: {
  eventId: string;
  basePath: string;
  filters: SearchFilterDescriptor[];
  query: OperationsSearchQuery;
  summary: OperationsSearchSummary | null;
  /** Other URL parameters to keep (the page's own, not the search's). */
  carry: Record<string, string | undefined>;
}) {
  const current: Record<string, readonly string[]> = {
    status: query.status,
    attendeeType: query.attendeeType,
    source: query.source,
    location: query.location,
    organization: query.organization,
    waitlist: query.waitlist,
    payment: query.payment,
    checkIn: query.checkIn ? [query.checkIn] : [],
    tag: query.tag,
  };
  const chosenAnswers = [...new Set(query.answers.flatMap((answer) => answer.values.map((value) => `${answer.question}=${value}`)))];
  // The canonical form of the sort and page size, so they survive a new search.
  const kept = new URLSearchParams(serializeOperationsSearchQuery({ ...query, page: 1 }));

  function pageHref(page: number) {
    const params = new URLSearchParams(serializeOperationsSearchQuery({ ...query, page }));
    params.set("event", eventId);
    for (const [key, value] of Object.entries(carry)) if (value && !params.has(key)) params.set(key, value);
    return `${basePath}?${params.toString()}`;
  }
  const clearParams = new URLSearchParams({ event: eventId });
  for (const [key, value] of Object.entries(carry)) if (value && key !== "location") clearParams.set(key, value);
  const active = hasActiveFilters(query);

  return (
    <section aria-label="Search registrations" className="operations-search" data-testid="operations-search">
      <details className="operations-search-disclosure" data-testid="operations-search-disclosure" open={activeFilterKeys(query).some((key) => key !== "location") || summary !== null}>
      <summary>Advanced search</summary>
      <form action={basePath} className="form-stack operations-search-form" method="get">
        <input name="event" type="hidden" value={eventId} />
        {Object.entries(carry).map(([key, value]) => (value ? <input key={key} name={key} type="hidden" value={value} /> : null))}
        {kept.get("sort") ? <input name="sort" type="hidden" value={kept.get("sort") as string} /> : null}
        {kept.get("size") ? <input name="size" type="hidden" value={kept.get("size") as string} /> : null}
        {filters.map((filter) => {
          if (filter.key === "q") {
            return (
              <label className="field" key="q">
                <span>Search</span>
                <input defaultValue={query.text} maxLength={100} name="q" placeholder="Name, email, phone or confirmation code" type="search" />
              </label>
            );
          }
          if (filter.kind === "enum" && filter.key === "status") {
            return (
              <fieldset className="field operations-search-status" key="status">
                <legend>{filterLabels.status}</legend>
                {filter.options.map((option) => (
                  <label className="checkbox-label" key={option.value}>
                    <input defaultChecked={current.status.includes(option.value)} name="status" type="checkbox" value={option.value} /> {humanize(option.value)}
                  </label>
                ))}
              </fieldset>
            );
          }
          if (filter.kind === "enum") {
            const values = current[filter.key] ?? [];
            const labelOf = (value: string) => {
              const option = filter.options.find((candidate) => candidate.value === value);
              return option && "label" in option ? option.label : humanize(value);
            };
            // More than one value chosen (from a link): keep them all, shown as text, rather than a one-value control that drops the rest.
            if (values.length > 1) {
              return (
                <div className="field" key={filter.key}>
                  <span>{filterLabels[filter.key] ?? humanize(filter.key)}</span>
                  <span>{values.map(labelOf).join(", ")}</span>
                  <input name={filter.key} type="hidden" value={values.join(",")} />
                </div>
              );
            }
            return (
              <label className="field" key={filter.key}>
                <span>{filterLabels[filter.key] ?? humanize(filter.key)}</span>
                <select defaultValue={values[0] ?? ""} name={filter.key}>
                  <option value="">Any</option>
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>{"label" in option ? option.label : humanize(option.value)}</option>
                  ))}
                </select>
              </label>
            );
          }
          if (filter.kind === "questions") {
            if (chosenAnswers.length > 1) {
              return (
                <div className="field" key="answer">
                  <span>{filterLabels.answer}</span>
                  <span>{chosenAnswers.length} answers chosen</span>
                  {chosenAnswers.map((answer) => <input key={answer} name="answer" type="hidden" value={answer} />)}
                </div>
              );
            }
            return (
              <label className="field" key="answer">
                <span>{filterLabels.answer}</span>
                <select defaultValue={chosenAnswers[0] ?? ""} name="answer">
                  <option value="">Any</option>
                  {filter.questions.map((question) => (
                    <optgroup key={question.question} label={question.label}>
                      {question.choices.map((choice) => (
                        <option key={choice.value} value={`${question.question}=${choice.value}`}>{choice.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            );
          }
          return null;
        })}
        <div className="operations-search-actions">
          <button className="primary-button" type="submit"><Search aria-hidden="true" size={14} /> Search</button>
          {active ? <Link className="secondary-button" href={`${basePath}?${clearParams.toString()}`}><X aria-hidden="true" size={14} /> Clear</Link> : null}
        </div>
      </form>
      </details>
      {summary && summary.issues.length > 0 ? (
        <ul className="form-error" data-testid="operations-search-issues" role="alert">
          {summary.issues.map((issue) => <li key={`${issue.filter}:${issue.code}`}>{filterLabels[issue.filter] ?? humanize(issue.filter)}: {issue.message}</li>)}
        </ul>
      ) : null}
      {summary && summary.issues.length === 0 ? (
        <p aria-live="polite" className="muted" data-testid="operations-search-summary">
          {summary.total} {summary.total === 1 ? "registration matches" : "registrations match"}
          {summary.pageCount > 1 ? ` · page ${summary.page} of ${summary.pageCount}` : ""}
          {summary.pageCount > 1 ? (
            <>
              {" "}
              {summary.page > 1 ? <Link href={pageHref(summary.page - 1)}>Previous</Link> : null}
              {summary.page > 1 && summary.page < summary.pageCount ? " · " : null}
              {summary.page < summary.pageCount ? <Link href={pageHref(summary.page + 1)}>Next</Link> : null}
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

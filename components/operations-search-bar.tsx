import Link from "next/link";
import { Search, X } from "lucide-react";
import {
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
  waitlist: "Waitlist",
  payment: "Payment",
  checkIn: "Check-in",
  tag: "Tag",
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
 * further than this form does.
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
    waitlist: query.waitlist,
    payment: query.payment,
    checkIn: query.checkIn ? [query.checkIn] : [],
    tag: query.tag,
  };
  const chosenAnswers = new Set(query.answers.flatMap((answer) => answer.values.map((value) => `${answer.question}=${value}`)));

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
      <form action={basePath} className="operations-search-form" method="get">
        <input name="event" type="hidden" value={eventId} />
        {Object.entries(carry).map(([key, value]) => (value ? <input key={key} name={key} type="hidden" value={value} /> : null))}
        {filters.map((filter) => {
          if (filter.key === "q") {
            return (
              <label className="field" key="q">
                <span>Search</span>
                <input defaultValue={query.text} maxLength={100} name="q" placeholder="Name, email, phone or confirmation code" type="search" />
              </label>
            );
          }
          if (filter.kind === "enum") {
            return (
              <label className="field" key={filter.key}>
                <span>{filterLabels[filter.key] ?? humanize(filter.key)}</span>
                <select defaultValue={current[filter.key]?.[0] ?? ""} name={filter.key}>
                  <option value="">Any</option>
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>{"label" in option ? option.label : humanize(option.value)}</option>
                  ))}
                </select>
              </label>
            );
          }
          if (filter.kind === "questions") {
            return (
              <label className="field" key="answer">
                <span>Form answer</span>
                <select defaultValue={[...chosenAnswers][0] ?? ""} name="answer">
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
      {summary && summary.issues.length > 0 ? (
        <ul className="form-error" data-testid="operations-search-issues" role="alert">
          {summary.issues.map((issue) => <li key={`${issue.filter}:${issue.code}`}>{humanize(issue.filter)}: {issue.message}</li>)}
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

# Public analytics (#111)

Anonymous, aggregate operational counts for the public site. Built so that nothing can be traced to a person.

## What is counted

One row per day, metric and allowlisted dimension (`PublicMetricDaily`), incremented atomically.

| Metric | Dimension | Recorded by |
| --- | --- | --- |
| `EVENT_PAGE_VIEW` | event slug (public, published events only) | browser beacon |
| `REGISTRATION_START` | event slug (same rule) | browser beacon |
| `REGISTRATION_COMPLETE` | event slug (same rule) | server, at a successful public form submit |
| `DIRECTORY_SEARCH` | none: that a search was used, never the text | browser beacon |
| `DIRECTORY_FILTER` | `category`, `audience`, `location` or `date`: the filter's name, never its value | browser beacon |
| `LOGIN_SUCCESS`, `LOGIN_FAILURE` | `staff-password`, `staff-passkey`, `attendee-password`, `attendee-passkey` | server, in the sign-in routes |
| `NOT_FOUND` | first path segment if it is a known public section, else `other` | browser beacon |
| `IMAGE_ERROR` | `same-origin` or `external` | browser beacon |
| `WEB_VITAL` | `LCP\|CLS\|INP\|FCP\|TTFB` and `good\|needs-improvement\|poor`, as `NAME:rating` | browser beacon (Next's `useReportWebVitals`) |

Every dimension is checked against a fixed list on the server (`modules/public-metrics/domain.ts`); anything else is dropped.

## What is never stored or logged

IP addresses, user agents, user, account, attendee or registration ids, emails, names, search text, filter values, full URLs or query strings, cookies, session ids, referrers. The beacon route reads no session or cookie and logs nothing about the request. A metric that fails to save is swallowed with a warning that holds no request data, so a metric can never change a response.

## Private events

An event slug is counted only when that event is published, shown on the calendar and not archived. Otherwise the hit is dropped and `/api/public-metrics` still answers `204`, the same as for a counted hit, so the response says nothing about which events exist.

## Opting out

The beacon does nothing when `navigator.globalPrivacyControl` is true or `doNotTrack` is `"1"`, and the server also ignores requests carrying `Sec-GPC: 1` or `DNT: 1`. There are no cookies, no identifiers and no third-party scripts.

## Retention

Rows are daily aggregates. The outbox sweep deletes rows older than 400 days on every run (`prunePublicMetrics`).

## Viewing

System administrators only: Public analytics (`/admin/analytics`), the last 30 days as tables of counts.

# Public analytics (#111)

Anonymous, aggregate operational counts for the public site. Built so that nothing can be traced to a person.

## What is counted

One row per day, metric and allowlisted dimension (`PublicMetricDaily`), incremented atomically.

| Metric | Dimension | Recorded by |
| --- | --- | --- |
| `EVENT_PAGE_VIEW` | event slug (public, published events only) | browser beacon |
| `REGISTRATION_START` | event slug (same rule) | browser beacon, on the individual, group and general-link registration pages |
| `REGISTRATION_COMPLETE` | event slug (same rule) | server, at a successful individual, group or general-link submit |
| `DIRECTORY_SEARCH` | none: that a search was used, never the text | browser beacon |
| `DIRECTORY_FILTER` | `category`, `audience`, `location` or `date`: the filter's name, never its value | browser beacon |
| `LOGIN_SUCCESS`, `LOGIN_FAILURE` | the sign-in method: `staff-password`, `staff-mfa`, `staff-passkey`, `attendee-password`, `attendee-passkey`, `unified-password`, `unified-passkey` | server, in the sign-in routes |
| `NOT_FOUND` | first path segment if it is a known public section, else `other` | browser beacon |
| `IMAGE_ERROR` | `same-origin` or `external` | browser beacon |
| `WEB_VITAL` | `LCP\|CLS\|INP\|FCP\|TTFB` and `good\|needs-improvement\|poor`, as `NAME:rating` | browser beacon (Next's `useReportWebVitals`) |

Every dimension is checked against a fixed list on the server (`modules/public-metrics/domain.ts`); anything else is dropped.

A staff password sign-in that hands off to two-step verification counts nothing at the password step: it counts as worked (`staff-mfa`) only when the code is accepted, and as failed (`staff-mfa`) when the code is refused. A passkey failure counts only when the passkey itself fails verification, not for a malformed request or a server error.

The staff workspace is never measured: its page speed, missing pages and images are ignored. Web vitals are reported once per page load by one component in the root layout.

## What is never stored or logged

IP addresses, user agents, user, account, attendee or registration ids, emails, names, search text, filter values, full URLs or query strings, cookies, session ids, referrers. The beacon route reads no session or cookie and logs nothing about the request. A metric that fails to save is swallowed with a warning that holds no request data, so a metric can never change a response.

## Private events

An event slug is counted only when that event is published, shown on the calendar and not archived. Otherwise the hit is dropped and `/api/public-metrics` still answers `204`, the same as for a counted hit, so the response says nothing about which events exist.

## Opting out

The beacon does nothing when `navigator.globalPrivacyControl` is true or `doNotTrack` is `"1"`. The server also skips every count, including sign-ins and completed registrations, on a request carrying `Sec-GPC: 1` or `DNT: 1`. There are no cookies, no identifiers and no third-party scripts.

## Retention

Rows are daily aggregates. The outbox sweep deletes rows older than 400 days on every run (`prunePublicMetrics`).

## Viewing

System administrators only: Public analytics (`/admin/analytics`), as tables of counts. Links at the top (the staff view strip; they keep the reader's place and any table sort) pick the period: last 30 days (the default), last 90 days or last 12 months (`?days=30|90|365`; any other value shows 30 days). Retention is 400 days, so 12 months is always available.

The page opens with an "At a glance" panel (#1961), built from the same stored daily counts (no new tracking):

- **Tiles:** event page views, registrations started, registrations completed, and completed of started. Each shows an arrow and words ("Up 12% from the previous 30 days"). A rate's change is in percentage points. A previous count of 0 gives no percent (never a made-up +100%).
- **Previous period:** the same number of days just before the chosen period. It is compared only when all of its days are still stored (inside the 400-day retention). That holds for 30 and 90 days; for 12 months the previous period is about 730 days back, so the tiles say "No comparison" instead of using a part-kept period.
- **Charts:** views, starts and completions by day (30 and 90 days) or by week (12 months; weeks end today and the oldest bucket holds the leftover day), a whole-site funnel (views, started, completed), and the top 10 events by completed registrations. Each has a text summary for screen readers and a "Show as a table" copy of its numbers; series differ by line pattern, marker or fill as well as colour. The events table also carries a small decorative bar trio per event.
- The rules (previous period, change, filling days, weekly buckets, top 10) are pure functions in `modules/public-metrics/domain.ts`; the markup is `components/analytics-charts.tsx`. Tests: `tests/public-analytics-charts-1961.test.ts`.

The Events table, "Which event pages lead to registrations" (#1560), has one row per event with the event's name, page views, registrations started, registrations completed, completed as a share of views and completed as a share of started. It is built only from the `EVENT_PAGE_VIEW`, `REGISTRATION_START` and `REGISTRATION_COMPLETE` counts above; nothing new is recorded. Rows start in order of completed registrations, then views, and every column can be sorted. The counts are separate days' totals and people can arrive by a direct link, so a rate can pass 100% (it is shown as computed, not capped). Events are counted only while they are public; a count made while an event was public stays after it is unpublished.

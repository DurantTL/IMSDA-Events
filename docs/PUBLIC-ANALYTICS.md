# Public analytics (#111)

Anonymous, aggregate operational counts for the public site. Built so that nothing can be traced to a person.

## What is counted

One row per day, metric and dimension (`PublicMetricDaily`), incremented atomically. Most dimensions come from a fixed list; three (#1560) are short normalized text, described below.

| Metric | Dimension | Recorded by |
| --- | --- | --- |
| `EVENT_PAGE_VIEW` | event slug (public, published events only) | browser beacon |
| `REGISTRATION_START` | event slug (same rule) | browser beacon, on the individual, group and general-link registration pages |
| `REGISTRATION_COMPLETE` | event slug (same rule) | server, at a successful individual, group or general-link submit |
| `DIRECTORY_SEARCH` | none: that a search was used, never the text (a search with no results is `SEARCH_NO_RESULTS`, below) | browser beacon |
| `DIRECTORY_FILTER` | `category`, `audience`, `location` or `date`: the filter's name, never its value | browser beacon |
| `LOGIN_SUCCESS`, `LOGIN_FAILURE` | the sign-in method: `staff-password`, `staff-mfa`, `staff-passkey`, `attendee-password`, `attendee-passkey`, `unified-password`, `unified-passkey` | server, in the sign-in routes |
| `NOT_FOUND` | first path segment if it is a known public section, else `other` | browser beacon |
| `IMAGE_ERROR` | `same-origin` or `external` | browser beacon |
| `WEB_VITAL` | `LCP\|CLS\|INP\|FCP\|TTFB` and `good\|needs-improvement\|poor`, as `NAME:rating` | browser beacon (Next's `useReportWebVitals`) |

| `REFERRER_SITE` | the referring site's host only, e.g. `example.org` | browser beacon, once per page load |
| `CAMPAIGN_VISIT` | `source / medium / campaign` from `utm_source`, `utm_medium`, `utm_campaign` (`-` for a missing part) | browser beacon, once per page load |
| `SEARCH_NO_RESULTS` | the normalized search term, when the events list showed no event | browser beacon, from `/events?q=` |

Every other dimension is checked against a fixed list on the server (`modules/public-metrics/domain.ts`); anything else is dropped. The three text metrics follow these rules instead:

- **Referring site:** sent on the landing page only, and only when the visitor allows measuring, the page is not in the staff workspace, `document.referrer` is an http(s) address on another site, and the visit is not a reload or back/forward. The browser sends the hostname only; the server lower-cases it, drops a trailing dot and a leading `www.`, and accepts only a plain hostname (letters, digits, hyphens, at least one dot, at most 100 characters). Ports, userinfo, IP addresses and `localhost` are dropped. Nothing is kept in cookies or browser storage.
- **Campaign tags:** same landing and opt-out rules, independent of the referrer, and only when `utm_source` is present. Nothing else from the query string is read. Each part is lower-cased, spaces become `-`, only `[a-z0-9._-]` and 1 to 30 characters pass. A part with an `@`, 7 or more digits, or any other character drops the whole hit.
- **Search with no results:** when `/events` is opened with a search and no event card shows, the term is normalized (Unicode NFKC, lower case, trimmed, spaces collapsed, only letters, digits, spaces, hyphens and apostrophes kept) and counted if it is 3 to 40 characters. A term that contained an `@` or 7 or more digits is dropped. The term is never logged. The existing `DIRECTORY_SEARCH` count (that a search was used) is unchanged.
- **Abuse cap:** at most 200 different values per day and metric. A value already stored that day still counts up; a new one beyond 200 is dropped. The check is in the same SQL statement as the write; two requests at the same instant can pass it together, so the count can briefly pass 200 by a few.
- **Shown only from 3:** on the analytics page a site, tag set or search is listed only when its total in the chosen period is at least 3 (`minimumShownCount`, `applyMinimumCount`). The rest appear as one line, "Other sites, tags or searches, each fewer than 3 times: N in total", with a count and no names. The names are removed on the server and never sent to the page.
- **Deleted when rare:** a term or site seen fewer than 3 times (added up over every stored day) is deleted after 30 days.

A staff password sign-in that hands off to two-step verification counts nothing at the password step: it counts as worked (`staff-mfa`) only when the code is accepted, and as failed (`staff-mfa`) when the code is refused. A passkey failure counts only when the passkey itself fails verification, not for a malformed request or a server error.

The staff workspace is never measured: its page speed, missing pages and images are ignored. Web vitals are reported once per page load by one component in the root layout.

## What is never stored or logged

IP addresses, user agents, user, account, attendee or registration ids, emails, names, filter values, full URLs, paths or query strings, cookies, session ids. The only free text kept is the three normalized values above: a referring site's host, utm campaign tags and a search that found nothing. The beacon route reads no session or cookie and logs nothing about the request. A metric that fails to save is swallowed with a warning that holds no request data, so a metric can never change a response.

## Private events

An event slug is counted only when that event is published, shown on the calendar and not archived. Otherwise the hit is dropped and `/api/public-metrics` still answers `204`, the same as for a counted hit, so the response says nothing about which events exist.

## Opting out

The beacon does nothing when `navigator.globalPrivacyControl` is true or `doNotTrack` is `"1"`. The server also skips every count, including sign-ins and completed registrations, on a request carrying `Sec-GPC: 1` or `DNT: 1`. There are no cookies, no identifiers and no third-party scripts.

## Retention

Rows are daily aggregates. The outbox sweep deletes rows older than 400 days on every run (`prunePublicMetrics`). In the same run, a referring site, campaign tag set or no-result search seen fewer than 3 times in total is deleted once its row is older than 30 days.

## Viewing

System administrators only: Public analytics (`/admin/analytics`), as tables of counts. Links at the top (the staff view strip; they keep the reader's place and any table sort) pick the period: last 30 days (the default), last 90 days or last 12 months (`?days=30|90|365`; any other value shows 30 days). Retention is 400 days, so 12 months is always available.

The page opens with an "At a glance" panel (#1961), built from the same stored daily counts (no new tracking):

- **Tiles:** event page views, registrations started, registrations completed, and completed of started. Each shows an arrow and words ("Up 12% from the previous 30 days"). A rate's change is in percentage points. A previous count of 0 gives no percent (never a made-up +100%).
- **Previous period:** the same number of days just before the chosen period. It is compared only when all of its days are still stored (inside the 400-day retention). That holds for 30 and 90 days; for 12 months the previous period is about 730 days back, so the tiles say "No comparison" instead of using a part-kept period.
- **Charts:** views, starts and completions by day (30 and 90 days) or by week (12 months; weeks end today and the oldest bucket holds the leftover day), a whole-site funnel (views, started, completed), and the top 10 events by completed registrations. Each has a text summary for screen readers and a "Show as a table" copy of its numbers; series differ by line pattern, marker or fill as well as colour. The events table also carries a small decorative bar trio per event.
- The rules (previous period, change, filling days, weekly buckets, top 10) are pure functions in `modules/public-metrics/domain.ts`; the markup is `components/analytics-charts.tsx`. Tests: `tests/public-analytics-charts-1961.test.ts`.

The Events table, "Which event pages lead to registrations" (#1560), has one row per event with the event's name, page views, registrations started, registrations completed, completed as a share of views and completed as a share of started. It is built only from the `EVENT_PAGE_VIEW`, `REGISTRATION_START` and `REGISTRATION_COMPLETE` counts above; nothing new is recorded. Rows start in order of completed registrations, then views, and every column can be sorted. The counts are separate days' totals and people can arrive by a direct link, so a rate can pass 100% (it is shown as computed, not capped). Events are counted only while they are public; a count made while an event was public stays after it is unpublished.

# UltraCamp vendor evidence notes

Prepared October 21, 2026. This is a source reconciliation for the documentation pack, not fresh vendor verification or a contractual determination.

## The distinction the report must preserve

The uploaded integration report says UltraCamp's API is undocumented in public because its searches did not find developer documentation. A separate, explicit project discovery comment records a public REST documentation URL and an official API-license URL. Do not repeat the negative-search result as proof that no public API exists.

The strongest available local record is [issue #71's July 30 discovery](https://github.com/DurantTL/IMSDA-Events/issues/71#issuecomment-5139058493). It reports that the official REST contract contains authentication, camp/account API keys, accounts/people, seasons/locations, cart and reservation create/update, rosters, waitlists, cancellations, reservation options/activities/lodging/fees and operational/financial reports. Exact endpoint names, HTTP operations, entitlement, rate limits, versioning and production behavior need the current vendor contract/documentation before implementation.

The same record says health, medication, treatment-log, online-form-answer and form-completion endpoints were **not clearly documented in the public REST contract reviewed**. This is an unknown capability—not a finding that UltraCamp lacks those product features or cannot offer a customer-specific method.

## What could not be freshly verified

The execution environment's enforced allowlist does not include `rest.ultracamp.com`, `help.ultracamp.com` or `ultracampmanagement.com`; `/etc/codex/network-policy.json` was inspected. No attempt was made to bypass that policy, scrape the UI or access a customer account. Official-site availability, current page content, API coverage and current commercial terms were not reverified on October 21. The report should use the dated review record and request written vendor confirmation.

## API terms: avoid an unsupported verbatim quote

The July discovery summarizes a limited/revocable interoperability/internal-use license, API-key confidentiality, possible API charges, a restriction against replicating/replacing UltraCamp or building a competing service using the API, and beta/as-is availability. The current term page was not retrieved here and no full verbatim license excerpt was found locally. Present those as **reported terms requiring confirmation**, with the official page link and discovery-comment citation. Do not put the summary in quotation marks or conclude that a proposed IMSDA use is permitted/prohibited. Ask the authorized contract owner and UltraCamp for written confirmation of the precise use case, including an independently built replacement, permitted data export, use of exported data after termination, and interoperability during overlap.

The uploaded report quotes “Client Data is available for export while these Terms are active” and says a non-designated processor needs consent plus a 1% fee. These rest on that report's excerpt-level research; neither is freshly verified. Do not carry the fee as a current price fact. Ask for the current agreement, API entitlement/fees, termination export window, secure return/deletion obligations, attachment/medical access and payment-token portability in writing.

## Official references available in the existing record

| Source | Exact URL | Recorded observation | Evidence status |
|---|---|---|---|
| Public REST documentation | https://rest.ultracamp.com/developers/docs/index | Operational account/person/session/reservation/report surface; camp/account keys | Prior official-doc review recorded July 30 in #71; not refreshed today |
| API License Terms | https://ultracampmanagement.com/api-license-terms/ | License, permitted-use, confidentiality and availability restrictions reported; last modified Oct 1, 2025 per discovery | Prior review summary only; no local full verbatim copy |
| Terms of Service | https://ultracampmanagement.com/terms-of-service2_0_0/ | Separate API-license terms and active-contract export language reported | Uploaded report/search excerpts; not refreshed |
| Health and Medical help | https://help.ultracamp.com/hc/en-us/sections/7258663404308-Health-and-Medical | Product medical tools exist; not an API guarantee | Prior official help review |
| Online Form Reports | https://help.ultracamp.com/hc/en-us/articles/7259296035988-Online-Form-Reports | Form reports/export exist; permitted API/form coverage unknown | Prior official help review |
| Assigning Online Forms | https://help.ultracamp.com/hc/en-us/articles/50300731674900-Assigning-Online-Forms | Required-form tracking | Prior official help review |
| Custom Online Forms | https://help.ultracamp.com/hc/en-us/articles/7231482555284-Custom-Online-Forms | Individual/account forms, medical restriction, completion/expiration, third-party route; Classic/New UI distinctions | Official documentation reviewed Oct 20; reported update June 18, 2026 |
| Custom Question Templates | https://help.ultracamp.com/hc/en-us/articles/7232122783124-Custom-Question-Templates | Utilization/change log; linked-template update semantics differ from IMSDA immutable copies | Official documentation reviewed Oct 20; reported update June 12, 2026 |
| Session Roster Report | https://help.ultracamp.com/hc/en-us/articles/7259287896212-Session-Roster-Report | Season/session/location/age/balance/attendance filtering; person/family rows and export | Official documentation reviewed Oct 20 |
| Stored Groups and Exporting | https://help.ultracamp.com/hc/en-us/articles/7259298092436-Storing-Groups-and-Exporting | Excel/CSV/PDF; report warns transient stored groups need explicit permanent save | Uploaded report excerpt; confirm retention and full archival coverage |
| Account Detail | https://help.ultracamp.com/hc/en-us/articles/7260056170132-Account-Detail-Page | Account/person/reservation/task relationship | Official documentation reviewed Oct 20 |
| Reservation Detail | https://help.ultracamp.com/hc/en-us/articles/7260339252628-Reservation-Detail | Balances/fees/options/booking context | Official documentation reviewed Oct 20 |
| Session Wait List | https://help.ultracamp.com/hc/en-us/articles/7229279130132-Session-Wait-List | Waitlist versus enrolled, held place and timed offer | Official documentation reviewed Oct 20 |
| Activities or Options | https://help.ultracamp.com/hc/en-us/articles/8911704522644-Should-I-use-Activities-or-Options | Scheduled activity/waitlist versus simpler option selections | Official documentation reviewed Oct 20 |
| Completion Monitoring | https://help.ultracamp.com/hc/en-us/articles/7259289264788-Completion-Monitoring | Incomplete reservation tracking and reminders | Official documentation reviewed Oct 20 |
| Privacy/Security Policy | https://ultracampmanagement.com/privacy-security-policy/ | Variety-of-format export reported | Uploaded report excerpt; precise medical/export protections unverified |

## Known unknowns for the vendor request

Current endpoint/field contract and version; rate/volume limits and 429/retry guidance; account scope and least-privilege keys; sandbox/test camp; write idempotency; update/delete/tombstone and account-merge semantics; change feed/webhooks/scheduled-report/SFTP availability; form-readiness without answers; restricted medical/treatment/administration access; attachment retrieval and checksums; audit export; retention/legal holds; post-termination exports; credentials/token/payment-method portability; outage/support SLA; cost and license approval for the specific overlap or exit model.

Current policy remains [#71's owner decision](https://github.com/DurantTL/IMSDA-Events/issues/71#issuecomment-5139118475): all UltraCamp work remains optional Phase 5; ordinary IMSDA operations are independent of it. This report does not recreate the old roadmap/ADR conflict—current ADR 0002 has already been amended to align.

# Future information architecture (#1259)

A map of where later work belongs, so help, navigation and new pages have a stable home to grow into. It records the owning
issue, its status and its dependencies **as the issues state them**, read on 2026-10-27. It is a map, not a plan:

- It adds no menu entries and promises no dates. A planned item has no page, no menu entry and no help guide.
- Status uses three words. **Planned**: the issue is open and its work is not delivered. **Delivered**: the work the issue
  describes shipped (its slices are closed). **Closed**: the issue itself is closed.
- Dependencies are only what the issue or its comments say. Nothing here is inferred.
- A help guide describes what the app does today. When an item below ships, its guide is written from the real pages
  (`docs/HELP-AND-LEARNING.md`), not from this table.
- #840 and #843 describe a later ministry model. It is not the current Area Coordinator scope, which today is all active
  clubs, and a guide must not describe it as if it were.

Check the issue itself for the current state before relying on a row.

## Event operations

| Issue | Subject | Status | Dependencies and notes as stated |
|---|---|---|---|
| #65 | Volunteer roles, shifts, assignments and coverage | Planned (tracking epic; slices #201, #202, #203 are open) | Takes normalized eligibility from #42 and #70 and never parses screening-provider statuses itself. |
| #78 | Transportation, vehicles, drivers, buses and manifests | Planned (tracking epic; slices #204, #205, #206 are open) | Takes only a normalized driver-readiness requirement from #42 and #70. Keeps transportation separate from event check-in. |
| #80 | Facility, key, wristband, badge and issued-asset tracking | Delivered for its listed slices: #213 and #214 are closed. The parent issue is still open. | A comment on the issue recommends recording charges as intents, not writing them into the current payment tables, until the accounting model #74 exists. |
| #81 | Meal-service planning, credentials, redemption and kitchen reconciliation | Delivered for its listed slices: #210, #211 and #212 are closed. The parent issue is still open. | Protected dietary indicators depend on #44. Meal financial reconciliation depends on #74. |
| #89 | General attendee grouping (cabins, buses, teams, tables, crews, cohorts) | Planned | A group is a membership set with history, never an inventory. Related issues listed: #64, #75, #77, #78, #83. |
| #96 | Authorized minor pickup, release and reunification | Planned, and blocked (labelled `needs-human` and `needs-decision`). Slices: #215 (a human gate), #216, #217. | Depends on guardian authority defined by #43. Sits between #78 (transport arrival) and #79 (reunification). |

## Clubs and ministries

| Issue | Subject | Status | Dependencies and notes as stated |
|---|---|---|---|
| #840 | Epic: Adventurers on IMSDA Events | Planned (labelled `needs-decision`) | Contains the decisions #841, #842 and #843. |
| #841 | Decision: Adventurer class levels and awards on club rosters | Planned (labelled `needs-decision`) | Makes Pathfinder or Adventurer a real field on the club. |
| #842 | Decision: one-time move of Adventurer clubs and members from the old system | Planned (labelled `needs-human` and `needs-decision`) | Uses a synthetic export to define the field map before any schema change. |
| #843 | Decision: Area Coordinators by ministry and area | Planned (labelled `needs-decision`) | Builds after the materials gate of #840. Inventory every coordinator read, export, report, points, health and notification path first. |

## Content

| Issue | Subject | Status | Dependencies and notes as stated |
|---|---|---|---|
| #84 | Full no-code event website, content, agenda and branding builder | Planned (tracking epic; slices #247 to #251 are open) | Stores presentation and content configuration, not duplicate session, lodging, capacity or registration data. |
| #283 | Registration presentation slice 1: versioned themes and cross-channel rendering | Planned | Existing public registration and builder-preview renderers; the approved event asset storage path; the event-template foundation #152 (#153 and #154 consume it). |
| #284 | Registration presentation slice 2: rich content blocks, state previews and mobile summary | Planned | The registration presentation foundation #283; existing versioned form definitions and renderers; the approved event asset pipeline. |

## Finance

| Issue | Subject | Status | Dependencies and notes as stated |
|---|---|---|---|
| #92 | Automatic installment charging, failed-payment recovery and statements | Planned (labelled `needs-human` and `needs-decision`; slices #229 to #232, with the human gate #268) | Needs the accounting work #74 through #120, and #121's read-site cutover before statements show authoritative numbers. |
| #94 | Camp store, cashless accounts, spending limits and point-of-sale reconciliation | Planned (labelled `needs-human` and `needs-decision`) | Sits on #74, #54 and the badge and asset infrastructure of #64 and #80. |
| #95 | Donations, fundraising campaigns, sponsorship appeals and designated funds | Planned (labelled `needs-human` and `needs-decision`) | Related issues listed: #74, #85, #88. |

## Platform integrations

| Issue | Subject | Status | Dependencies and notes as stated |
|---|---|---|---|
| #103 | Outbound integration layer: API keys, scoped access and webhooks | Planned (tracking epic; labelled `needs-human` and `needs-decision`) | Slices in order: #124, #237, #238, #239, #240, #241. The inbound provider adapters (#69, #70, #71) do not wait for it. |
| #237 | API slice 2: approve the v1 audience, resources, fields, webhook events and support contract | Planned (a human gate) | Part of #103. |
| #238 | API slice 3: read-only v1 endpoints, field allowlists, pagination and scope enforcement | Planned | Blocked until contract approval #237. Depends on API credentials #124. |
| #239 | API slice 4: webhook subscriptions, scopes, signing-secret rotation and endpoint validation | Planned | Blocked until contract approval #237. Depends on API administration patterns #124. |
| #240 | API slice 5: immutable webhook events, signed delivery, retries and dead-letter operations | Planned | Depends on the approved contract #237 and webhook subscriptions #239. |
| #241 | API slice 6: OpenAPI documentation, sample consumer, change log and production readiness gate | Planned | Depends on #124 and #237 to #240. |

## Keeping this current

- When an issue closes or its slices ship, change its status here and say so. Do not leave delivered work listed as future.
- Add or move a row only from what the issue says. If an issue gives no dependency, write none.
- Never add a date, a menu label or a promise that a page will appear.

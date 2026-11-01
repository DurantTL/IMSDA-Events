import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { questionsFromDefinition, sensitiveQuestionIdsFromDefinition } from "@/modules/registrations/choice-answer-filter";
import {
  activeFilterKeys,
  availableOperationsFilters,
  buildRegistrationWhere,
  emptySearchCatalog,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  normalizeSearchText,
  parseOperationsSearchParams,
  registrationOrderBy,
  resolveOperationsSearch,
  searchTokens,
  serializeOperationsSearchQuery,
  viewerCanUseDomain,
  type OperationsSearchQuery,
  type SearchCatalog,
  type SearchIssue,
  type SearchParamsInput,
  type SearchPaymentState,
  type SearchQuestion,
  type SearchViewer,
} from "@/modules/registrations/operations-search-domain";
import { formatPersonName } from "@/lib/person-name";

/**
 * Event-scoped operations search, the database half (#180). Pure rules, filter
 * keys, URL form and the predicate live in `operations-search-domain.ts`.
 *
 * Callers get registration ids, never rows: each list hydrates the page it
 * shows with its own permission-gated loader (the People list uses
 * `listRegistrations`). That keeps this service free of anything a list would
 * have to redact, and lets the audience builder (#176) read the same
 * definition of "who matches" without being handed contact details.
 *
 * Bounds: one event only (`eventId` is the first clause of every query), at
 * most MAX_PAGE_SIZE rows per page and MAX_PAGE pages deep, at most six text
 * words, and a statement timeout on the read transaction. Everything that
 * reads data (the money-state and legacy-answer lookups, the rows, the count,
 * the facets and the suggestions) runs inside that one repeatable-read
 * transaction, so they describe the same moment and share its timeout.
 */

const STATEMENT_TIMEOUT_MS = 8_000;
/** Candidate and id lists a lookup may hand back to the predicate before the search must be narrowed. */
const ID_LIST_CAP = 20_000;
const SUGGESTION_LIMIT = 8;
const SUGGESTION_MIN_LENGTH = 2;

/** The search matches more than can be filtered this way; the caller reports it and the viewer narrows it. */
class TooBroadError extends Error {}

const TOO_BROAD: SearchIssue = {
  filter: "search",
  code: "too-broad",
  message: "This search matches too many records or took too long. Narrow it and try again.",
};

/** Our own cap, a statement timeout, or a transaction that timed out or was closed under load. */
function isTooBroad(error: unknown) {
  if (error instanceof TooBroadError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2028" || code === "P2034") return true;
  return error instanceof Error && /statement timeout|canceling statement|transaction (?:api error|already closed|timeout|expired)|expired transaction/i.test(error.message);
}

export type OperationsSearchFacets = {
  /** Registrations per lifecycle status inside the filtered set, so the counts add up to `total`. */
  status: Array<{ value: string; count: number }>;
};

export type OperationsSearchResult = {
  /** False when something asked for was not run: see `issues`. No rows are returned then, never a partly filtered set. */
  ok: boolean;
  issues: SearchIssue[];
  query: OperationsSearchQuery;
  /** Canonical URL query string for `query`. */
  queryString: string;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** In canonical order. */
  registrationIds: string[];
  facets: OperationsSearchFacets;
};

function rejectedResult(query: OperationsSearchQuery, issues: SearchIssue[]): OperationsSearchResult {
  return {
    ok: false,
    issues,
    query,
    queryString: serializeOperationsSearchQuery(query),
    total: 0,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: 0,
    registrationIds: [],
    facets: { status: [] },
  };
}

/**
 * What exists for this event, as far as this viewer may know. A domain the
 * viewer may not use is not read at all, so it costs nothing and cannot be told
 * apart from a domain the event does not have.
 */
export async function loadOperationsSearchCatalog(viewer: SearchViewer): Promise<SearchCatalog> {
  const catalog = emptySearchCatalog();
  if (!viewerCanUseDomain(viewer, "lifecycle")) return catalog;
  const prisma = getPrisma();
  const { eventId } = viewer;

  const [event, attendeeTypes, locations, organizations, tags, questions] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { waitlistEnabled: true, billingMode: true } }),
    prisma.eventAttendeeType.findMany({
      where: { eventId },
      select: { code: true, label: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      take: 200,
    }),
    prisma.eventLocation.findMany({ where: { eventId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
    viewerCanUseDomain(viewer, "identity") ? loadEventOrganizations(eventId) : Promise.resolve([]),
    viewerCanUseDomain(viewer, "tags")
      ? prisma.eventTag.findMany({ where: { eventId }, select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" }, take: 500 })
      : Promise.resolve([]),
    viewerCanUseDomain(viewer, "formAnswers") ? loadFilterableQuestions(eventId) : Promise.resolve([]),
  ]);
  if (!event) return catalog;
  return {
    waitlistEnabled: event.waitlistEnabled,
    deferredBilling: event.billingMode === "DEFERRED_ORGANIZATION_INVOICE",
    attendeeTypes,
    locations,
    organizations,
    tags,
    questions,
  };
}

/** Clubs (and churches) with a registration on this event, by name. */
async function loadEventOrganizations(eventId: string) {
  const rows = await getPrisma().clubEventRegistration.findMany({
    where: { eventId },
    distinct: ["organizationId"],
    select: { organization: { select: { id: true, name: true } } },
    take: 1_000,
  });
  return rows.map((row) => row.organization).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The event's non-sensitive choice questions across every form version that
 * collected an answer or is published now, each with the versions that offer
 * it. A question that is sensitive in ANY version (health type, flagged, or
 * linked to one), offered there or not, is dropped for every viewer: health
 * data is never searchable here, and a later version cannot launder a key an
 * earlier version marked sensitive.
 */
async function loadFilterableQuestions(eventId: string): Promise<SearchQuestion[]> {
  const prisma = getPrisma();
  const used = await prisma.publicRegistrationSubmission.groupBy({ by: ["formVersionId"], where: { eventId } });
  const versions = await prisma.registrationFormVersion.findMany({
    where: {
      OR: [
        { id: { in: used.map((row) => row.formVersionId) } },
        { status: "PUBLISHED", form: { eventId } },
      ],
    },
    select: { id: true, definition: true },
    take: 200,
  });
  const sensitiveAnywhere = new Set<string>();
  const byId = new Map<string, SearchQuestion>();
  for (const version of versions) {
    const definition = version.definition as Record<string, unknown>;
    for (const id of sensitiveQuestionIdsFromDefinition(definition)) sensitiveAnywhere.add(id);
    for (const question of questionsFromDefinition(definition).values()) {
      const existing = byId.get(question.id);
      if (!existing) {
        byId.set(question.id, { ...question, choices: [...question.choices], versionIds: [version.id] });
        continue;
      }
      existing.versionIds.push(version.id);
      if (question.sensitive) existing.sensitive = true;
      for (const choice of question.choices) {
        if (!existing.choices.some((known) => known.value === choice.value)) existing.choices.push(choice);
      }
    }
  }
  return [...byId.values()].filter((question) => !question.sensitive && !sensitiveAnywhere.has(question.id));
}

/** The filters to offer this viewer on this event (see `availableOperationsFilters`). */
export async function describeOperationsSearch(viewer: SearchViewer) {
  const catalog = await loadOperationsSearchCatalog(viewer);
  return { catalog, filters: availableOperationsFilters(viewer, catalog) };
}

function paymentCondition(state: SearchPaymentState, deferredBilling: boolean) {
  const net = Prisma.sql`(COALESCE(m.paid, 0) - COALESCE(m.refunded, 0))`;
  switch (state) {
    case "UNPAID": return deferredBilling ? Prisma.sql`FALSE` : Prisma.sql`(r."totalAmount" > 0 AND ${net} <= 0)`;
    case "PARTIAL": return deferredBilling ? Prisma.sql`FALSE` : Prisma.sql`(${net} > 0 AND ${net} < r."totalAmount")`;
    case "PAID": return deferredBilling ? Prisma.sql`FALSE` : Prisma.sql`(r."totalAmount" > 0 AND ${net} >= r."totalAmount")`;
    case "REFUNDED": return Prisma.sql`(COALESCE(m.refunded, 0) > 0)`;
  }
}

type ReadClient = Prisma.TransactionClient;

/**
 * Registrations in the event whose net money state (succeeded payments less
 * succeeded refunds, against the total) matches. Computed in SQL over this
 * event's payment rows only, and limited to `candidateIds` (the registrations
 * the other filters already kept) when there are any.
 */
async function paymentStateRegistrationIds(
  tx: ReadClient,
  eventId: string,
  states: readonly SearchPaymentState[],
  deferredBilling: boolean,
  candidateIds: readonly string[] | null,
) {
  const conditions = states.map((state) => paymentCondition(state, deferredBilling));
  const restrict = candidateIds ? Prisma.sql`AND r.id = ANY(${[...candidateIds]}::text[])` : Prisma.empty;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT r.id
    FROM "Registration" r
    LEFT JOIN (
      SELECT p."registrationId" AS rid, SUM(p.amount) AS paid, COALESCE(SUM(rf.refunded), 0) AS refunded
      FROM "Payment" p
      LEFT JOIN (
        SELECT "paymentId", SUM(amount) AS refunded
        FROM "Refund"
        WHERE "eventId" = ${eventId} AND status = 'SUCCEEDED'
        GROUP BY "paymentId"
      ) rf ON rf."paymentId" = p.id
      WHERE p."eventId" = ${eventId} AND p.status = 'SUCCEEDED'
      GROUP BY p."registrationId"
    ) m ON m.rid = r.id
    WHERE r."eventId" = ${eventId} ${restrict} AND (${Prisma.join(conditions, " OR ")})
    LIMIT ${ID_LIST_CAP + 1}
  `);
  if (rows.length > ID_LIST_CAP) throw new TooBroadError();
  return rows.map((row) => row.id);
}

/**
 * Registrations whose attendee answer exists only on the original submission:
 * the attendee row saved no answers of its own, so the answer is read from the
 * submission at the attendee's position (position, then creation order, as the
 * People list orders them). The same fallback the in-memory answer filter makes
 * (`attendeeAnswerRecord`), for rows saved before attendees kept their own.
 */
async function legacyAttendeeAnswerIds(tx: ReadClient, eventId: string, question: SearchQuestion, values: readonly string[]) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT x."registrationId" AS id
    FROM (
      SELECT a."registrationId", a."formResponses", s."attendeeResponses",
             ROW_NUMBER() OVER (PARTITION BY a."registrationId" ORDER BY a.position, a."createdAt") - 1 AS idx
      FROM "RegistrationAttendee" a
      JOIN "PublicRegistrationSubmission" s ON s."registrationId" = a."registrationId"
      WHERE a."eventId" = ${eventId} AND s."formVersionId" = ANY(${question.versionIds}::text[])
    ) x
    WHERE x."formResponses" = '{}'::jsonb
      AND jsonb_typeof(x."attendeeResponses") = 'array'
      AND EXISTS (
        SELECT 1 FROM unnest(${[...values]}::text[]) AS wanted(value)
        WHERE (x."attendeeResponses" -> (x.idx)::int) -> ${question.key}::text = to_jsonb(wanted.value)
           OR (x."attendeeResponses" -> (x.idx)::int) -> ${question.key}::text @> jsonb_build_array(wanted.value)
      )
    LIMIT ${ID_LIST_CAP + 1}
  `);
  if (rows.length > ID_LIST_CAP) throw new TooBroadError();
  return rows.map((row) => row.id);
}

/**
 * Registrations whose registration-wide answer matches, as the People list reads it: the answers of the latest
 * AMENDMENT operation when it recorded any, else the original submission's (`latestRegistrationResponses` in
 * `repository.ts`). Limited to registrations submitted through a version that offers the question as a choice.
 */
async function registrationAnswerIds(tx: ReadClient, eventId: string, question: SearchQuestion, values: readonly string[]) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT x.id
    FROM (
      SELECT r.id,
             CASE WHEN jsonb_typeof(a.resp) = 'object' AND a.resp <> '{}'::jsonb THEN a.resp ELSE s.responses END AS answers
      FROM "Registration" r
      JOIN "PublicRegistrationSubmission" s ON s."registrationId" = r.id
      LEFT JOIN LATERAL (
        SELECT o."afterSnapshot" -> 'registrationResponses' AS resp
        FROM "RegistrationOperation" o
        WHERE o."registrationId" = r.id AND o.type = 'AMENDMENT'
        ORDER BY o."createdAt" DESC
        LIMIT 1
      ) a ON TRUE
      WHERE r."eventId" = ${eventId} AND s."formVersionId" = ANY(${question.versionIds}::text[])
    ) x
    WHERE EXISTS (
      SELECT 1 FROM unnest(${[...values]}::text[]) AS wanted(value)
      WHERE x.answers -> ${question.key}::text = to_jsonb(wanted.value)
         OR x.answers -> ${question.key}::text @> jsonb_build_array(wanted.value)
    )
    LIMIT ${ID_LIST_CAP + 1}
  `);
  if (rows.length > ID_LIST_CAP) throw new TooBroadError();
  return rows.map((row) => row.id);
}

type Prepared =
  | { ok: false; result: OperationsSearchResult }
  | { ok: true; viewer: SearchViewer; query: OperationsSearchQuery; questions: SearchQuestion[]; deferredBilling: boolean };

/**
 * The first step of every read: resolve the query for this viewer against the
 * event's catalog. Results, counts, facets and suggestions all start here and
 * then take their predicate from `readWhere`, which is what makes them agree.
 */
async function prepare(viewer: SearchViewer, query: OperationsSearchQuery, carried: readonly SearchIssue[], preloaded?: SearchCatalog): Promise<Prepared> {
  const catalog = preloaded ?? await loadOperationsSearchCatalog(viewer);
  const resolved = resolveOperationsSearch(query, viewer, catalog, carried);
  if (!resolved.ok) return { ok: false, result: rejectedResult(query, resolved.issues) };
  return { ok: true, viewer, query, questions: resolved.questions, deferredBilling: catalog.deferredBilling };
}

/**
 * The one predicate, inside the read transaction. The cheap structural filters
 * form the base; the legacy-answer and money-state lookups are computed here, in
 * the same snapshot and under the same timeout, and the money-state lookup is
 * limited to the registrations the other filters kept (the cap applies to that
 * set, not to the whole event).
 */
async function readWhere(tx: ReadClient, prepared: Extract<Prepared, { ok: true }>): Promise<Prisma.RegistrationWhereInput> {
  const { viewer, query, questions } = prepared;
  const answerRegistrationIds = new Map<string, string[]>();
  for (const answer of query.answers) {
    const question = questions.find((candidate) => candidate.id === answer.question);
    if (!question) continue;
    answerRegistrationIds.set(
      answer.question,
      question.scope === "ATTENDEE"
        ? await legacyAttendeeAnswerIds(tx, viewer.eventId, question, answer.values)
        : await registrationAnswerIds(tx, viewer.eventId, question, answer.values),
    );
  }
  const base = buildRegistrationWhere(query, { eventId: viewer.eventId, questions, answerRegistrationIds, paymentRegistrationIds: null });
  if (query.payment.length === 0) return base;

  const narrowed = activeFilterKeys(query).some((key) => key !== "payment");
  let candidateIds: string[] | null = null;
  if (narrowed) {
    const candidates = await tx.registration.findMany({ where: base, select: { id: true }, take: ID_LIST_CAP + 1 });
    if (candidates.length > ID_LIST_CAP) throw new TooBroadError();
    candidateIds = candidates.map((row) => row.id);
  }
  const paymentRegistrationIds = await paymentStateRegistrationIds(tx, viewer.eventId, query.payment, prepared.deferredBilling, candidateIds);
  return buildRegistrationWhere(query, { eventId: viewer.eventId, questions, answerRegistrationIds, paymentRegistrationIds });
}

/** One repeatable-read snapshot with a statement timeout, and room for the timeout to fire before the transaction's own. */
function readTransaction<T>(run: (tx: ReadClient) => Promise<T>) {
  return getPrisma().$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      return run(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: STATEMENT_TIMEOUT_MS * 3, maxWait: 5_000 },
  );
}

/**
 * Runs a search for the viewer's event. `input` is the URL (or any record of
 * the page's search params): it is parsed defensively, so anything the viewer
 * is not allowed to ask for, or that names something no longer there, comes
 * back as `issues` with no rows.
 */
export async function searchOperationsRegistrations(
  viewer: SearchViewer,
  input: SearchParamsInput | OperationsSearchQuery,
  /** A catalog already loaded for this viewer, to spare a second read. Never build one by hand for another viewer. */
  catalog?: SearchCatalog,
  /** Issues the caller already found in the request (for example a retired URL parameter): they stop the search like any other. */
  carriedIssues: readonly SearchIssue[] = [],
): Promise<OperationsSearchResult> {
  const parsed = isQuery(input) ? { query: input, issues: [] as SearchIssue[] } : parseOperationsSearchParams(input);
  const query = parsed.query;
  const prepared = await prepare(viewer, query, [...parsed.issues, ...carriedIssues], catalog);
  if (!prepared.ok) return prepared.result;

  try {
    const [total, rows, statusGroups] = await readTransaction(async (tx) => {
      const where = await readWhere(tx, prepared);
      return Promise.all([
        tx.registration.count({ where }),
        tx.registration.findMany({
          where,
          orderBy: registrationOrderBy(query),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true },
        }),
        tx.registration.groupBy({ by: ["status"], where, _count: { _all: true } }),
      ]);
    });
    return {
      ok: true,
      issues: [],
      query,
      queryString: serializeOperationsSearchQuery(query),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.ceil(total / query.pageSize),
      registrationIds: rows.map((row) => row.id),
      facets: {
        status: statusGroups
          .map((group) => ({ value: group.status as string, count: group._count._all }))
          .sort((a, b) => (a.value < b.value ? -1 : 1)),
      },
    };
  } catch (error) {
    if (isTooBroad(error)) return rejectedResult(query, [TOO_BROAD]);
    throw error;
  }
}

/** The most registrations one enumeration returns: every page the search offers, so it never reaches further than paging could. */
export const MAX_ENUMERATED_REGISTRATIONS = MAX_PAGE * MAX_PAGE_SIZE;

export type OperationsIdEnumeration = {
  /** False when something asked for was not run (see `issues`), or the match is larger than the bound. No ids are returned then. */
  ok: boolean;
  issues: SearchIssue[];
  query: OperationsSearchQuery;
  queryString: string;
  total: number;
  /** In canonical order, one snapshot. */
  registrationIds: string[];
};

/**
 * Every registration id the search matches, for a caller that needs the whole
 * set (the audience builder, #176) rather than one page. It is the same
 * predicate as `searchOperationsRegistrations` (`prepare` then `readWhere`), so
 * the same permission checks, domain gates and sensitive-data rules apply and a
 * filter the viewer may not use is refused before any read. It returns ids only,
 * in one repeatable-read transaction under the same statement timeout, so the
 * set is one consistent moment.
 *
 * Bounded: at most MAX_ENUMERATED_REGISTRATIONS ids (MAX_PAGE pages of
 * MAX_PAGE_SIZE). A larger match is refused as too broad and returns no ids,
 * never a truncated set that would look complete.
 */
export async function enumerateOperationsRegistrationIds(
  viewer: SearchViewer,
  input: SearchParamsInput | OperationsSearchQuery,
  catalog?: SearchCatalog,
  carriedIssues: readonly SearchIssue[] = [],
  /** Narrow the same predicate to these registrations (the scheduled-email send-time check re-reads one recipient at a time). */
  onlyIds?: readonly string[],
): Promise<OperationsIdEnumeration> {
  const parsed = isQuery(input) ? { query: input, issues: [] as SearchIssue[] } : parseOperationsSearchParams(input);
  const query = parsed.query;
  const prepared = await prepare(viewer, query, [...parsed.issues, ...carriedIssues], catalog);
  const rejected = (issues: SearchIssue[]): OperationsIdEnumeration => ({
    ok: false,
    issues,
    query,
    queryString: serializeOperationsSearchQuery(query),
    total: 0,
    registrationIds: [],
  });
  if (!prepared.ok) return rejected(prepared.result.issues);
  try {
    const rows = await readTransaction(async (tx) => tx.registration.findMany({
      where: onlyIds
        ? { AND: [await readWhere(tx, prepared), { id: { in: [...onlyIds] } }] }
        : await readWhere(tx, prepared),
      orderBy: registrationOrderBy(query),
      take: MAX_ENUMERATED_REGISTRATIONS + 1,
      select: { id: true },
    }));
    if (rows.length > MAX_ENUMERATED_REGISTRATIONS) return rejected([TOO_BROAD]);
    return {
      ok: true,
      issues: [],
      query,
      queryString: serializeOperationsSearchQuery(query),
      total: rows.length,
      registrationIds: rows.map((row) => row.id),
    };
  } catch (error) {
    if (isTooBroad(error)) return rejected([TOO_BROAD]);
    throw error;
  }
}

function isQuery(input: SearchParamsInput | OperationsSearchQuery): input is OperationsSearchQuery {
  return !(input instanceof URLSearchParams) && typeof (input as OperationsSearchQuery).pageSize === "number" && Array.isArray((input as OperationsSearchQuery).status);
}

export type OperationsSearchSuggestion = {
  /** Text to put in the search box: a confirmation code or a person's name. */
  label: string;
  /** A registration this suggestion belongs to, so a click can open it. */
  registrationId: string;
};

function nameFrom(snapshot: unknown, person: { firstName: string; lastName: string }) {
  const record = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  const first = typeof record.firstName === "string" ? record.firstName : person.firstName;
  const last = typeof record.lastName === "string" ? record.lastName : person.lastName;
  return formatPersonName({ firstName: first, lastName: last });
}

/**
 * Autocomplete for the search box. It builds its predicate with the same code
 * as the results (the typed prefix becomes the `text` filter on top of the
 * filters already chosen), so it offers a name or code only when a search for
 * that prefix would return the registration, and offers nothing at all to a
 * viewer who may not search by text. It suggests names and confirmation codes,
 * never emails or phone numbers.
 */
export async function suggestOperationsSearch(
  viewer: SearchViewer,
  prefix: string,
  base?: SearchParamsInput | OperationsSearchQuery,
): Promise<{ ok: boolean; issues: SearchIssue[]; suggestions: OperationsSearchSuggestion[] }> {
  const typed = normalizeSearchText(prefix);
  // Too short to suggest from: answer before any read, whoever asks.
  if (typed.length < SUGGESTION_MIN_LENGTH) return { ok: true, issues: [], suggestions: [] };
  const parsed = base ? (isQuery(base) ? { query: base, issues: [] as SearchIssue[] } : parseOperationsSearchParams(base)) : parseOperationsSearchParams(new URLSearchParams());
  const query: OperationsSearchQuery = { ...parsed.query, text: typed.slice(0, 100), page: 1, pageSize: 20 };
  const prepared = await prepare(viewer, query, parsed.issues);
  if (!prepared.ok) return { ok: false, issues: prepared.result.issues, suggestions: [] };

  const tokens = searchTokens(typed).map((token) => token.toLocaleLowerCase("en-US"));
  let rows;
  try {
    rows = await readTransaction(async (tx) => tx.registration.findMany({
      where: await readWhere(tx, prepared),
      orderBy: registrationOrderBy(query),
      take: 20,
      select: {
        id: true,
        confirmationCode: true,
        contactSnapshot: true,
        accountHolderPerson: { select: { firstName: true, lastName: true } },
        attendees: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { profileSnapshot: true, person: { select: { firstName: true, lastName: true } } } },
      },
    }));
  } catch (error) {
    if (isTooBroad(error)) return { ok: false, issues: [TOO_BROAD], suggestions: [] };
    throw error;
  }
  const seen = new Set<string>();
  const suggestions: OperationsSearchSuggestion[] = [];
  for (const row of rows) {
    const candidates = [
      row.confirmationCode,
      nameFrom(row.contactSnapshot, row.accountHolderPerson),
      ...row.attendees.map((attendee) => nameFrom(attendee.profileSnapshot, attendee.person)),
    ];
    for (const label of candidates) {
      const lower = label.toLocaleLowerCase("en-US");
      if (!label || !tokens.every((token) => lower.includes(token)) || seen.has(lower)) continue;
      seen.add(lower);
      suggestions.push({ label, registrationId: row.id });
      if (suggestions.length >= SUGGESTION_LIMIT) return { ok: true, issues: [], suggestions };
    }
  }
  return { ok: true, issues: [], suggestions };
}

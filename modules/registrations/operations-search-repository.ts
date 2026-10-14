import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { mergeChoiceQuestions } from "@/modules/registrations/choice-answer-filter";
import {
  availableOperationsFilters,
  buildRegistrationWhere,
  emptySearchCatalog,
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
  type SearchViewer,
} from "@/modules/registrations/operations-search-domain";

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
 * words, and a statement timeout on the read transaction. Reads use a
 * repeatable-read snapshot so the count, the page and the facets describe the
 * same moment.
 */

const STATEMENT_TIMEOUT_MS = 8_000;
/** The most registrations a money-state filter may resolve to before the search must be narrowed. */
const PAYMENT_ID_CAP = 20_000;
const SUGGESTION_LIMIT = 8;
const SUGGESTION_MIN_LENGTH = 2;

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

  const [event, attendeeTypes, locations, tags, questions] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { waitlistEnabled: true, billingMode: true } }),
    prisma.eventAttendeeType.findMany({
      where: { eventId },
      select: { code: true, label: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      take: 200,
    }),
    prisma.eventLocation.findMany({ where: { eventId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
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
    tags,
    questions,
  };
}

/**
 * The event's non-sensitive choice questions across every form version that
 * collected an answer or is published now. A sensitive question (health type,
 * flagged, or linked to one) is dropped whatever the viewer holds: health data
 * is never searchable here.
 */
async function loadFilterableQuestions(eventId: string) {
  const prisma = getPrisma();
  const used = await prisma.publicRegistrationSubmission.groupBy({ by: ["formVersionId"], where: { eventId } });
  const versions = await prisma.registrationFormVersion.findMany({
    where: {
      OR: [
        { id: { in: used.map((row) => row.formVersionId) } },
        { status: "PUBLISHED", form: { eventId } },
      ],
    },
    select: { definition: true },
    take: 200,
  });
  return mergeChoiceQuestions(versions.map((version) => version.definition as Record<string, unknown>))
    .filter((question) => !question.sensitive);
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

/**
 * Registrations in the event whose net money state (succeeded payments less
 * succeeded refunds, against the total) matches. Computed in SQL over this
 * event's payment rows only; null means too many to filter this way.
 */
async function paymentStateRegistrationIds(eventId: string, states: readonly SearchPaymentState[], deferredBilling: boolean) {
  const conditions = states.map((state) => paymentCondition(state, deferredBilling));
  const rows = await getPrisma().$queryRaw<Array<{ id: string }>>(Prisma.sql`
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
    WHERE r."eventId" = ${eventId} AND (${Prisma.join(conditions, " OR ")})
    LIMIT ${PAYMENT_ID_CAP + 1}
  `);
  return rows.length > PAYMENT_ID_CAP ? null : rows.map((row) => row.id);
}

type Prepared =
  | { ok: false; result: OperationsSearchResult }
  | { ok: true; query: OperationsSearchQuery; where: Prisma.RegistrationWhereInput };

/**
 * The one path every read takes: resolve the query for this viewer, then build
 * the predicate. Results, counts, facets and suggestions all start here, which
 * is what makes them agree.
 */
async function prepare(viewer: SearchViewer, query: OperationsSearchQuery, carried: readonly SearchIssue[], preloaded?: SearchCatalog): Promise<Prepared> {
  const catalog = preloaded ?? await loadOperationsSearchCatalog(viewer);
  const resolved = resolveOperationsSearch(query, viewer, catalog, carried);
  if (!resolved.ok) return { ok: false, result: rejectedResult(query, resolved.issues) };

  let paymentRegistrationIds: string[] | null = null;
  if (query.payment.length > 0) {
    paymentRegistrationIds = await paymentStateRegistrationIds(viewer.eventId, query.payment, catalog.deferredBilling);
    if (paymentRegistrationIds === null) {
      return { ok: false, result: rejectedResult(query, [{ filter: "payment", code: "too-broad", message: "This search matches too many records to filter this way. Narrow it first." }]) };
    }
  }
  const where = buildRegistrationWhere(query, { eventId: viewer.eventId, questions: resolved.questions, paymentRegistrationIds });
  return { ok: true, query, where };
}

function isStatementTimeout(error: unknown) {
  return error instanceof Error && /statement timeout|canceling statement/i.test(error.message);
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
): Promise<OperationsSearchResult> {
  const { query, issues } = isQuery(input) ? { query: input, issues: [] as SearchIssue[] } : parseOperationsSearchParams(input);
  const prepared = await prepare(viewer, query, issues, catalog);
  if (!prepared.ok) return prepared.result;

  const prisma = getPrisma();
  try {
    const [total, rows, statusGroups] = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
        return Promise.all([
          tx.registration.count({ where: prepared.where }),
          tx.registration.findMany({
            where: prepared.where,
            orderBy: registrationOrderBy(query),
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            select: { id: true },
          }),
          tx.registration.groupBy({ by: ["status"], where: prepared.where, _count: { _all: true } }),
        ]);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: STATEMENT_TIMEOUT_MS * 2 },
    );
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
    if (isStatementTimeout(error)) {
      return rejectedResult(query, [{ filter: "search", code: "too-broad", message: "This search took too long. Narrow it and try again." }]);
    }
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
  return `${first} ${last}`.trim();
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
  const parsed = base ? (isQuery(base) ? { query: base, issues: [] as SearchIssue[] } : parseOperationsSearchParams(base)) : parseOperationsSearchParams(new URLSearchParams());
  const query: OperationsSearchQuery = { ...parsed.query, text: typed.slice(0, 100), page: 1, pageSize: 20 };
  const prepared = await prepare(viewer, query, parsed.issues);
  if (!prepared.ok) return { ok: false, issues: prepared.result.issues, suggestions: [] };
  if (typed.length < SUGGESTION_MIN_LENGTH) return { ok: true, issues: [], suggestions: [] };

  const tokens = searchTokens(typed).map((token) => token.toLocaleLowerCase("en-US"));
  const rows = await getPrisma().registration.findMany({
    where: prepared.where,
    orderBy: registrationOrderBy(query),
    take: 20,
    select: {
      id: true,
      confirmationCode: true,
      contactSnapshot: true,
      accountHolderPerson: { select: { firstName: true, lastName: true } },
      attendees: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { profileSnapshot: true, person: { select: { firstName: true, lastName: true } } } },
    },
  });
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

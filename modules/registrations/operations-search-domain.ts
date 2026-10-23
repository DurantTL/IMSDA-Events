import type { Prisma } from "@prisma/client";
import type { EventPermission } from "@/modules/access/permissions";
import { sortOrderText, type SortKind } from "@/lib/list-sort";
import type { ChoiceQuestion } from "@/modules/registrations/choice-answer-filter";

/**
 * Event-scoped operations search, the pure half (#180).
 *
 * One query model serves every staff list that needs to find registrations:
 * the People list today, the reviewed audience builder (#176) next. Nothing
 * here touches the database; `operations-search-repository.ts` runs the query
 * this module describes. The split keeps the rules that decide what a viewer
 * may ask for, and how a query reads in a URL, testable without a database.
 *
 * What it will never search, whatever the viewer holds: restricted staff note
 * bodies, consent evidence, health or medical data (a sensitive form question
 * is never offered), and event membership. There is no filter key for them, so
 * the URL cannot name one.
 *
 * Every filter has a stable key (`FILTER_KEYS`) that does not change with
 * display labels or form versions. A structured form answer is named by the
 * field's own key and its stored value (`answer=ATTENDEE:meal=vegan`), never by
 * the label people read; a key or value the form no longer offers is reported
 * as an issue and nothing is searched, instead of being quietly read as
 * something else.
 */

export const FILTER_KEYS = [
  "q",
  "status",
  "attendeeType",
  "source",
  "organization",
  "location",
  "waitlist",
  "payment",
  "checkIn",
  "tag",
  "answer",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** The other URL parameters the search owns. */
export const SEARCH_PARAM_NAMES = [...FILTER_KEYS, "sort", "page", "size"] as const;

/** A domain is a group of filters one permission decision covers. */
export const SEARCH_DOMAINS = ["lifecycle", "identity", "payment", "checkIn", "tags", "formAnswers"] as const;
export type SearchDomain = (typeof SEARCH_DOMAINS)[number];

/** The viewer holds any one of these permissions to use the domain. Event-scoped: the viewer is for one event. */
export const DOMAIN_PERMISSIONS: Record<SearchDomain, readonly EventPermission[]> = {
  lifecycle: ["VIEW_EVENT"],
  identity: ["VIEW_SENSITIVE_DATA"],
  payment: ["MANAGE_FINANCE"],
  checkIn: ["MANAGE_CHECK_IN", "MANAGE_REGISTRATION"],
  tags: ["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"],
  formAnswers: ["VIEW_SENSITIVE_DATA"],
};

export const FILTER_DOMAIN: Record<FilterKey, SearchDomain> = {
  q: "identity",
  status: "lifecycle",
  attendeeType: "lifecycle",
  source: "lifecycle",
  organization: "identity",
  location: "lifecycle",
  waitlist: "lifecycle",
  payment: "payment",
  checkIn: "checkIn",
  tag: "tags",
  answer: "formAnswers",
};

/**
 * Who is searching, for ONE event. Built from the server's own permission
 * check (`resolveEventContext`), never from the URL. Every query in this module
 * and its repository is scoped to `eventId`; there is no cross-event search.
 */
export type SearchViewer = { eventId: string; permissions: readonly EventPermission[] };

export function viewerMaySearchEvent(viewer: SearchViewer) {
  return viewer.permissions.includes("VIEW_EVENT");
}

export function viewerCanUseDomain(viewer: SearchViewer, domain: SearchDomain) {
  return viewerMaySearchEvent(viewer) && DOMAIN_PERMISSIONS[domain].some((permission) => viewer.permissions.includes(permission));
}

export const REGISTRATION_STATUSES = ["DRAFT", "SUBMITTED", "CONFIRMED", "WAITLISTED", "CANCELLED"] as const;
export type SearchRegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** How a registration arrived. Mutually exclusive, so a count by source adds up. */
export const REGISTRATION_SOURCES = ["PUBLIC_FORM", "CLUB", "GROUP", "GENERAL_LINK", "STAFF"] as const;
export type SearchRegistrationSource = (typeof REGISTRATION_SOURCES)[number];

export const WAITLIST_STATES = ["WAITING", "PROMOTED", "REMOVED"] as const;
export type SearchWaitlistState = (typeof WAITLIST_STATES)[number];

/**
 * Money state from succeeded payments net of succeeded refunds against the
 * registration total, the same arithmetic as the finance workspace. UNPAID,
 * PARTIAL and PAID do not apply on an event that bills churches afterwards (no
 * attendee balance exists there); REFUNDED (any succeeded refund) always does.
 */
export const PAYMENT_STATES = ["UNPAID", "PARTIAL", "PAID", "REFUNDED"] as const;
export type SearchPaymentState = (typeof PAYMENT_STATES)[number];

/** ANY: at least one attendee checked in. ALL: every attendee. NONE: nobody. */
export const CHECK_IN_STATES = ["ANY", "ALL", "NONE"] as const;
export type SearchCheckInState = (typeof CHECK_IN_STATES)[number];

export const SORT_KEYS = ["submitted", "created", "code", "name", "total"] as const;
export type SearchSortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";
const DEFAULT_DIRECTION: Record<SearchSortKey, SortDirection> = {
  submitted: "desc",
  created: "desc",
  code: "asc",
  name: "asc",
  total: "desc",
};

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
/** Deepest page offered. Offset paging is bounded; narrow the filters instead of paging past this. */
export const MAX_PAGE = 200;
export const MAX_TEXT_LENGTH = 100;
export const MAX_TEXT_TOKENS = 6;
export const MAX_LIST_VALUES = 50;
export const MAX_ANSWER_FILTERS = 10;

/** One structured form-answer condition: a field key within its scope and the stored values (any of them). */
export type AnswerFilter = {
  /** `${scope}:${field key}`, as `ChoiceQuestion.id`. Stable across label and form-version changes. */
  question: string;
  values: string[];
};

export type OperationsSearchQuery = {
  text: string;
  status: SearchRegistrationStatus[];
  attendeeType: string[];
  source: SearchRegistrationSource[];
  organization: string[];
  /** Sites of a multi-location event. The URL key matches the People list's own `location` parameter. */
  location: string[];
  waitlist: SearchWaitlistState[];
  payment: SearchPaymentState[];
  checkIn: SearchCheckInState | null;
  tag: string[];
  answers: AnswerFilter[];
  sort: SearchSortKey;
  direction: SortDirection;
  page: number;
  pageSize: number;
};

export function emptyOperationsSearchQuery(): OperationsSearchQuery {
  return {
    text: "",
    status: [],
    attendeeType: [],
    source: [],
    organization: [],
    location: [],
    waitlist: [],
    payment: [],
    checkIn: null,
    tag: [],
    answers: [],
    sort: "submitted",
    direction: DEFAULT_DIRECTION.submitted,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

/**
 * Why part of a search was not run. Messages are deliberately generic: a filter
 * the viewer may not use reads exactly like one that does not exist, and a
 * form field that is stale reads like one that is restricted, so the answer
 * never confirms something the viewer may not see.
 */
export type SearchIssueCode =
  | "unavailable"
  | "invalid-value"
  | "field-unavailable"
  | "value-not-offered"
  | "stale-reference"
  | "too-broad"
  | "conflict";

export type SearchIssue = { filter: string; code: SearchIssueCode; message: string };

function issue(filter: string, code: SearchIssueCode): SearchIssue {
  const messages: Record<SearchIssueCode, string> = {
    unavailable: "This filter is not available for this event.",
    "invalid-value": "This filter has a value that is not recognised.",
    "field-unavailable": "This form question is no longer offered as a filter, or is not available to you.",
    "value-not-offered": "This choice is no longer offered.",
    "stale-reference": "This item no longer exists for this event.",
    "too-broad": "This search matches too many records to filter this way. Narrow it first.",
    conflict: "This cannot be combined with the other filters in this search.",
  };
  return { filter, code, message: messages[code] };
}

/** An issue a caller reports for a request the search itself cannot see (for example a retired URL parameter). */
export function conflictIssue(filter: string): SearchIssue {
  return issue(filter, "conflict");
}

// ---- parsing and serialization ---------------------------------------------

export type SearchParamsInput = URLSearchParams | Record<string, string | readonly string[] | undefined>;

function paramValues(input: SearchParamsInput, name: string): string[] {
  if (input instanceof URLSearchParams) return input.getAll(name);
  const raw = input[name];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? [...raw] : [raw as string];
}

/** Only the parameters the search owns, so a page can pass everything it was given. */
export function pickSearchParams(input: SearchParamsInput): URLSearchParams {
  const picked = new URLSearchParams();
  for (const name of SEARCH_PARAM_NAMES) for (const value of paramValues(input, name)) picked.append(name, value);
  return picked;
}

export function normalizeSearchText(raw: string) {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Whitespace-separated words, bounded. Each word must match the same person. */
export function searchTokens(text: string) {
  return normalizeSearchText(text).split(" ").filter((token) => token.length > 0).slice(0, MAX_TEXT_TOKENS);
}

function parseEnumList<T extends string>(
  input: SearchParamsInput,
  name: string,
  allowed: readonly T[],
  issues: SearchIssue[],
): T[] {
  const out = new Set<T>();
  let invalid = false;
  for (const raw of paramValues(input, name)) {
    for (const part of raw.split(",")) {
      const value = part.trim();
      if (!value) continue;
      if ((allowed as readonly string[]).includes(value)) out.add(value as T);
      else invalid = true;
    }
  }
  if (invalid) issues.push(issue(name, "invalid-value"));
  return [...out].sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
}

function parseOpaqueList(input: SearchParamsInput, name: string, issues: SearchIssue[]): string[] {
  const out = new Set<string>();
  for (const raw of paramValues(input, name)) {
    for (const part of raw.split(",")) {
      const value = part.trim();
      if (!value) continue;
      if (value.length > 80 || !/^[\w.-]+$/.test(value)) {
        issues.push(issue(name, "invalid-value"));
        continue;
      }
      out.add(value);
    }
  }
  if (out.size > MAX_LIST_VALUES) {
    issues.push(issue(name, "invalid-value"));
    return [...out].sort().slice(0, MAX_LIST_VALUES);
  }
  return [...out].sort();
}

const ANSWER_QUESTION_PATTERN = /^(REGISTRATION|ATTENDEE):[a-z][a-z0-9_]{1,59}$/;

function parseAnswers(input: SearchParamsInput, issues: SearchIssue[]): AnswerFilter[] {
  const byQuestion = new Map<string, Set<string>>();
  for (const raw of paramValues(input, "answer")) {
    const separator = raw.indexOf("=");
    const question = separator > 0 ? raw.slice(0, separator) : "";
    const value = separator > 0 ? raw.slice(separator + 1) : "";
    if (!ANSWER_QUESTION_PATTERN.test(question) || value.length === 0 || value.length > 200) {
      issues.push(issue("answer", "invalid-value"));
      continue;
    }
    const values = byQuestion.get(question) ?? new Set<string>();
    values.add(value);
    byQuestion.set(question, values);
  }
  if (byQuestion.size > MAX_ANSWER_FILTERS) issues.push(issue("answer", "invalid-value"));
  return [...byQuestion.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, MAX_ANSWER_FILTERS)
    .map(([question, values]) => ({ question, values: [...values].sort() }));
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number, max: number, issues: SearchIssue[]) {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,6}$/.test(raw)) {
    issues.push(issue(name, "invalid-value"));
    return fallback;
  }
  const value = Number(raw);
  if (value < 1 || value > max) {
    issues.push(issue(name, "invalid-value"));
    return fallback;
  }
  return value;
}

/**
 * Reads the search out of URL parameters. Never throws and never trusts the
 * input: anything malformed is dropped from the query and reported, and the
 * caller decides what to show. Whether the viewer may use a filter, and
 * whether an id or form key still exists, is decided later by
 * `resolveOperationsSearch`.
 */
export function parseOperationsSearchParams(input: SearchParamsInput): { query: OperationsSearchQuery; issues: SearchIssue[] } {
  const issues: SearchIssue[] = [];
  const query = emptyOperationsSearchQuery();

  const text = normalizeSearchText(paramValues(input, "q")[0] ?? "");
  if (text.length > MAX_TEXT_LENGTH || text.split(" ").length > MAX_TEXT_TOKENS) {
    issues.push(issue("q", "invalid-value"));
    query.text = text.slice(0, MAX_TEXT_LENGTH).split(" ").slice(0, MAX_TEXT_TOKENS).join(" ").trim();
  } else {
    query.text = text;
  }

  query.status = parseEnumList(input, "status", REGISTRATION_STATUSES, issues);
  query.attendeeType = parseOpaqueList(input, "attendeeType", issues);
  query.source = parseEnumList(input, "source", REGISTRATION_SOURCES, issues);
  query.organization = parseOpaqueList(input, "organization", issues);
  query.location = parseOpaqueList(input, "location", issues);
  query.waitlist = parseEnumList(input, "waitlist", WAITLIST_STATES, issues);
  query.payment = parseEnumList(input, "payment", PAYMENT_STATES, issues);
  query.tag = parseOpaqueList(input, "tag", issues);
  query.answers = parseAnswers(input, issues);

  const checkIn = paramValues(input, "checkIn")[0];
  if (checkIn) {
    if ((CHECK_IN_STATES as readonly string[]).includes(checkIn)) query.checkIn = checkIn as SearchCheckInState;
    else issues.push(issue("checkIn", "invalid-value"));
  }

  const sortRaw = paramValues(input, "sort")[0];
  if (sortRaw) {
    const [key, direction, ...rest] = sortRaw.split(".");
    const directionOk = direction === undefined || direction === "asc" || direction === "desc";
    if ((SORT_KEYS as readonly string[]).includes(key) && directionOk && rest.length === 0) {
      query.sort = key as SearchSortKey;
      query.direction = (direction as SortDirection | undefined) ?? DEFAULT_DIRECTION[query.sort];
    } else {
      issues.push(issue("sort", "invalid-value"));
    }
  }
  query.pageSize = parsePositiveInt(paramValues(input, "size")[0], "size", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, issues);
  query.page = parsePositiveInt(paramValues(input, "page")[0], "page", 1, MAX_PAGE, issues);
  return { query, issues };
}

/**
 * The canonical URL query string for a search: fixed parameter order, sorted
 * deduplicated values, defaults left out. Two equal searches serialize to the
 * same string, and `parseOperationsSearchParams(serialize(q))` returns `q`, so
 * it is safe in a URL and as stored text for a saved view later. It names
 * stable keys and stored values only, never labels.
 */
export function serializeOperationsSearchQuery(query: OperationsSearchQuery): string {
  const params = new URLSearchParams();
  const text = normalizeSearchText(query.text);
  if (text) params.set("q", text);
  const list = (name: string, values: readonly string[]) => {
    if (values.length > 0) params.set(name, [...new Set(values)].sort().join(","));
  };
  // Enum lists keep their declared order, so equal searches serialize equally.
  const ordered = (name: string, order: readonly string[], chosen: readonly string[]) => {
    const kept = order.filter((value) => chosen.includes(value));
    if (kept.length > 0) params.set(name, kept.join(","));
  };
  ordered("status", REGISTRATION_STATUSES, query.status);
  list("attendeeType", query.attendeeType);
  ordered("source", REGISTRATION_SOURCES, query.source);
  list("organization", query.organization);
  list("location", query.location);
  ordered("waitlist", WAITLIST_STATES, query.waitlist);
  ordered("payment", PAYMENT_STATES, query.payment);
  if (query.checkIn) params.set("checkIn", query.checkIn);
  list("tag", query.tag);
  const answers = [...query.answers].sort((a, b) => (a.question < b.question ? -1 : a.question > b.question ? 1 : 0));
  for (const answer of answers) {
    for (const value of [...new Set(answer.values)].sort()) params.append("answer", `${answer.question}=${value}`);
  }
  if (query.sort !== "submitted" || query.direction !== DEFAULT_DIRECTION.submitted) {
    params.set("sort", query.direction === DEFAULT_DIRECTION[query.sort] ? query.sort : `${query.sort}.${query.direction}`);
  }
  if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set("size", String(query.pageSize));
  if (query.page !== 1) params.set("page", String(query.page));
  return params.toString();
}

/** True when the query narrows anything (the sort and page do not count). */
export function hasActiveFilters(query: OperationsSearchQuery) {
  return Boolean(
    query.text || query.status.length || query.attendeeType.length || query.source.length || query.organization.length
    || query.location.length || query.waitlist.length || query.payment.length || query.checkIn || query.tag.length || query.answers.length,
  );
}

/** The filter keys the query actually uses. */
export function activeFilterKeys(query: OperationsSearchQuery): FilterKey[] {
  const keys: FilterKey[] = [];
  if (query.text) keys.push("q");
  if (query.status.length) keys.push("status");
  if (query.attendeeType.length) keys.push("attendeeType");
  if (query.source.length) keys.push("source");
  if (query.organization.length) keys.push("organization");
  if (query.location.length) keys.push("location");
  if (query.waitlist.length) keys.push("waitlist");
  if (query.payment.length) keys.push("payment");
  if (query.checkIn) keys.push("checkIn");
  if (query.tag.length) keys.push("tag");
  if (query.answers.length) keys.push("answer");
  return keys;
}

// ---- catalog and resolution -------------------------------------------------

/**
 * What exists for this event, as far as this viewer may know. A domain the
 * viewer may not use is loaded as empty, so "does not exist" and "not allowed"
 * cannot be told apart from the result.
 */
export type SearchCatalog = {
  waitlistEnabled: boolean;
  /** Church-billed (deferred) event: no attendee balance, so no UNPAID / PARTIAL / PAID. */
  deferredBilling: boolean;
  attendeeTypes: Array<{ code: string; label: string }>;
  /** Sites of the event; empty on a single-location event, where the filter does not exist. */
  locations: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string; isActive: boolean }>;
  /** Organizations (clubs and churches) with a registration on the event; empty when the viewer may not use identity filters. */
  organizations: Array<{ id: string; name: string }>;
  /** Non-sensitive choice questions across the event's form versions; empty when the viewer may not use form answers. */
  questions: SearchQuestion[];
};

/**
 * A choice question plus the form versions that offer it as a filterable
 * choice. An answer is read only on a registration submitted through one of
 * those versions, so a later version that reuses the key for free text is
 * never read as a choice (the same rule as the in-memory answer filter).
 */
export type SearchQuestion = ChoiceQuestion & { versionIds: string[] };

export function emptySearchCatalog(): SearchCatalog {
  return { waitlistEnabled: false, deferredBilling: false, attendeeTypes: [], locations: [], tags: [], organizations: [], questions: [] };
}

/** Whether a filter exists for the event at all (before the permission check). */
function filterExists(key: FilterKey, catalog: SearchCatalog) {
  switch (key) {
    case "attendeeType": return catalog.attendeeTypes.length > 0;
    case "location": return catalog.locations.length > 0;
    case "organization": return catalog.organizations.length > 0;
    case "waitlist": return catalog.waitlistEnabled;
    case "tag": return catalog.tags.length > 0;
    case "answer": return catalog.questions.length > 0;
    default: return true;
  }
}

export type SearchFilterDescriptor =
  | { key: Exclude<FilterKey, "answer" | "attendeeType" | "location" | "organization" | "tag" | "status" | "source" | "waitlist" | "payment" | "checkIn">; kind: "text" }
  | { key: "status" | "source" | "waitlist" | "payment" | "checkIn"; kind: "enum"; options: Array<{ value: string }> }
  | { key: "attendeeType"; kind: "enum"; options: Array<{ value: string; label: string }> }
  | { key: "location" | "organization"; kind: "enum"; options: Array<{ value: string; label: string }> }
  | { key: "tag"; kind: "enum"; options: Array<{ value: string; label: string }> }
  | { key: "answer"; kind: "questions"; questions: Array<{ question: string; label: string; scope: "REGISTRATION" | "ATTENDEE"; choices: Array<{ value: string; label: string }> }> };

/**
 * The filters to offer this viewer for this event: only those whose domain
 * exists and whose permission the viewer holds. The one list the UI renders
 * and the audience builder (#176) can read, so neither invents its own.
 */
export function availableOperationsFilters(viewer: SearchViewer, catalog: SearchCatalog): SearchFilterDescriptor[] {
  const usable = (key: FilterKey) => viewerCanUseDomain(viewer, FILTER_DOMAIN[key]) && filterExists(key, catalog);
  const out: SearchFilterDescriptor[] = [];
  if (usable("q")) out.push({ key: "q", kind: "text" });
  if (usable("status")) out.push({ key: "status", kind: "enum", options: REGISTRATION_STATUSES.map((value) => ({ value })) });
  if (usable("attendeeType")) out.push({ key: "attendeeType", kind: "enum", options: catalog.attendeeTypes.map((type) => ({ value: type.code, label: type.label })) });
  if (usable("location")) out.push({ key: "location", kind: "enum", options: catalog.locations.map((site) => ({ value: site.id, label: site.name })) });
  if (usable("organization")) out.push({ key: "organization", kind: "enum", options: catalog.organizations.map((organization) => ({ value: organization.id, label: organization.name })) });
  if (usable("source")) out.push({ key: "source", kind: "enum", options: REGISTRATION_SOURCES.map((value) => ({ value })) });
  if (usable("waitlist")) out.push({ key: "waitlist", kind: "enum", options: WAITLIST_STATES.map((value) => ({ value })) });
  if (usable("payment")) {
    const states = catalog.deferredBilling ? PAYMENT_STATES.filter((state) => state === "REFUNDED") : PAYMENT_STATES;
    out.push({ key: "payment", kind: "enum", options: states.map((value) => ({ value })) });
  }
  if (usable("checkIn")) out.push({ key: "checkIn", kind: "enum", options: CHECK_IN_STATES.map((value) => ({ value })) });
  if (usable("tag")) out.push({ key: "tag", kind: "enum", options: catalog.tags.filter((tag) => tag.isActive).map((tag) => ({ value: tag.id, label: tag.name })) });
  if (usable("answer")) {
    out.push({
      key: "answer",
      kind: "questions",
      questions: catalog.questions.map((question) => ({ question: question.id, label: question.label, scope: question.scope, choices: question.choices })),
    });
  }
  return out;
}

export type ResolvedSearch =
  | { ok: true; query: OperationsSearchQuery; questions: SearchQuestion[] }
  | { ok: false; issues: SearchIssue[] };

/**
 * Decides whether a parsed query may run for this viewer against this event's
 * catalog. All or nothing: any filter the viewer may not use, or that names
 * something the event no longer has, is reported and the search does not run,
 * so a partly honoured query never returns rows that look complete.
 */
export function resolveOperationsSearch(
  query: OperationsSearchQuery,
  viewer: SearchViewer,
  catalog: SearchCatalog,
  carriedIssues: readonly SearchIssue[] = [],
): ResolvedSearch {
  const issues: SearchIssue[] = [...carriedIssues];
  if (!viewerMaySearchEvent(viewer)) {
    return { ok: false, issues: [issue("search", "unavailable")] };
  }
  const keys = activeFilterKeys(query);
  const usableKeys = new Set<FilterKey>();
  for (const key of keys) {
    if (viewerCanUseDomain(viewer, FILTER_DOMAIN[key]) && filterExists(key, catalog)) usableKeys.add(key);
    else issues.push(issue(key, "unavailable"));
  }

  if (usableKeys.has("attendeeType")) {
    const known = new Set(catalog.attendeeTypes.map((type) => type.code));
    if (query.attendeeType.some((code) => !known.has(code))) issues.push(issue("attendeeType", "stale-reference"));
  }
  if (usableKeys.has("location")) {
    const known = new Set(catalog.locations.map((site) => site.id));
    if (query.location.some((id) => !known.has(id))) issues.push(issue("location", "stale-reference"));
  }
  if (usableKeys.has("organization")) {
    const known = new Set(catalog.organizations.map((organization) => organization.id));
    if (query.organization.some((id) => !known.has(id))) issues.push(issue("organization", "stale-reference"));
  }
  // Sorting by a value is reading that value: the sort needs the same domain as the filter on it.
  if (query.sort === "name" && !viewerCanUseDomain(viewer, "identity")) issues.push(issue("sort", "unavailable"));
  if (query.sort === "total" && !viewerCanUseDomain(viewer, "payment")) issues.push(issue("sort", "unavailable"));
  if (usableKeys.has("tag")) {
    const known = new Set(catalog.tags.map((tag) => tag.id));
    if (query.tag.some((id) => !known.has(id))) issues.push(issue("tag", "stale-reference"));
  }
  if (usableKeys.has("payment") && catalog.deferredBilling && query.payment.some((state) => state !== "REFUNDED")) {
    issues.push(issue("payment", "value-not-offered"));
  }
  const questions: SearchQuestion[] = [];
  if (usableKeys.has("answer")) {
    const byId = new Map(catalog.questions.map((question) => [question.id, question]));
    for (const answer of query.answers) {
      const question = byId.get(answer.question);
      if (!question) {
        issues.push(issue("answer", "field-unavailable"));
        continue;
      }
      questions.push(question);
      const offered = new Set(question.choices.map((choice) => choice.value));
      if (answer.values.some((value) => !offered.has(value))) issues.push(issue("answer", "value-not-offered"));
    }
  }
  if (issues.length > 0) return { ok: false, issues: dedupeIssues(issues) };
  return { ok: true, query, questions };
}

function dedupeIssues(issues: readonly SearchIssue[]) {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.filter}:${entry.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- the predicate -----------------------------------------------------------

export type SearchWhereContext = {
  eventId: string;
  questions: readonly SearchQuestion[];
  /**
   * Registrations the repository resolved in SQL, per question id. For a registration-wide question: those whose current
   * answer (latest amendment, else the submission) matches. For an attendee question: those whose answer lives only on the
   * original submission (the attendee row has no answers of its own), read at the attendee's position.
   */
  answerRegistrationIds?: ReadonlyMap<string, readonly string[]>;
  /** Registrations whose money state matches, when a payment filter is active (computed by the repository). */
  paymentRegistrationIds: readonly string[] | null;
};

const insensitive = "insensitive" as const;

/**
 * Prisma passes `contains` text to ILIKE unescaped, so a typed "%" or "_" would
 * match everything. Escape them (and the escape character) so a person's text
 * is only ever literal text.
 */
export function escapeLikePattern(text: string) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function personFieldMatches(raw: string): Prisma.PersonWhereInput {
  const token = escapeLikePattern(raw);
  return {
    OR: [
      { firstName: { contains: token, mode: insensitive } },
      { lastName: { contains: token, mode: insensitive } },
      { normalizedEmail: { contains: token, mode: insensitive } },
      { phone: { contains: token, mode: insensitive } },
    ],
  };
}

function snapshotMatches(field: "contactSnapshot" | "profileSnapshot", raw: string) {
  const token = escapeLikePattern(raw);
  return ["firstName", "lastName", "email", "phone"].map((key) => ({
    [field]: { path: [key], string_contains: token, mode: insensitive },
  }));
}

/**
 * Text lookup that keeps what PR #316 gave staff: a registration is found by
 * its confirmation code, its account holder, or ANY attendee on it, so a call
 * from someone who is not the payer still lands on the right row. Every word
 * must match the same person, so "Jane Smith" does not match Jane Doe travelling
 * with Sam Smith.
 */
function textPredicate(text: string): Prisma.RegistrationWhereInput {
  const tokens = searchTokens(text);
  const whole = escapeLikePattern(normalizeSearchText(text));
  const accountHolder: Prisma.RegistrationWhereInput = {
    AND: tokens.map((token) => ({
      OR: [
        { accountHolderPerson: { is: personFieldMatches(token) } },
        ...(snapshotMatches("contactSnapshot", token) as Prisma.RegistrationWhereInput[]),
      ],
    })),
  };
  const attendee: Prisma.RegistrationAttendeeWhereInput = {
    AND: tokens.map((token) => ({
      OR: [
        { person: { is: personFieldMatches(token) } },
        ...(snapshotMatches("profileSnapshot", token) as Prisma.RegistrationAttendeeWhereInput[]),
      ],
    })),
  };
  return {
    OR: [
      { confirmationCode: { contains: whole, mode: insensitive } },
      accountHolder,
      { attendees: { some: attendee } },
      { clubRegistration: { is: { organization: { is: { name: { contains: whole, mode: insensitive } } } } } },
    ],
  };
}

function sourcePredicate(source: SearchRegistrationSource): Prisma.RegistrationWhereInput {
  const notClub = { clubRegistration: null };
  const notGroup = { groupRegistration: null };
  const notGeneral = { generalLinkSubmission: null };
  switch (source) {
    case "CLUB": return { clubRegistration: { isNot: null } };
    case "GROUP": return { clubRegistration: null, groupRegistration: { isNot: null } };
    case "GENERAL_LINK": return { clubRegistration: null, groupRegistration: null, generalLinkSubmission: { isNot: null } };
    case "PUBLIC_FORM": return { ...notClub, ...notGroup, ...notGeneral, publicFormSubmission: { isNot: null } };
    case "STAFF": return { ...notClub, ...notGroup, ...notGeneral, publicFormSubmission: null };
  }
}

function answerValuePredicate(key: string, value: string) {
  // A single choice is stored as text and a multi-select as a list; read either so a field that changed kind between form versions still matches.
  return [{ path: [key], equals: value }, { path: [key], array_contains: [value] }];
}

function answerPredicate(answer: AnswerFilter, question: SearchQuestion, lookedUpIds: readonly string[]): Prisma.RegistrationWhereInput {
  // A registration-wide answer is whatever the latest amendment says, else the original submission: SQL resolves that
  // (see `registrationAnswerIds`), already limited to the versions that offer the question, so the ids are the answer.
  if (question.scope === "REGISTRATION") return { id: { in: [...lookedUpIds] } };
  // An attendee's own answers are kept on the attendee row (amendments update it in place). Only a registration submitted
  // through a version that offers the question as a choice is read; answers kept only on the submission come from the lookup.
  const offeredVersion: Prisma.RegistrationWhereInput = { publicFormSubmission: { is: { formVersionId: { in: question.versionIds } } } };
  return {
    OR: [
      {
        AND: [
          offeredVersion,
          { attendees: { some: { OR: answer.values.flatMap((value) => answerValuePredicate(question.key, value).map((formResponses) => ({ formResponses }))) } } },
        ],
      },
      { id: { in: [...lookedUpIds] } },
    ],
  };
}

/**
 * THE predicate. Results, counts, facets and suggestions all build their
 * `where` here, so a count can never describe a different set than the rows it
 * sits beside, and no path can search a domain this one leaves out. It is
 * always scoped to the viewer's event first. Call it only with a query that
 * `resolveOperationsSearch` accepted.
 */
export function buildRegistrationWhere(query: OperationsSearchQuery, context: SearchWhereContext): Prisma.RegistrationWhereInput {
  const clauses: Prisma.RegistrationWhereInput[] = [];
  if (query.text) clauses.push(textPredicate(query.text));
  if (query.status.length) clauses.push({ status: { in: query.status } });
  if (query.attendeeType.length) {
    clauses.push({ attendees: { some: { attendeeTypeDefinition: { is: { eventId: context.eventId, code: { in: query.attendeeType } } } } } });
  }
  if (query.source.length) clauses.push({ OR: query.source.map(sourcePredicate) });
  if (query.location.length) clauses.push({ locationId: { in: query.location } });
  if (query.organization.length) clauses.push({ clubRegistration: { is: { organizationId: { in: query.organization } } } });
  if (query.waitlist.length) clauses.push({ waitlistEntry: { is: { status: { in: query.waitlist } } } });
  if (query.checkIn === "ANY") clauses.push({ attendees: { some: { checkIns: { some: { undoneAt: null } } } } });
  if (query.checkIn === "NONE") clauses.push({ attendees: { none: { checkIns: { some: { undoneAt: null } } } } });
  if (query.checkIn === "ALL") clauses.push({ attendees: { some: {}, every: { checkIns: { some: { undoneAt: null } } } } });
  if (query.tag.length) {
    clauses.push({
      OR: [
        { tagAssignments: { some: { eventId: context.eventId, tagId: { in: query.tag }, removedAt: null } } },
        { attendees: { some: { tagAssignments: { some: { eventId: context.eventId, tagId: { in: query.tag }, removedAt: null } } } } },
      ],
    });
  }
  if (query.payment.length && context.paymentRegistrationIds) clauses.push({ id: { in: [...context.paymentRegistrationIds] } });
  for (const answer of query.answers) {
    const question = context.questions.find((candidate) => candidate.id === answer.question);
    // Unreachable for a resolved query; failing closed beats matching everything.
    clauses.push(question ? answerPredicate(answer, question, context.answerRegistrationIds?.get(answer.question) ?? []) : { id: { in: [] } });
  }
  return { eventId: context.eventId, ...(clauses.length ? { AND: clauses } : {}) };
}

const SORT_DESCRIPTION: Record<SearchSortKey, { label: string; kind: SortKind }> = {
  submitted: { label: "submitted date", kind: "date" },
  created: { label: "created date", kind: "date" },
  code: { label: "confirmation code", kind: "text" },
  name: { label: "name", kind: "text" },
  total: { label: "total", kind: "number" },
};

/**
 * The sentence for the order a search actually ran in ("Sorted by name, A to Z."),
 * from the resolved query the service ordered by, never from raw URL text. A
 * search that did not run (`ok` false: an invalid or unavailable sort among the
 * issues) has no order to describe, so this returns null rather than name a
 * field the viewer may not use.
 */
export function describeSearchOrder(result: { ok: boolean; query: Pick<OperationsSearchQuery, "sort" | "direction"> }): string | null {
  if (!result.ok) return null;
  const { label, kind } = SORT_DESCRIPTION[result.query.sort];
  return sortOrderText(label, result.query.direction, kind);
}

/**
 * Canonical order: the chosen key, then newest-created, then id, always in the
 * same direction. The id tail makes the order total, so two rows that tie on
 * every visible value still page in a fixed order and none is skipped or
 * repeated between pages.
 */
export function registrationOrderBy(query: Pick<OperationsSearchQuery, "sort" | "direction">): Prisma.RegistrationOrderByWithRelationInput[] {
  const dir = query.direction;
  const head: Prisma.RegistrationOrderByWithRelationInput[] = (() => {
    switch (query.sort) {
      case "submitted": return [{ submittedAt: { sort: dir, nulls: "last" } }];
      case "created": return [];
      case "code": return [{ confirmationCode: dir }];
      case "name": return [{ accountHolderPerson: { lastName: dir } }, { accountHolderPerson: { firstName: dir } }];
      case "total": return [{ totalAmount: dir }];
    }
  })();
  return [...head, { createdAt: dir }, { id: dir }];
}

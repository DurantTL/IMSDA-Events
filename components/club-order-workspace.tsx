"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useClientSearch } from "@/components/search-as-you-type";
import { AlertTriangle, CheckCircle2, Download, Eye, History, Info, PackageCheck, Plus, Printer, RotateCcw, Save, Trash2 } from "lucide-react";
import styles from "@/components/club-orders.module.css";
import { savedMessage } from "@/components/form-message";
import { ClubSupplyStockWorkspace } from "@/components/club-supply-stock-workspace";
import { ClubUniformSection, emptyUniformData, type ClubUniformData } from "@/components/club-uniform-section";
import { ORDER_LIST_SECTIONS, activeHelperLines, formatSizeLabel, groupUnmatchedByHonor, hasStockTracking, needsDatedBefore, orderListSectionLabels, type HelperLine } from "@/modules/club-orders/domain";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import type { AwardableNeed, OrderBatchSummary, OrderableHonor, UnmatchedNeed, WaitingNeed } from "@/modules/club-orders/repository";
import type { ClubStockRow } from "@/modules/club-supplies/repository";
import { ListPager } from "@/components/list-pager";
import { paginate } from "@/lib/pagination";
import { effectiveChoice, makeSearchMatcher, searchResultSummary } from "@/lib/search-match";
import { DisabledHint, disabledHintId } from "@/components/disabled-hint";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export type ClubOrderWorkspaceData = {
  helper: HelperLine[];
  /** Orders placed before the helper list (#654): only ones still waiting to arrive are shown, to mark received. */
  batches: OrderBatchSummary[];
  unmatched: UnmatchedNeed[];
  awardable: AwardableNeed[];
  waiting: WaitingNeed[];
  firstOrderAt: string | null;
};

type ApiResult = Partial<ClubOrderWorkspaceData> & {
  error?: string;
  message?: string;
  issues?: Array<{ message?: string }>;
  awarded?: number;
  fromStock?: number;
  marked?: number;
  created?: number;
  skipped?: number;
  removed?: number;
};

const ordersBase = (organizationId: string) => `/api/attendee/clubs/${encodeURIComponent(organizationId)}/orders`;

/** The same bulk limit the award routes accept. */
const BULK_LIMIT = 500;

export const ADVENTSOURCE_URL = "https://www.adventsource.org";

/**
 * Stable anchors for the Orders page's sections (#810). "inventory" and
 * "club-uniforms" already existed (the old supplies redirects land on
 * `#inventory`), so the ids never change; the jump links at the top use them.
 */
export const ORDER_SECTION_IDS = {
  list: "club-order-list",
  supplies: "inventory",
  waiting: "club-order-waiting",
  ready: "club-order-ready",
  uniforms: "club-uniforms",
} as const;

/**
 * The jump links at the top of Orders, in page order, each with one plain sentence on what
 * that part is for (the owner's Oct 13 request). The sentences describe what the sections
 * below do today. "Orders waiting to arrive" is listed only while one exists. A view-only
 * viewer (registrar, Area Coordinator) gets descriptive wording rather than instructions,
 * in the tone of the read-only line in club-uniform-section.tsx.
 */
export function orderSectionLinks(hasWaiting: boolean, readOnly = false): { id: string; label: string; description: string }[] {
  const text = readOnly
    ? {
      list: "The shopping list for AdventSource. Finished honors, uniform needs and earned awards appear here on their own. It can be exported or printed.",
      supplies: "What the club has on hand. These counts come off what needs to be ordered.",
      waiting: "Older orders from before this list. Once one arrives it is marked received and its items join the supplies.",
      ready: "Members whose honor, award or uniform item is already in the supplies. Once it is given to them it is marked handed out; it leaves this list and comes off the supplies.",
      uniforms: "Who needs which uniform items. They join the order list with the honors, and supplies on hand are taken off.",
    }
    : {
      list: "Your shopping list for AdventSource. Finished honors, uniform needs and earned awards show up here on their own. Change quantities, add or remove items, then export or print it.",
      supplies: "What your club already has on hand. Keep these counts up to date and they come off what you need to order.",
      waiting: "Older orders from before this list. Mark one received when it arrives and its items join your supplies.",
      ready: "Members whose honor, award or uniform item is already in your supplies. When you give it to them, mark it handed out; it leaves this list and comes off your supplies.",
      uniforms: "Who needs which uniform items. They join the order list with the honors, and supplies you already have are taken off.",
    };
  return [
    { id: ORDER_SECTION_IDS.list, label: "Order list", description: text.list },
    { id: ORDER_SECTION_IDS.supplies, label: "Supplies", description: text.supplies },
    ...(hasWaiting ? [{ id: ORDER_SECTION_IDS.waiting, label: "Waiting to arrive", description: text.waiting }] : []),
    { id: ORDER_SECTION_IDS.ready, label: "Ready to hand out", description: text.ready },
    { id: ORDER_SECTION_IDS.uniforms, label: "Uniforms", description: text.uniforms },
  ];
}

/** The picker's matches (#1324): active items not already listed, found by name, item number, size or linked honor name. */
export function filterPickerItems(stock: readonly ClubStockRow[], listed: ReadonlySet<string>, query: string) {
  const matches = makeSearchMatcher(query);
  return stock.filter((row) => row.isActive && !listed.has(row.itemId) && matches([row.name, row.catalogNumber, row.sizeLabel, row.honorName]));
}

/** Shown beside an honor with no catalog item (#1330). */
export const NO_CATALOG_ITEM_LABEL = "No catalog item: order from AdventSource separately";

/** The picker's honors (#1330): active honors with no catalog item that aren't on the list yet, found by name. */
export function filterPickerHonors(honors: readonly OrderableHonor[], listed: ReadonlySet<string>, query: string) {
  const matches = makeSearchMatcher(query);
  return honors.filter((honor) => !listed.has(honor.honorId) && matches([honor.name]));
}

/** Most items the "add an item" picker lists at once. */
const PICKER_PAGE_SIZE = 100;

const HONOR_PICK_PREFIX = "honor:";

/** What a line is addressed by: its catalog item id, or `honor:<id>` (#1330). */
const lineKey = (line: HelperLine) => (line.itemId ?? `${HONOR_PICK_PREFIX}${line.honorId}`);

/** The route for one line's quantity: a catalog item's, or an honor with no catalog item's (#1330). */
const lineTarget = (key: string) => (key.startsWith(HONOR_PICK_PREFIX)
  ? `honor-lines/${encodeURIComponent(key.slice(HONOR_PICK_PREFIX.length))}`
  : `lines/${encodeURIComponent(key)}`);

const promptDismissedKey = (organizationId: string) => `imsda:orders:earlier-honors-dismissed:${organizationId}`;

/** Fallback for this page view when storage is blocked. */
const dismissedInMemory = new Set<string>();

function readDismissed(organizationId: string) {
  if (dismissedInMemory.has(organizationId)) return true;
  try {
    return window.localStorage.getItem(promptDismissedKey(organizationId)) === "1";
  } catch {
    return false;
  }
}

const DISMISSED_EVENT = "imsda:orders-prompt-dismissed";

function subscribeDismissed(onChange: () => void) {
  window.addEventListener(DISMISSED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISMISSED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeDismissed(organizationId: string) {
  dismissedInMemory.add(organizationId);
  try {
    window.localStorage.setItem(promptDismissedKey(organizationId), "1");
  } catch {
    // Storage can be blocked; the prompt then returns next visit.
  }
  window.dispatchEvent(new Event(DISMISSED_EVENT));
}

function formatDate(value: string) {
  return formatInConferenceTime(value, { dateStyle: "long" });
}

/**
 * A club's Orders screen (#487, #497, #654): a helper for building the list
 * of supplies to order from AdventSource. It is not an order form and places
 * nothing. The list has Uniforms, Honors and other supplies, each line with
 * item name, size, item number and a quantity the director can change, add or
 * remove; "to order" is needed less what the club has on hand (the Inventory
 * below). It exports to CSV and prints. Below the list: who is ready to hand
 * out, honors that may already be handed out, and the uniform entry. Only
 * names and item names appear for people; no other personal field is ever
 * loaded. A registrar or Area Coordinator gets `readOnly`: the same lists, no
 * controls.
 */
export function ClubOrderWorkspace({
  organizationId,
  initial,
  initialUniforms = emptyUniformData,
  stock = [],
  orderableHonors = [],
  printHref,
  readOnly = false,
}: {
  organizationId: string;
  initial: ClubOrderWorkspaceData;
  initialUniforms?: ClubUniformData;
  /** The catalog with this club's quantities: the add-an-item picker and the Inventory. */
  stock?: ClubStockRow[];
  /** Active honors with no catalog item, which a director can add by hand (#1330). */
  orderableHonors?: OrderableHonor[];
  /** The printable page, when the viewer has one. */
  printHref?: string;
  readOnly?: boolean;
}) {
  const [data, setData] = useState(initial);
  const [uniforms, setUniforms] = useState(initialUniforms);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [handedOut, setHandedOut] = useState<Set<string>>(new Set());
  const handedOutBlocked = handedOut.size === 0 ? "Tick at least one item above that was already handed out." : null;
  const [beforeDate, setBeforeDate] = useState("");
  // Remembered per club on this device. The server snapshot is "not dismissed", so the first render matches the server.
  const promptDismissed = useSyncExternalStore(subscribeDismissed, () => readDismissed(organizationId), () => false);
  const pickerSearch = useClientSearch();
  const pickerQuery = pickerSearch.term;
  const [pickerPage, setPickerPage] = useState(1);
  const [pickerItem, setPickerItem] = useState("");
  // A new search starts on page 1 with nothing chosen, once the list has changed (not on every keystroke).
  const [pickerTermSeen, setPickerTermSeen] = useState(pickerQuery);
  if (pickerTermSeen !== pickerQuery) {
    setPickerTermSeen(pickerQuery);
    setPickerPage(1);
    setPickerItem("");
  }
  const [pickerQuantity, setPickerQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const focusHonorId = useRef<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const base = ordersBase(organizationId);
  const uniformsBase = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/uniforms`;

  const onList = useMemo(() => activeHelperLines(data.helper), [data.helper]);
  const takenOff = useMemo(() => data.helper.filter((line) => line.needed === 0 && line.edited && line.computedNeeded > 0), [data.helper]);
  const totalToOrder = onList.reduce((sum, line) => sum + line.toOrder, 0);
  const awardGroups = useMemo(() => {
    const groups = new Map<string, { itemName: string; needs: AwardableNeed[] }>();
    for (const need of data.awardable) {
      const group = groups.get(need.itemId) ?? { itemName: need.itemName, needs: [] };
      group.needs.push(need);
      groups.set(need.itemId, group);
    }
    return [...groups.entries()];
  }, [data.awardable]);
  // Honors on the list by hand (#1330), so the picker and "Add to list" never offer one twice.
  const listedHonorIds = useMemo(() => new Set(data.helper.flatMap((line) => (line.honorId ? [line.honorId] : []))), [data.helper]);
  const orderableHonorIds = useMemo(() => new Set(orderableHonors.map((honor) => honor.honorId)), [orderableHonors]);
  // Catalog items first, then honors with no catalog item. A honor's value is prefixed so it can't collide with an item id.
  const pickerItems = useMemo(() => {
    const items = filterPickerItems(stock, new Set(onList.flatMap((line) => (line.itemId ? [line.itemId] : []))), pickerQuery)
      .map((row) => ({
        itemId: row.itemId,
        label: `${row.name}${row.catalogNumber ? ` · ${row.catalogNumber}` : ""}${row.honorName && row.honorName !== row.name ? ` · honor: ${row.honorName}` : ""}`,
      }));
    const honors = filterPickerHonors(orderableHonors, listedHonorIds, pickerQuery)
      .map((honor) => ({ itemId: `${HONOR_PICK_PREFIX}${honor.honorId}`, label: `${honor.name} · ${NO_CATALOG_ITEM_LABEL}` }));
    return [...items, ...honors];
  }, [stock, orderableHonors, listedHonorIds, pickerQuery, onList]);
  const pickerSlice = useMemo(() => paginate(pickerItems, pickerPage, PICKER_PAGE_SIZE), [pickerItems, pickerPage]);
  const shownPickerItems = pickerSlice.items;
  const pickerSummary = searchResultSummary(pickerItems.length, pickerQuery, "item");
  // One match needs no second click, and a search can never leave a hidden item chosen (#799).
  const chosenItem = effectiveChoice(pickerItem, shownPickerItems.map((row) => ({ id: row.itemId })), pickerQuery);
  // Honors that may have been handed out long ago: the club marks them so they aren't counted as needed.
  const earlier = useMemo(() => data.waiting.filter((need) => need.sourceType === "HONOR" && need.beforeFirstOrder), [data.waiting]);
  // Shown only while the club hasn't edited the helper list or handed anything out here: a one-time cleanup, never in read-only mode.
  const showPrompt = !readOnly && !promptDismissed && earlier.length > 0 && !data.helper.some((line) => line.edited);
  useEffect(() => {
    const honorId = focusHonorId.current;
    if (!honorId || !listedHonorIds.has(honorId)) return;
    focusHonorId.current = null;
    document.getElementById(`club-order-on-list-${honorId}`)?.focus();
  }, [listedHonorIds]);
  const waitingBatches = data.batches.filter((batch) => batch.status === "ORDERED");

  function dismissPrompt() {
    writeDismissed(organizationId);
  }

  async function refresh() {
    // Uniforms first: an editor's load drops departed members' needs before the order list is read.
    const uniformResponse = await fetch(uniformsBase, { cache: "no-store" });
    const response = await fetch(base, { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ApiResult;
    if (response.ok && result.helper && result.batches && result.awardable && result.unmatched && result.waiting) {
      setData({ helper: result.helper, batches: result.batches, unmatched: result.unmatched, awardable: result.awardable, waiting: result.waiting, firstOrderAt: result.firstOrderAt ?? null });
    }
    const uniformResult = await uniformResponse.json().catch(() => ({})) as Partial<ClubUniformData>;
    if (uniformResponse.ok && uniformResult.needs && uniformResult.catalog && uniformResult.members) {
      setUniforms({ catalog: uniformResult.catalog, members: uniformResult.members, needs: uniformResult.needs, issuedCount: uniformResult.issuedCount ?? 0 });
    }
  }

  async function send(url: string, method: "POST" | "PUT", body: unknown) {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as ApiResult;
    if (!response.ok) {
      throw new Error(
        result.error === "MFA_UNLOCK_REQUIRED"
          ? "Confirm it's you again: reload this page and enter your authenticator code."
          : result.message ?? result.issues?.[0]?.message ?? "That could not be saved.",
      );
    }
    return result;
  }
  const post = (url: string, body: unknown) => send(url, "POST", body);

  async function act(run: () => Promise<string>) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      setNotice(await run());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
      return false;
    } finally {
      await refresh().catch(() => undefined);
      setBusy(false);
    }
  }

  /**
   * Sets one line's quantity (0 takes it off the list), or `null` to put it back to the computed count.
   * `key` is a catalog item id, or `honor:<id>` for an honor with no catalog item (#1330), whose
   * line is removed by 0 or `null` alike.
   */
  function setQuantity(key: string, quantity: number | null, message: string) {
    return act(async () => {
      await send(`${base}/${lineTarget(key)}`, "PUT", { quantity });
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return message;
    });
  }

  function saveDraft(line: HelperLine) {
    const draft = drafts[lineKey(line)];
    if (draft === undefined) return;
    if (!/^\d+$/.test(draft.trim())) {
      setError("Enter a whole number, 0 or more.");
      return;
    }
    return setQuantity(lineKey(line), Number(draft), savedMessage());
  }

  /** "Honors to order separately": adds the honor with the number of members who completed it (#1330). */
  async function addHonorLine(honor: { honorId: string; name: string; members: number }) {
    // The button is replaced by "On the list" once saved, so focus moves there instead of falling to the page.
    focusHonorId.current = honor.honorId;
    if (!await setQuantity(`${HONOR_PICK_PREFIX}${honor.honorId}`, honor.members, `Added ${honor.name} to the list, quantity ${honor.members}.`)) focusHonorId.current = null;
  }

  function removeLine(line: HelperLine) {
    // A line nothing calls for was added by hand: forget it. Otherwise keep a 0 so it stays off the list.
    return setQuantity(lineKey(line), line.computedNeeded > 0 ? 0 : null, `Took ${line.name} off the list.`);
  }

  async function addLine() {
    const quantity = Number(pickerQuantity);
    if (!chosenItem || !Number.isSafeInteger(quantity) || quantity < 1) {
      setError("Choose an item and a quantity of 1 or more.");
      return;
    }
    if (await setQuantity(chosenItem, quantity, "Added to the list.")) {
      setPickerItem("");
      pickerSearch.setValue(""); setPickerPage(1);
      setPickerQuantity("1");
    }
  }

  async function markAwarded() {
    const needIds = [...selected];
    if (needIds.length === 0) return;
    const ok = await act(async () => {
      const result = await post(`${base}/award`, { needIds });
      const fromStock = result.fromStock ?? 0;
      return `Marked ${result.awarded ?? 0} handed out${fromStock > 0 ? ` (${fromStock} from stock)` : ""}.`;
    });
    if (ok) {
      setSelected(new Set());
      dismissPrompt();
    }
  }

  async function markAlreadyHandedOut() {
    const needIds = [...handedOut];
    if (needIds.length === 0) return;
    const ok = await act(async () => {
      let marked = 0;
      for (let start = 0; start < needIds.length; start += BULK_LIMIT) {
        const result = await post(`${base}/already-awarded`, { needIds: needIds.slice(start, start + BULK_LIMIT) });
        marked += result.marked ?? 0;
      }
      return `Marked ${marked} as already handed out. Stock wasn't changed.`;
    });
    if (ok) {
      setHandedOut(new Set());
      dismissPrompt();
    }
  }

  async function recordUniforms(input: { personIds: string[]; itemIds: string[]; alreadyHasOne: boolean }) {
    return act(async () => {
      const result = await post(uniformsBase, input);
      const created = result.created ?? 0;
      const skipped = result.skipped ?? 0;
      const marked = result.marked ?? 0;
      const what = input.alreadyHasOne
        ? `Recorded ${created} as already issued${marked > 0 ? ` and marked ${marked} existing ${marked === 1 ? "need" : "needs"} as issued` : ""}. Stock wasn't changed.`
        : `Recorded ${created} uniform ${created === 1 ? "need" : "needs"}.`;
      return skipped > 0 ? `${what} ${skipped} already on file, so ${skipped === 1 ? "it was" : "they were"} skipped.` : what;
    });
  }

  async function removeUniforms(needIds: string[]) {
    return act(async () => {
      let removed = 0;
      for (let start = 0; start < needIds.length; start += BULK_LIMIT) {
        removed += (await post(`${uniformsBase}/remove`, { needIds: needIds.slice(start, start + BULK_LIMIT) })).removed ?? 0;
      }
      return `Removed ${removed} uniform ${removed === 1 ? "need" : "needs"}.`;
    });
  }

  async function uniformsAlreadyHaveOne(needIds: string[]) {
    return act(async () => {
      let marked = 0;
      for (let start = 0; start < needIds.length; start += BULK_LIMIT) {
        marked += (await post(`${base}/already-awarded`, { needIds: needIds.slice(start, start + BULK_LIMIT) })).marked ?? 0;
      }
      return `Marked ${marked} as already issued. Stock wasn't changed.`;
    });
  }

  function toggleIn(setter: typeof setSelected, ids: string[], on: boolean) {
    setter((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const unmatchedCount = data.unmatched.length;
  const unmatchedHonors = useMemo(() => groupUnmatchedByHonor(data.unmatched), [data.unmatched]);
  const earlierIds = earlier.map((need) => need.needId);
  const beforeDateIds = needsDatedBefore(earlier, beforeDate).map((need) => need.needId);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="public-registration-eyebrow">Honors, uniforms and supplies</p>
          <h2>Orders</h2>
        </div>
        <span className="count-badge">{onList.length} {onList.length === 1 ? "line" : "lines"}</span>
      </div>
      <nav aria-label="Jump to a part of this page" className={styles.jumpNav} id="club-order-sections">
        {orderSectionLinks(waitingBatches.length > 0, readOnly).map((link) => (
          <a className={styles.jumpLink} href={`#${link.id}`} key={link.id}>
            <span className={styles.jumpLabel}>{link.label}</span>
            <small className={styles.jumpHint}>{link.description}</small>
          </a>
        ))}
      </nav>

      <p className="inline-notice" id="club-order-helper-notice" role="note">
        This is a helper to build your list — it is <strong>not</strong> an official order form. You still need to order the items from{" "}
        <a href={ADVENTSOURCE_URL} rel="noopener noreferrer" target="_blank">AdventSource</a>.
      </p>
      {readOnly ? (
        <p className="inline-notice" role="status"><Eye aria-hidden="true" size={14} /> View only. Shows what&apos;s on file. The club director or deputy builds the list.</p>
      ) : (
        <p className={`field-help ${styles.helpText}`}>Completed honors, uniform needs, and earned awards that haven&apos;t been handed out appear here on their own. Change a quantity, add an item, or take one off. Stock on hand comes off what you need.</p>
      )}
      {notice && <p className="inline-notice success" role="status">{notice}</p>}
      {error && <p className="inline-notice error" role="alert">{error}</p>}

      {showPrompt && (
        <section aria-labelledby="club-order-earlier" className={`${styles.block} ${styles.prompt}`}>
          <h3 id="club-order-earlier"><History aria-hidden="true" size={14} /> Honors that may already be handed out</h3>
          <p className={styles.promptCopy}>Mark the ones already handed out so they come off the list. Nothing is marked for you, and stock isn&apos;t changed.</p>
          {/* Closed until opened: a long list of completed honors would push the real order list off the screen (#1004). */}
          <details className={styles.earlierDetails}>
            <summary>Show the {earlier.length} {earlier.length === 1 ? "honor" : "honors"}</summary>
            <div className={styles.actions}>
              <button className="secondary-button" disabled={busy} onClick={() => toggleIn(setHandedOut, earlierIds, true)} type="button">Select all ({earlierIds.length})</button>
              <span className={styles.dateSelect}>
                <label htmlFor="club-order-before-date">Completed before</label>
                <input className={styles.date} id="club-order-before-date" onChange={(event) => setBeforeDate(event.target.value)} type="date" value={beforeDate} />
                <button className="secondary-button" disabled={busy || beforeDateIds.length === 0} onClick={() => toggleIn(setHandedOut, beforeDateIds, true)} type="button">
                  Select {beforeDate ? `(${beforeDateIds.length})` : ""}
                </button>
              </span>
            </div>
            <ul className={styles.people}>
              {earlier.map((need) => (
                <li key={need.needId}>
                  <label className={styles.check}>
                    <input checked={handedOut.has(need.needId)} onChange={(event) => toggleIn(setHandedOut, [need.needId], event.target.checked)} type="checkbox" />
                    <span>
                      <span translate="no">{need.firstName} {need.lastName}</span>
                      {" · "}<span translate="no">{need.itemName ?? need.sourceLabel}</span>
                      {need.sourceDate && <small className={styles.muted}> · {formatCalendarDate(need.sourceDate)}</small>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button aria-describedby={disabledHintId(handedOutBlocked, "club-order-handed-out-hint")} className="primary-button" disabled={busy || handedOut.size === 0} onClick={markAlreadyHandedOut} type="button">
                <CheckCircle2 aria-hidden="true" size={16} /> Already handed out{handedOut.size > 0 ? ` (${handedOut.size})` : ""}
              </button>
            </div>
            <DisabledHint id="club-order-handed-out-hint" reason={handedOutBlocked} />
          </details>
          {/* Outside the closed list, so the prompt can be dismissed without opening it. */}
          <div className={styles.actions}>
            <button className="text-button" onClick={dismissPrompt} type="button">Not now</button>
          </div>
        </section>
      )}

      <section className={styles.block} id={ORDER_SECTION_IDS.list}>
        <h3>Your order list</h3>
        {unmatchedCount > 0 && (
          <div className={styles.flag} id="club-order-unmatched">
            <Info aria-hidden="true" size={14} />
            <div className={styles.unmatched}>
              <p role="status">{unmatchedCount} completed {unmatchedCount === 1 ? "honor has" : "honors have"} no matching catalog item, so {unmatchedCount === 1 ? "it isn't" : "they aren't"} on this list. Conference staff can link the honor in the supply catalog.</p>
              <details className={styles.earlierDetails}>
                <summary>{`${unmatchedHonors.length === 1 ? "Honor" : "Honors"} to order separately (${unmatchedHonors.length})`}</summary>
                <ul className={styles.unmatchedList}>
                  {unmatchedHonors.map((honor) => {
                    const canAdd = !readOnly && honor.honorId !== null && orderableHonorIds.has(honor.honorId);
                    const onTheList = honor.honorId !== null && listedHonorIds.has(honor.honorId);
                    return (
                      <li className={styles.unmatchedItem} key={honor.honorId ?? honor.name}>
                        <span><span translate="no">{honor.name}</span> · {honor.members} {honor.members === 1 ? "member" : "members"}</span>
                        {onTheList ? (
                          <span className={styles.unmatchedState} id={`club-order-on-list-${honor.honorId}`} tabIndex={-1}>On the list</span>
                        ) : canAdd && (
                          <button
                            aria-label={`Add to list: ${honor.name}, quantity ${honor.members}`}
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => void addHonorLine({ honorId: honor.honorId!, name: honor.name, members: honor.members })}
                            type="button"
                          >
                            <Plus aria-hidden="true" size={14} /> Add to list
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            </div>
          </div>
        )}
        {onList.length === 0 ? (
          <p className="quiet-copy">Nothing on the list. New completed honors appear here on their own; record uniform needs below, add earned awards on the Class tracking page, or add an item yourself.</p>
        ) : (
          ORDER_LIST_SECTIONS.map((section) => {
            const lines = onList.filter((line) => line.section === section);
            if (lines.length === 0) return null;
            return (
              <div className={styles.group} key={section}>
                <div className={styles.groupHead}><strong>{orderListSectionLabels[section]}</strong></div>
                <ul className={styles.list}>
                  {lines.map((line) => {
                    const key = lineKey(line);
                    const inputId = `club-order-quantity-${key.replace(":", "-")}`;
                    const draft = drafts[key];
                    return (
                      <li className={styles.row} key={key}>
                        <span className={styles.text}>
                          <strong translate="no">{line.name}</strong>
                          <small>
                            {line.size && <>{formatSizeLabel(line.size)} · </>}
                            {line.honorId ? NO_CATALOG_ITEM_LABEL : line.catalogNumber ? <>Item no. <code>{line.catalogNumber}</code></> : (
                              <span className={styles.flagInline}><AlertTriangle aria-hidden="true" size={12} /> No item number</span>
                            )}
                            {line.itemId && line.edited && line.needed !== line.computedNeeded && <> · Suggested from honors and uniform needs: {line.computedNeeded}</>}
                          </small>
                        </span>
                        <dl className={styles.numbers}>
                          <div>
                            <dt>Quantity</dt>
                            <dd>
                              {readOnly ? line.needed : (
                                <>
                                  <label className="sr-only" htmlFor={inputId}>Quantity: {line.name}{line.size ? `, ${line.size}` : ""}</label>
                                  <input
                                    className={styles.number}
                                    id={inputId}
                                    inputMode="numeric"
                                    min={0}
                                    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                                    type="number"
                                    value={draft ?? String(line.needed)}
                                  />
                                </>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Available</dt>
                            <dd>{hasStockTracking(line) ? line.onHand : <><span aria-hidden="true">—</span><span className="sr-only">Not tracked</span></>}</dd>
                          </div>
                          <div><dt>To order</dt><dd><strong>{line.toOrder}</strong></dd></div>
                        </dl>
                        {!readOnly && (
                          <span className={styles.actions}>
                            <button
                              aria-label={`Save quantity: ${line.name}${line.size ? `, ${line.size}` : ""}`}
                              className="secondary-button"
                              disabled={busy || draft === undefined || draft === String(line.needed)}
                              onClick={() => void saveDraft(line)}
                              type="button"
                            >
                              <Save aria-hidden="true" size={14} /> Save
                            </button>
                            {line.edited && line.computedNeeded > 0 && (
                              <button
                                aria-label={`Reset to ${line.computedNeeded}: ${line.name}${line.size ? `, ${line.size}` : ""}`}
                                className="text-button"
                                disabled={busy}
                                onClick={() => void setQuantity(key, null, "Quantity reset.")}
                                type="button"
                              >
                                <RotateCcw aria-hidden="true" size={14} /> Reset
                              </button>
                            )}
                            <button
                              aria-label={`Remove from the list: ${line.name}${line.size ? `, ${line.size}` : ""}`}
                              className="text-button"
                              disabled={busy}
                              onClick={() => void removeLine(line)}
                              type="button"
                            >
                              <Trash2 aria-hidden="true" size={14} /> Remove
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
        {onList.length > 0 && (
          <p className={`field-help ${styles.helpText}`}>To order is the quantity less what is available, never below zero. Available = in stock minus items set aside for someone. {totalToOrder} to order in all.</p>
        )}

        {takenOff.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupHead}><strong>Taken off the list</strong></div>
            <ul className={styles.people}>
              {takenOff.map((line) => (
                <li className={styles.rowStatic} key={lineKey(line)}>
                  <span translate="no">{line.name}{line.size ? ` (${line.size})` : ""}</span>
                  {!readOnly && (
                    <button className="text-button" disabled={busy} onClick={() => void setQuantity(lineKey(line), null, "Put back on the list.")} type="button">Put back</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!readOnly && (
          <div className={styles.group}>
            <div className={styles.groupHead}><strong>Add an item</strong></div>
            <div className={styles.pickerRow}>
              <label className={styles.pickerField} htmlFor="club-order-picker-search">
                Search honors and items
                <input className={styles.select} aria-describedby="club-order-picker-results" id="club-order-picker-search" {...pickerSearch.inputProps} placeholder="Honor or item name, or item number" type="search" />
              </label>
              <label className={styles.pickerField} htmlFor="club-order-picker-item">
                Item
                <select className={styles.select} id="club-order-picker-item" onChange={(event) => setPickerItem(event.target.value)} value={chosenItem}>
                  <option value="">Choose an item</option>
                  {shownPickerItems.map((row) => (
                    <option key={row.itemId} value={row.itemId}>{row.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.pickerField} htmlFor="club-order-picker-quantity">
                Quantity
                <input className={styles.select} id="club-order-picker-quantity" inputMode="numeric" min={1} onChange={(event) => setPickerQuantity(event.target.value)} type="number" value={pickerQuantity} />
              </label>
              <button className="secondary-button" disabled={busy || !chosenItem} onClick={() => void addLine()} type="button">
                <Plus aria-hidden="true" size={14} /> Add to list
              </button>
            </div>
            <ListPager label="Honor and item pages" onPage={(page) => { setPickerPage(page); setPickerItem(""); }} slice={pickerSlice} />
            <p aria-live="polite" className="field-help" id="club-order-picker-results" role="status">{pickerSummary}</p>
            <p className={`field-help ${styles.helpText}`}>Honors with no catalog item can be added too; they are marked as ordered from AdventSource separately and have no item number. If an honor is missing, conference staff can link it in the supply catalog.</p>
          </div>
        )}

        <div className={styles.actions}>
          {onList.length > 0 ? (
            <a className="primary-button" href={`${base}/csv?view=list`}><Download aria-hidden="true" size={14} /> Export list (CSV)</a>
          ) : (
            <button aria-describedby="club-order-nothing" className="primary-button" disabled type="button"><Download aria-hidden="true" size={14} /> Export list (CSV)</button>
          )}
          {onList.length > 0 && (
            <a className="secondary-button" href={`${base}/csv?view=all`}><Download aria-hidden="true" size={14} /> Export everything (CSV)</a>
          )}
          {printHref && onList.length > 0 && (
            <a className="secondary-button" href={printHref}><Printer aria-hidden="true" size={14} /> Printable list</a>
          )}
          {onList.length > 0 || data.awardable.length > 0 ? (
            <a className="secondary-button" href={`${base}/csv?view=picklist`}><Download aria-hidden="true" size={14} /> Pick list (who gets what)</a>
          ) : null}
        </div>
        {onList.length > 0 && (
          <p className={`field-help ${styles.helpText}`}>Export list has the club details and a calculated column. Export everything is one plain table: honors, uniforms and other items together, one row per item.</p>
        )}
        {onList.length === 0 && <p className={`field-help ${styles.helpText}`} id="club-order-nothing">Nothing on the list to export yet.</p>}
      </section>

      <section className={styles.block} id={ORDER_SECTION_IDS.supplies}>
        <ClubSupplyStockWorkspace
          embedded
          initialStock={stock}
          onSaved={() => void refresh().catch(() => undefined)}
          organizationId={organizationId}
          readOnly={readOnly}
        />
      </section>

      {waitingBatches.length > 0 && (
        <section className={styles.block} id={ORDER_SECTION_IDS.waiting}>
          <h3>Orders waiting to arrive</h3>
          <p className={`field-help ${styles.helpText}`}>Earlier orders, from before this helper list. Mark one received when it arrives and its items join your stock. New orders can&apos;t be placed here.</p>
          <ul className={styles.list}>
            {waitingBatches.map((batch) => (
              <li className={styles.row} key={batch.id}>
                <span className={styles.text}>
                  <strong>{formatDate(batch.createdAt)}</strong>
                  <small>{batch.itemCount} {batch.itemCount === 1 ? "item" : "items"} · {batch.totalQuantity} ordered</small>
                </span>
                {!readOnly && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void act(async () => { await post(`${base}/${encodeURIComponent(batch.id)}/receive`, {}); return "Order marked received."; })}
                    type="button"
                  >
                    <PackageCheck aria-hidden="true" size={14} /> Mark received
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.block} id={ORDER_SECTION_IDS.ready}>
        <h3>Ready to hand out</h3>
        {awardGroups.length === 0 ? (
          <p className="quiet-copy">Nothing in stock covers a need yet.</p>
        ) : (
          <>
            {awardGroups.map(([itemId, group]) => {
              const ids = group.needs.map((need) => need.needId);
              const allOn = ids.every((id) => selected.has(id));
              return (
                <div className={styles.group} key={itemId}>
                  <div className={styles.groupHead}>
                    <strong translate="no">{group.itemName}</strong>
                    {!readOnly && (
                      <button className="text-button" onClick={() => toggleIn(setSelected, ids, !allOn)} type="button">{allOn ? "Clear all" : "Select all"}</button>
                    )}
                  </div>
                  <ul className={styles.people}>
                    {group.needs.map((need) => {
                      const name = <span translate="no">{need.firstName} {need.lastName}</span>;
                      const note = need.fromStock ? <small className={styles.muted}> · from stock</small> : null;
                      return (
                        <li key={need.needId}>
                          {readOnly ? (
                            <span>{name}{note}</span>
                          ) : (
                            <label className={styles.check}>
                              <input checked={selected.has(need.needId)} onChange={(event) => toggleIn(setSelected, [need.needId], event.target.checked)} type="checkbox" />
                              <span>{name}{note}</span>
                            </label>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {!readOnly && (
              <div className={styles.actions}>
                <button className="primary-button" disabled={busy || selected.size === 0} onClick={markAwarded} type="button">
                  <CheckCircle2 aria-hidden="true" size={16} /> Mark handed out{selected.size > 0 ? ` (${selected.size})` : ""}
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <ClubUniformSection
        busy={busy}
        data={uniforms}
        onAlreadyHasOne={uniformsAlreadyHaveOne}
        onRecord={recordUniforms}
        onRemove={removeUniforms}
        readOnly={readOnly}
      />
    </section>
  );
}

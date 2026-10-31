"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { withCurrentEvent } from "@/components/staff-navigation";
import {
  filterGuides,
  filterGuidesByWorkspace,
  workspaceFilterLabels,
  workspaceFilterOptions,
  type WorkspaceFilter,
} from "@/modules/help/visibility";
import styles from "./help.module.css";

/** What the hub needs about one guide the server already decided this viewer may see. */
export type HubGuide = { id: string; title: string; summary: string; workspace: "System" | "Event"; keywords: readonly string[] };

const groups: readonly { workspace: HubGuide["workspace"]; title: string }[] = [
  { workspace: "System", title: "System administration" },
  { workspace: "Event", title: "Event workspace" },
];

/** The hub's guide list with a plain filter over title, summary and keywords. Nothing is sent as you type. */
export function HelpSearch({ guides, selectedEventId }: { guides: readonly HubGuide[]; selectedEventId: string }) {
  const inputId = useId();
  const countId = useId();
  const filterName = useId();
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const options = useMemo(() => workspaceFilterOptions(guides), [guides]);
  const shown = useMemo(() => filterGuidesByWorkspace(filterGuides(guides, query), workspace), [guides, query, workspace]);
  const filtered = Boolean(query.trim()) || workspace !== "all";
  const count = `${shown.length} ${shown.length === 1 ? "guide" : "guides"}${filtered ? " match" : " available"}.`;
  const clear = () => {
    setQuery("");
    setWorkspace("all");
  };

  return (
    <div className={styles.page}>
      <div className={styles.searchField}>
        <label className={styles.searchLabel} htmlFor={inputId}>Search the guides</label>
        <input
          aria-describedby={countId}
          autoComplete="off"
          className={styles.searchInput}
          id={inputId}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="For example: invite, email, import"
          type="search"
          value={query}
        />
        <p className={styles.count} id={countId} role="status">{count}</p>
      </div>
      <fieldset className={styles.filterSet}>
        <legend className={styles.searchLabel}>Show guides for</legend>
        <div className={styles.filterOptions}>
          {options.map((option) => (
            <label className={styles.filterOption} key={option}>
              <input
                checked={workspace === option}
                className={styles.filterRadio}
                name={filterName}
                onChange={() => setWorkspace(option)}
                type="radio"
                value={option}
              />
              <span>{workspaceFilterLabels[option]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {shown.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            {workspace !== "all" && query.trim()
              ? `No ${workspaceFilterLabels[workspace]} guide matches that search. Try a shorter or different word, or show all guides.`
              : workspace !== "all"
                ? `There is no ${workspaceFilterLabels[workspace]} guide to show.`
                : "No guide matches. Try a shorter or different word, or read the glossary."}
          </p>
          {filtered && <button className="secondary-button" onClick={clear} type="button">Show all guides</button>}
        </div>
      ) : groups.map((group) => {
        const inGroup = shown.filter((guide) => guide.workspace === group.workspace);
        if (inGroup.length === 0) return null;
        return (
          <section aria-label={group.title} className={styles.group} key={group.workspace}>
            <h2 className={styles.groupTitle}>{group.title}</h2>
            <ul className={styles.list}>
              {inGroup.map((guide) => (
                <li className={styles.card} key={guide.id}>
                  <Link className={styles.cardLink} href={withCurrentEvent(`/help/${guide.id}`, selectedEventId)}>
                    <span className={styles.cardTitle}>{guide.title}</span>
                    <span className={styles.cardSummary}>{guide.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

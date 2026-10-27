"use client";

import { useState } from "react";
import { Save, Sparkles } from "lucide-react";
import {
  homepageMinistryDescriptionMax,
  homepageMinistryIcons,
  type HomepageMinistry,
} from "@/modules/system-admin/homepage-ministries-domain";

type TileDraft = Omit<HomepageMinistry, "description" | "linkHref" | "categories"> & { description: string; linkHref: string; categories: string };

const toDraft = (tile: HomepageMinistry): TileDraft => ({
  position: tile.position,
  name: tile.name,
  description: tile.description ?? "",
  linkHref: tile.linkHref ?? "",
  categories: tile.categories.join(", "),
  icon: tile.icon,
});

const toPayload = (tile: TileDraft) => ({
  position: tile.position,
  name: tile.name,
  description: tile.description,
  linkHref: tile.linkHref,
  categories: tile.categories.split(",").map((category) => category.trim()).filter(Boolean),
  icon: tile.icon,
});

/** The "Homepage ministries" section of Platform settings (#1251): six fixed tiles, saved on their own with an audit row. */
export function HomepageMinistriesEditor({
  initial,
  updatedAt,
  updatedByName,
}: {
  initial: HomepageMinistry[];
  updatedAt: string | null;
  updatedByName: string | null;
}) {
  const [saved, setSaved] = useState(() => initial.map(toDraft));
  const [tiles, setTiles] = useState(saved);
  const [meta, setMeta] = useState({ updatedAt, updatedByName });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(tiles) !== JSON.stringify(saved);

  function change(position: number, patch: Partial<TileDraft>) {
    setTiles((current) => current.map((tile) => (tile.position === position ? { ...tile, ...patch } : tile)));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/platform-settings/homepage-ministries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ministries: tiles.map(toPayload) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.ministries)) throw new Error(result.message ?? "The homepage ministries could not be saved.");
      const next = (result.ministries as HomepageMinistry[]).map(toDraft);
      setSaved(next);
      setTiles(next);
      setMeta({ updatedAt: result.updatedAt ?? null, updatedByName: result.updatedByName ?? null });
      setNotice("Homepage ministries saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The homepage ministries could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-labelledby="homepage-ministries-heading" className="form-stack" onSubmit={save}>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><Sparkles aria-hidden="true" size={14} /> Public homepage</p>
            <h2 id="homepage-ministries-heading">Homepage ministries</h2>
          </div>
        </div>
        <p className="field-help platform-note">
          The six &ldquo;Find your place&rdquo; tiles on the front page. Each shows its next upcoming calendar item from the categories you list
          (separate them with commas, as they are spelled on the calendar). Leave the link blank to open the calendar filtered to the first
          category. A link starts with / for a page on this site, or https:// for another site. Changes are recorded in the audit log.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="inline-notice" role="status">{notice}</p>}
        {tiles.map((tile) => (
          <fieldset className="ministry-tile-fields" key={tile.position}>
            <legend>Tile {tile.position}</legend>
            <label>Name<input maxLength={60} required value={tile.name} onChange={(event) => change(tile.position, { name: event.target.value })} /></label>
            <label>
              Description
              <input maxLength={homepageMinistryDescriptionMax} value={tile.description} onChange={(event) => change(tile.position, { description: event.target.value })} />
              <small>Plain text, up to {homepageMinistryDescriptionMax} characters. Leave blank to show the name and upcoming event only.</small>
            </label>
            <label>
              Calendar categories
              <input autoComplete="off" value={tile.categories} onChange={(event) => change(tile.position, { categories: event.target.value })} />
            </label>
            <label>
              Link
              <input autoComplete="off" maxLength={500} placeholder="/calendar?view=list" value={tile.linkHref} onChange={(event) => change(tile.position, { linkHref: event.target.value })} />
            </label>
            <label>
              Icon
              <select value={tile.icon} onChange={(event) => change(tile.position, { icon: event.target.value as TileDraft["icon"] })}>
                {homepageMinistryIcons.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
              </select>
            </label>
          </fieldset>
        ))}
        <div className="form-actions">
          {dirty && <span className="unsaved-dot" role="status">Unsaved changes</span>}
          <button className="primary-button" disabled={saving || !dirty} type="submit">
            <Save aria-hidden="true" size={16} /> {saving ? "Saving…" : "Save homepage ministries"}
          </button>
        </div>
        {meta.updatedAt && (
          <p className="field-help platform-note">
            Last changed {new Date(meta.updatedAt).toLocaleString()}{meta.updatedByName ? ` by ${meta.updatedByName}` : ""}.
          </p>
        )}
      </section>
    </form>
  );
}

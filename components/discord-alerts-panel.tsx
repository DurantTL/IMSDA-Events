"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import { submitJson } from "@/lib/submit-json";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { DISCORD_GROUPS, DISCORD_GROUP_LABELS, type DiscordGroup } from "@/modules/operations/discord-alerts-domain";
import type { DiscordAlertSettingsView } from "@/modules/operations/discord-alert-settings";
import styles from "./discord-alerts-panel.module.css";

const ENDPOINT = "/api/admin/platform-settings/discord-alerts";
const when = (iso: string) => formatInConferenceTime(iso, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The Discord channel for system alerts (#2048) on Platform settings. Only a system administrator reaches this page
 * and every route checks again. The address goes to the server once and never comes back: the page only ever holds
 * "connected", the last 4 characters, who set it and when.
 */
export function DiscordAlertsPanel({ initial }: { initial: DiscordAlertSettingsView }) {
  const [settings, setSettings] = useState(initial);
  const [editing, setEditing] = useState(!initial.connected);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { confirm, confirmDialog } = useConfirm();

  async function call(path: string, body: unknown, method: "PUT" | "PATCH" | "DELETE" | "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await submitJson(path, body, { method, init: { cache: "no-store" } });
      const data = response.body as { settings?: DiscordAlertSettingsView; result?: { state: string; message: string }; message?: string } | null;
      if (!response.ok || !data?.settings) {
        setError(data?.message ?? "That could not be saved. Try again.");
        return null;
      }
      setSettings(data.settings);
      return data;
    } catch {
      setError("That could not be saved. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveAddress(event: React.FormEvent) {
    event.preventDefault();
    const data = await call(ENDPOINT, { address }, "PUT");
    if (!data) return;
    setAddress("");
    setEditing(false);
    setNotice("Saved. Use Send a test message to check it.");
  }

  async function remove() {
    const ok = await confirm({
      title: "Remove the Discord channel",
      confirmLabel: "Remove the address",
      destructive: true,
      body: <p>Alerts stop going to Discord. They are still written to the app logs, and the email webhook (if one is set) is not affected.</p>,
    });
    if (!ok) return;
    const data = await call(ENDPOINT, undefined, "DELETE");
    if (data) {
      setEditing(true);
      setNotice("Removed. Alerts no longer go to Discord.");
    }
  }

  async function toggle(group: DiscordGroup, on: boolean) {
    const data = await call(ENDPOINT, { groups: { ...settings.groups, [group]: on } }, "PATCH");
    if (data) setNotice(`${DISCORD_GROUP_LABELS[group].label} is ${on ? "on" : "off"}.`);
  }

  async function sendTest() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await submitJson(`${ENDPOINT}/test`, {}, { method: "POST", init: { cache: "no-store" } });
      const data = response.body as { settings?: DiscordAlertSettingsView; result?: { state: string; message: string }; message?: string } | null;
      if (!response.ok || !data?.result) {
        setError(data?.message ?? "The test message could not be sent.");
        return;
      }
      if (data.settings) setSettings(data.settings);
      if (data.result.state === "delivered") setNotice(data.result.message);
      else setError(data.result.message);
    } catch {
      setError("The test message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="discord-alerts-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow"><BellRing aria-hidden="true" size={14} /> System alerts</p>
          <h2 id="discord-alerts-heading">Alerts to Discord</h2>
        </div>
      </div>
      <p className={`field-help ${styles.help}`}>
        Sends site trouble, deploys, backups and practice runs to one Discord channel. Messages carry fixed words, counts and version ids only, never anyone&apos;s name or details.
      </p>

      <p className={styles.status}>
        <span className={`${styles.badge} ${settings.connected ? styles.badgeOn : ""}`}>{settings.connected ? "Connected" : "Not connected"}</span>
        {settings.connected && settings.last4 && <span>Address ends in <strong>{settings.last4}</strong></span>}
        {settings.connected && settings.setAt && (
          <span>Set {when(settings.setAt)}{settings.setByName ? ` by ${settings.setByName}` : ""}</span>
        )}
      </p>

      {editing ? (
        <form onSubmit={saveAddress}>
          <label className={styles.field}>
            Discord webhook address
            <input
              autoComplete="off"
              disabled={busy}
              name="discord-webhook-address"
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              required
              spellCheck={false}
              type="password"
              value={address}
            />
            <small className={`field-help ${styles.help}`}>In Discord: channel settings, Integrations, Webhooks, New webhook, Copy Webhook URL. It is stored encrypted and is never shown again.</small>
          </label>
          <div className={styles.actions}>
            <button className="primary-button" disabled={busy || !address.trim()} type="submit">Save address</button>
            {settings.connected && <button className="secondary-button" disabled={busy} onClick={() => { setEditing(false); setAddress(""); setError(""); }} type="button">Cancel</button>}
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <button className="secondary-button" disabled={busy} onClick={() => setEditing(true)} type="button">Replace</button>
          <button className="secondary-button" disabled={busy} onClick={() => void remove()} type="button">Remove</button>
        </div>
      )}

      {settings.connected && (
        <>
          <fieldset className={styles.groups} disabled={busy}>
            <legend>What to send</legend>
            {DISCORD_GROUPS.map((group) => (
              <label className={styles.check} key={group}>
                <input checked={settings.groups[group]} onChange={(event) => void toggle(group, event.target.checked)} type="checkbox" />
                <span>
                  <strong>{DISCORD_GROUP_LABELS[group].label}</strong>
                  <small className="field-help">{DISCORD_GROUP_LABELS[group].help}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className={styles.actions}>
            <button className="secondary-button" disabled={busy} onClick={() => void sendTest()} type="button">Send a test message</button>
          </div>
          <ul className={styles.delivery}>
            <li>Last delivered: {settings.lastDeliveredAt ? when(settings.lastDeliveredAt) : "never"}</li>
            <li>Last failed: {settings.lastFailedAt ? when(settings.lastFailedAt) : "never"}</li>
          </ul>
        </>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {confirmDialog}
    </section>
  );
}

import styles from "@/components/email-header-preview.module.css";

/** What the preview shows for a name that is blank, so the bar never looks empty while someone types. */
const BLANK_NAME = "IMSDA Events";

function shown(name: string) {
  return name.replace(/\s+/g, " ").trim() || BLANK_NAME;
}

function HeaderBar({ label, name }: { label: string; name: string }) {
  return (
    <figure className={styles.sample}>
      <figcaption className={styles.caption}>{label}</figcaption>
      <div className={styles.bar}>
        <span aria-hidden="true" className={styles.mark}>i</span>
        <span className={styles.words}>
          <span className={styles.name}>{shown(name)}</span>
          <span className={styles.subline}>Iowa-Missouri Conference</span>
        </span>
      </div>
    </figure>
  );
}

/**
 * The email header as it will look, redrawn on every keystroke from the two name fields (#1443). Client-side only:
 * nothing is saved or sent. The names are React text, so they are escaped like any other value.
 */
export function EmailHeaderPreview({ eventName, clubName }: { eventName: string; clubName: string }) {
  return (
    <div aria-label="Email header preview" className={styles.preview} role="group">
      <HeaderBar label="Event and general emails" name={eventName} />
      <HeaderBar label="Club emails" name={clubName} />
    </div>
  );
}

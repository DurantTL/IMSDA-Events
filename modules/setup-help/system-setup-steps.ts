import type { SetupHelp } from "./types";

/**
 * Every "How to set this up" text the System report shows (#1434). This file is the ONE place the steps live; the
 * `docs/*.md` runbooks point here instead of repeating them. Names only: no value, key or sample key appears, and the
 * guard test (`tests/system-report-setup-help-1434.test.ts`) fails if one does.
 *
 * Secrets stay in the xCloud site's environment (Caleb's decision, Nov 1 2026): these are instructions, never a form.
 * To add one, add the id to `SystemSetupId`, give it an entry, and point the row at it with `setup` in the provider.
 */
export type SystemSetupId =
  | "r2-backup-read"
  | "turnstile"
  | "cloudflare-purge"
  | "heartbeat-token"
  | "alert-webhook"
  | "square-payments"
  | "square-webhook"
  | "apple-pay"
  | "email-provider"
  | "email-reports"
  | "email-sender"
  | "account-email"
  | "google-sign-in"
  | "encryption-key"
  | "outbox-sweep"
  | "breach-service"
  | "email-backup";

const ADD_IN_XCLOUD = "In xCloud, open this site's environment settings (the environment panel) and add";
const REDEPLOY = "Save, then redeploy the site in xCloud so the app picks up the new settings. A plain restart of the old container does not re-read them.";
const NEVER_SHARE = "Never paste the secret into chat, GitHub or a ticket.";

export const SYSTEM_SETUP_STEPS: Record<SystemSetupId, SetupHelp> = {
  "r2-backup-read": {
    steps: [
      "In the Cloudflare dashboard, open R2 Object Storage and copy the Account ID shown on the overview page.",
      "Click Manage API tokens (it may be labelled API or Manage R2 API Tokens), then Create API token.",
      "Name it, for example imsda-events-backup-read. For permissions choose Object Read only. Do not choose anything with Write.",
      "Under Specify bucket(s) choose Apply to specific buckets only and pick only the backup bucket. Set the token to last Forever, or note the end date so you can replace it first.",
      "Click Create API token. Copy the Access Key ID and the Secret Access Key now, because Cloudflare shows the secret only once. " + NEVER_SHARE,
      `${ADD_IN_XCLOUD} the four settings listed below. The optional BACKUP_R2_READ_PREFIX (the folder in the bucket) helps if the bucket holds more than about 10,000 files.`,
      REDEPLOY,
    ],
    settingNames: [
      "BACKUP_R2_READ_ACCOUNT_ID",
      "BACKUP_R2_READ_ACCESS_KEY_ID",
      "BACKUP_R2_READ_SECRET_ACCESS_KEY",
      "BACKUP_R2_READ_BUCKET",
      "BACKUP_R2_READ_PREFIX (optional)",
    ],
    docsLink: "docs/BACKUPS.md",
    whenDone: "Newest database backup shows its date and size with OK. The answer is kept for 10 minutes, so wait a moment after redeploying.",
  },
  turnstile: {
    steps: [
      "In the Cloudflare dashboard, open Turnstile and click Add widget.",
      "Name it IMSDA Events. For the hostname enter the site's address without https:// (the host of APP_BASE_URL). Add another hostname only if the app is also served from one.",
      "Set the widget mode to Managed and leave pre-clearance off. Create it.",
      "Copy the Site key and the Secret key. " + NEVER_SHARE,
      `${ADD_IN_XCLOUD} the first two settings listed below. Add TURNSTILE_ALLOWED_HOSTNAMES only if the app is served from more than one host (comma-separated).`,
      "Restart the app in xCloud. No rebuild is needed, the keys are read at run time.",
      "Open a sign-in page and a registration form, confirm the Security check box shows, and that a submit works.",
    ],
    settingNames: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_ALLOWED_HOSTNAMES (only if more than one host)"],
    docsLink: "docs/TURNSTILE.md",
    whenDone: "Security check reads OK, Configured. Both keys must be set, because with only one the check stays off.",
  },
  "cloudflare-purge": {
    steps: [
      "In the xCloud site's settings, open Automatic Cache Purge (the hosting panel's cache purge) and copy the private webhook URL it shows. It is a secret: anyone who has it can clear the cache. " + NEVER_SHARE,
      `${ADD_IN_XCLOUD} the setting listed below. The value must be an https:// address.`,
      REDEPLOY,
    ],
    settingNames: ["CLOUDFLARE_PURGE_WEBHOOK_URL"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "The Clear Cloudflare cache button appears here and the Not set up note goes away.",
  },
  "heartbeat-token": {
    steps: [
      "Make a long random token (at least 32 characters) on the server, for example by running openssl rand -base64 48. Do not show it anywhere else.",
      `${ADD_IN_XCLOUD} the app setting HOST_JOB_HEARTBEAT_TOKEN, then redeploy the site.`,
      "On the server, as root, make the file /etc/default/imsda-heartbeat (install -m 600 /dev/null /etc/default/imsda-heartbeat) and open it in an editor, not with echo, so the token stays out of shell history.",
      "Add one line that sets IMSDA_HEARTBEAT_TOKEN to the same token, and save.",
      "Re-install the server scripts from the repository's deploy/xcloud folder, including imsda-heartbeat, as the deploy guide's install lines show.",
      "The jobs report on their next run (auto-deploy within a few minutes, the others on their own timers).",
    ],
    settingNames: ["HOST_JOB_HEARTBEAT_TOKEN", "IMSDA_HEARTBEAT_TOKEN"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Auto-deploy, Docker cleanup and Runtime guard stop saying Not reporting yet and show their last run. Nothing breaks without this.",
  },
  "alert-webhook": {
    steps: [
      "In Slack or Teams, add an Incoming Webhook to the channel that should get alerts, and copy its URL. Anything that accepts a JSON POST also works. The URL is a secret. " + NEVER_SHARE,
      `${ADD_IN_XCLOUD} the setting listed below.`,
      REDEPLOY,
    ],
    settingNames: ["ALERT_WEBHOOK_URL"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Alert delivery reads Never at first (no alert has needed sending yet) and turns OK after the first alert reaches the webhook.",
  },
  "square-payments": {
    steps: [
      "Sign in to the Square Developer Dashboard and open the application for the site.",
      "On the Credentials page, copy the Application ID and the Access token. Make sure the Sandbox or Production switch matches the SQUARE_ENVIRONMENT you will use. " + NEVER_SHARE,
      "On the Locations page, copy the Location ID of the location that should take payments.",
      `${ADD_IN_XCLOUD} the three credential settings listed below, and set SQUARE_ENVIRONMENT to sandbox. Production also needs SQUARE_ENABLE_PRODUCTION set to true, which a person decides on purpose.`,
      REDEPLOY,
    ],
    settingNames: ["SQUARE_APPLICATION_ID", "SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID", "SQUARE_ENVIRONMENT", "SQUARE_ENABLE_PRODUCTION (production only)"],
    docsLink: "README.md",
    whenDone: "Square payments reads set up here, Square reachable can be tested with Test connections, and card payment shows on registration pages.",
  },
  "square-webhook": {
    steps: [
      "In the Square Developer Dashboard, open the application, then Webhooks, then Subscriptions, and add an endpoint (switch to the matching Sandbox or Production view first).",
      "For the notification URL use the site's address followed by /api/webhooks/square. It must match the app's own address exactly.",
      "Subscribe to these events: payment.created, payment.updated, refund.created and refund.updated.",
      "Copy the endpoint's Signature key. " + NEVER_SHARE,
      `${ADD_IN_XCLOUD} the signature key setting listed below. SQUARE_WEBHOOK_NOTIFICATION_URL is only needed if it differs from the address built from APP_BASE_URL.`,
      REDEPLOY,
    ],
    settingNames: ["SQUARE_WEBHOOK_SIGNATURE_KEY (or SQUARE_WEBHOOK_SECRET)", "SQUARE_WEBHOOK_NOTIFICATION_URL (only if different)"],
    docsLink: "README.md",
    whenDone: "Square payment confirmations reads set up, and Square notices shows the time of the last notice after a payment.",
  },
  "apple-pay": {
    steps: [
      "First finish the Square payments setup, because this test only runs once Square payments is set up.",
      "In the Square Developer Dashboard, open Apple Pay (Digital wallets) and add the site's domain, once in the Sandbox view and once in the Production view. The app serves Square's domain file itself, so there is nothing to upload.",
      "Back here, press Test connections.",
    ],
    settingNames: ["SQUARE_APPLICATION_ID", "SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID"],
    docsLink: "README.md",
    whenDone: "Apple Pay domain file shows OK with a time after Test connections. Apple Pay then appears at checkout on supported devices.",
  },
  "email-provider": {
    steps: [
      "Resend: in the Resend dashboard, add and verify the sending domain, then create an API key and copy it. " + NEVER_SHARE,
      `Resend: ${ADD_IN_XCLOUD} RESEND_API_KEY.`,
      "Amazon SES instead: in the SES console (US East, Ohio), open SMTP settings, then Create SMTP credentials, and copy the SMTP username and SMTP password now, because AWS shows the password once. These are not the IAM access key. Make sure the sending domain shows Verified under Verified identities.",
      `Amazon SES: ${ADD_IN_XCLOUD} EMAIL_PROVIDER set to ses, plus SES_REGION, SES_SMTP_USERNAME and SES_SMTP_PASSWORD.`,
      REDEPLOY,
      "Use an event's send test message with real delivery to an address you can read, and confirm it arrives.",
    ],
    settingNames: ["RESEND_API_KEY", "EMAIL_PROVIDER (ses only)", "SES_REGION", "SES_SMTP_USERNAME", "SES_SMTP_PASSWORD"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Email provider reads Yes and Email service reachable can be tested with Test connections. Until then event email is only captured locally and nothing is sent.",
  },
  "email-reports": {
    steps: [
      "Resend: in the Resend dashboard, open Webhooks, add an endpoint with the site's address followed by /api/webhooks/resend, include the delivery, bounce and complaint events, and copy its signing secret. " + NEVER_SHARE,
      `Resend: ${ADD_IN_XCLOUD} RESEND_WEBHOOK_SECRET.`,
      "Amazon SES: in the AWS console open Amazon SNS, create a Standard topic, and note its ARN and the 12-digit AWS account id inside it. In SES, make a configuration set whose event destination sends Delivery, Bounces and Complaints to that topic, then in SNS subscribe the HTTPS endpoint made from the site's address followed by /api/webhooks/ses (raw message delivery off).",
      `Amazon SES: ${ADD_IN_XCLOUD} SES_SNS_TOPIC_ARN, SES_AWS_ACCOUNT_ID and SES_CONFIGURATION_SET.`,
      REDEPLOY,
    ],
    settingNames: ["RESEND_WEBHOOK_SECRET", "SES_SNS_TOPIC_ARN", "SES_AWS_ACCOUNT_ID", "SES_CONFIGURATION_SET"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Email bounce and complaint reports reads set up, and the Resend or SES notices row shows the time of the last notice.",
  },
  "email-sender": { href: "/admin/email", label: "Set up the sender address" },
  "account-email": {
    steps: [
      "Choose the address account email (activation and password-reset links) is sent from, on a domain verified with your email provider, for example the conference's no-reply address.",
      "In the email provider (Resend, or the Amazon SES Verified identities page), check that its domain shows Verified. A rejected sender is not retried.",
      `${ADD_IN_XCLOUD} the setting listed below. ACCOUNT_EMAIL_SENDER_NAME and ACCOUNT_EMAIL_REPLY_TO are optional.`,
      REDEPLOY,
    ],
    settingNames: ["ACCOUNT_EMAIL_SENDER_ADDRESS", "ACCOUNT_EMAIL_SENDER_NAME (optional)", "ACCOUNT_EMAIL_REPLY_TO (optional)"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Account email sender reads set up under Connected services, and invited colleagues receive their activation links.",
  },
  "google-sign-in": {
    steps: [
      "In the Google Cloud console, pick or create the project, then open APIs & Services, then Credentials, and create an OAuth client ID of type Web application.",
      "Under Authorized redirect URIs add the site's address followed by /api/attendee/oauth/google/callback.",
      "Copy the Client ID and the Client secret. " + NEVER_SHARE,
      `${ADD_IN_XCLOUD} both settings listed below. Set both or leave both blank.`,
      REDEPLOY,
    ],
    settingNames: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Google sign-in reads set up, Google sign-in keys can be tested with Test connections, and attendees see the Continue with Google button.",
  },
  "encryption-key": {
    steps: [
      "Make a long random value on the server, for example by running openssl rand -base64 48, and keep a safe copy as the server security checklist says.",
      `${ADD_IN_XCLOUD} the setting listed below.`,
      REDEPLOY,
      "Never change it once people have enrolled in two-step sign-in or birth dates are stored. Changing it makes every enrolled authenticator unreadable and loses every roster birth date for good.",
    ],
    settingNames: ["SECRET_ENCRYPTION_KEY"],
    docsLink: "docs/SERVER-SECURITY-CHECKLIST.md",
    whenDone: "Encryption key reads Yes. The value is never shown.",
  },
  "outbox-sweep": {
    steps: [
      "Make a long random token (at least 32 characters) on the server, for example by running openssl rand -base64 48.",
      `${ADD_IN_XCLOUD} the setting listed below. The server's email sweeper uses the same token to call the app.`,
      REDEPLOY,
    ],
    settingNames: ["OUTBOX_SWEEP_TOKEN"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Scheduled message sweep token reads set up, and scheduled email goes out on time.",
  },
  "breach-service": {
    steps: [
      `${ADD_IN_XCLOUD} the setting listed below, set to enabled. Unset means it is on in production and off elsewhere.`,
      REDEPLOY,
      "Press Test connections here.",
    ],
    settingNames: ["PASSWORD_BREACH_CHECK"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Password breach service shows OK with a time after Test connections.",
  },
  "email-backup": {
    steps: [
      "Set up the main email service as Amazon SES first (see the email provider steps).",
      `${ADD_IN_XCLOUD} EMAIL_BACKUP_PROVIDER set to resend, and RESEND_API_KEY from the Resend dashboard. ${NEVER_SHARE}`,
      "In Resend, add a bounce and complaint webhook (the site's address followed by /api/webhooks/resend) and copy its signing secret into RESEND_WEBHOOK_SECRET.",
      "For the sending domain, add the SPF record and the three DKIM records Amazon SES shows, and the SPF and DKIM records Resend shows. Keep one SPF record that includes both services.",
      REDEPLOY,
      "Use Send through the backup (Resend) in the email tester to prove Resend delivers.",
    ],
    settingNames: ["EMAIL_PROVIDER", "EMAIL_BACKUP_PROVIDER", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "SES_REGION", "SES_SMTP_USERNAME", "SES_SMTP_PASSWORD"],
    docsLink: "docs/DEPLOY-DOCKER.md",
    whenDone: "Backup email service reads Set up, and Resend takes over if Amazon SES does not accept a message.",
  },
};

export function systemSetupFor(id: SystemSetupId): SetupHelp {
  return SYSTEM_SETUP_STEPS[id];
}

/** The `setup` for each EnvironmentStatus service id (`environment-status.ts`). A new service there needs an entry here. */
export const ENVIRONMENT_SERVICE_SETUP: Record<string, SystemSetupId> = {
  "email-provider": "email-provider",
  "email-reports": "email-reports",
  "account-email": "account-email",
  payments: "square-payments",
  "payment-webhook": "square-webhook",
  "google-sign-in": "google-sign-in",
  "encryption-key": "encryption-key",
  "outbox-sweep": "outbox-sweep",
  "alert-webhook": "alert-webhook",
};

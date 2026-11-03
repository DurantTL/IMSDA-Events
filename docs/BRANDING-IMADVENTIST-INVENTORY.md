# IMAdventist branding inventory (#1549)

The product name is **IMAdventist** and the logo is the approved symbol `public/brand/imadventist-symbol.png`.
Both are defined once in `lib/brand.ts` (`PRODUCT_NAME`, `PRODUCT_DESCRIPTOR`, `BRAND_SYMBOL_PATH`,
`BRAND_CALENDAR_LABEL`). `components/brand-link.tsx` always draws the symbol; the old capital-I mark
(`BrandMark`, `.brand-mark`, `.brand-flame`, the yellow tile and purple dot) is removed.

## Changed

| Area | Files | What changed |
| --- | --- | --- |
| Logo | `components/brand-link.tsx`, `components/brand-link.module.css`, `components/brand-mark.tsx` (deleted), `app/globals.css` | Symbol is the default everywhere (42px, readable collapsed and on mobile). Link destination `/calendar`, guarded navigation, 44px target and focus ring are unchanged. The `publicBrand` and `compact` props are gone. |
| Chrome | `components/app-shell.tsx`, `components/club-portal-masthead-view.tsx`, `components/coordinator-masthead-view.tsx`, `components/workspace-shell.tsx`, loading pages under `app/(public)/{events,register,manage}` | IMAdventist wordmark and label ("IMAdventist Club portal", "IMAdventist Club coordination"), loading fallback text, loading-page symbol. |
| Metadata | `app/layout.tsx`, `app/page.tsx` | Title default and template, `applicationName`, icons. The home page title is now `absolute` so it does not get a second "\| IMAdventist". |
| Page copy | sign-in, account, unsubscribe, authenticator help, settings, people, communications, payments and club screens in `app/` and `components/` | "IMSDA Events" product wording became "IMAdventist". |
| Email defaults | `modules/communications/email-layout.ts`, `email-layout-domain.ts`, `transactional-messages.ts`, `effective-delivery.ts`, `messaging-repository.ts`, `lib/env.ts` (`ACCOUNT_EMAIL_SENDER_NAME` default), staff-invitation, general-link, honors, lodging and club-teams fallbacks | Header and footer names, "why you got this" lines, signatures, subjects, code-defined default sender display names. The header mark is now the symbol image, served from the site's own `/calendar` address; without that address only the name shows. Signature stripping still recognises the old "IMSDA Events" closing line. |
| Other modules | `modules/*/email.ts` and `*-email.ts`, `club-imports/invites.ts`, `organizations/*`, `calendar/deadlines.ts`, `security/security-check-code-email.ts`, `health-records/link-email.ts`, payments and reporting messages | Product name in app-written text. |
| Print and PDF | `modules/reporting/club-packet-repository.ts` (`CONFERENCE_NAME` packet header), `modules/invoices/invoice-pdf.ts` and `modules/registration-pdf/render.ts` (PDF metadata), `app/(workspace)/more/reports/packets/page.tsx` | App-generated headers and metadata. Sample PDFs in `docs/samples/` were regenerated from synthetic data. |
| Tests and scripts | `tests/**`, `scripts/**` (`.ts`), email snapshots | Updated to the new strings; new `tests/brand-imadventist-1549.test.ts`. |
| Rules doc | `docs/SITE-RULES.md` (A7) | Wording now says IMAdventist symbol. |

## Retained, with reason

| Where | Value | Reason |
| --- | --- | --- |
| `modules/access/mfa-service.ts`, `modules/attendee-accounts/mfa-service.ts` | `"IMSDA Events"` authenticator issuer fallback | Authenticator issuer needs a separate explicit review. Changing it would show a different name for new enrolments only and can confuse existing authenticator entries. The normal issuer is the host name. |
| `modules/access/passkeys.ts`, `modules/attendee-accounts/passkeys.ts` | `rpName: "IMSDA Events"` | Passkey relying-party configuration needs a separate explicit review. |
| `tests/passkey-domain.test.ts` | `organizationName` sample | Matches the retained platform-settings default below. |
| `prisma/schema.prisma` defaults and `prisma/migrations/**` | `'IMSDA Events'` column defaults (`organizationName`, `defaultSenderName`, `emailHeaderName`, `emailClubHeaderName`) and the schema comment | Changing a default needs a migration. No migrations in this issue. |
| `modules/communications/email-layout.ts` | Legacy "IMSDA Events" closing line | Kept so already-stored message bodies still lose the old signature. |
| Conference references (IMSDA, Iowa-Missouri Conference, `support@imsda.org`, `imsda.org`) | n/a | These name the organization, not the product. |
| Technical identifiers | Cookie names, env var names, `APP_BASE_URL`, routes, database models, `IMSDA_*` constants, CSS class names | Not display branding. |
| Email sending addresses and domains | `ACCOUNT_EMAIL_SENDER_ADDRESS`, provider identities, domains | Need separate explicit review if ever changed. Only display names changed. |
| `modules/*/README.md` (communications, payments, organizations) | prose | Developer docs. Update when those READMEs are next edited. |
| `scripts/install-xcloud-runtime-guard.sh` | systemd unit descriptions | Operations tooling, not user-facing. |
| `docs/design-system/**`, `docs/platform-documentation/**`, `docs/ui-audit-*`, `docs/BUILD-STATUS-*` | historical or generated documents | Historical evidence and exports. A refresh of the design-system `BrandMark` page and the briefing exports is a separate task. |
| Event-specific content | event names, custom sender names, custom logos, authored templates | Authored content is never rewritten. |

## Saved settings and templates that need a separate, human-reviewed update

None of these were changed by this work. Each is a live data change.

1. **Platform settings row** (`PlatformSettings`): `organizationName`, `defaultSenderName`, `emailHeaderName` and
   `emailClubHeaderName` hold `IMSDA Events` unless an administrator changed them. New code defaults say IMAdventist, but
   an existing row keeps its saved value, so sent emails and the preview still show the old header name until an
   administrator edits Platform settings (or a reviewed data update is run). Fresh databases also get the old value
   from the schema default.
2. **Central email settings** (`defaultSenderName`) and **per-event email settings** (`senderName`): saved sender display
   names stay as they are.
3. **Stored message templates, announcements and the outbox** (`senderNameSnapshot`, saved bodies and subjects): historical
   records are not rewritten.
4. **Authenticator and passkey enrolments** already created under the old names.
5. **Provider-side names** (Square application and item names, Cloudflare Turnstile widget name, Google OAuth consent
   screen): configured outside this repository.

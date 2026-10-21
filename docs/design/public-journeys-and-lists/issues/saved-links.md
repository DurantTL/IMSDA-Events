# Event sharing: use persisted settings for public URLs and copied embed code

Tracking: [#1115](https://github.com/DurantTL/IMSDA-Events/issues/1115).

## Problem

The Event settings sharing panel is presented as live public registration, but its public event URL, displayed embed paths and `copyEmbedCode` are built from unsaved `draft.slug`; copied embed metadata also uses `draft.name`. Changing the slug before Save can produce an address that does not resolve to this event. A rejected Save leaves the same misleading sharing outputs. Source-confirmed against main `72a6cb21`; no production event or clipboard was inspected.

## Reproduction with synthetic data

1. Open a published event with saved slug `family-retreat-2027` and a published form `attendees`.
2. Change Short web address to `family-retreat-2028`, without saving.
3. Open public event page or copy the form embed. Current output uses `/events/family-retreat-2028` or `/embed/family-retreat-2028/attendees` although only the 2027 address is saved. It may be unavailable or identify a different existing event if that slug is already taken; uniqueness is not checked by typing.
4. Reject/fail the save and repeat: the draft still drives sharing. The same risk applies while a save is in progress.

## Current source and owner

- [Persisted baseline and saved response](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L145): `savedDraft` is already maintained after a successful response.
- [Embed copy](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L488) uses `draft.slug` and `draft.name`.
- [Sharing panel](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L1078) uses the draft address.

This is a bounded existing-settings correction. #448 owns the broader public-setup organization; #283/#284 own presentation/preview; #250 owns future redirects/publication lifecycle. Do not wait for those larger scopes or implement them here.

## Required behavior

- All outputs labelled public/share/copy use the last server-confirmed saved slug and compatible saved metadata. Update after a successful save, not when the input changes or a request starts. Do not use the immutable initial prop after saving a new slug.
- If a draft address differs, explain “Public links use the saved address. Save changes to update them.” A draft preview, if separately supported, must be clearly labelled and retain authorized preview semantics.
- Preserve separate Save and Publish/Unpublish actions, published-form eligibility, current origin/embed allowlist/auto-height behavior, server validation and the existing dirty-navigation guard.
- Clipboard success only follows a successful copy. Clear stale Copied feedback when the underlying saved address or relevant form changes; failed copying offers a useful recovery.
- Do not silently create aliases, redirects, publish a draft, mutate form slugs, or replace historical/private links. Existing slug changes retain current domain behavior; future redirect policy stays in #250.

## Acceptance criteria

- [ ] With an unsaved slug/name edit, Open public page, displayed embed path and clipboard embed still identify the saved event/form.
- [ ] Failed/rejected/in-progress saves cannot expose the unsaved address as the live share target.
- [ ] Successful save updates all share outputs to the server-returned values without a full reload; another edit leaves the new saved address in use.
- [ ] Cancel/discard and an invalid/duplicate slug leave the correct saved outputs intact.
- [ ] Unpublished/no-published-form states retain their existing sharing restrictions; a preview cannot grant public access.
- [ ] Verify keyboard/phone feedback and add focused interaction coverage for unsaved → failed → successful save and clipboard success/failure. Use synthetic addresses only.

Design review context: #1114. Schedule through #98; no automatic `codex-ready` or production configuration change.

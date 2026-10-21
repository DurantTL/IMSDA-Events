# Admin usability 3: settings ownership, change impact and unsaved-edit recovery

Parent: #1073. Proposed slice 3. Related: #1043 central Email, delivered #647 unsaved-navigation guard, #543 profile, #870 readiness, #1064/#1065 form templates.

## Accepted design status
**Visual direction accepted — October 20, 2026.** After reviewing the corrected four-role examples, Caleb said: “those look good actually make the issues and put as much context in them on the github for the design elements and such.” The accepted distinction is a personal attendee portal, a club director portal, a coordinator oversight portal and a full system-admin workbench. This issue records the system-admin part of that direction. The earlier shared staff-style treatment of all roles is superseded by the corrected examples. Production behavior and domain policy remain owned by their existing issues.

Follow the bounded slices and ordering in #98. Layout acceptance completes the former pending-design gate; implementation enters the normal queue and does not become `codex-ready` automatically. Preserve separately owned domain, merge/deploy and operational gates. Cross-role design index: #1109.

## Goal
Help an administrator understand where a setting is owned, who it affects, when it applies and whether an edit has been saved.

## Proposed acceptance criteria
- [ ] Use distinct Platform settings, Event settings and My profile/security destinations; system scope is independent of the remembered event.
- [ ] Group settings by recognizable tasks and show contextual help beside the control. Keep provider/technical details under an explicit advanced section.
- [ ] Show ownership and precedence from the actual source contract: central value, event override, template copy or environment-managed status. Do not invent editable environment credentials or a second source of truth.
- [ ] Explain whether a change affects all events, this event, newly created events, future drafts or copied configuration. Template edits do not imply retroactive changes to live events or historical artifacts.
- [ ] Keep explicit Save/Cancel and clear Saved/Unsaved/Conflict/Failed states where the owning page uses draft edits. Edits after Save immediately show Unsaved; Save success cannot mask a failed persistence operation.
- [ ] Navigation, event/context changes and browser exit preserve the existing dirty-state guard. Canceling navigation preserves the original context and edits.
- [ ] For risky existing actions, show consequences and use their existing domain confirmation/authorization workflows rather than adding one-click generic switches.
- [ ] Align Email layout with #1043: central Delivery & sender / Staff alerts / Email health; event display name and reply-to remain event settings. This design does not add delivery controls for event staff.
- [ ] Keep manual readiness evidence, live service health and environment configuration distinct. Show configured/status indicators without secret values.
- [ ] Provide field-level errors, focus to the invalid field, inline recovery and accessible saved/error feedback.
- [ ] Review phone sticky actions, keyboard/safe area, long help, 200% zoom, failed save, stale save and denied permission.

## Delivered Email compatibility
#1043 central Email is delivered. Use the current central Delivery & sender / Staff alerts / Email health model: one central From identity; only event display name and reply-to overrides at event scope; delivery pauses remain systemadmin controls. Preserve its migration/activation rules. This visual slice adds no event-staff delivery switch or second sender source.

## Out of scope
Changing delivery policy, enabling live provider settings, new finance/health policy, rewriting every settings backend, and adding autosave across unrelated domains.

## Concrete current-source fixes
- Platform settings combines organization identity, passkey domain, invoice PDF headers and new-event defaults. Label each effect: a passkey-domain change invalidates existing passkeys; invoice headers apply to newly generated PDFs; new-event defaults leave existing events unchanged.
- Replace the blanket new-event-default save message with accurate confirmation for the settings actually saved.
- Add the unsaved-navigation protection already used by Event settings; retain explicit save and the existing page's persistence contract.
- Correct the Platform settings navigation description so it does not promise payment-processor controls that the form does not provide.


## Accepted visual references

- [Four-role reference and shared visual tokens](../README.md)
- [Design notes](../design-notes.md), [source-based role contract](../evidence/role-contract.md), and [five-page comparison PDF](../comparison.pdf)
- [Offline interactive prototype](../interactive-prototype.zip): extract and open `role-design-samples.html` or `prototype/admin.html`; shared `operations.js` / `operations.css` are inside `prototype/`.

![System-admin desktop direction](../screenshots/admin-desktop.png)

![System-admin phone direction](../screenshots/admin-phone.png)

All examples are synthetic local demonstrations. Counts, timestamps and health indicators illustrate the design; production values and actions come from the authorized owning services. Review-gallery controls remain outside product chrome.

### Accepted impact presentation using a real setting

The reference uses the actual **Default timezone** field, with a synthetic proposed `America/Chicago` → `America/Denver` change. Show the current value, draft proposed value and plain-language effect: **newly created events use the new default; existing events and already sent messages keep their own values/history**. The preview must derive the real current/draft values, not hardcode the sample. The local design example does not save anything.

Use the same field-specific pattern for current real settings:

| Existing setting | Effect to explain |
|---|---|
| New-event defaults | Seed new events; do not rewrite existing events. |
| Invoice PDF header | Applies to newly generated PDFs; historical artifacts are not silently rewritten. |
| Passkey domain | Changing it invalidates existing passkeys; retain its actual domain confirmation and authorization. |
| Environment-managed provider setting/status | Explain configured/unknown ownership without showing secrets or inventing an editable credential field. |

Do not add a fictional organization-contact/description field just to illustrate impact. Replace the blanket new-event-default save message with accurate feedback for the fields actually persisted. Correct the Platform settings navigation description so it does not promise payment-processor controls absent from that form.

### Save and recovery detail

Show draft Unsaved, Saving, Saved and Failed/Conflict states only as supported by the owning persistence contract. Keep explicit Save/Cancel. Disable duplicate saves while preserving visible progress; edit after save immediately becomes Unsaved. Field errors identify the affected input and focus it; error feedback must not clear edits or report success after a rejected request. Conflict recovery must not silently overwrite a newer value. Reuse the existing unsaved-navigation guard on internal navigation, event/context switches and browser exit; canceling navigation leaves context and edits intact.

At 360/390px, action rows remain reachable above safe areas/keyboard, do not cover focused fields or help text, and do not hide errors. Test field-level failure, rejected save, stale/conflicting write, long impact copy, permission revoked mid-edit, keyboard and 200% zoom. This is a bounded improvement to the existing Platform settings form and related presentation, not a page-wide backend rewrite/autosave rollout.

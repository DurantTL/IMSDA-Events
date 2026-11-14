Buttons for every action: navy primary, outlined secondary, purple text button and the outlined danger button.

- One `.primary-button` per view for the main action (e.g. **Submit report**); `.cta` raises it to `--target-cta` (48px) on public pages.
- `.secondary-button` for alternatives such as **Save draft**; it uses `--line` and `--secondary-bg`.
- `.text-button` (purple) for low-weight actions inside rows.
- `.danger-outline-button` for removal; destructive steps always go through a confirmation `Dialog`.
- Labels are verbs in sentence case and name the result ("Submit registration", not "OK"). Icons are lucide at 16–18px, `aria-hidden`.
- Disabled while saving: 58% opacity and a wait cursor.

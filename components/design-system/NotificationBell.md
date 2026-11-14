The staff header's notification bell and the "Needs attention" panel it opens.

- The bell is a 44px round `.avatar.attention-bell` button with a 19px bell icon, `aria-expanded` and a name that includes the count ("Notifications, 3 items need attention"). A purple `.count-badge.attention-badge` pill with a white border sits at its top right corner when the count is above zero; it is `aria-hidden` because the button's name carries the count.
- The panel (`.header-popover.attention-popover`, up to 340px wide, scrolls past 70% of the screen height) starts with a focusable "Needs attention" heading, then groups of rows; each row is a 44px link with the count in bold purple and a label. A "Recent alerts" group lists alerts with an "(unread)" note and a mark-read action.
- Notes in the panel say when something could not load ("Alerts could not be loaded. The rest of the page is unaffected.").
- Tabbing out of the panel closes it.

The staff workspace frame (#1565): a branded header, an 88px icon rail, one row of tabs per area, and a five-slot bottom bar on phones. There is no sidebar.

- Header: the IMAdventist image symbol (42px, links to the calendar), "Find a page or task", Help & learning, Create, the notifications bell and the account menu, which is also the workspace switcher (only the workspaces the person holds).
- Rail: a vertical `--imsda-navy` to `--imsda-navy-deep` gradient, 88px wide, at most six areas (today Events, Clubs, People, Reports, Admin; Home joins when its pages exist) filtered by role. Items are 14px white text with 64px targets; the current area has a white 10% tint and a 3px `--imsda-gold` inset edge.
- Tab row: one per area, and inside an event the event's tabs (Event home, Registrations, Check-in, Communications, Money, Reports, Event setup). 48px tabs, 14px weight 800, muted until current; the current tab is navy with a 4px `--imsda-gold` underline. At most eight tabs.
- Views inside a tab: a bordered strip of at most five buttons, the current one filled `--imsda-navy`. Never a second tab row.
- Menu line: below 1024px, or when a row would not fit, the row is replaced by the current tab (4px gold underline) and a button named "<Area> menu" or "Event menu". It opens the full list, a sheet on a phone and a dialog on wider screens, with the current item marked by a 4px gold inset edge. A row never scrolls sideways or is cut off.
- Phone bar: Home, Events, Check-in, Clubs and More on white with `--shadow-tabbar`; the current slot has a 4px gold top bar and a navy tint. More lists "This event" first inside an event.
- "Where you are" is gold everywhere in staff (the club portal keeps purple). Staff pages raise every type floor to 14px.

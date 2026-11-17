The views inside one staff tab: a bordered strip of links with the current view filled navy. It is never a second row of tabs.

- The strip is a `role="group"` with a label ("Money views", "Event club pages"). Each view is a 44px link, 14px bold, in `--muted`; the current view is `--imsda-navy` with white text (`aria-current="page"`).
- A strip that only changes a choice on the same page (such as a time period) marks its current view `aria-current="true"` and shows it in `--imsda-navy-soft` with navy text, because the section tab already says "page". The same soft fill marks a page that sits below a view (a queue under "Review queues").
- At most five views, and a strip of fewer than two renders nothing. The strip is as wide as its links (`fit-content`) and wraps onto a second line rather than scrolling.
- On a phone (800px and narrower), when the tabs have become the menu line, the shell's own strip (`shell`) is not shown: the menu line names the current view and the menu lists every view (#2023). A strip a page draws itself stays.
- Hover fills a view with `--imsda-navy-soft`; keyboard focus is a 3px `--imsda-purple` ring.

The small cards a staff page puts in a grid: summary tiles, quick-action cards and the finance summary.

- `.metric-grid` is four `MetricCard`s across (two at 1120px and narrower), with a 13px gap and 20px below it. `.finance-summary` is the same four-across grid for `.finance-stat` tiles, with a 12px gap (8px at 580px and narrower). On narrow screens an odd last tile spans the full row.
- `.finance-stat` is a bordered white tile: a 36px rounded icon square (green by default; `warning` gold, `muted` purple) on the left, a small `--muted` label, and the value in navy 1.02rem bold. It shares the panel's border and shadow.
- `.action-grid` holds `.action-card` links, two across (one at 580px and narrower); a lone last card spans the row. A card is a 14px-radius bordered tile with a 38px `.action-icon` square (navy; `purple`, `green` or `gold`), a bold title, a one-line `small` description in `--muted`, and an arrow at the right. Hover lifts it 1px and darkens the border.
- The whole `.action-card` is the link.

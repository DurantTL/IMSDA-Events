Labelled inputs, selects, checkboxes, help and error text, as used in every form.

- Labels sit above the field in 14px bold `--ink`; help text below in `--muted`.
- Fields: `--field-border` (3:1 against white), `--radius-field`, hover `--field-border-hover`, focus `--field-focus` purple border and one 2px purple ring with a 2px offset, no halo; error fields keep the red border and also get the ring; on navy the ring is gold.
- Errors are a `.form-error` block in `--coral` on `--coral-soft`, written as what to do next.
- Checkboxes use the purple accent at 17px inside a 44px-tall label row.
- `.search-field` puts a lucide search icon inside the field; always keep a visible or `sr-only` label.

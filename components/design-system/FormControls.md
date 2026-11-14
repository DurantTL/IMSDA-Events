The remaining form controls and how errors and unsaved changes show: select, checkbox, radio cards, date and file, inline errors and the error summary.

- Select, text and date inputs take the `Field` look. A date question is typed (placeholder "M/D/YYYY"); `.birth-date-field` shows "Reads as April 17, 2014." in `.field-help` under it, and the helper line under a date question says "Pick a date." on a touch screen instead of the typing hint.
- Checkboxes use `.checkbox-label` (see `Field`). Radio choices that need a sentence each use `.radio-card-group`: a fieldset with a legend and `.radio-card` options (44px tall, purple border and tint when chosen, `small` for the extra line).
- A file is a `.secondary-button.file-button` or a `.file-drop` area around a visually hidden input; the ring goes on the label when the input has focus; disabled is 58% opacity.
- An inline error is `.field-error-message`: an alert icon plus the text in `--coral`, never color alone. The control gets `aria-invalid="true"` (a red border and a one-pixel red ring) and `aria-describedby` pointing at the message.
- A long form gets a `.form-error-summary` at the top: a coral-bordered `role="alert"` block headed "2 things to fix before saving" with one link per problem; each link moves focus to its field. Fixing a field removes its item.
- Leaving a page with unsaved edits asks first in the shared dialog ("Leave without saving?", buttons "Keep editing" and "Leave without saving"; see `Dialog`). Reload and closing the tab use the browser's own prompt (rule B6).

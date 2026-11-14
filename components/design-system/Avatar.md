The small square with a person's initials or photo, used beside a name in lists, and the larger round profile photo.

- `.person-avatar` is a 38px square with 11px corners, bold text and a navy tint (`--imsda-navy-soft`). Tones: `purple`, `green` (the check-in lists use green for a person who has arrived, purple for one who has not) and `gold`. `.large` makes it 45px with 13px corners.
- Initials: the check-in lists and the overview's recent registrations use the first letter of the first and last name. The staff list uses the first letter of the first two words of the display name, and the profile photo card uses up to two letters, uppercased.
- Photo: an `<img class="person-avatar-photo">` fills the square (`object-fit: cover`; the square clips it to its rounded corners). The staff list shows the thumbnail when the person has a photo and initials when not. Photos are decorative (`alt=""`); the name sits next to them.
- `.person-list` stacks `.person-row`s: avatar, then a bold name over a `--muted` detail line, then a status chip, with a thin line between rows. `.linked-row` makes the row a link that turns the name purple on hover. `.arrival-row` is the check-in version. `.staff-person` is the staff list's avatar-and-name pair.
- The profile photo card (`profile-photo-card`) shows the person's own photo or initials as a 96px circle (`--radius-pill`), with the buttons "Add a profile photo" or "Change photo" and "Remove photo". Without a photo the initials show on `--imsda-navy-soft`.
- The header's account button (`.avatar`) is a different, 44px control; see `Menus`.

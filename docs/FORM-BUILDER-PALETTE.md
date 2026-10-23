# Form builder: the Questions palette and editor layout

The registration form builder's editor (tablets and desktops, #1132) has one
sidebar with three tabs: **Questions**, **Question settings** and **History**.
Phones keep the earlier builder layout until the phone step (#1071).

## The palette is driven by one registry

Everything in the Questions tab comes from `paletteRegistry` in
`components/registration-builder/palette-registry.ts`. The sidebar
(`builder-palette.tsx`, `builder-sidebar.tsx`) lists whatever is registered and
never names a field type or a module. Search, the groups, click-to-add and
drag-to-insert all read the same entries.

An entry is:

| Field | Meaning |
| --- | --- |
| `id` | Stable and unique, for example `type:TEXT`, `module:housing`, `saved:<id>`. Registering an existing id throws. |
| `label` | What the question is called in the palette. |
| `description` | Optional one-line help, also searched. |
| `group` | A group id: `general`, `people`, `money`, `agreements`, `modules`, `saved`. An id that is not registered gets a group of its own, so a new group needs no sidebar change either. |
| `icon` | A lucide icon component. |
| `keywords` | Extra search words. |
| `add(context)` | Returns `{ fields, module? }`: the fields to insert. `context` carries the fields already on the form (to choose unused keys) and an id maker. |

Groups fold (the header is a button with `aria-expanded`). Searching opens every
group that has a match; "/" focuses the search box and Enter adds the best match
to the current step.

### Add a ready-made module

Add it to `builderFieldModules` in `modules/forms/builder-modules.ts`. That is
all: `registerBuilderModules` registers every module, so it appears in the
palette under the group `moduleGroupId` picks from its category (People ->
People and directory, Housing and Group event -> Modules, the fee, payment and
promo modules -> Money, the acknowledgments -> Agreements, anything else ->
General questions). Module entries are inserted through the builder's existing
module insert, so fixed field keys, the "already on the form" check, switching
the roster on and the insert notices all keep working.

To place a module in a different group, register it yourself instead:

```ts
import { moduleEntry, paletteRegistry } from "@/components/registration-builder/palette-registry";

paletteRegistry.register(moduleEntry(myModule, "money"));
```

### Add any other entry (a question type, saved questions)

```ts
paletteRegistry.register({
  id: "saved:medical-contact",
  label: "Medical contact",
  group: "saved",
  icon: Bookmark,
  keywords: ["emergency", "health"],
  add: ({ newId, existingFields }) => ({ fields: [/* fields built with newId() */] }),
});
```

`register` returns a function that removes the entry again. The palette updates
on its own (it subscribes to the registry). Saved questions (#1070) register
under the `saved` group, which already shows an empty hint.

Keep `add()` free of side effects: it only builds fields. The builder inserts
them with `addPaletteEntry` (use-builder-edits.ts), which goes through the same
`replaceDefinition` as every other edit, so the draft, the unsaved-changes guard
and the 20-fields-per-step limit apply.

## Layout options

The top bar's Layout options button shows or hides the sidebar, moves it to the
left or right, makes it narrower or wider, and resets the layout. The sidebar's
edge is also a separator that can be dragged, or focused and moved with the
arrow keys (Home and End jump to the narrowest and widest). Width is clamped to
300-600px.

The layout is remembered per browser in `localStorage` (key
`imsda.registrationBuilder.editorLayout.v1`). Every storage read and write is in
a try/catch, so with storage unavailable the layout still works for the page
visit and is simply not remembered.

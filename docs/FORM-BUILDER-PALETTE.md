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
| `id` | Stable and unique, for example `type:TEXT`, `module:housing`, `saved:<id>`. Registering an existing id replaces the entry. |
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

`register` returns a function that removes the entry again. Registering an id
that already exists replaces that entry (and registering the very same entry
again does nothing), so hot reload or a double registration cannot throw; the
returned cleanup only removes the entry if it is still the one registered. The
palette updates on its own (it subscribes to the registry).

### Entries that belong to one organization or person

`paletteRegistry` is a process-wide singleton: on the server it is shared by
every request and every organization. **Never put organization-scoped entries
(saved questions, #1070) in it.** Use one of these instead:

1. **A registry per provider.** Make one with `createDefaultPaletteRegistry()`
   (or `createPaletteRegistry()`), fill it from the signed-in organization's
   data, and pass it to the editor: `<BuilderEditorShell registry={registry} />`.
   Create it in component state or a provider, so each organization gets its own.
2. **Client-only registration in an effect, with cleanup.**

```ts
useEffect(() => {
  const removers = savedQuestions.map((question) => paletteRegistry.register(savedQuestionEntry(question)));
  return () => removers.forEach((remove) => remove());
}, [savedQuestions]);
```

Option 1 is safer because nothing is shared. If you use option 2, the entries
exist only in that browser tab while the effect is mounted, and the cleanup
removes them when the person leaves or switches organization.

Saved questions register under the `saved` group, which already shows an empty
hint. Their ids and keys may already be on the form: `planPaletteInsert` gives
the inserted copy fresh ids and suffixes any key that clashes (and follows
conditions between the inserted fields), so `add()` need not check.

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

## Question library (#1070)

Saved questions live in the `QuestionLibraryItem` table (`modules/question-library/`), not in source. The builder loads
them for the event being built (`GET /api/question-library?eventId=`) and layers them over the shared registry
(`library-registry.ts`), so each one is a palette entry in the `saved` group ("Question library"). The shared registry is
never written to.

- **Who:** anyone who can build forms (system administrators, event staff with `MANAGE_FORMS` on that event) saves with
  "Save to library" in a question's actions menu and adds from the palette. Only system administrators rename, edit or
  delete (System, Forms, Question library). Every route checks this on the server.
- **Copies:** adding makes an independent copy (`instantiateLibraryFragment`): fresh id, a key free on the form that is
  never one a module reads by name, and conditions between copied questions follow the new keys. A condition that points
  outside the saved item is removed and the copy is marked "Needs repair" in the builder; it is never pointed at another
  question that happens to share the key. Library edits and deletes never reach inserted questions or published versions.
- **Configuration only:** a fragment is validated with the form definition's field schema. Module-owned and canonical keys
  (promo code, roster bundle, age fields, meal tickets, attendee type) cannot be saved; an acknowledgment that points at an
  event's policy version is saved as placeholder wording; health-type questions are always saved as sensitive, and a
  question wired to a sensitive question is saved as sensitive and not a filter.
- **Information forms:** library entries pass through the same refusal check as every other entry, so only items an
  information form accepts are offered there.
- **Audit:** `QUESTION_LIBRARY_ITEM_CREATED`, `_EDITED` and `_DELETED` carry ids and counts only. Delete archives the row.

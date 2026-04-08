# Rich Text Editor Shell Reset Design

## Summary

The current shared rich text editor runtime already uses Tiptap, but the visible editor shell still feels like the old editor. The toolbar, surface framing, mode switching, and general interaction model do not communicate a clean rebuild. That mismatch is causing a product failure even though the engine underneath has changed.

This design resets the visible editor shell for all shared editor surfaces. Comments, comment edits, description editing, and create-issue description will all render through one compact, utilitarian editor UI with a fixed top toolbar, a cleaner document surface, and a secondary wiki action on the right side instead of an inline raw-mode workflow.

This spec is specifically about the visible editor shell and interaction contract. It complements the earlier shared-editor rebuild spec rather than replacing the Tiptap-based architecture already chosen.

## Goals

- Replace the visible editor shell so it no longer feels like the legacy editor.
- Keep one shared UI for add comment, edit comment, edit description, and create description.
- Use a fixed top toolbar with only the v1 basic actions:
  - bold
  - italic
  - underline
  - link
  - bullet list
  - numbered list
- Move wiki access to a secondary action on the right side of the toolbar instead of a first-class inline mode toggle.
- Make the editor look compact and utilitarian, aligned with the VS Code and Jira panel context.
- Keep the visual shell stable with no layout jumps on hover, focus, validation, or mode changes.
- Keep Tiptap as the engine and Jira wiki as the submitted value.

## Non-Goals

- No attempt to preserve the old toolbar look.
- No advanced formatting in the visible shell for v1:
  - heading
  - quote
  - strike
  - inline code
  - code block
- No floating toolbars, slash commands, inline bubble menus, or Google Docs style collaboration affordances.
- No multi-surface editing behavior where visual and wiki are both treated as live authorities.
- No expansion of Jira formatting scope beyond the current stable core.

## Current Problem

The repo now has a shared Tiptap runtime, but the host UI still presents as an inherited editor shell:

- the toolbar still reads like a generic utility strip rather than a clean document editor
- the mode controls are too prominent relative to the actual editing actions
- the visual frame does not strongly separate toolbar, document surface, and secondary actions
- the result looks too close to the editor the user asked to throw away

This is not a cosmetic nit. The shell is part of the feature. If the UI still feels like the old editor, the rebuild has not been delivered from the user's perspective.

## Proposed UI

### Layout

Each editor instance renders as one compact card with two visible zones:

1. Toolbar row
2. Surface frame

The toolbar is fixed at the top of the editor card and always visible. The surface frame below it holds either:

- the visual Tiptap surface, or
- the wiki textarea

The editor remains one container in both modes. Switching modes must not insert a second editor elsewhere in the layout.

### Toolbar

The toolbar uses a compact utilitarian layout:

- left cluster for formatting actions
- flexible spacer in the middle
- right cluster for the secondary `Wiki` action

The toolbar contains:

- `B`
- `I`
- `U`
- `Link`
- `Bullet list`
- `1. List`
- `Wiki` on the far right

No additional buttons are shown in v1.

### Visual Surface

The visual surface should read like a document workspace inside a panel:

- clear outer border
- consistent padding
- no doubled borders between toolbar and content
- minimum height sufficient for comment and description editing without looking oversized
- placeholder text that sits naturally inside the document area
- stable focus treatment with no geometry changes

The visual surface should feel calmer and more deliberate than the previous shell. The target impression is compact and utilitarian, not ornamental.

### Wiki Surface

The wiki fallback appears in the same surface frame when the user activates `Wiki`.

The wiki surface is not styled as a legacy raw editor. It should look like a secondary plain-text editing mode within the same editor card:

- same outer frame as the visual surface
- monospace text area
- stable padding and sizing
- no duplicated toolbar or detached textarea below the editor

The `Wiki` action should be visually secondary relative to formatting actions, but still obvious and usable.

## Interaction Design

### Default Mode

Visual mode is the default for all surfaces.

### Formatting State

Toolbar buttons must reflect the actual Tiptap selection state:

- no button is active by default unless the current selection really contains that mark or node
- clicking in and out of content must not flip visible state incorrectly
- repeated clicks inside existing content must not create false active-state changes

### Wiki Action

`Wiki` behaves as a right-side mode action:

- clicking `Wiki` swaps the visible surface from visual to wiki
- while wiki mode is active, that same right-side action changes to `Visual`
- clicking `Visual` swaps back to the visual editor
- the shell stays in one stable container during the switch

The controller remains responsible for synchronization:

- entering wiki mode copies the current canonical wiki value into the textarea
- returning to visual mode reparses the textarea through the codec and replaces the Tiptap document

### Keyboard Behavior

Keyboard behavior stays with Tiptap defaults for the supported feature set:

- Enter
- Backspace
- bullet lists
- numbered lists

No custom keyboard hacks should be added unless a concrete bug requires them.

## Shared Surface Coverage

The new shell applies to all shared editor hosts:

- comment composer
- comment reply
- comment edit
- issue description edit
- create-issue description

There must not be a separate "comment-looking" editor and "description-looking" editor. The same shell should appear everywhere, with only placeholder text and submit wiring differing by host.

## Component Changes

### `RichTextEditorView`

This class becomes the primary owner of the new shell markup and styles.

It should render:

- the compact fixed toolbar
- the right-side `Wiki` action cluster
- the shared framed surface container
- the visual mount point
- the wiki textarea surface
- the hidden canonical wiki field

It should not contain behavior.

### `RichTextToolbarController`

This class should be simplified to the v1 visible command set:

- bold
- italic
- underline
- link
- bullet list
- ordered list
- wiki mode action

Any contract for removed buttons should be deleted rather than left dormant.

### `RichTextEditorController`

This class keeps Tiptap ownership, but it must align to the new shell contract:

- maintain one canonical wiki payload
- drive active button state from editor state
- switch the single shared frame between visual and wiki surfaces
- keep hidden value and visible wiki textarea synchronized through explicit mode transitions

### `webview.panel.ts`

This file should not reintroduce shell-level special cases. It should continue to render the shared host only.

## Styling Direction

The shell should follow these styling rules:

- compact sizing
- utilitarian button shapes
- restrained contrast
- no oversized radii or decorative treatment
- stable reserved space for all interactive states
- consistent spacing across comments and description sections

The editor should inherit VS Code theme variables, but the composition should feel deliberate rather than default.

## Error Handling

- If the visual editor fails to initialize, the wiki surface remains available inside the same shell container.
- If wiki parsing fails when returning to visual mode, the controller should degrade to readable paragraphs rather than break the shell.
- Validation and save errors continue to use the existing form error areas outside the editor shell.
- The shell itself should not create new inline validation regions that shift layout unexpectedly.

## Testing Strategy

Implementation must follow TDD.

### View Tests

Add or update DOM tests to verify:

- only the basic toolbar actions are rendered
- `Wiki` is rendered in the right-side action group
- advanced buttons are absent
- the shared shell markup is the same across comment and description surfaces

### Controller Tests

Add or update DOM tests to verify:

- no formatting button starts active by default on an empty editor
- changing selection updates toolbar state correctly
- switching to wiki mode shows the wiki surface within the same editor container
- returning to visual mode reparses the wiki value into the editor
- the hidden canonical wiki field remains the submitted value

### Integration Tests

Update issue-panel and create-panel DOM tests to verify:

- comment edit uses the new shared shell
- comment reply uses the new shared shell
- description edit uses the new shared shell
- create issue description uses the new shared shell
- no rendered HTML includes legacy shell-only assumptions

## Risks and Mitigations

- Risk: the new shell still looks too close to the previous one.
  - Mitigation: replace the actual markup and button contract, not just CSS values.
- Risk: wiki mode becomes visually awkward or detached.
  - Mitigation: keep both surfaces inside the same framed container with one toolbar.
- Risk: surface changes accidentally diverge between comments and descriptions.
  - Mitigation: keep all markup in `RichTextEditorView` and assert shared rendering in DOM tests.
- Risk: advanced formatting pressure bloats the shell again.
  - Mitigation: freeze the visible command set to the v1 basic actions until stability is proven.

## Implementation Sequence

1. Add failing DOM tests for the new shell contract and reduced toolbar.
2. Rebuild `RichTextEditorView` markup and styles for the new compact shell.
3. Trim `RichTextToolbarController` and `RichTextEditorController` to the new visible interaction contract.
4. Update shared-editor integration tests for comments, comment edits, description edit, and create description.
5. Run focused editor DOM suites, then the full DOM suite, then bundle verification.

# Rich Text Editor Behavior Hardening Design

## Summary

The shared rich text editor now has the right engine and a reset shell, but it still does not behave consistently enough to feel like a real document editor. The remaining failures are not about missing buttons. They are about focus, selection, caret placement, keyboard semantics, and paste behavior.

This design defines a behavior-hardening phase for the shared Tiptap editor used by comments, issue description editing, and create-issue description. The goal is to make the editor behave predictably as a document surface before any additional formatting scope is added.

This spec extends the earlier rebuild and shell-reset specs. It does not replace the Tiptap architecture or the compact shell. It narrows the next implementation phase to behavior correctness.

## Goals

- Make the editor behave like one shared document editor across all hosts.
- Eliminate false toolbar state caused by stale focus or stored marks.
- Make empty-surface clicks place the caret in the actual ProseMirror surface without activating formatting unintentionally.
- Make repeated clicks inside the editor stable and non-destructive.
- Make `Enter`, `Shift+Enter`, and `Backspace` behave predictably in paragraphs and lists.
- Normalize paste input so external rich HTML does not corrupt editor behavior or Jira wiki output.
- Keep Jira wiki as the canonical integration format at submit boundaries.

## Non-Goals

- No new visible formatting features in this phase.
- No expansion to heading, quote, strike, inline code, or code block.
- No floating formatting UI, slash commands, or inline toolbars.
- No special per-host editing behavior for comments versus descriptions.
- No attempt to perfectly emulate Google Docs or Pages feature depth.

## Current Problem

The editor has moved off `execCommand`, but users can still hit document-level failures:

- clicking an empty editor can change visible toolbar state incorrectly
- clicking the same surface twice can produce different state transitions
- toolbar state can reflect stored marks even when the editor is not the active focus target
- real mouse hit-testing inside the VS Code webview can differ from DOM-only test behavior
- create-issue layout markup can redirect clicks in ways that the isolated editor does not
- keyboard behavior still depends too heavily on raw defaults without an explicit contract
- paste input is not yet treated as a first-class behavior surface

The create-issue regression that redirected clicks to the `Bold` button proved the main lesson of this phase: editor behavior cannot be treated as a local DOM concern only. The host markup, focus boundaries, and browser hit-testing rules all matter.

## Design Principles

### One Live Authority In Visual Mode

While visual mode is active, the live Tiptap document is the only source of truth.

- toolbar state derives from the focused editor selection
- hidden field value derives from document serialization
- host screens do not interpret formatting themselves

### Shared Behavior Across Hosts

Comment create, comment edit, issue description edit, and create-issue description must all use the same behavior rules.

Any host-specific special case should be limited to:

- placeholder text
- submit wiring
- cancel/reset wiring

Document behavior itself must remain shared.

### Explicit Behavior Layer

Document behavior should not be spread across:

- `webview.panel.ts`
- toolbar button handlers
- ad hoc host event listeners

Instead, editor interaction rules should live in one focused behavior layer that sits beside the controller.

## Proposed Architecture

### `RichTextEditorBehavior`

Add a dedicated behavior owner for document interactions.

Responsibilities:

- enter the real ProseMirror surface when the outer shell is clicked
- keep toolbar state tied to real editor focus
- manage click and repeat-click stability
- define key handling for `Enter`, `Shift+Enter`, and `Backspace`
- normalize pasted content before insertion
- expose narrowly scoped hooks back to the controller when content or focus changes

This class should operate through Tiptap and ProseMirror hooks, not through host-specific DOM patching.

### `RichTextEditorController`

Keep this class responsible for:

- editor lifecycle
- visual/wiki mode switching
- synchronization between editor HTML and canonical Jira wiki
- hidden-field updates
- submit-facing state

It should delegate interaction semantics to `RichTextEditorBehavior`.

### `RichTextToolbarController`

Keep the toolbar intentionally simple:

- dispatch formatting commands
- dispatch wiki/visual mode toggle
- reflect active state only from the focused editor

It should not guess formatting, preserve state, or own focus logic.

### `JiraWikiDocumentCodec`

Keep the codec as the conversion boundary:

- parse initial Jira wiki into editor content
- serialize editor content back to Jira wiki on demand

It should not contain UI behavior rules.

## Interaction Contract

### Focus And Selection

The editor must follow these rules:

- Clicking the outer document surface focuses the real ProseMirror node.
- Clicking an empty surface creates a visible caret in the document.
- Clicking inside the editor must never implicitly focus a toolbar button.
- Toolbar state is only meaningful while the editor is focused.
- Losing focus clears visible toolbar active state.
- Re-entering the editor recalculates toolbar state from the active selection only.

### Empty Editor Behavior

The empty placeholder state is a first-class scenario.

Required behavior:

- Empty surfaces must remain inert visually until the user actually requests formatting.
- Clicking the placeholder region must not activate `Bold`, `Italic`, `Underline`, lists, or links.
- Repeated clicks on an empty editor must remain stable.

### Keyboard Semantics

The editor must define explicit behavior for the supported feature set.

#### Paragraphs

- `Enter` in a normal paragraph creates a new paragraph.
- `Shift+Enter` inserts a soft line break inside the current block.
- `Backspace` in an empty paragraph should reduce structure only when there is an actual structural reason to do so.

#### Lists

- `Enter` in a non-empty list item creates a new list item.
- `Enter` in an empty list item exits the list into a normal paragraph.
- `Backspace` in an empty list item reduces or exits list structure predictably.
- Bullet and ordered list behavior must be identical across all editor hosts.

### Paste Semantics

Paste input must be normalized before it becomes document state.

Required behavior:

- Plain text pastes as readable text.
- Basic formatting may be preserved when it maps cleanly to supported marks:
  - links
  - bold
  - italic
  - underline
- Unsupported formatting and noisy external markup degrade to clean text or supported structure.
- Paste should not import inline styles, arbitrary classes, or layout-heavy HTML.

### Wiki Mode Contract

Wiki mode remains a separate fallback surface, not a parallel editor.

- Visual mode owns live document state.
- Switching to wiki mode serializes the current document once.
- Switching back to visual mode reparses the textarea once.
- Wiki mode does not continuously compete with the visual editor for authority.

## Host Markup Constraints

Host markup must not interfere with editor interaction.

Rules:

- Shared rich editor hosts must not be nested inside `<label>` wrappers.
- The toolbar must remain outside any click-redirection semantics meant for form labels.
- Editor surface geometry must reserve stable space so hover, focus, and validation do not move hit targets.

This is a behavioral requirement, not just a layout preference.

## Data Flow

### Visual Mode

1. User interacts with the visual surface.
2. `RichTextEditorBehavior` resolves focus, caret placement, keyboard handling, or paste normalization.
3. Tiptap mutates document state.
4. `RichTextEditorController` serializes the current document to Jira wiki for the hidden field.
5. `RichTextToolbarController` reflects active state from the focused selection.

### Wiki Mode

1. User switches to wiki mode.
2. Controller serializes the current document to the visible wiki textarea.
3. User edits the wiki textarea directly.
4. Hidden field mirrors textarea content.
5. On return to visual mode, controller reparses the wiki into editor content once.

## Error Handling

- If a behavior hook fails, the editor should fall back to normal Tiptap behavior rather than breaking the host.
- If paste normalization fails, paste should degrade to plain text.
- If wiki parsing fails on return to visual mode, the controller should degrade to readable paragraph content.
- If serialization cannot express a structure exactly, it must output readable Jira wiki rather than corrupted markup.
- Focus and selection fixes must never introduce new toolbar-driven focus theft.

## Testing Strategy

Implementation must follow TDD and must validate both DOM-level behavior and real VS Code webview behavior during development.

### DOM Tests

Add or expand tests for:

- empty-surface click keeps toolbar inactive
- repeated empty-surface click remains stable
- blur clears toolbar active state
- outer-surface click focuses the real ProseMirror node
- toolbar `mousedown` does not steal selection
- paragraph `Enter`
- paragraph `Shift+Enter`
- list item `Enter`
- empty list item `Enter`
- empty list item `Backspace`
- paste of plain text
- paste of simple formatted HTML
- paste degradation for noisy nested markup

### Integration DOM Tests

Add or expand tests for:

- create-issue description editor is not nested in a label
- comment composer uses the same behavior contract
- description editor uses the same behavior contract
- no host-specific markup reintroduces focus redirection

### Real Webview Verification

During implementation, verify the highest-risk interactions in a real VS Code webview renderer:

- create-issue description empty-surface click
- repeated click in the same empty surface
- toolbar state after blur

This real-webview verification is a required development check for this phase because earlier regressions were not visible in jsdom alone.

## Success Criteria

This phase is complete when:

- empty editors no longer activate formatting on click
- toolbar state only reflects the focused editor
- repeated clicks inside the editor are stable
- create-issue, comments, and description behave the same way
- paragraph and list keyboard behavior feels predictable
- paste no longer introduces formatting junk or unstable state

Only after those conditions are met should the editor expand into more formatting features.

# Rich Text Editor Rebuild Design

## Summary

The current rich text editing experience is split across multiple inline implementations inside `src/views/webview/webview.panel.ts`, and the comment editor relies on `contenteditable` plus `document.execCommand`. That combination is producing non-deterministic selection state, incorrect toolbar activation, and unstable behavior when users click in and out of formatted content.

This rebuild will replace the current editing model with one shared editor subsystem used by both comment editing and issue description editing. The new subsystem will use Tiptap as the document engine, treat editor state as the source of truth, and convert to Jira wiki markup only at the integration boundary. The first version will optimize for reliable document-style behavior rather than full formatting parity with the current toolbar.

## Goals

- Replace the current `execCommand` and ad hoc `contenteditable` behavior with a deterministic editor engine.
- Use one shared editor implementation for comment create/edit flows and issue description editing.
- Make toolbar state reflect actual editor selection state instead of inferred DOM state.
- Support a stable first-release formatting core: paragraphs, bold, italic, underline, links, bullet lists, numbered lists, and predictable Enter/Backspace behavior.
- Keep Jira writes in Jira wiki markup format so existing extension message contracts and server-side expectations remain intact.
- Preserve a user escape hatch through a separate plain wiki view, not a live dual-surface toggle in the same editor.
- Reduce the amount of editor logic embedded directly in `src/views/webview/webview.panel.ts`.

## Non-Goals

- No attempt to preserve the current implementation approach.
- No v1 support for strike, heading, quote, inline code, code block, or the current inline raw toggle.
- No proactive UI redesign outside the editor surfaces already being rebuilt.
- No changes to Jira API endpoints or message types beyond routing both editor surfaces through the new shared editor path.
- No rich HTML write path to Jira. Jira wiki remains the canonical outbound format.

## Current State

### Comment Editing

The comment editor renders a custom toolbar, a `contenteditable` visual surface, and a hidden raw wiki textarea. The behavior is initialized from a large inline bootstrap script in `src/views/webview/webview.panel.ts`. Formatting commands depend on `document.execCommand`, and toolbar state is derived from browser command-state APIs.

This creates the exact class of failures the user reported:

- toolbar buttons can start in the wrong active state
- clicking into text and clicking again can flip visible state unexpectedly
- formatting state is coupled to browser DOM behavior instead of a real editor model
- the visual editor and raw wiki textarea compete as synchronized editing surfaces

### Description Editing

Issue description editing uses a separate inline `contenteditable` implementation with a similar toolbar but without the shared comment editor widget. That means the repo currently has two editing paths with overlapping formatting concepts and inconsistent behavior.

### Structural Problem

The editor rendering, styling, conversion logic, command handling, and issue-panel wiring are all concentrated in `src/views/webview/webview.panel.ts`. That makes the editor hard to reason about, hard to test in isolation, and easy to regress.

## Proposed Design

### Shared Editor Subsystem

Create one shared editor subsystem under `src/views/webview/editors/` and use it for:

- add comment
- edit comment
- edit description

The editing engine will be Tiptap running in vanilla JavaScript/TypeScript inside the existing webview. The document model, selection handling, keyboard behavior, and command state will come from Tiptap rather than direct DOM command APIs.

### Source of Truth

The visual editor document is the only live source of truth while the user is editing. The separate wiki fallback view is a distinct mode, not a second always-live editing surface synchronized on every selection change.

This is the main behavioral reset from the current design:

- no `document.execCommand`
- no DOM-derived toolbar state
- no "visual plus hidden raw mode are both active editing authorities"
- no separate comment editor path versus description editor path

### Initial Feature Scope

The first rebuild will support only the stable core:

- paragraphs
- bold
- italic
- underline
- links
- bullet lists
- numbered lists
- predictable selection state and keyboard behavior

The following stay out of v1 on purpose:

- strike
- headings
- blockquotes
- inline code
- code blocks
- live raw toggle within the toolbar

### Wiki Fallback

The rebuild will keep a plain Jira wiki escape hatch, but it will be implemented as a separate plain-text view or tab owned by the editor controller. It will not be a live toggle that leaves the editor bouncing between two surfaces within one interaction flow.

## Component Design

### `RichTextEditorView`

Responsible for rendering the editor host markup for one editor instance:

- toolbar container
- editable surface container
- optional plain wiki fallback container
- data attributes and identifiers needed for initialization

This class does not own document behavior.

### `RichTextEditorController`

Responsible for one editor instance lifecycle:

- create and configure the Tiptap editor
- load initial Jira wiki content through the codec
- expose `getWikiValue()`, `setWikiValue()`, `focus()`, and `destroy()`
- coordinate form submit state
- coordinate switching between rich view and plain wiki fallback view

### `RichTextToolbarController`

Responsible for binding toolbar buttons to editor commands and updating active and disabled state from editor transactions and selection changes.

This is the boundary that fixes the current "bold looks active even when it should not be" problem. Toolbar state must come from the editor state, not from DOM inspection or browser command-state heuristics.

### `JiraWikiDocumentCodec`

Responsible for:

- parsing Jira wiki input into editor content for initial load
- serializing editor content back into Jira wiki for submit
- degrading unsupported content into readable plain text instead of emitting broken markup

This class keeps Jira-specific formatting rules separate from editor lifecycle code.

### `RichTextEditorRegistry`

Responsible for finding editor hosts in the issue panel DOM and creating controllers for each supported surface. This replaces the current global initializer pattern in `webview.panel.ts`.

## File Structure

The rebuild should introduce focused files with one class per file:

- `src/views/webview/editors/rich-text-editor.view.ts`
- `src/views/webview/editors/rich-text-editor.controller.ts`
- `src/views/webview/editors/rich-text-toolbar.controller.ts`
- `src/views/webview/editors/jira-wiki-document-codec.ts`
- `src/views/webview/editors/rich-text-editor.registry.ts`

`src/views/webview/webview.panel.ts` should remain responsible for:

- rendering issue-panel sections
- rendering editor host containers
- posting existing message contracts for comment and description updates

It should stop owning the internal editor command and conversion logic.

## Data Flow

### Load Flow

1. `webview.panel.ts` renders a host element with the initial Jira wiki value.
2. `RichTextEditorRegistry` finds the host and constructs a `RichTextEditorController`.
3. The controller uses `JiraWikiDocumentCodec` to parse the wiki into editor content.
4. Tiptap initializes from that parsed content.
5. `RichTextToolbarController` subscribes to editor updates and reflects current command state.

### Editing Flow

- The Tiptap document is the live editing state.
- Toolbar buttons dispatch editor commands through the controller.
- Selection changes and transactions update toolbar state.
- Form buttons enable or disable based on the serialized wiki value being empty or non-empty.
- Switching to the plain wiki fallback view uses the current editor state as the source value.

### Submit Flow

- On submit, the controller serializes the current document through `JiraWikiDocumentCodec`.
- Comment create and comment edit flows post Jira wiki text through the existing message pipeline.
- Description edit also serializes through the same shared codec path before posting.
- After a successful save, the editor host should refresh from the canonical saved Jira value rather than preserving stale DOM state.

## Dependency Choice

The rebuild will use a dedicated editor engine dependency. Tiptap is the recommended choice because it provides a stable document model, command system, and selection-aware state while still fitting the existing vanilla webview architecture.

This design explicitly rejects a custom clean-room editor implementation because that would recreate the same unstable class of bugs at a higher maintenance cost.

## Error Handling

- If Jira wiki parsing fails, the editor falls back to plain text paragraphs rather than leaving the surface broken.
- If wiki serialization encounters an unsupported node, the codec degrades to readable text instead of emitting invalid Jira wiki markup.
- If Tiptap initialization fails, the host falls back to the plain wiki view so the user can still edit.
- Comment and description save failures continue using the existing issue-panel error surfaces.
- The editor subsystem does not invent a second independent error-reporting system.

## Testing Strategy

Implementation must follow TDD.

### Codec Unit Tests

Add focused tests for `JiraWikiDocumentCodec` covering:

- empty content
- plain paragraphs
- bold
- italic
- underline
- links
- bullet lists
- numbered lists
- mixed inline formatting
- readable degradation for unsupported or malformed input

### Toolbar and Controller DOM Tests

Add DOM tests covering:

- toolbar buttons are not active by default unless editor state says they are
- selecting formatted content activates the correct toolbar state
- moving the selection updates toolbar state deterministically
- submit buttons enable and disable correctly from serialized content state
- switching to the plain wiki fallback view uses the current editor content
- loading an initial wiki value produces the expected editor content

### Issue Panel Integration Tests

Update or add DOM tests proving:

- comment create uses the shared editor path
- comment edit uses the shared editor path
- description edit uses the shared editor path
- comment submit posts Jira wiki output from the shared codec
- description submit posts Jira wiki output from the shared codec

### Test Direction

The rebuild should not preserve tests that only make sense for the `execCommand` model. The highest-risk logic must move into codec and controller classes so most behavior is testable without relying on browser-specific editing APIs.

## Risks and Mitigations

- Risk: Jira wiki conversion becomes the new bug hotspot.
  - Mitigation: isolate conversion in `JiraWikiDocumentCodec` and give it direct round-trip tests.
- Risk: `webview.panel.ts` still accumulates editor-specific logic during the rewrite.
  - Mitigation: keep editor behavior inside dedicated controller and registry classes and treat the panel as a host renderer only.
- Risk: feature parity pressure reintroduces unstable formatting too early.
  - Mitigation: lock v1 scope to the smaller stable core and add advanced formatting only after the shared editor proves stable.
- Risk: switching between rich mode and wiki fallback mode creates state drift.
  - Mitigation: make the controller own one canonical in-memory editor document and populate the fallback view from that state rather than trying to keep two active surfaces synchronized at all times.

## Implementation Sequence

1. Add failing tests for the shared codec and controller behavior before changing production editor code.
2. Introduce the shared editor files under `src/views/webview/editors/`.
3. Replace comment create and comment edit flows with the shared editor subsystem.
4. Replace description editing with the same shared editor subsystem.
5. Remove obsolete `execCommand`-based logic and duplicate inline editor wiring from `webview.panel.ts`.
6. Run targeted DOM and node tests for the codec, controller, and issue-panel flows.
7. Keep advanced formatting out of scope until the stable core is fully green and manually validated.

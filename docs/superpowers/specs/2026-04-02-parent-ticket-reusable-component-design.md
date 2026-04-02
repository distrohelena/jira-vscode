# Parent Ticket Reusable Component Design

## Summary

The issue creation sidebar already exposes the preferred Parent Ticket control: a card-style trigger that clearly communicates selection state and opens the dedicated parent picker modal. The issue details/edit sidebar still uses a separate row layout with different markup and a weaker visual hierarchy.

This change will promote the create-sidebar Parent Ticket card into a shared renderer and reuse it in both surfaces. The create flow remains the source of truth for design and interaction. The issue details/edit flow will adopt the same card presentation while preserving its current picker-open behavior.

## Goals

- Use one shared Parent Ticket renderer for both create and issue details/edit sidebars.
- Preserve the current create-ticket appearance and interaction as the canonical design.
- Make the issue details/edit Parent Ticket section visually match the create flow.
- Keep the existing `openParentPicker` message contract unchanged.
- Preserve create-form submission behavior by keeping the hidden input used for the parent field value.

## Non-Goals

- No new parent-picker capabilities or workflow changes.
- No changes to the picker overlay, Jira API calls, or controller message names.
- No unrelated sidebar layout refactors.
- No proactive UI redesign beyond aligning the issue details/edit surface with the approved create-ticket control.

## Current State

### Create Sidebar

`JiraWebviewPanel.renderCreateParentSidebarSection` calls `renderCreateParentFieldInput` and renders:

- A hidden input that stores the Jira create-field value.
- A card-style button with `parent-picker-card`.
- A stable title line: `Choose a parent ticket`.
- A detail line showing either the selected parent summary or the empty-state text.

### Issue Details/Edit Sidebar

`JiraWebviewPanel.renderParentMetadataSection` renders:

- A related-issue button or muted empty text.
- A separate trigger button labeled `Select parent` or `Change parent`.

This creates two independent implementations for the same concept and causes the design mismatch the user reported.

## Proposed Design

### Shared Renderer

Create a focused shared renderer in `src/views/webview/shared-parent-picker.ts` that owns the Parent Ticket card markup.

The renderer will accept a small view model with these responsibilities:

- Section label text for accessibility.
- Parent selection state.
- Detail text content derived from the selected parent or empty state.
- Optional hidden-field metadata for create-form submission.
- Disabled state for create-form submission lockout.

The renderer will return one consistent markup structure that both surfaces can embed.

### Shared Markup Contract

The shared component will render:

- An outer wrapper that remains compatible with existing sidebar section layout.
- An optional hidden input when a field id and value are provided.
- One button using the existing `parent-picker-trigger parent-picker-card` classes.
- A title line fixed to `Choose a parent ticket`.
- A detail line showing either:
  - `<KEY> - <SUMMARY>` when a parent exists.
  - `No parent selected - Unassigned` when no parent exists.

The card remains the only visible control for opening the picker. The issue details/edit surface will no longer render a separate linked parent row plus action button stack.

## Integration Plan

### Create Flow

`renderCreateParentSidebarSection` and `renderCreateAdditionalFieldInput` will continue to detect the Jira parent field exactly as they do now. Instead of directly building the card HTML inline, they will pass data into the shared renderer.

The create flow will still include:

- The hidden `data-create-custom-field` input.
- The current button classes and `data-parent-picker-open` attribute.
- Disabled handling while the create form is submitting.

### Issue Details/Edit Flow

`renderParentMetadataSection` will switch to the shared renderer and provide:

- The current issue parent when present.
- No hidden input.
- No create-form-only field metadata.
- The same `data-parent-picker-open` trigger used today.

The issue details/edit section title remains `Parent Ticket`, but the internal control becomes the same card shown in create.

## Data Flow

- Create sidebar data source: `CreateIssuePanelState.selectedParentIssue` and the Jira create-field value stored in `state.values.customFields`.
- Issue details/edit data source: `JiraIssue.parent`.
- Both views derive display text from the shared renderer input instead of formatting text independently inside `webview.panel.ts`.

## Error Handling

- Empty parent state remains explicit and stable through the card detail line.
- Missing parent summary will fall back to the available key text instead of rendering broken punctuation.
- The shared renderer must continue escaping all user-visible values through the existing HTML helper utilities.

## Testing Strategy

Implementation must follow TDD.

### DOM Tests

Add or update DOM tests to prove:

- The create sidebar still renders the Parent Ticket card and hidden field wiring.
- The issue details/edit sidebar renders the same card structure and no longer depends on the old row-plus-button layout.
- Clicking the card in both surfaces still posts `openParentPicker`.

### Regression Coverage

Keep existing create submission assertions so the shared renderer does not break form payload generation.

## Risks and Mitigations

- Risk: create and issue views drift again if each adds formatting around the shared card.
  - Mitigation: keep title and detail rendering inside the shared renderer, not in each caller.
- Risk: hidden-field handling leaks into the issue details/edit path.
  - Mitigation: model hidden input as optional shared-renderer data and omit it for issue details/edit.
- Risk: tests only verify click behavior and miss visual structure drift.
  - Mitigation: add DOM assertions for shared card classes and text content in both surfaces.

## Implementation Sequence

1. Add a failing DOM test for the issue details/edit sidebar to assert it uses the shared card structure.
2. Refactor the create sidebar card markup behind the shared renderer without changing behavior.
3. Move the issue details/edit sidebar to the same renderer.
4. Run DOM tests covering create and issue sidebars.
5. Run any targeted node tests affected by type or import changes.

# Edit Assignee Title Design

## Goal

Change the assignee card title in the issue-details edit view so it shows `Assignee` when the issue is already assigned, while keeping `Choose an assignee` for unassigned issues and for the create-issue flow.

## Problem

The current assignee card title always reads `Choose an assignee`, even when the issue already has an assignee. In the issue-details edit view, that wording is too action-oriented once a value already exists. The create form should keep the current wording.

## Scope

This change applies only to the issue-details assignee card rendered in the edit/details sidebar.

This change does not alter:

- the create-issue assignee card
- assignee picker modal copy
- assignee submission behavior
- assignee avatars or detail text

## Architecture

The issue-details assignee title is controlled in two places and both must follow the same rule:

- `src/views/webview/webview.panel.ts` renders the initial assignee card title
- `src/views/webview/assignee-picker.overlay.ts` rewrites the visible card after picker selection changes

The shared rule for the issue-details view is:

- assigned issue: title is `Assignee`
- unassigned issue: title is `Choose an assignee`

The create-issue view continues using `Choose an assignee` regardless of whether a create-form draft value exists.

## Components

### Issue Details Assignee Renderer

`src/views/webview/webview.panel.ts`

Update the issue-details assignee card renderer so the title depends on whether the current issue has an assignee label.

### Assignee Picker Sync

`src/views/webview/assignee-picker.overlay.ts`

Update the assignee-card sync logic so applying or clearing an assignee in the issue-details view keeps the same title rule instead of resetting to `Choose an assignee` unconditionally.

The create-form sync path should remain unchanged.

## Data Flow

1. The issue details view renders.
2. If the issue has an assignee, the card title renders as `Assignee`.
3. If the issue has no assignee, the card title renders as `Choose an assignee`.
4. When the user changes or clears the assignee through the picker, the issue-details card title is recalculated with the same rule.
5. The create-issue assignee card keeps its current title behavior.

## Error Handling

No new error handling is required. This is a display-only behavior change.

## Testing

Update DOM coverage to prove:

- issue-details with an existing assignee renders `Assignee`
- issue-details without an assignee still renders `Choose an assignee`
- create-issue still renders `Choose an assignee`
- issue-details assignee card keeps `Assignee` after picker-driven selection updates

Relevant files:

- `tests/dom/issuePanelEditing.dom.test.ts`
- `tests/dom/createIssuePanel.dom.test.ts`

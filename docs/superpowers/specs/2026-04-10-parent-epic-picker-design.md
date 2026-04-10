# Parent Epic Picker Design

## Goal

Make the shared parent selector Epic-only and rename the UI so it consistently communicates `Parent Epic` instead of the broader `Parent Ticket`.

## Problem

The current parent flow is too permissive and too vague:

- the picker searches project issues generally unless an issue type filter is chosen
- the shared card and modal copy say `ticket`, which implies any issue can be selected

In this workflow, parent relationships are always Epics. The extension should reflect that rule directly instead of showing invalid choices and relying on Jira to reject them later.

## Scope

This change applies to the shared parent selection flow used by:

- create issue sidebar
- issue details sidebar parent change flow
- parent picker modal copy and behavior

This change does not alter:

- how the create form detects whether Jira exposes a parent field
- how the selected parent is submitted to Jira
- Jira's final server-side validation

## Architecture

The parent flow remains a shared system, but it becomes an Epic-specific system:

- `ParentIssuePickerController` always searches with `issueTypeName = "Epic"`
- `ParentIssuePickerOverlay` presents Epic-specific copy
- `SharedParentPicker` renders Epic-specific card copy everywhere the shared parent card is used
- create and issue-detail screens keep using the same shared picker entry points

The save contract remains unchanged: the extension still submits Jira's `parent` field, and Jira remains the final validator.

## Components

### Shared Parent Card

`src/views/webview/shared-parent-picker.ts`

Rename the shared card copy from:

- `Choose a parent ticket`
- `No parent selected - Unassigned`

to Epic-specific wording:

- `Choose a parent epic`
- `No parent epic selected - Unassigned`

Any UI that reuses this renderer inherits the wording automatically.

### Parent Picker Modal

`src/views/webview/parent-issue-picker.overlay.ts`

Rename the modal copy from ticket/issue wording to Epic wording, including:

- dialog label
- title
- helper text
- `None` preview and result copy

The modal should read as a dedicated Epic picker, not a generic issue picker.

### Parent Picker Search Enforcement

`src/controllers/parent-issue-picker.controller.ts`

The controller should stop treating issue type as user-chosen for this flow. Instead:

- initialize the picker state with `issueTypeName: "Epic"`
- always pass `issueTypeName: "Epic"` to `fetchProjectIssuesPage`
- ignore any raw `issueTypeName` value coming back from overlay filters for parent searches

Search query and status filtering can remain available. Issue type filtering is no longer part of the user-facing contract for parent selection.

## Data Flow

1. The create form or issue details screen opens the shared parent picker.
2. `ParentIssuePickerController` opens the modal with an Epic-only search state.
3. Every load/search request sends `issueTypeName: "Epic"` to Jira issue search.
4. The user selects an Epic or clears the relationship.
5. The selected Epic key is written back into the shared parent field/card.
6. Save/update still submits Jira's `parent` field exactly as today.

## Error Handling

No new error surfaces are required.

Existing behavior remains:

- if Jira search fails, the modal shows the current picker error banner
- if Jira rejects the selected parent on save, the existing create/update error path handles it

The main UX improvement is preventive: the picker should stop offering non-Epic results in the first place.

## Testing

Add coverage at two levels:

### Copy Contract

Update DOM tests so they assert the new wording:

- `Parent Epic`
- `Choose a parent epic`
- `Select Parent Epic`
- `No parent epic selected`
- `No Parent Epic`

Relevant files:

- `tests/dom/createIssuePanel.dom.test.ts`
- `tests/dom/issuePanelEditing.dom.test.ts`
- any existing parent-picker DOM assertions that reference the old ticket wording

### Search Enforcement

Add a controller-level regression test that proves parent picker searches are always Epic-filtered.

Recommended target:

- a new node test for `ParentIssuePickerController`, or
- an existing test seam around `fetchProjectIssuesPage` request construction if that is cheaper in this repo

The assertion should prove the picker passes `issueTypeName: "Epic"` for initial load and filtered searches.

## Constraints

This design assumes the Jira issue type name is literally `Epic` in the target workflow. If that ever becomes configurable, this implementation should be revisited and driven from project metadata instead of a fixed string.

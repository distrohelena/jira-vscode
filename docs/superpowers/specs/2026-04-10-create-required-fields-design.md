## Summary

The create-issue screen must surface required-field expectations before submit instead of relying on a Jira `400 Bad Request` after the request is already sent. The immediate gap is the `Parent Epic` picker: Jira metadata can mark it required, but the current create UI does not make that obvious and the controller does not block submit when it is empty.

This change keeps the scope narrow:

- create screen only
- required-field indicators only for fields Jira marks required
- submit blocked locally before API calls when required create fields are missing, including the parent picker path
- existing top-level create error surface reused for the message

## Problem

The create issue controller already validates:

- summary is required
- required additional text fields in `values.customFields`

However, the parent picker is rendered through the shared parent-card path and is not treated as part of the explicit create-form required validation contract. In practice that means a required parent can look optional and the user only finds out after Jira rejects the request.

## Goals

- Show a required indicator for required create fields, including `Parent Epic`.
- Stop create submit before the Jira API call when a required parent is missing.
- Use the Jira field name in the error message so the UI and validation language match.
- Preserve current behavior for optional parent fields and non-create screens.

## Non-Goals

- Adding per-field inline validation messages.
- Changing edit-screen validation or behavior.
- Changing Jira-side validation or API payload structure.
- Adding new modal or toast error systems.

## Approach Options

### Option 1: Create-form level validation plus visible required markers

This uses the existing create-panel error contract and extends required validation to the parent field while marking it visually in the form. It is the lowest-risk approach and matches the current summary/custom-field validation style.

### Option 2: Per-field inline validation UI

This would add missing-field styling and inline messages directly next to every control. It improves UX further, but expands the scope into broader UI work that was not requested.

### Option 3: Post-submit error normalization only

This would translate Jira `400` responses into nicer text after failure. It still wastes a request and still hides required state before submit, so it does not solve the core problem.

## Recommended Approach

Use option 1.

The extension already has the required metadata. It should render that state clearly and enforce it locally before calling `createIssue(...)`.

## Architecture

### Webview Rendering

`webview.panel.ts` remains responsible for rendering required indicators in the create form.

Required fields already use the `field-required` suffix when rendered through the additional-field path. The parent create section should follow the same contract instead of hardcoding an unqualified `Parent Epic` label. The parent section title and the parent picker card label should reflect required state when Jira marks the field required.

### Controller Validation

`create-issue.controller.ts` remains the create submission gate.

Validation order should be:

1. Summary
2. Required parent field
3. Other required create fields

The parent check should use Jira create metadata to find the parent field definition and then inspect `values.customFields[parentField.id]`. If the field is required and the stored value is empty after trimming, submit must be blocked before the API call.

### Error Surface

The existing create-panel `error` state remains the only blocking error surface.

When the parent is missing, the message should use the Jira field definition name, for example:

- `Parent Epic is required.`
- `Parent is required.`

This keeps the UI terminology aligned with the field metadata instead of hardcoding a second label in the controller.

## Data Flow

### Render

1. Jira create metadata is loaded.
2. The create panel renders required fields.
3. If the parent field is required, the parent section title and card label show the same required marker contract as other required fields.

### Submit

1. The webview posts `createIssue`.
2. `CreateIssueController` sanitizes the values.
3. Validation runs in the defined order.
4. If required parent metadata exists and the selected parent value is empty, the controller updates panel state with a blocking error and returns without calling Jira.
5. If validation passes, the normal create request continues.

## Edge Cases

- If Jira create metadata does not expose a parent field, no parent validation runs.
- If the parent field exists but is optional, submit behavior remains unchanged.
- If the user clears a previously selected required parent, local validation must still catch it.
- Summary validation remains first, so an empty summary still reports `Summary is required.` before any parent validation message.

## Testing

### DOM Tests

- Required parent fields render a required marker in the create screen.
- Create submit is blocked before the API call when a required parent is missing.
- Optional parent fields do not block submit on that condition.
- Existing required additional-field validation still works.
- Summary validation still takes precedence over parent validation.

### Verification

Run the full project test suite after implementation:

- `npm test`

## Risks

- The parent field is rendered through shared parent-picker helpers, so the create-only required marker must be added without changing edit-screen behavior.
- The controller already has a generic required custom-field path; the parent-specific check must not duplicate or reorder behavior in a way that changes existing field error precedence unexpectedly.

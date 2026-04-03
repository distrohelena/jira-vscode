# Edit Assignee Assign To Me Shared Button Design

## Summary

The create-ticket assignee section already renders the correct `Assign to Me` button treatment. The issue details/edit sidebar renders a separate `Assign to Me` button that works, but it does not match the create experience closely enough and has started to drift visually.

This change will make the edit sidebar reuse the same `Assign to Me` button rendering contract as the create flow so the button looks the same in both places while preserving the edit sidebar's existing assignee-change behavior.

## Goals

- Make the issue details/edit `Assign to Me` button look the same as the create-ticket `Assign to Me` button.
- Establish a single reusable renderer for the `Assign to Me` button markup and styling contract.
- Preserve the edit sidebar's current click behavior and assignee update flow.
- Preserve existing disabled and hover states.

## Non-Goals

- No changes to the assignee picker card layout.
- No change to the edit sidebar's underlying assignee update request path.
- No broader assignee-flow unification between create and edit.
- No unrelated sidebar spacing or styling changes.

## Current State

- The create-ticket assignee section renders an `Assign to Me` button using the desired appearance.
- The issue details/edit sidebar renders its own separate `Assign to Me` button markup.
- Both surfaces share broad CSS selectors for button styling, but the rendering paths remain separate, which makes visual drift easy to introduce.

## Proposed Change

- Extract a shared renderer for the `Assign to Me` button markup so create and edit both render through the same visual contract.
- Keep the renderer focused on button structure, classes, label text, disabled state, and shared data attributes needed by the caller.
- Let each surface continue to supply its own behavioral attributes:
  - create keeps its current local-selection metadata attributes
  - edit keeps its current issue-key and direct assignee-change attributes
- Update the issue details/edit assignee section to use the shared renderer instead of bespoke button markup.
- Leave the existing create-ticket button behavior unchanged except for moving it onto the shared renderer.

## Testing

- Add DOM coverage that verifies create and edit render the same shared `Assign to Me` button class/markup contract.
- Keep or add edit-side coverage proving the button still triggers the existing edit assignee action.
- Run the relevant DOM test suites for create and issue-panel rendering after the change.

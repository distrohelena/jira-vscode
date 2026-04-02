# Issue Sidebar Hover Cursor Design

## Summary

The issue details/edit sidebar renders interactive Parent Ticket and Assignee controls using card-style buttons, but those controls do not currently show a pointer cursor on hover in the issue sidebar path. The create-ticket flow already behaves correctly and should remain unchanged.

This change will add pointer-cursor hover behavior only to the issue details/edit sidebar Parent Ticket and Assignee interactive controls.

## Goals

- Show a pointer cursor when hovering the issue details/edit Parent Ticket control.
- Show a pointer cursor when hovering the issue details/edit Assignee control.
- Leave create-ticket controls unchanged.
- Preserve disabled-state behavior.

## Non-Goals

- No markup changes unless required for a targeted style hook.
- No behavioral changes to picker opening, navigation, or layout.
- No style changes to non-interactive metadata rows.

## Current State

- The create-ticket parent and assignee card controls already present the expected pointer affordance.
- The issue details/edit sidebar reuses similar card-style controls for Parent Ticket and Assignee, but the hover cursor does not currently reflect that they are interactive.

## Proposed Change

- Add or refine CSS for the issue details/edit sidebar interactive card controls so the pointer cursor appears on hover-capable interactive states.
- Scope the rule to the edit/details sidebar parent and assignee triggers only.
- Keep disabled styles as-is so disabled controls do not misleadingly show as clickable.

## Testing

- Run focused DOM coverage for the create and issue panel suites to ensure the style change does not disturb existing structure or picker wiring.
- If practical, add a small assertion tied to the relevant style block; otherwise rely on focused regression verification.

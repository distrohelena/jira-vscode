# Rich Text Toolbar Hover Design

## Goal

Add visible hover color feedback to the shared rich text toolbar so both formatting buttons and the `Wiki`/`Visual` toggle feel interactive across every rich text field.

## Scope

This change applies only to the shared rich text editor shell in `src/views/webview/editors/rich-text-editor.view.ts`.

It does not change:

- toolbar layout
- command behavior
- pressed-state behavior
- disabled-state behavior
- any non-rich-text buttons elsewhere in the webview

## Design

The shared editor stylesheet will add `:hover:not(:disabled)` rules for:

- `.jira-rich-editor-button`
- `.jira-rich-editor-secondary-button`

The hover state will:

- change background color using VS Code theme-aware variables
- change border color so the compact buttons read as interactive
- keep text color readable on hover

The pressed state on `.jira-rich-editor-button[aria-pressed='true']` remains stronger than hover so active formatting still reads as active. Disabled buttons remain unchanged.

## Styling Contract

Hover styling uses the existing VS Code-style theme fallback chain:

- `background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.08)))`
- `border-color: var(--vscode-focusBorder, transparent)`
- `color: var(--vscode-foreground)`

This keeps the toolbar aligned with the rest of the extension without introducing a custom accent system.

## Testing

Add a DOM-level style contract assertion in `tests/dom/richTextEditorView.dom.test.ts` that checks the shared stylesheet contains hover selectors for both toolbar button classes.

No controller or integration logic changes are required.

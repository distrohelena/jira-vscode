# Rich Text Toolbar Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add theme-aware hover color feedback to both rich text formatting buttons and the shared `Wiki`/`Visual` toggle across every rich text field.

**Architecture:** Keep this change inside the shared editor shell so every comment and description editor inherits it automatically. Use one DOM style-contract test to pin the hover selectors, then add the minimal shared CSS rules in the view stylesheet without touching runtime controller logic.

**Tech Stack:** TypeScript, shared webview CSS string rendering, Vitest DOM tests

---

## File Structure

- Modify: `src/views/webview/editors/rich-text-editor.view.ts`
  Purpose: add hover styling for `.jira-rich-editor-button` and `.jira-rich-editor-secondary-button` in the shared rich text editor stylesheet.
- Modify: `tests/dom/richTextEditorView.dom.test.ts`
  Purpose: lock the shared hover-style contract so both toolbar button types keep visible hover styling.

### Task 1: Add Shared Toolbar Hover Styling

**Files:**
- Modify: `src/views/webview/editors/rich-text-editor.view.ts`
- Test: `tests/dom/richTextEditorView.dom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('renders hover styling for both toolbar button types in the shared stylesheet', () => {
	const styles = RichTextEditorView.renderStyles();

	expect(styles).toMatch(
		/\.jira-rich-editor-button:hover:not\(:disabled\)[\s\S]*background:\s*var\(--vscode-toolbar-hoverBackground,\s*var\(--vscode-button-secondaryHoverBackground,\s*rgba\(255,\s*255,\s*255,\s*0\.08\)\)\);/
	);
	expect(styles).toMatch(
		/\.jira-rich-editor-button:hover:not\(:disabled\)[\s\S]*border-color:\s*var\(--vscode-focusBorder,\s*transparent\);/
	);
	expect(styles).toMatch(
		/\.jira-rich-editor-secondary-button:hover:not\(:disabled\)[\s\S]*background:\s*var\(--vscode-toolbar-hoverBackground,\s*var\(--vscode-button-secondaryHoverBackground,\s*rgba\(255,\s*255,\s*255,\s*0\.08\)\)\);/
	);
	expect(styles).toMatch(
		/\.jira-rich-editor-secondary-button:hover:not\(:disabled\)[\s\S]*border-color:\s*var\(--vscode-focusBorder,\s*transparent\);/
	);
	expect(styles).toMatch(
		/\.jira-rich-editor-secondary-button:hover:not\(:disabled\)[\s\S]*color:\s*var\(--vscode-foreground\);/
	);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts`

Expected: FAIL because `renderStyles()` does not yet include `:hover:not(:disabled)` rules for the shared toolbar buttons.

- [ ] **Step 3: Write the minimal implementation**

Update `RichTextEditorView.renderStyles()` in `src/views/webview/editors/rich-text-editor.view.ts` by adding these rules immediately after the base button declarations:

```ts
		.jira-rich-editor-button:hover:not(:disabled) {
			background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.08)));
			border-color: var(--vscode-focusBorder, transparent);
			color: var(--vscode-foreground);
		}
```

```ts
		.jira-rich-editor-secondary-button:hover:not(:disabled) {
			background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.08)));
			border-color: var(--vscode-focusBorder, transparent);
			color: var(--vscode-foreground);
		}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts`

Expected: PASS with the shared stylesheet now exposing hover selectors for both toolbar button types.

- [ ] **Step 5: Run the broader verification**

Run:

```bash
npm run test:dom
npm run bundle
```

Expected:
- `npm run test:dom` passes with `0` failures
- `npm run bundle` exits `0`

- [ ] **Step 6: Commit**

```bash
git add src/views/webview/editors/rich-text-editor.view.ts tests/dom/richTextEditorView.dom.test.ts
git commit -m "style: add rich text toolbar hover feedback"
```

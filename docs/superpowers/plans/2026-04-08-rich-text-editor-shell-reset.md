# Rich Text Editor Shell Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible shared rich text editor shell with a compact, utilitarian Tiptap UI that no longer feels like the legacy editor.

**Architecture:** Keep the shared Tiptap engine, registry, and Jira wiki codec in place, but replace the host shell contract rendered by `RichTextEditorView`. Trim the toolbar/controller contract to the v1 command set plus one right-side `Wiki`/`Visual` toggle button, and update panel reset logic plus DOM tests so every editor surface uses the new shell consistently.

**Tech Stack:** TypeScript, Tiptap, VS Code webviews, Vitest, JSDOM.

---

## File Map

- `src/views/webview/editors/rich-text-editor.view.ts`
  - Owns the new shared shell markup and styles for all editor instances.
- `src/views/webview/editors/rich-text-toolbar.controller.ts`
  - Owns button lookup, active-state refresh, and the single secondary mode toggle action.
- `src/views/webview/editors/rich-text-editor.controller.ts`
  - Owns Tiptap lifecycle, canonical wiki synchronization, and visual/wiki mode switching.
- `src/views/webview/webview.panel.ts`
  - Owns panel-level cancel/reset behavior that still assumes the removed dual mode buttons.
- `tests/dom/support/richTextEditorDomTestHarness.ts`
  - Exposes selectors and helpers for the new shell contract.
- `tests/dom/richTextEditorView.dom.test.ts`
  - Verifies the shell markup and hidden-field contract.
- `tests/dom/richTextEditorController.dom.test.ts`
  - Verifies mode switching, hidden value synchronization, and inactive toolbar defaults.
- `tests/dom/richTextEditor.dom.test.ts`
  - Verifies the shared shell inside the issue panel comment editor.
- `tests/dom/issuePanelEditing.dom.test.ts`
  - Verifies comment edit and description edit integration against the new shell.
- `tests/dom/createIssuePanel.dom.test.ts`
  - Verifies create-issue description uses the new shell.

## Task 1: Lock The New Shell Contract In View Tests

**Files:**
- Modify: `tests/dom/richTextEditorView.dom.test.ts`
- Modify: `src/views/webview/editors/rich-text-editor.view.ts`
- Test: `tests/dom/richTextEditorView.dom.test.ts`

- [ ] **Step 1: Write the failing view-contract test**

```ts
it('renders the compact shell with one secondary wiki toggle instead of dual mode buttons', () => {
	const host = document.createElement('div');
	host.innerHTML = RichTextEditorView.render({
		fieldId: 'description',
		fieldName: 'description',
		value: 'Existing description',
		plainValue: 'Existing description',
		placeholder: 'Describe the issue',
	});

	const editor = host.querySelector('[data-jira-rich-editor]') as HTMLElement | null;
	const primaryActions = host.querySelector('.jira-rich-editor-primary-actions') as HTMLElement | null;
	const secondaryActions = host.querySelector('.jira-rich-editor-secondary-actions') as HTMLElement | null;
	const commandButtons = host.querySelectorAll('.jira-rich-editor-button[data-command]');
	const wikiToggleButton = host.querySelector(
		'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
	) as HTMLButtonElement | null;

	expect(editor).toBeTruthy();
	expect(editor?.getAttribute('data-mode')).toBe('visual');
	expect(primaryActions).toBeTruthy();
	expect(secondaryActions).toBeTruthy();
	expect(commandButtons).toHaveLength(6);
	expect(host.querySelector('.jira-rich-editor-mode-button')).toBeNull();
	expect(wikiToggleButton).toBeTruthy();
	expect(wikiToggleButton?.textContent?.trim()).toBe('Wiki');
	expect(wikiToggleButton?.getAttribute('data-target-mode')).toBe('wiki');
});
```

- [ ] **Step 2: Run the view test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts`

Expected: FAIL because `.jira-rich-editor-primary-actions` and `.jira-rich-editor-secondary-button` do not exist yet, and `.jira-rich-editor-mode-button` is still rendered.

- [ ] **Step 3: Rebuild the shared shell markup and styles in `RichTextEditorView`**

```ts
static render(options: RichTextEditorViewOptions): string {
	const mode = options.mode ?? 'visual';
	const disabledAttr = options.disabled ? 'disabled' : '';
	const fieldId = HtmlHelper.escapeAttribute(options.fieldId);
	const fieldName = HtmlHelper.escapeAttribute(options.fieldName);
	const placeholder = HtmlHelper.escapeAttribute(options.placeholder);
	const value = HtmlHelper.escapeHtml(options.value);
	const plainValue = HtmlHelper.escapeHtml(options.plainValue);
	const secondaryLabel = mode === 'wiki' ? 'Visual' : 'Wiki';
	const targetMode = mode === 'wiki' ? 'visual' : 'wiki';
	const secondaryAria = mode === 'wiki' ? 'Switch to visual mode' : 'Switch to wiki mode';

	return `<div class="jira-rich-editor-host" data-jira-rich-editor data-mode="${HtmlHelper.escapeAttribute(mode)}">
	<div class="jira-rich-editor-toolbar" role="toolbar" aria-label="Rich text editor formatting">
		<div class="jira-rich-editor-primary-actions">
			${RichTextEditorView.renderToolbarButton('bold', 'B', 'Bold', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('italic', 'I', 'Italic', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('underline', 'U', 'Underline', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('link', 'Link', 'Insert link', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('bulletList', 'Bullet list', 'Bullet list', disabledAttr)}
			${RichTextEditorView.renderToolbarButton('orderedList', '1. List', 'Numbered list', disabledAttr)}
		</div>
		<div class="jira-rich-editor-secondary-actions">
			<button
				type="button"
				class="jira-rich-editor-secondary-button"
				data-secondary-action="toggleMode"
				data-target-mode="${HtmlHelper.escapeAttribute(targetMode)}"
				aria-label="${HtmlHelper.escapeAttribute(secondaryAria)}"
				${disabledAttr}
			>${HtmlHelper.escapeHtml(secondaryLabel)}</button>
		</div>
	</div>
	<div class="jira-rich-editor-frame">
		<div
			class="jira-rich-editor-surface jira-rich-editor-visual"
			data-rich-editor-surface
			contenteditable="${options.disabled ? 'false' : 'true'}"
			data-placeholder="${placeholder}"
			id="${fieldId}-visual"
			role="textbox"
			aria-multiline="true"
		></div>
		<textarea class="jira-rich-editor-plain" id="${fieldId}-plain" placeholder="${placeholder}" aria-label="Wiki markup fallback" ${disabledAttr}>${plainValue}</textarea>
	</div>
	<textarea class="jira-rich-editor-value" id="${fieldId}" name="${fieldName}" hidden ${disabledAttr} aria-hidden="true">${value}</textarea>
</div>`;
}
```

```ts
static renderStyles(): string {
	return `
		.jira-rich-editor-host {
			display: grid;
			gap: 0;
			min-width: 0;
			color: var(--vscode-foreground);
		}
		.jira-rich-editor-toolbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			min-height: 40px;
			padding: 6px 8px;
			border: 1px solid var(--vscode-input-border);
			border-bottom: none;
			border-radius: 6px 6px 0 0;
			background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-sideBar-background) 10%);
		}
		.jira-rich-editor-primary-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			min-width: 0;
		}
		.jira-rich-editor-secondary-actions {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			flex: 0 0 auto;
		}
		.jira-rich-editor-frame {
			border: 1px solid var(--vscode-input-border);
			border-radius: 0 0 6px 6px;
			background: var(--vscode-input-background);
			overflow: hidden;
		}
		.jira-rich-editor-button,
		.jira-rich-editor-secondary-button {
			min-height: 28px;
			padding: 4px 9px;
			border-radius: 4px;
			border: 1px solid transparent;
			background: transparent;
			color: var(--vscode-foreground);
			font: inherit;
			cursor: pointer;
		}
		.jira-rich-editor-secondary-button {
			color: var(--vscode-descriptionForeground);
		}
	`;
}
```

- [ ] **Step 4: Run the view test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts`

Expected: PASS with both view tests green.

- [ ] **Step 5: Commit the shell-contract reset**

```bash
git add tests/dom/richTextEditorView.dom.test.ts src/views/webview/editors/rich-text-editor.view.ts
git commit -m "feat: rebuild compact rich text editor shell"
```

## Task 2: Replace Dual Mode Buttons With One Secondary Toggle

**Files:**
- Modify: `tests/dom/support/richTextEditorDomTestHarness.ts`
- Modify: `tests/dom/richTextEditorController.dom.test.ts`
- Modify: `src/views/webview/editors/rich-text-toolbar.controller.ts`
- Modify: `src/views/webview/editors/rich-text-editor.controller.ts`
- Test: `tests/dom/richTextEditorController.dom.test.ts`

- [ ] **Step 1: Write the failing controller-mode test and harness helper**

```ts
getModeToggleButton(): HTMLButtonElement {
	const button = this.host.querySelector(
		'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
	);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error('The mode toggle button was not rendered.');
	}

	return button;
}
```

```ts
it('uses one secondary button to round-trip wiki mode changes back into the hidden value field', () => {
	const harness = new RichTextEditorDomTestHarness({
		value: '',
		plainValue: '',
	});

	harness.initialize();
	harness.click(harness.getModeToggleButton());
	expect(harness.host.getAttribute('data-mode')).toBe('wiki');
	expect(harness.getModeToggleButton().textContent?.trim()).toBe('Visual');

	harness.setWikiValue('*bold* _italic_');
	harness.click(harness.getModeToggleButton());

	expect(harness.host.getAttribute('data-mode')).toBe('visual');
	expect(harness.mountedSurface.innerHTML).toContain('<strong>bold</strong>');
	expect(harness.mountedSurface.innerHTML).toContain('<em>italic</em>');
	expect(harness.hiddenValueField.value).toBe('*bold* _italic_');
	expect(harness.getModeToggleButton().textContent?.trim()).toBe('Wiki');
});
```

- [ ] **Step 2: Run the controller suite to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorController.dom.test.ts`

Expected: FAIL because the toolbar controller still requires `.jira-rich-editor-mode-button[data-mode="visual"]` and `.jira-rich-editor-mode-button[data-mode="wiki"]`.

- [ ] **Step 3: Trim the toolbar/controller contract to one secondary toggle**

```ts
export type RichTextToolbarControllerOptions = {
	isCommandActive: (command: RichTextToolbarCommand) => boolean;
	getCurrentMode: () => RichTextEditorViewMode;
	onCommandRequested: (command: RichTextToolbarCommand) => void;
	onModeToggleRequested: () => void;
};
```

```ts
private readonly modeToggleButton: HTMLButtonElement;

constructor(toolbarElement: HTMLElement, options: RichTextToolbarControllerOptions) {
	this.toolbarElement = toolbarElement;
	this.options = options;
	this.commandButtons = this.resolveCommandButtons();
	this.modeToggleButton = this.resolveButton(
		'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
	);
	this.toolbarElement.addEventListener('click', this.handleToolbarClick.bind(this));
	this.refreshState();
}

refreshState(): void {
	for (const [command, button] of this.commandButtons) {
		button.setAttribute('aria-pressed', this.options.isCommandActive(command) ? 'true' : 'false');
	}

	const currentMode = this.options.getCurrentMode();
	const targetMode = currentMode === 'wiki' ? 'visual' : 'wiki';
	this.modeToggleButton.textContent = currentMode === 'wiki' ? 'Visual' : 'Wiki';
	this.modeToggleButton.setAttribute('data-target-mode', targetMode);
	this.modeToggleButton.setAttribute(
		'aria-label',
		currentMode === 'wiki' ? 'Switch to visual mode' : 'Switch to wiki mode'
	);
}
```

```ts
private handleToolbarClick(event: Event): void {
	const target = event.target;
	if (!(target instanceof Element)) {
		return;
	}

	const button = target.closest('button');
	if (!(button instanceof HTMLButtonElement) || button.disabled) {
		return;
	}

	const command = button.getAttribute('data-command');
	if (this.isToolbarCommand(command)) {
		this.options.onCommandRequested(command);
		return;
	}

	if (button.getAttribute('data-secondary-action') === 'toggleMode') {
		this.options.onModeToggleRequested();
	}
}
```

```ts
this.toolbarController = new RichTextToolbarController(this.toolbarElement, {
	isCommandActive: this.isCommandActive.bind(this),
	getCurrentMode: this.getCurrentMode.bind(this),
	onCommandRequested: this.executeCommand.bind(this),
	onModeToggleRequested: this.toggleMode.bind(this),
});

private toggleMode(): void {
	this.setMode(this.currentMode === 'wiki' ? 'visual' : 'wiki');
}
```

- [ ] **Step 4: Run the controller suite to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorController.dom.test.ts`

Expected: PASS with all controller tests green.

- [ ] **Step 5: Commit the single-toggle behavior**

```bash
git add tests/dom/support/richTextEditorDomTestHarness.ts tests/dom/richTextEditorController.dom.test.ts src/views/webview/editors/rich-text-toolbar.controller.ts src/views/webview/editors/rich-text-editor.controller.ts
git commit -m "refactor: replace rich text mode buttons with one toggle"
```

## Task 3: Update Issue Panel And Create Panel Integration

**Files:**
- Modify: `tests/dom/richTextEditor.dom.test.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Test: `tests/dom/richTextEditor.dom.test.ts`
- Test: `tests/dom/issuePanelEditing.dom.test.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Write the failing integration assertions for the new shell**

```ts
expect(commentForm?.querySelector('.jira-rich-editor-button[data-command="bold"]')).toBeTruthy();
expect(commentForm?.querySelector('.jira-rich-editor-button[data-command="orderedList"]')).toBeTruthy();
expect(commentForm?.querySelector('.jira-rich-editor-mode-button')).toBeNull();
expect(
	commentForm?.querySelector('.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]')
).toBeTruthy();
```

```ts
it('restores the original description value when cancel is pressed after entering wiki mode', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		description: 'Original description text',
		descriptionHtml: '<p>Original description text</p>',
	});
	expect(scriptErrors).toEqual([]);

	const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element;
	IssuePanelTestHarness.click(descriptionDisplay, dom.window);

	const toggleButton = dom.window.document.querySelector(
		'.jira-description-editor .jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
	) as HTMLButtonElement | null;
	const plainTextarea = dom.window.document.querySelector(
		'.jira-description-editor .jira-rich-editor-plain'
	) as HTMLTextAreaElement | null;
	const cancelButton = dom.window.document.querySelector('.jira-description-cancel') as HTMLButtonElement | null;

	toggleButton!.click();
	plainTextarea!.value = 'Changed from wiki mode';
	plainTextarea!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
	cancelButton!.click();

	expect(plainTextarea!.value).toBe('Original description text');
});
```

- [ ] **Step 2: Run the integration suites to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: FAIL because the tests now expect `.jira-rich-editor-secondary-button`, and description cancel logic in `webview.panel.ts` still tries to click the removed dual mode buttons.

- [ ] **Step 3: Update panel reset logic to use host `data-mode` plus the new single toggle button**

```ts
const resetDescriptionEditor = () => {
	if (
		!(descriptionHost instanceof HTMLElement) ||
		!(descriptionPlain instanceof HTMLTextAreaElement) ||
		!(descriptionValue instanceof HTMLTextAreaElement)
	) {
		return;
	}

	const modeToggleButton = descriptionHost.querySelector(
		'.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
	);
	const ensureMode = (mode: 'visual' | 'wiki') => {
		const currentMode = descriptionHost.getAttribute('data-mode') === 'wiki' ? 'wiki' : 'visual';
		if (currentMode !== mode && modeToggleButton instanceof HTMLButtonElement) {
			modeToggleButton.click();
		}
	};

	ensureMode('wiki');
	descriptionPlain.value = originalDescription;
	descriptionValue.value = originalDescription;
	descriptionPlain.dispatchEvent(new Event('input', { bubbles: true }));
	ensureMode('visual');
};
```

```ts
expect(descriptionEditor?.querySelector('.jira-rich-editor-mode-button')).toBeNull();
expect(
	descriptionEditor?.querySelector('.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]')
).toBeTruthy();
```

- [ ] **Step 4: Run the focused integration suites to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: PASS with the shared shell assertions and the new description cancel test green.

- [ ] **Step 5: Run broad verification**

Run: `npm run test:dom`

Expected: PASS with all DOM suites green.

Run: `npm run bundle`

Expected: PASS with rebuilt `dist/extension.js` and `dist/webview/rich-text-editor.js`.

- [ ] **Step 6: Commit the integrated shell reset**

```bash
git add tests/dom/richTextEditor.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts src/views/webview/webview.panel.ts
git commit -m "feat: ship compact shared rich text editor shell"
```

## Self-Review

### Spec Coverage

- Shared compact shell across comment, comment edit, description, and create description: covered by Tasks 1 and 3.
- Fixed top toolbar with only the v1 commands: covered by Tasks 1 and 2.
- Secondary right-side `Wiki` action instead of dual mode buttons: covered by Tasks 1, 2, and 3.
- Stable one-container visual/wiki switching: covered by Tasks 2 and 3.
- No layout-jump legacy shell assumptions in tests: covered by Tasks 1 and 3.

### Placeholder Scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Every task includes exact file paths, concrete code snippets, exact test commands, and expected results.

### Type And Contract Consistency

- The plan consistently uses `data-secondary-action="toggleMode"` for the right-side button.
- The plan consistently uses host `data-mode="visual|wiki"` as the mode source of truth.
- The plan consistently keeps `.jira-rich-editor-value` as the canonical submitted wiki field.

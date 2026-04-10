# Rich Text Mention Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first `Search...` option to every visual-mode `@` popup that opens the existing custom people-search modal and inserts a real Jira mention after the user confirms a person.

**Architecture:** Keep the current shared mention popup and real ADF mention insertion path, but extend it with one synthetic action row. Reuse the existing assignee picker overlay shell in a mention-search mode instead of building a second large-search UI, and route the selected user back to the originating rich text editor through the existing webview message bridge.

**Tech Stack:** TypeScript, VS Code webview messaging, Tiptap rich text editor, Vitest DOM tests, Node test runner

---

## File Structure

- Modify: `src/views/webview/editors/rich-text-mention.controller.ts`
  Purpose: render the synthetic `Search...` row first, open mention search from the active `@query`, and insert a returned candidate into the stored query range.
- Modify: `src/views/webview/editors/rich-text-mention-host.bridge.ts`
  Purpose: bridge mention-search open requests and resolved selections between one rich text host and the outer webview script.
- Modify: `src/views/webview/assignee-picker.overlay.ts`
  Purpose: add a mention-search presentation mode that reuses the custom people-search modal shell with mention-specific copy and no `None` option.
- Modify: `src/controllers/assignee-picker.controller.ts`
  Purpose: accept mention-search requests with initial query text and a mode-specific overlay contract while still supporting assignee selection.
- Modify: `src/controllers/issue.controller.ts`
  Purpose: open the mention-search modal for issue-bound editors, seed the search box from the active `@query`, and post the selected user back to the originating editor.
- Modify: `src/controllers/create-issue.controller.ts`
  Purpose: open the mention-search modal for create-issue editors and post the selected user back to the originating editor.
- Modify: `src/views/webview/webview.panel.ts`
  Purpose: forward mention-search open requests from the editor hosts to the extension side and route mention-search selection messages back to the correct editor host.
- Modify: `tests/dom/richTextMentionController.dom.test.ts`
  Purpose: cover `Search...` rendering, keyboard selection, and insertion after modal-style resolution.
- Modify: `tests/dom/richTextEditor.dom.test.ts`
  Purpose: verify the shared issue-comment webview bridge forwards mention-search requests and routes selections back to the originating editor host.
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
  Purpose: verify the create-issue description editor forwards mention-search requests and routes selections back to the correct host.
- Modify: `tests/node/issueController.node.test.ts`
  Purpose: verify issue-bound mention search opens with the typed query and returns a real mention candidate message.
- Modify: `tests/node/createIssueController.node.test.ts`
  Purpose: verify create-issue mention search opens with the typed query and returns a real mention candidate message.

### Task 1: Add `Search...` to the shared mention popup

**Files:**
- Modify: `src/views/webview/editors/rich-text-mention.controller.ts`
- Modify: `src/views/webview/editors/rich-text-mention-host.bridge.ts`
- Test: `tests/dom/richTextMentionController.dom.test.ts`

- [ ] **Step 1: Write the failing DOM tests**

```ts
it('renders Search as the first mention option and opens mention search with the active query', async () => {
	const harness = createRichTextEditorDomTestHarness();
	harness.setVisualMode(true);
	harness.focusEditor();
	harness.insertText('@hel');

	let searchRequest: { editorId?: string; query?: string } | undefined;
	harness.host.addEventListener('jira-rich-editor-mention-search-open', ((event: Event) => {
		const customEvent = event as CustomEvent<{ editorId?: string; query?: string }>;
		searchRequest = customEvent.detail;
	}) as EventListener);
	harness.host.addEventListener('jira-rich-editor-mention-query', ((event: Event) => {
		const customEvent = event as CustomEvent<{ requestId: string }>;
		harness.host.dispatchEvent(new CustomEvent('jira-rich-editor-mention-results', {
			detail: {
				requestId: customEvent.detail.requestId,
				candidates: [
					{
						accountId: 'acct-1',
						displayName: 'Helena',
						mentionText: '@Helena',
						userType: 'DEFAULT',
						source: 'assignable',
					},
				],
			},
		}));
	}) as EventListener);

	harness.refreshMentionPopup();

	const options = harness.getMentionOptionButtons();
	expect(options[0]?.textContent).toBe('Search...');

	options[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

	expect(searchRequest).toEqual({
		editorId: harness.host.getAttribute('data-editor-id'),
		query: 'hel',
	});
});

it('inserts a real mention when mention search resolves a selected user', async () => {
	const harness = createRichTextEditorDomTestHarness();
	harness.setVisualMode(true);
	harness.focusEditor();
	harness.insertText('@hel');

	harness.host.addEventListener('jira-rich-editor-mention-query', ((event: Event) => {
		const customEvent = event as CustomEvent<{ requestId: string }>;
		harness.host.dispatchEvent(new CustomEvent('jira-rich-editor-mention-results', {
			detail: {
				requestId: customEvent.detail.requestId,
				candidates: [],
			},
		}));
	}) as EventListener);

	harness.refreshMentionPopup();
	harness.host.dispatchEvent(new CustomEvent('jira-rich-editor-mention-search-selected', {
		detail: {
			accountId: 'acct-1',
			displayName: 'Helena',
			mentionText: '@Helena',
			userType: 'DEFAULT',
		},
	}));

	expect(harness.getAdfValueField().value).toContain('"type":"mention"');
	expect(harness.getProseMirrorText()).toContain('@Helena');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextMentionController.dom.test.ts`
Expected: FAIL because the popup does not render `Search...`, does not emit a mention-search event, and ignores the selection event.

- [ ] **Step 3: Write the minimal mention-popup implementation**

```ts
type RichTextMentionPopupOption =
	| { kind: 'search' }
	| { kind: 'candidate'; candidate: RichTextMentionCandidate };

private buildPopupOptions(): RichTextMentionPopupOption[] {
	return [{ kind: 'search' }, ...this.candidates.map((candidate) => ({ kind: 'candidate', candidate }))];
}

private handleSearchSelection(): void {
	if (!this.activeQuery) {
		return;
	}

	this.hostBridge.openMentionSearch(this.editorId, this.activeQuery.query);
	this.closePopup();
}

private handleMentionSearchSelected(candidate: RichTextMentionCandidate): void {
	if (!this.activeQuery) {
		return;
	}

	this.insertCandidate(candidate);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextMentionController.dom.test.ts`
Expected: PASS with the new search-first popup behavior and selection insertion.

- [ ] **Step 5: Commit**

```bash
git add src/views/webview/editors/rich-text-mention.controller.ts src/views/webview/editors/rich-text-mention-host.bridge.ts tests/dom/richTextMentionController.dom.test.ts
git commit -m "feat: add search option to rich text mention popup"
```

### Task 2: Bridge mention-search requests through the shared webview script

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Test: `tests/dom/richTextEditor.dom.test.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Write the failing webview bridge tests**

```ts
it('forwards mention search requests from the shared comment editor and routes selected users back to the same host', () => {
	const { dom, host, messages } = renderSharedCommentEditor();

	host.dispatchEvent(new dom.window.CustomEvent('jira-rich-editor-mention-search-open', {
		bubbles: true,
		detail: {
			editorId: 'comment-editor',
			query: 'hel',
		},
	}));

	const openMessage = messages.find((message) => message?.type === 'openRichTextMentionSearch');
	expect(openMessage).toEqual({
		type: 'openRichTextMentionSearch',
		editorId: 'comment-editor',
		query: 'hel',
	});

	let selectionDetail: any;
	host.addEventListener('jira-rich-editor-mention-search-selected', ((event: Event) => {
		selectionDetail = (event as CustomEvent).detail;
	}) as EventListener);

	dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
		data: {
			type: 'richTextMentionSearchSelectionApplied',
			editorId: 'comment-editor',
			candidate: {
				accountId: 'acct-1',
				displayName: 'Helena',
				mentionText: '@Helena',
				userType: 'DEFAULT',
			},
		},
	}));

	expect(selectionDetail.accountId).toBe('acct-1');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`
Expected: FAIL because the webview script does not forward `jira-rich-editor-mention-search-open` or dispatch selection events back to the host.

- [ ] **Step 3: Write the minimal bridge implementation**

```ts
const forwardMentionSearchOpen = (event) => {
	const detail = event?.detail;
	if (!detail) {
		return;
	}

	vscode.postMessage({
		type: 'openRichTextMentionSearch',
		editorId: typeof detail.editorId === 'string' ? detail.editorId : undefined,
		query: typeof detail.query === 'string' ? detail.query : '',
	});
};

const dispatchMentionSearchSelection = (message) => {
	if (message?.type !== 'richTextMentionSearchSelectionApplied') {
		return;
	}

	targetHost.dispatchEvent(new CustomEvent('jira-rich-editor-mention-search-selected', {
		detail: message.candidate,
	}));
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`
Expected: PASS with both issue and create-issue webview bridges forwarding search opens and routing selections back to the correct editor host.

- [ ] **Step 5: Commit**

```bash
git add src/views/webview/webview.panel.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts
git commit -m "feat: bridge mention search through webview hosts"
```

### Task 3: Reuse the custom people-search modal for mention search

**Files:**
- Modify: `src/views/webview/assignee-picker.overlay.ts`
- Modify: `src/controllers/assignee-picker.controller.ts`
- Test: `tests/node/issueController.node.test.ts`
- Test: `tests/node/createIssueController.node.test.ts`

- [ ] **Step 1: Write the failing controller tests**

```ts
test('issue controller opens mention search with the typed query and posts the selected user back to the editor', async () => {
	const panel = createPanelDouble();
	const pickerRequests: any[] = [];
	let resolveSelection: ((value: any) => void) | undefined;

	const controller = createIssueController({
		panel,
		assigneePicker: {
			pickAssignee(request) {
				pickerRequests.push(request);
				return {
					promise: new Promise((resolve) => {
						resolveSelection = resolve;
					}),
					handleMessage: async () => false,
					dispose() {},
				};
			},
		},
	});

	await panel.receiveMessage({
		type: 'openRichTextMentionSearch',
		editorId: 'comment-editor',
		query: 'hel',
	});

	assert.equal(pickerRequests[0]?.mode, 'mention');
	assert.equal(pickerRequests[0]?.initialSearchQuery, 'hel');

	resolveSelection?.({
		kind: 'user',
		user: { accountId: 'acct-1', displayName: 'Helena', avatarUrl: '' },
	});
	await Promise.resolve();

	assert.deepEqual(panel.postedMessages.at(-1), {
		type: 'richTextMentionSearchSelectionApplied',
		editorId: 'comment-editor',
		candidate: {
			accountId: 'acct-1',
			displayName: 'Helena',
			mentionText: '@Helena',
			userType: 'DEFAULT',
			avatarUrl: '',
			source: 'assignable',
		},
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts`
Expected: FAIL because the controllers do not recognize `openRichTextMentionSearch`, the picker request has no mention mode, and no selection message is posted back to the editor.

- [ ] **Step 3: Write the minimal modal/controller implementation**

```ts
export type AssigneePickerMode = 'assignee' | 'mention';

export type AssigneePickerRequest = {
	mode?: AssigneePickerMode;
	initialSearchQuery?: string;
	editorId?: string;
	// existing fields...
};

const overlayTitle = request.mode === 'mention' ? 'Search People' : 'Select Assignee';
const confirmLabel = request.mode === 'mention' ? 'Insert Mention' : 'Use Assignee';
const includeNoneOption = request.mode !== 'mention';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts`
Expected: PASS with both controllers opening mention search in modal mode and posting a selected user back to the originating editor.

- [ ] **Step 5: Commit**

```bash
git add src/views/webview/assignee-picker.overlay.ts src/controllers/assignee-picker.controller.ts src/controllers/issue.controller.ts src/controllers/create-issue.controller.ts tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts
git commit -m "feat: reuse people search modal for mention selection"
```

### Task 4: Run the end-to-end mention-search verification suite

**Files:**
- Modify: `docs/superpowers/plans/2026-04-10-rich-text-mention-search.md`
- Test: `tests/dom/richTextMentionController.dom.test.ts`
- Test: `tests/dom/richTextEditor.dom.test.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`
- Test: `tests/node/issueController.node.test.ts`
- Test: `tests/node/createIssueController.node.test.ts`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
npx vitest run --config vitest.config.ts tests/dom/richTextMentionController.dom.test.ts tests/dom/richTextEditor.dom.test.ts tests/dom/createIssuePanel.dom.test.ts
node --import tsx --test tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts
```

Expected: PASS with the new `Search...` mention behavior covered in both DOM and controller layers.

- [ ] **Step 2: Run the broader repo checks**

Run:

```bash
npm run test:dom
npm run bundle
```

Expected: PASS with no mention-search regressions across the shared editor and webview bundle.

- [ ] **Step 3: Update the plan checklist**

```md
- [x] Task 1 complete
- [x] Task 2 complete
- [x] Task 3 complete
- [x] Task 4 complete
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-10-rich-text-mention-search.md
git commit -m "docs: mark rich text mention search plan complete"
```

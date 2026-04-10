# Parent Epic Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared parent picker Epic-only and rename the live UI from `Parent Ticket` to `Parent Epic`.

**Architecture:** Keep the current shared parent-picker flow, but tighten its contract in three places: visible card copy, inline modal copy/layout, and controller-enforced search filters. The webview remains the presentation layer, while `ParentIssuePickerController` becomes the single place that forces `issueTypeName: "Epic"` regardless of any raw filter payload coming back from the DOM.

**Tech Stack:** TypeScript, VS Code webview HTML, Vitest DOM tests, `node:test`

---

## File Map

- Modify: `src/views/webview/shared-parent-picker.ts`
  - Shared parent card title/detail copy used by create and issue sidebars.
- Modify: `src/views/webview/webview.panel.ts`
  - Live section titles and accessible labels for create and issue-details parent sections.
- Modify: `src/views/webview/parent-issue-picker.overlay.ts`
  - Inline modal copy, filter form contract, and live card-sync text applied after picker selection.
- Modify: `src/controllers/parent-issue-picker.controller.ts`
  - Enforced Epic search state for initial load, reload, and load-more paths.
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
  - Create-form card copy and inline overlay contract assertions.
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`
  - Issue sidebar copy assertions for the shared parent card.
- Modify: `tests/node/parentIssuePickerController.node.test.ts`
  - Controller regression proving all parent searches stay Epic-filtered.

## Out Of Scope

- `src/views/webview/parent-issue-picker.panel.ts`
- `tests/dom/parentIssuePickerPanel.dom.test.ts`

The current issue/create flow uses `ParentIssuePickerOverlay` inside the main webview, not the standalone panel implementation above. Do not expand scope into that dead path unless live code is found to still call it.

### Task 1: Rename The Shared Parent Card To Parent Epic

**Files:**
- Modify: `src/views/webview/shared-parent-picker.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`
- Test: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the failing DOM assertions for the new Parent Epic copy**

```ts
expect(parentButtonText).toContain('Choose a parent epic');
expect(parentButtonText).toContain('No parent epic selected');
expect(parentCard?.getAttribute('aria-label')).toBe('Parent Epic');

const parentSection = Array.from(dom.window.document.querySelectorAll('.issue-sidebar .meta-section')).find(
	(section) => section.textContent?.includes('Parent Epic')
);
expect(parentCardTitle?.textContent?.trim()).toBe('Choose a parent epic');
```

- [ ] **Step 2: Run the focused DOM tests to verify the old ticket wording fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts`

Expected: FAIL with existing `Parent Ticket`, `Choose a parent ticket`, and `No parent selected` text still rendered by the shared card and sidebar section headings.

- [ ] **Step 3: Write the minimal copy changes in the shared card and live sidebar sections**

```ts
/**
 * Renders the shared parent Epic picker card used by webview sidebars.
 */
export class SharedParentPicker {
	static renderCard(options: SharedParentPickerRenderOptions): string {
		const titleLabel = 'Choose a parent epic';
		const detailLabel = options.selectedParent
			? HtmlHelper.escapeHtml(SharedParentPicker.formatDetailLabel(options.selectedParent))
			: 'No parent epic selected &bull; Unassigned';
```

```ts
const parentPickerCard = SharedParentPicker.renderCard({
	ariaLabel: 'Parent Epic',
	selectedParent,
});

return `<div class="meta-section">
	<div class="section-title">Parent Epic</div>
	${parentPickerCard}
	${parentIssueLink}
</div>`;
```

```ts
const content = renderCreateParentFieldInput(
	state,
	parentField,
	parentValue,
	disabledAttr,
	'Parent Epic'
);
return `<div class="meta-section">
	<div class="section-title">Parent Epic</div>
	${content}
</div>`;
```

- [ ] **Step 4: Run the focused DOM tests again**

Run: `npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts`

Expected: PASS with the shared card and both live sidebars announcing `Parent Epic`.

- [ ] **Step 5: Commit the shared-card copy change**

```bash
git add tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts src/views/webview/shared-parent-picker.ts src/views/webview/webview.panel.ts
git commit -m "feat: rename parent picker copy to epic"
```

### Task 2: Make The Inline Parent Picker Modal Epic-Specific

**Files:**
- Modify: `src/views/webview/parent-issue-picker.overlay.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Add failing overlay assertions for Epic copy and the removed issue-type field**

```ts
const html = ParentIssuePickerOverlay.renderOverlayHtml({
	projectKey: 'PROJ',
	projectLabel: 'Project',
	searchQuery: '',
	issueTypeName: '',
	statusName: '',
	loading: false,
	loadingMore: false,
	issues: [],
	hasMore: false,
	selectedIssueKey: undefined,
});
const overlayDom = new JSDOM(html);

expect(overlayDom.window.document.querySelector('.parent-picker-title')?.textContent?.trim()).toBe('Select Parent Epic');
expect(html).toContain('Search the current project to choose a parent epic.');
expect(overlayDom.window.document.querySelector('[name="issueTypeName"]')).toBeNull();
expect(html).toContain('No Parent Epic');
```

```ts
expect(clearedText).toContain('Choose a parent epic');
expect(clearedText).toContain('No parent epic selected');
expect(clearedText).toContain('Unassigned');
```

- [ ] **Step 2: Run the create-panel DOM suite to confirm the old overlay contract fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: FAIL because the overlay still renders `Select Parent Ticket`, still shows the `issueTypeName` input, and the live selection sync still resets the card to ticket wording.

- [ ] **Step 3: Update the inline overlay copy, sync text, and filter form layout**

```ts
const parentPickerReadFilters = () => {
	const form = parentPickerHost ? parentPickerHost.querySelector('[data-parent-picker-form]') : null;
	if (!form) {
		return { searchQuery: '', issueTypeName: 'Epic', statusName: '' };
	}
	const data = new FormData(form);
	return {
		searchQuery: typeof data.get('searchQuery') === 'string' ? data.get('searchQuery').trim() : '',
		issueTypeName: 'Epic',
		statusName: typeof data.get('statusName') === 'string' ? data.get('statusName').trim() : '',
	};
};
```

```ts
if (!issue) {
	titleEl.textContent = 'Choose a parent epic';
	detailEl.textContent = 'No parent epic selected - Unassigned';
	return;
}

titleEl.textContent = 'Choose a parent epic';
```

```ts
.parent-picker-host .parent-picker-filters {
	display: grid;
	grid-template-columns: minmax(0, 1.4fr) minmax(180px, 1fr) auto;
	gap: 10px;
	align-items: end;
}
```

```ts
const errorMarkup = state.error
	? `<div class="message error">${HtmlHelper.escapeHtml(state.error)}</div>`
	: '<div class="message muted">Search the current project to choose a parent epic.</div>';

return `<div class="parent-picker-overlay-backdrop" data-parent-picker-overlay>
	<div class="parent-picker-shell" role="dialog" aria-modal="true" aria-label="Select parent epic">
		<div class="parent-picker-header">
			<div>
				<h2 class="parent-picker-title">Select Parent Epic</h2>
```

```ts
<form class="parent-picker-filters" data-parent-picker-form>
	<label class="field">
		<span>Search</span>
		<input type="text" name="searchQuery" value="${searchQueryValue}" placeholder="Search epic key or text" ${searchDisabledAttr} />
	</label>
	<label class="field">
		<span>Status</span>
		<select name="statusName" ${searchDisabledAttr}>
			${statusOptions}
		</select>
	</label>
	<button type="submit" class="primary" ${searchDisabledAttr}>Search</button>
</form>
```

```ts
<div class="result-summary">Leave this issue without a parent epic</div>
<div class="result-meta">Use this when the issue should not have a parent epic relationship.</div>

<div class="preview-title">No Parent Epic</div>
<div class="preview-body">Confirm this selection to leave the issue without a parent epic.</div>
```

- [ ] **Step 4: Run the create-panel DOM suite again**

Run: `npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: PASS with the inline modal showing Epic-only copy, no visible issue-type filter, and live selection sync resetting the card to Epic wording.

- [ ] **Step 5: Commit the overlay contract change**

```bash
git add tests/dom/createIssuePanel.dom.test.ts src/views/webview/parent-issue-picker.overlay.ts
git commit -m "feat: make parent picker overlay epic specific"
```

### Task 3: Enforce Epic-Only Search In The Parent Picker Controller

**Files:**
- Modify: `src/controllers/parent-issue-picker.controller.ts`
- Test: `tests/node/parentIssuePickerController.node.test.ts`

- [ ] **Step 1: Add a failing controller regression proving raw issue-type filters are ignored**

```ts
test('pickParentIssue always searches for Epic parents', async () => {
	const originalFetchProjectIssuesPage = jiraApiClient.fetchProjectIssuesPage;
	const capturedOptions: any[] = [];
	jiraApiClient.fetchProjectIssuesPage = (async (_authInfo, _token, _projectKey, options) => {
		capturedOptions.push(options);
		return { issues: [], hasMore: false };
	}) as typeof jiraApiClient.fetchProjectIssuesPage;

	try {
		const controller = new ParentIssuePickerController();
		const panel: any = {
			webview: { postMessage: async () => true },
			onDidDispose: () => ({ dispose() {} }),
		};
		const session = controller.pickParentIssue({
			panel,
			project: { key: 'PROJ', name: 'Project' },
			authInfo: { baseUrl: 'https://example.atlassian.net', username: 'helena', serverLabel: 'cloud' },
			token: 'token-123',
		});

		await session.handleMessage({
			type: 'loadParentIssues',
			filters: { searchQuery: 'backend', issueTypeName: 'Bug', statusName: 'Closed' },
		});
		await session.handleMessage({
			type: 'loadMoreParentIssues',
			filters: { searchQuery: 'backend', issueTypeName: 'Task', statusName: 'Closed' },
		});

		assert.equal(capturedOptions[0]?.issueTypeName, 'Epic');
		assert.equal(capturedOptions[1]?.issueTypeName, 'Epic');
	} finally {
		jiraApiClient.fetchProjectIssuesPage = originalFetchProjectIssuesPage;
	}
});
```

- [ ] **Step 2: Run the controller node test to verify the current implementation still accepts non-Epic issue types**

Run: `node --import tsx --test tests/node/parentIssuePickerController.node.test.ts`

Expected: FAIL because `pickParentIssue` currently forwards `filters.issueTypeName` from the webview and initializes the picker state with an empty issue type.

- [ ] **Step 3: Enforce the Epic issue type in controller state, sanitization, and fetch calls**

```ts
export class ParentIssuePickerController {
	private static readonly parentEpicIssueTypeName = 'Epic';
```

```ts
const initialState: ParentIssuePickerOverlayState = {
	projectKey: project.key,
	projectLabel: project.name ? `${project.name} (${project.key})` : project.key,
	searchQuery: '',
	issueTypeName: ParentIssuePickerController.parentEpicIssueTypeName,
	statusName: '',
```

```ts
const enforcedIssueTypeName = ParentIssuePickerController.parentEpicIssueTypeName;
updateState({
	searchQuery: filters.searchQuery,
	issueTypeName: enforcedIssueTypeName,
	statusName: filters.statusName,
});

const page = await jiraApiClient.fetchProjectIssuesPage(authInfo, token, project.key, {
	searchQuery: filters.searchQuery,
	issueTypeName: enforcedIssueTypeName,
	statusName: filters.statusName || undefined,
	excludeIssueKey,
	maxResults: 25,
});
```

```ts
private static sanitizeFilters(raw: any, fallback: ParentIssuePickerFilters): ParentIssuePickerFilters {
	const searchQuery = typeof raw?.searchQuery === 'string' ? raw.searchQuery : fallback.searchQuery;
	const statusName = typeof raw?.statusName === 'string' ? raw.statusName : fallback.statusName;
	return {
		searchQuery: searchQuery ?? '',
		issueTypeName: ParentIssuePickerController.parentEpicIssueTypeName,
		statusName: statusName ?? '',
	};
}
```

- [ ] **Step 4: Run the parent-picker verification commands**

Run: `node --import tsx --test tests/node/parentIssuePickerController.node.test.ts`

Expected: PASS with the controller always sending `issueTypeName: "Epic"`.

Run: `npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts`

Expected: PASS with the live webview copy still aligned to the controller contract.

- [ ] **Step 5: Commit the Epic-only search enforcement**

```bash
git add tests/node/parentIssuePickerController.node.test.ts src/controllers/parent-issue-picker.controller.ts
git commit -m "feat: enforce epic only parent search"
```

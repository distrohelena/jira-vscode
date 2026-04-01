# Jira Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace extension-owned issue icons with Jira-owned icons in the issue webviews and Items tree while keeping stable layout and safe fallbacks.

**Architecture:** Extend the Jira transport and shared issue/status models so Jira icon URLs flow through the existing MVC layers instead of being inferred from status text. Render Jira icon URLs directly in webviews, and add a focused icon cache service that resolves Jira URLs into local `vscode.Uri` values for tree items so the tree does not depend on remote image loading.

**Tech Stack:** TypeScript, VS Code extension API, Jira REST API transport, jsdom DOM tests, Node test runner, Vitest, axios, local extension storage

---

## File Structure

### Existing files to modify

- `src/model/jira.type.ts`
  - Add Jira icon URL properties to shared issue and status types.
- `src/model/jira-api.client.ts`
  - Map documented Jira `iconUrl` fields onto the shared types.
- `src/views/webview/webview.panel.ts`
  - Prefer Jira icon URLs in the issue details header and issue-reference UI.
- `src/views/webview/parent-issue-picker.overlay.ts`
  - Show Jira issue type and status icons in parent picker result rows and preview content.
- `src/views/tree/tree-item.view.ts`
  - Accept resolved icon URIs instead of always computing `ThemeIcon` values from status text.
- `src/views/tree/items-tree-data.provider.ts`
  - Resolve Jira icons through the cache service before building tree items and group icons.
- `src/extension.entrypoint.ts`
  - Construct the new cache service and inject it into the Items tree provider.
- `tests/node/jiraApiTransport.node.test.ts`
  - Add failing transport mapping tests for status and issue type icon URLs.
- `tests/dom/issuePanelEditing.dom.test.ts`
  - Add failing webview rendering tests that prove Jira icon URLs are preferred.

### New files to create

- `src/services/jira-icon-cache.service.ts`
  - Download, cache, and reuse Jira icon files for tree rendering.
- `tests/node/jiraIconCacheService.node.test.ts`
  - Cover cache reuse, shared in-flight requests, and invalid/failing URL handling.

## Task 1: Add Jira Icon URL Properties To Shared Models And Transport Mapping

**Files:**
- Modify: `src/model/jira.type.ts`
- Modify: `src/model/jira-api.client.ts`
- Test: `tests/node/jiraApiTransport.node.test.ts`

- [ ] **Step 1: Write the failing transport tests**

```ts
test('mapIssueInternal captures Jira issue type and status icon urls', () => {
	const issue = (JiraApiTransport as any).mapIssueInternal(
		{
			id: '1001',
			key: 'PROJ-1001',
			self: 'https://example.atlassian.net/rest/api/3/issue/1001',
			fields: {
				summary: 'Icon mapping issue',
				status: {
					name: 'In Progress',
					iconUrl: 'https://example.atlassian.net/images/icons/statuses/inprogress.png',
					statusCategory: {
						key: 'indeterminate',
					},
				},
				issuetype: {
					id: '10000',
					name: 'Task',
					iconUrl: 'https://example.atlassian.net/images/icons/issuetypes/task.svg',
				},
			},
		},
		'https://example.atlassian.net'
	);

	assert.equal(issue.statusIconUrl, 'https://example.atlassian.net/images/icons/statuses/inprogress.png');
	assert.equal(issue.issueTypeIconUrl, 'https://example.atlassian.net/images/icons/issuetypes/task.svg');
});

test('mapTransitionToStatusOptionInternal captures Jira status icon urls', () => {
	const option = (JiraApiTransport as any).mapTransitionToStatusOptionInternal({
		id: '31',
		name: 'Done',
		to: {
			name: 'Done',
			iconUrl: 'https://example.atlassian.net/images/icons/statuses/done.png',
			statusCategory: {
				key: 'done',
			},
		},
	});

	assert.equal(option?.iconUrl, 'https://example.atlassian.net/images/icons/statuses/done.png');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/node/jiraApiTransport.node.test.ts`

Expected: FAIL because `statusIconUrl`, `issueTypeIconUrl`, and `iconUrl` are not mapped yet.

- [ ] **Step 3: Add the new shared model properties**

```ts
export type JiraIssue = {
	id: string;
	key: string;
	summary: string;
	statusName: string;
	statusIconUrl?: string;
	created?: string;
	issueTypeId?: string;
	issueTypeName?: string;
	issueTypeIconUrl?: string;
	assigneeName?: string;
	// existing fields continue unchanged
};

export type IssueStatusOption = {
	id: string;
	name: string;
	category?: IssueStatusCategory;
	iconUrl?: string;
};
```

- [ ] **Step 4: Map the documented Jira icon fields in the transport**

```ts
static mapTransitionToStatusOptionInternal(transition: any): IssueStatusOption | undefined {
	const targetStatus = transition?.to;
	const transitionId = transition?.id ? String(transition.id) : undefined;
	const name = typeof targetStatus?.name === 'string' ? targetStatus.name.trim() : '';
	if (!transitionId || !name) {
		return undefined;
	}

	return {
		id: transitionId,
		name,
		category: mapStatusCategory(targetStatus?.statusCategory?.key),
		iconUrl: typeof targetStatus?.iconUrl === 'string' ? targetStatus.iconUrl.trim() : undefined,
	};
}

static mapIssueInternal(issue: any, urlRoot: string): JiraIssue {
	const fields = issue?.fields ?? {};
	const issueType = fields?.issuetype ?? {};
	const status = fields?.status ?? {};

	return {
		id: String(issue?.id ?? ''),
		key: String(issue?.key ?? ''),
		summary: fields?.summary ?? 'Untitled',
		statusName: status?.name ?? 'Unknown',
		statusIconUrl: typeof status?.iconUrl === 'string' ? status.iconUrl.trim() : undefined,
		issueTypeId: issueType?.id ? String(issueType.id) : undefined,
		issueTypeName: issueType?.name ?? undefined,
		issueTypeIconUrl: typeof issueType?.iconUrl === 'string' ? issueType.iconUrl.trim() : undefined,
		url: issue?.key ? `${urlRoot}/browse/${issue.key}` : urlRoot,
		updated: fields?.updated ?? '',
	};
}
```

- [ ] **Step 5: Run the transport test to verify it passes**

Run: `node --test tests/node/jiraApiTransport.node.test.ts`

Expected: PASS for the new icon mapping assertions.

- [ ] **Step 6: Commit**

```bash
git add tests/node/jiraApiTransport.node.test.ts src/model/jira.type.ts src/model/jira-api.client.ts
git commit -m "feat: map jira issue icon urls"
```

## Task 2: Add The Jira Icon Cache Service For Tree Rendering

**Files:**
- Create: `src/services/jira-icon-cache.service.ts`
- Test: `tests/node/jiraIconCacheService.node.test.ts`

- [ ] **Step 1: Write the failing cache service tests**

```ts
test('resolveIconUri reuses an existing cached file', async () => {
	const context = createExtensionContextStub(tmpDir);
	const service = new JiraIconCacheService(context, fakeDownloader);
	const iconUrl = 'https://example.atlassian.net/images/icons/issuetypes/task.svg';

	const first = await service.resolveIconUri(iconUrl);
	const second = await service.resolveIconUri(iconUrl);

	assert.equal(first?.fsPath, second?.fsPath);
	assert.equal(fakeDownloader.calls.length, 1);
});

test('resolveIconUri shares in-flight work for duplicate requests', async () => {
	const service = new JiraIconCacheService(context, delayedDownloader);
	const iconUrl = 'https://example.atlassian.net/images/icons/statuses/inprogress.png';

	const [first, second] = await Promise.all([
		service.resolveIconUri(iconUrl),
		service.resolveIconUri(iconUrl),
	]);

	assert.equal(first?.fsPath, second?.fsPath);
	assert.equal(delayedDownloader.calls.length, 1);
});

test('resolveIconUri returns undefined for invalid urls', async () => {
	const service = new JiraIconCacheService(context, fakeDownloader);
	const result = await service.resolveIconUri('not-a-valid-url');
	assert.equal(result, undefined);
});
```

- [ ] **Step 2: Run the cache service test to verify it fails**

Run: `node --test tests/node/jiraIconCacheService.node.test.ts`

Expected: FAIL because the service does not exist yet.

- [ ] **Step 3: Implement the minimal cache service**

```ts
export class JiraIconCacheService {
	private readonly inFlightByUrl = new Map<string, Promise<vscode.Uri | undefined>>();

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		private readonly downloadIcon: (url: string) => Promise<Uint8Array> = JiraIconCacheService.downloadIconBytes
	) {}

	async resolveIconUri(iconUrl: string | undefined): Promise<vscode.Uri | undefined> {
		const normalizedUrl = JiraIconCacheService.normalizeIconUrl(iconUrl);
		if (!normalizedUrl) {
			return undefined;
		}

		const existing = this.inFlightByUrl.get(normalizedUrl);
		if (existing) {
			return existing;
		}

		const work = this.resolveOrDownloadIcon(normalizedUrl).finally(() => {
			this.inFlightByUrl.delete(normalizedUrl);
		});
		this.inFlightByUrl.set(normalizedUrl, work);
		return work;
	}

	private async resolveOrDownloadIcon(normalizedUrl: string): Promise<vscode.Uri | undefined> {
		const cacheFile = await this.ensureCacheFilePath(normalizedUrl);
		try {
			await vscode.workspace.fs.stat(cacheFile);
			return cacheFile;
		} catch {
			const bytes = await this.downloadIcon(normalizedUrl);
			await vscode.workspace.fs.writeFile(cacheFile, bytes);
			return cacheFile;
		}
	}
}
```

- [ ] **Step 4: Run the cache service test to verify it passes**

Run: `node --test tests/node/jiraIconCacheService.node.test.ts`

Expected: PASS for cache reuse, in-flight reuse, and invalid URL fallback.

- [ ] **Step 5: Commit**

```bash
git add tests/node/jiraIconCacheService.node.test.ts src/services/jira-icon-cache.service.ts
git commit -m "feat: add jira icon cache service"
```

## Task 3: Render Jira Icons In The Issue Webviews

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `src/views/webview/parent-issue-picker.overlay.ts`
- Test: `tests/dom/issuePanelEditing.dom.test.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Write the failing DOM tests**

```ts
it('prefers Jira status icon urls over local media icons in the issue header', () => {
	const { dom } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		statusIconUrl: 'https://jira.example.test/images/icons/statuses/inprogress.png',
		issueTypeIconUrl: 'https://jira.example.test/images/icons/issuetypes/task.svg',
	});

	const statusIcon = dom.window.document.querySelector('.status-icon') as HTMLImageElement;
	expect(statusIcon.src).toContain('https://jira.example.test/images/icons/statuses/inprogress.png');
});

it('renders Jira issue type icons in parent picker results without changing row structure', () => {
	const html = ParentIssuePickerOverlay.renderOverlayHtml({
		projectKey: 'PROJ',
		projectLabel: 'Project (PROJ)',
		searchQuery: '',
		issueTypeName: '',
		statusName: '',
		loading: false,
		loadingMore: false,
		issues: [
			{
				id: '1001',
				key: 'PROJ-1',
				summary: 'Parent candidate',
				statusName: 'Done',
				statusIconUrl: 'https://jira.example.test/images/icons/statuses/done.png',
				issueTypeName: 'Task',
				issueTypeIconUrl: 'https://jira.example.test/images/icons/issuetypes/task.svg',
				url: 'https://jira.example.test/browse/PROJ-1',
				updated: '2026-04-01T10:00:00.000Z',
			},
		],
		hasMore: false,
		selectedIssueKey: 'PROJ-1',
	});

	expect(html).toContain('issue-icon');
	expect(html).toContain('https://jira.example.test/images/icons/issuetypes/task.svg');
});
```

- [ ] **Step 2: Run the DOM tests to verify they fail**

Run: `npm run test:dom`

Expected: FAIL because the current webview HTML still uses local status media and the parent picker does not render Jira icons.

- [ ] **Step 3: Update the issue details header and issue-reference rows to prefer Jira icon URLs**

```ts
static renderIssuePanelContent(panel: vscode.WebviewPanel, issue: JiraIssue, options?: IssuePanelOptions): void {
	const statusCategory = IssueModel.determineStatusCategory(issue.statusName);
	const iconPath = ViewResource.getStatusIconPath(statusCategory);
	if (iconPath) {
		panel.iconPath = iconPath;
	}
	panel.webview.html = renderIssueDetailsHtml(panel.webview, issue, options);
}

static renderIssueDetailsHtml(webview: vscode.Webview, issue: JiraIssue, options?: IssuePanelOptions): string {
	const fallbackStatusIconSrc = ViewResource.getStatusIconWebviewSrc(
		webview,
		IssueModel.determineStatusCategory(issue.statusName)
	);
	const statusIconSrc = issue.statusIconUrl || fallbackStatusIconSrc;
	const issueTypeIconMarkup = issue.issueTypeIconUrl
		? `<img class="issue-icon issue-type-icon" src="${HtmlHelper.escapeAttribute(issue.issueTypeIconUrl)}" alt="${HtmlHelper.escapeHtml(issue.issueTypeName ?? 'Issue type')} icon" />`
		: '';

	const statusIconMarkup = statusIconSrc
		? `<img class="status-icon issue-icon" src="${HtmlHelper.escapeAttribute(statusIconSrc)}" alt="${HtmlHelper.escapeHtml(issue.statusName ?? 'Issue status')} status icon" />`
		: '<span class="issue-icon issue-icon-placeholder" aria-hidden="true"></span>';

	// existing header markup continues, but keeps a fixed icon block width and height
}
```

- [ ] **Step 4: Add Jira icon markup to the parent picker overlay without changing reserved row height**

```ts
private static renderIssueResultsList(issues: JiraIssue[], selectedIssueKey: string): string {
	const listItems = issues.map((issue) => {
		const issueTypeIcon = issue.issueTypeIconUrl
			? `<img class="issue-icon result-issue-type-icon" src="${HtmlHelper.escapeAttribute(issue.issueTypeIconUrl)}" alt="${HtmlHelper.escapeHtml(issue.issueTypeName ?? 'Issue type')} icon" />`
			: '<span class="issue-icon issue-icon-placeholder" aria-hidden="true"></span>';
		const statusIcon = issue.statusIconUrl
			? `<img class="issue-icon result-status-icon" src="${HtmlHelper.escapeAttribute(issue.statusIconUrl)}" alt="${HtmlHelper.escapeHtml(issue.statusName ?? 'Issue status')} status icon" />`
			: '';

		return `<li class="parent-picker-result">
			<button type="button" class="parent-picker-result-button" data-parent-picker-result data-parent-issue-key="${HtmlHelper.escapeAttribute(issue.key)}">
				<div class="result-top">
					<span class="result-icons">${issueTypeIcon}${statusIcon}</span>
					<div class="result-key">${HtmlHelper.escapeHtml(issue.key)}</div>
					<div class="result-summary">${HtmlHelper.escapeHtml(issue.summary ?? issue.key)}</div>
				</div>
			</button>
		</li>`;
	}).join('');

	return `<ul class="parent-picker-results-list">${listItems}</ul>`;
}
```

- [ ] **Step 5: Run the DOM tests to verify they pass**

Run: `npm run test:dom`

Expected: PASS for the new Jira icon assertions, with no regressions in existing parent/assignee modal tests.

- [ ] **Step 6: Commit**

```bash
git add tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts src/views/webview/webview.panel.ts src/views/webview/parent-issue-picker.overlay.ts
git commit -m "feat: render jira icons in webviews"
```

## Task 4: Resolve Jira Icons Through The Cache Service In The Items Tree

**Files:**
- Modify: `src/views/tree/tree-item.view.ts`
- Modify: `src/views/tree/items-tree-data.provider.ts`
- Modify: `src/extension.entrypoint.ts`
- Modify: `src/model/jira.type.ts`
- Modify: `src/model/jira-api.client.ts`
- Test: `tests/node/jiraIconCacheService.node.test.ts`

- [ ] **Step 1: Write the failing tree integration test**

```ts
test('createIssueTreeItem prefers a cached Jira issue type icon uri', async () => {
	const issue = {
		id: '1001',
		key: 'PROJ-1001',
		summary: 'Tree icon issue',
		statusName: 'In Progress',
		statusIconUrl: 'https://jira.example.test/images/icons/statuses/inprogress.png',
		issueTypeName: 'Task',
		issueTypeIconUrl: 'https://jira.example.test/images/icons/issuetypes/task.svg',
		url: 'https://jira.example.test/browse/PROJ-1001',
		updated: '2026-04-01T10:00:00.000Z',
	} satisfies JiraIssue;

	const cachedIconUri = vscode.Uri.file(path.join(tmpDir, 'task.svg'));
	const item = JiraTreeItem.createIssueTreeItem(issue, cachedIconUri);

	assert.deepEqual(item.iconPath, cachedIconUri);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `node --test tests/node/jiraIconCacheService.node.test.ts`

Expected: FAIL because `JiraTreeItem.createIssueTreeItem` does not accept resolved icon URIs yet.

- [ ] **Step 3: Update tree item creation and Items provider icon resolution**

```ts
static createIssueTreeItem(issue: JiraIssue, iconPath?: vscode.Uri | vscode.ThemeIcon): JiraTreeItem {
	const item = new JiraTreeItem(
		'issue',
		`${displayKey} · ${displaySummary}`,
		vscode.TreeItemCollapsibleState.None,
		undefined,
		issue
	);
	item.tooltip = `${issue.summary}\nStatus: ${issue.statusName}\nUpdated: ${new Date(issue.updated).toLocaleString()}`;
	item.iconPath = iconPath ?? JiraTreeItem.deriveIssueIcon(issue.statusName);
	return item;
}

private async createIssueIconPath(issue: JiraIssue): Promise<vscode.Uri | vscode.ThemeIcon> {
	const cachedIssueTypeIcon = await this.iconCacheService.resolveIconUri(issue.issueTypeIconUrl);
	if (cachedIssueTypeIcon) {
		return cachedIssueTypeIcon;
	}
	const cachedStatusIcon = await this.iconCacheService.resolveIconUri(issue.statusIconUrl);
	if (cachedStatusIcon) {
		return cachedStatusIcon;
	}
	return JiraTreeItem.deriveIssueIcon(issue.statusName);
}
```

- [ ] **Step 4: Inject the cache service from the extension entrypoint**

```ts
const jiraIconCacheService = new JiraIconCacheService(context);
const itemsProvider = new JiraItemsTreeDataProvider(
	context,
	authManager,
	focusManager,
	transitionPrefetcher,
	jiraIconCacheService
);
```

- [ ] **Step 5: Run the relevant tests to verify they pass**

Run: `node --test tests/node/jiraIconCacheService.node.test.ts`

Expected: PASS for the new tree icon path assertions and the existing cache service tests.

- [ ] **Step 6: Commit**

```bash
git add src/views/tree/tree-item.view.ts src/views/tree/items-tree-data.provider.ts src/extension.entrypoint.ts tests/node/jiraIconCacheService.node.test.ts
git commit -m "feat: use jira icons in items tree"
```

## Task 5: Run Full Verification And Clean Up Fallback Behavior

**Files:**
- Modify: `src/views/view.resource.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `src/views/tree/tree-item.view.ts`
- Test: `tests/node/jiraApiTransport.node.test.ts`
- Test: `tests/node/jiraIconCacheService.node.test.ts`
- Test: `tests/dom/issuePanelEditing.dom.test.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Write the final fallback regression test if one is still missing**

```ts
it('falls back to the packaged status icon when Jira does not provide a status icon url', () => {
	const { dom } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		statusIconUrl: undefined,
		statusName: 'In Progress',
	});

	const statusIcon = dom.window.document.querySelector('.status-icon') as HTMLImageElement;
	expect(statusIcon.src).toContain('/media/');
});
```

- [ ] **Step 2: Run the targeted fallback test to verify it fails if the fallback path regressed**

Run: `npm run test:dom`

Expected: PASS if fallback already works, otherwise FAIL and reveal the broken fallback path before final cleanup.

- [ ] **Step 3: Remove any now-unused webview icon helpers only if all callers are gone**

```ts
export class ViewResource {
	static getStatusIconPath(category: IssueStatusCategory): vscode.Uri | undefined {
		// keep this method only while the fallback path still uses packaged status assets
	}

	static getItemsIconPath(): vscode.Uri | undefined {
		const extensionUri = EnvironmentRuntime.getExtensionUri();
		return vscode.Uri.joinPath(extensionUri, 'media', 'items.png');
	}
}
```

- [ ] **Step 4: Run the full verification suite**

Run: `node --test tests/node/jiraApiTransport.node.test.ts`
Expected: PASS

Run: `node --test tests/node/jiraIconCacheService.node.test.ts`
Expected: PASS

Run: `npm run test:dom`
Expected: PASS

Run: `npm run compile`
Expected: PASS

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/view.resource.ts src/views/webview/webview.panel.ts src/views/tree/tree-item.view.ts tests/node/jiraApiTransport.node.test.ts tests/node/jiraIconCacheService.node.test.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts
git commit -m "feat: finish jira icon integration"
```

## Self-Review

### Spec coverage

- Jira icon URLs in shared models: covered by Task 1.
- Jira icon mapping from documented transport payloads: covered by Task 1.
- Webview rendering from Jira icon URLs with stable layout: covered by Task 3 and Task 5.
- Tree rendering through a local cache service: covered by Task 2 and Task 4.
- Safe fallbacks and non-blocking behavior: covered by Task 2 and Task 5.
- Automated mapping, rendering, and caching coverage: covered by Tasks 1 through 5.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Every code-changing task includes concrete snippets and exact commands.
- Every verification step includes an expected outcome.

### Type consistency

- `JiraIssue.statusIconUrl`, `JiraIssue.issueTypeIconUrl`, and `IssueStatusOption.iconUrl` are defined in Task 1 and reused consistently in Tasks 3 and 4.
- `JiraIconCacheService.resolveIconUri` is introduced in Task 2 and reused consistently in Task 4.
- Tree item construction uses the same `iconPath` concept in Task 4 and Task 5.

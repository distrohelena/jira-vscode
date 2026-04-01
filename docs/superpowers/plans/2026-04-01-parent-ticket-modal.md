# Parent Ticket Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current parent-ticket field flow with a large current-project modal picker that can search all issues in the project, including closed issues, and use the same picker from both Create Ticket and Edit Ticket flows.

**Architecture:** Add a reusable parent-issue picker controller that owns search, selection state, and update actions. Render the picker as a dedicated webview modal so the create form and issue details panel can both open the same UI without duplicating the search experience. Keep Jira REST calls in the API client layer and keep the webview layer responsible only for presentation and message wiring.

**Tech Stack:** TypeScript, VS Code webviews, Jira REST API, Vitest, Node test runner, JSDOM.

---

### Task 1: Add parent-picker data flow and Jira update/search helpers

**Files:**
- Modify: `src/model/jira.type.ts`
- Modify: `src/model/jira-api.client.ts`
- Modify: `src/jira-api/contracts/jira-api.client.contract.ts`
- Modify: `src/jira-api/services/jira-api.client.ts`
- Modify: `tests/node/jiraApiTransport.node.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('buildProjectIssuesJqlInternal keeps closed issues available for parent search', () => {
	const jql = JiraApiTransport.buildProjectIssuesJqlInternal(
		{ baseUrl: 'https://example.atlassian.net', username: 'helena', serverLabel: 'cloud' },
		'PROJ',
		{ searchQuery: 'parent candidate' }
	);

	assert.equal(jql, 'project = PROJ AND text ~ "parent candidate" ORDER BY updated DESC');
});

test('updateIssueParentInternal sends the parent field in issue update payload', async () => {
	// Verify the request body contains `fields.parent` and uses key-or-id style payloads.
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:node -- tests/node/jiraApiTransport.node.test.ts`
Expected: FAIL because the parent-update helper does not exist yet and the parent-picker state is not yet modeled.

- [ ] **Step 3: Write the minimal implementation**

```ts
type ParentIssuePickerFilters = {
	searchQuery: string;
	issueTypeName?: string;
	statusName?: string;
};

async function updateIssueParentInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	parentKey: string
): Promise<void> {
	await axios.put(resourceUrl, { fields: { parent: { key: parentKey } } }, requestConfig);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:node -- tests/node/jiraApiTransport.node.test.ts`
Expected: PASS.

### Task 2: Build the reusable parent issue picker modal

**Files:**
- Add: `src/controllers/parent-issue-picker.controller.ts`
- Add: `src/views/webview/parent-issue-picker.panel.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `src/controllers/create-issue.controller.ts`
- Modify: `src/controllers/issue.controller.ts`
- Modify: `src/extension.entrypoint.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('create ticket parent field opens a large picker modal and posts the selected issue key', () => {
	// Render the create panel, click the parent control, select a result, confirm the picker,
	// and assert the create form receives `customFields.parent`.
});

test('issue details parent section opens the picker and updates the parent issue', () => {
	// Render the issue panel, click the parent edit action, confirm the picker selection,
	// and assert the controller calls the parent-update helper.
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:dom -- --run tests/dom/parentIssuePickerPanel.dom.test.ts`
Expected: FAIL because the modal does not exist yet and the create/edit entry points still use the old parent flow.

- [ ] **Step 3: Write the minimal implementation**

```ts
class ParentIssuePickerController {
	async pickParentIssue(options: ParentIssuePickerOptions): Promise<JiraIssue | undefined> {
		// Open modal, search current project issues, and resolve the selected issue.
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:dom -- --run tests/dom/parentIssuePickerPanel.dom.test.ts`
Expected: PASS.

### Task 3: Lock down layout stability and finish integration tests

**Files:**
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`
- Add: `tests/dom/parentIssuePickerPanel.dom.test.ts`
- Modify: `src/views/webview/parent-issue-picker.panel.ts`
- Modify: `src/views/webview/webview.panel.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('parent picker reserves space for filters, errors, and results so the modal does not jump', () => {
	// Assert the modal uses stable containers for header, filters, results, and preview.
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:dom`
Expected: FAIL until the picker layout uses fixed-height or reserved regions for interactive content.

- [ ] **Step 3: Write the minimal implementation**

```ts
const resultsRegionStyle = 'min-height: 280px;';
const messageRegionStyle = 'min-height: 48px;';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:dom`
Expected: PASS.

- [ ] **Step 5: Run full verification**

Run: `npm test`
Expected: PASS with no failing node, dom, or smoke tests.


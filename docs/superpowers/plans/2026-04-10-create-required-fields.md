# Create Required Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the create-issue screen visibly mark required fields and block submit locally when a required `Parent Epic` is missing instead of letting Jira reject the request later.

**Architecture:** Keep the change narrow to the create flow. The webview renderer will expose required state for the create parent selector, and the create controller will validate required parent metadata before calling the Jira API while preserving the existing summary-first validation order.

**Tech Stack:** TypeScript, VS Code webview HTML rendering, Vitest DOM tests, Node built-in test runner with `tsx`

---

## File Structure

**Modify:**
- `src/views/webview/shared-parent-picker.ts`
  - Extend the shared parent card renderer so create-only callers can override the visible card title without affecting edit views.
- `src/views/webview/webview.panel.ts`
  - Render required create-parent labels using the existing `field-required` marker contract and pass create-only parent-title overrides into the shared card.
- `src/controllers/create-issue.controller.ts`
  - Add required-parent validation ahead of the generic required custom-field validation path.
- `tests/dom/createIssuePanel.dom.test.ts`
  - Add create-screen DOM coverage for required parent markers and unchanged optional-parent behavior.
- `tests/node/createIssueController.node.test.ts`
  - Add controller tests that prove required parent fields block submit before the Jira API call and that summary validation still runs first.

**No new files expected beyond this plan document.**

### Task 1: Render Required Parent Markers In The Create Screen

**Files:**
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Modify: `src/views/webview/shared-parent-picker.ts`
- Modify: `src/views/webview/webview.panel.ts`

- [ ] **Step 1: Write the failing DOM tests for required and optional parent labels**

Add two focused tests in `tests/dom/createIssuePanel.dom.test.ts` near the existing parent-card coverage:

```ts
	it('marks the create Parent Epic section and card title as required when Jira metadata requires it', () => {
		const { dom, scriptErrors } = renderCreateIssuePanelDom({
			createFields: [
				{
					id: 'parent',
					name: 'Parent Epic',
					required: true,
					multiline: false,
					isParentField: true,
				},
			],
		});
		expect(scriptErrors).toEqual([]);

		const sectionTitle = dom.window.document.querySelector(
			'.issue-sidebar .meta-section .section-title'
		) as HTMLDivElement | null;
		const cardTitle = dom.window.document.querySelector(
			'.issue-sidebar .parent-picker-card-title'
		) as HTMLSpanElement | null;
		const cardTrigger = dom.window.document.querySelector(
			'.issue-sidebar [data-parent-picker-open]'
		) as HTMLButtonElement | null;

		expect(sectionTitle?.innerHTML).toContain('field-required');
		expect(sectionTitle?.textContent?.replace(/\s+/g, ' ').trim()).toContain('Parent Epic *');
		expect(cardTitle?.innerHTML).toContain('field-required');
		expect(cardTitle?.textContent?.replace(/\s+/g, ' ').trim()).toContain('Choose a parent epic *');
		expect(cardTrigger?.getAttribute('aria-label')).toBe('Parent Epic (required)');
	});

	it('keeps the create Parent Epic section optional when Jira metadata does not require it', () => {
		const { dom, scriptErrors } = renderCreateIssuePanelDom({
			createFields: [
				{
					id: 'parent',
					name: 'Parent Epic',
					required: false,
					multiline: false,
					isParentField: true,
				},
			],
		});
		expect(scriptErrors).toEqual([]);

		const sectionTitle = dom.window.document.querySelector(
			'.issue-sidebar .meta-section .section-title'
		) as HTMLDivElement | null;
		const cardTitle = dom.window.document.querySelector(
			'.issue-sidebar .parent-picker-card-title'
		) as HTMLSpanElement | null;
		const cardTrigger = dom.window.document.querySelector(
			'.issue-sidebar [data-parent-picker-open]'
		) as HTMLButtonElement | null;

		expect(sectionTitle?.innerHTML).not.toContain('field-required');
		expect(sectionTitle?.textContent?.trim()).toBe('Parent Epic');
		expect(cardTitle?.innerHTML).not.toContain('field-required');
		expect(cardTitle?.textContent?.trim()).toBe('Choose a parent epic');
		expect(cardTrigger?.getAttribute('aria-label')).toBe('Parent Epic');
	});
```

- [ ] **Step 2: Run the DOM test file to verify the new test fails for the right reason**

Run: `npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: FAIL because the current create parent section renders plain `Parent Epic` / `Choose a parent epic` with no required marker and no required-aware `aria-label`.

- [ ] **Step 3: Implement the minimal create-only parent marker support**

Update `src/views/webview/shared-parent-picker.ts` so the shared card accepts an optional visible title override:

```ts
export type SharedParentPickerRenderOptions = {
	ariaLabel: string;
	fieldId?: string;
	fieldValue?: string;
	selectedParent?: SharedParentPickerSelection;
	disabled?: boolean;
	titleLabelHtml?: string;
};

static renderCard(options: SharedParentPickerRenderOptions): string {
	const titleLabelHtml = options.titleLabelHtml ?? HtmlHelper.escapeHtml('Choose a parent epic');
	// existing body continues unchanged
}
```

Update `src/views/webview/webview.panel.ts` so the create parent section computes required markup once and passes the create-only values through:

```ts
static renderCreateParentSidebarSection(state: CreateIssuePanelState, disabled: boolean): string {
	const parentField = (state.createFields ?? []).find((field) => field.isParentField || field.id === 'parent');
	if (!parentField) {
		return '';
	}

	const requiredSuffix = parentField.required ? ' <span class="field-required">*</span>' : '';
	const sectionTitle = `Parent Epic${requiredSuffix}`;
	const ariaLabel = parentField.required ? 'Parent Epic (required)' : 'Parent Epic';
	const cardTitleHtml = parentField.required
		? 'Choose a parent epic <span class="field-required">*</span>'
		: 'Choose a parent epic';
	const parentValue = state.values.customFields?.[parentField.id] ?? '';
	const disabledAttr = disabled ? 'disabled' : '';
	const content = renderCreateParentFieldInput(state, parentField, parentValue, disabledAttr, ariaLabel, cardTitleHtml);

	return `<div class="meta-section">
		<div class="section-title">${sectionTitle}</div>
		${content}
	</div>`;
}

static renderCreateParentFieldInput(
	state: CreateIssuePanelState,
	field: CreateIssueFieldDefinition,
	value: string,
	disabledAttr: string,
	ariaLabel: string,
	titleLabelHtml: string
): string {
	return SharedParentPicker.renderCard({
		ariaLabel,
		titleLabelHtml,
		fieldId: field.id,
		fieldValue: value,
		selectedParent: state.selectedParentIssue
			? {
				key: state.selectedParentIssue.key,
				summary: state.selectedParentIssue.summary,
			}
			: undefined,
		disabled: Boolean(disabledAttr),
	});
}
```

Keep the edit-screen callers on the existing defaults so only the create flow changes.

- [ ] **Step 4: Run the DOM test file again to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: PASS with the new required-parent assertions and no regressions in the existing create panel tests.

- [ ] **Step 5: Commit the rendering change**

```bash
git add tests/dom/createIssuePanel.dom.test.ts src/views/webview/shared-parent-picker.ts src/views/webview/webview.panel.ts
git commit -m "feat: mark required parent fields in create view"
```

### Task 2: Block Create Submit When A Required Parent Is Missing

**Files:**
- Modify: `tests/node/createIssueController.node.test.ts`
- Modify: `src/controllers/create-issue.controller.ts`

- [ ] **Step 1: Write the failing controller tests for required-parent validation**

Add focused tests to `tests/node/createIssueController.node.test.ts` by stubbing `JiraWebviewPanel.renderCreateIssuePanel` to capture panel states and stubbing `jiraApiClient.createIssue` to count calls:

```ts
async function createValidationHarness(createFields: any[]): Promise<{
	onMessage: (message: unknown) => Promise<void>;
	renderedStates: any[];
	createIssueCalls: any[];
	restore: () => void;
}> {
	const modules = loadCreateIssueControllerModules() as CreateIssueControllerTestModules & {
		jiraApiClient: typeof import('../../src/jira-api').jiraApiClient & {
			__getOnMessage?: () => ((message: unknown) => Promise<void>) | undefined;
		};
	};
	const { CreateIssueControllerFactory, JiraWebviewPanel, jiraApiClient } = modules;
	const renderedStates: any[] = [];
	const createIssueCalls: any[] = [];
	const originalShowCreateIssuePanel = JiraWebviewPanel.showCreateIssuePanel;
	const originalRenderCreateIssuePanel = JiraWebviewPanel.renderCreateIssuePanel;
	const originalFetchCreateIssueFields = jiraApiClient.fetchCreateIssueFields;
	const originalCreateIssue = jiraApiClient.createIssue;

	JiraWebviewPanel.showCreateIssuePanel = (() => ({
		webview: {
			cspSource: 'vscode-resource://test',
			html: '',
			asWebviewUri: (value: unknown) => ({ toString: () => String(value) }),
			postMessage: async () => true,
			onDidReceiveMessage: (handler: (message: unknown) => Promise<void>) => {
				jiraApiClient.__getOnMessage = () => handler;
				return { dispose() {} };
			},
		},
		onDidDispose: () => ({ dispose() {} }),
	})) as typeof JiraWebviewPanel.showCreateIssuePanel;
	JiraWebviewPanel.renderCreateIssuePanel = ((_panel, _project, state) => {
		renderedStates.push(structuredClone(state));
	}) as typeof JiraWebviewPanel.renderCreateIssuePanel;
	jiraApiClient.fetchCreateIssueFields = (async () => createFields) as typeof jiraApiClient.fetchCreateIssueFields;
	jiraApiClient.createIssue = (async (...args: unknown[]) => {
		createIssueCalls.push(args);
		return { key: 'PROJ-1' } as any;
	}) as typeof jiraApiClient.createIssue;

	const controller = CreateIssueControllerFactory.create({
		authManager: {
			async getAuthInfo(): Promise<any> {
				return {
					baseUrl: 'https://example.atlassian.net',
					username: 'helena@example.com',
					displayName: 'Helena',
					accountId: 'acct-current',
					serverLabel: 'cloud',
				};
			},
			async getToken(): Promise<string> {
				return 'token-123';
			},
		} as any,
		focusManager: {
			getSelectedProject: () => ({ key: 'PROJ', name: 'Project' }),
		} as any,
		assigneePicker: { pickAssignee: () => { throw new Error('not used'); } } as any,
		parentIssuePicker: { pickParentIssue: () => { throw new Error('not used'); } } as any,
		projectStatusStore: { get: () => undefined, ensure: async () => [] } as any,
		webviewIconService: {
			async createStatusOptionsWithResolvedIconSources(_webview: unknown, options?: unknown) {
				return options as any;
			},
		} as any,
		revealIssueInItemsView: async () => undefined,
		openIssueDetails: async () => undefined,
	});

	await controller.createIssue();
	await flushAsyncWork();

	const onMessage = jiraApiClient.__getOnMessage?.();
	assert.equal(typeof onMessage, 'function');

	return {
		onMessage: onMessage as (message: unknown) => Promise<void>,
		renderedStates,
		createIssueCalls,
		restore: () => {
			JiraWebviewPanel.showCreateIssuePanel = originalShowCreateIssuePanel;
			JiraWebviewPanel.renderCreateIssuePanel = originalRenderCreateIssuePanel;
			jiraApiClient.fetchCreateIssueFields = originalFetchCreateIssueFields;
			jiraApiClient.createIssue = originalCreateIssue;
		},
	};
}

test('create issue controller blocks submit when a required parent field is empty', async () => {
	const harness = await createValidationHarness([
		{ id: 'parent', name: 'Parent Epic', required: true, multiline: false, isParentField: true },
	]);

	try {
		await harness.onMessage({
			type: 'createIssue',
			values: {
				summary: 'Child ticket',
				description: '',
				issueType: 'Task',
				status: 'To Do',
				customFields: {
					parent: '',
				},
			},
		});
		await flushAsyncWork();

		assert.equal(harness.createIssueCalls.length, 0);
		assert.equal(harness.renderedStates.at(-1)?.error, 'Parent Epic is required.');
	} finally {
		harness.restore();
	}
});

test('create issue controller keeps summary validation ahead of required parent validation', async () => {
	const harness = await createValidationHarness([
		{ id: 'parent', name: 'Parent Epic', required: true, multiline: false, isParentField: true },
	]);

	try {
		await harness.onMessage({
			type: 'createIssue',
			values: {
				summary: '',
				description: '',
				issueType: 'Task',
				status: 'To Do',
				customFields: {
					parent: '',
				},
			},
		});
		await flushAsyncWork();

		assert.equal(harness.createIssueCalls.length, 0);
		assert.equal(harness.renderedStates.at(-1)?.error, 'Summary is required.');
	} finally {
		harness.restore();
	}
});

test('create issue controller allows submit when the parent field is optional', async () => {
	const harness = await createValidationHarness([
		{ id: 'parent', name: 'Parent Epic', required: false, multiline: false, isParentField: true },
	]);

	try {
		await harness.onMessage({
			type: 'createIssue',
			values: {
				summary: 'Child ticket',
				description: '',
				issueType: 'Task',
				status: 'To Do',
				customFields: {
					parent: '',
				},
			},
		});
		await flushAsyncWork();

		assert.equal(harness.createIssueCalls.length, 1);
		assert.equal(harness.renderedStates.at(-1)?.error, undefined);
	} finally {
		harness.restore();
	}
});
```

- [ ] **Step 2: Run the node test file to verify the validation tests fail correctly**

Run: `node --import tsx --test tests/node/createIssueController.node.test.ts`

Expected: FAIL because the controller currently only checks summary and then runs the generic required-field scan, which does not provide parent-specific ordering or a dedicated required-parent gate.

- [ ] **Step 3: Implement the minimal required-parent validation in the controller**

Update `src/controllers/create-issue.controller.ts` in the `message.type === 'createIssue'` branch:

```ts
const values = CreateIssueControllerFactory.sanitizeCreateIssueValues(message.values, state.values, state.statusOptions);
if (!values.summary.trim()) {
	updatePanel({ error: 'Summary is required.', values });
	return;
}

const parentField = (state.createFields ?? []).find(
	(field) => field.required && (field.isParentField || field.id === 'parent')
);
if (parentField && !(values.customFields?.[parentField.id] ?? '').trim()) {
	updatePanel({ error: `${parentField.name} is required.`, values });
	return;
}

const missingRequiredField = (state.createFields ?? []).find(
	(field) =>
		field.required &&
		!(field.isParentField || field.id === 'parent') &&
		!(values.customFields?.[field.id] ?? '').trim()
);
if (missingRequiredField) {
	updatePanel({ error: `${missingRequiredField.name} is required.`, values });
	return;
}
```

This keeps the current validation style intact while making parent required-state explicit and preserving summary-first precedence.

- [ ] **Step 4: Run the node test file again to verify it passes**

Run: `node --import tsx --test tests/node/createIssueController.node.test.ts`

Expected: PASS with the new parent-required validation tests and no regressions in the existing create-controller tests.

- [ ] **Step 5: Commit the validation change**

```bash
git add tests/node/createIssueController.node.test.ts src/controllers/create-issue.controller.ts
git commit -m "feat: validate required parent fields before create"
```

### Task 3: Run Regression Verification On The Full Create Flow

**Files:**
- Modify: none expected unless a regression appears during verification

- [ ] **Step 1: Run the focused create-screen tests together**

Run:

```bash
npx vitest run --config vitest.config.ts tests/dom/createIssuePanel.dom.test.ts
node --import tsx --test tests/node/createIssueController.node.test.ts
```

Expected: PASS for both focused suites.

- [ ] **Step 2: Run the full project test suite**

Run: `npm test`

Expected: PASS with no new failures.

- [ ] **Step 3: Review the final diff for scope**

Run:

```bash
git diff --stat master...HEAD
git diff --name-only master...HEAD
```

Expected:
- only the create-screen renderer, shared parent picker, create controller, and their tests changed
- no edit-screen files beyond shared create-safe rendering changes

- [ ] **Step 4: Commit any final follow-up if verification forced a regression fix**

If no extra changes were needed after `npm test`, skip this step.

If a regression fix was required, commit it with:

```bash
git add <exact-files>
git commit -m "test: finalize create required field validation"
```

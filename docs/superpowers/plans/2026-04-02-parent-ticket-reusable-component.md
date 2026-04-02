# Parent Ticket Reusable Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing create-ticket Parent Ticket card as the single shared renderer for both create and issue details/edit sidebars so the edit surface matches the create surface without changing picker behavior.

**Architecture:** Introduce a focused webview-side renderer class in `src/views/webview/shared-parent-picker.ts` that owns the Parent Ticket card markup, title text, detail text formatting, optional hidden input, and trigger attributes. Keep `JiraWebviewPanel` responsible for deciding when to render the section, but remove the duplicated HTML assembly from both the create and issue details paths by routing both through the shared renderer.

**Tech Stack:** TypeScript, VS Code webviews, JSDOM, Vitest.

---

### Task 1: Lock the expected shared card behavior with failing DOM tests

**Files:**
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('renders the parent field as the shared parent picker card in create issue', () => {
	const { dom, scriptErrors } = renderCreateIssuePanelDom({
		createFields: [
			{
				id: 'parent',
				name: 'Parent',
				required: true,
				multiline: false,
				isParentField: true,
			},
		],
		values: {
			customFields: {
				parent: 'PROJ-123',
			},
		},
		selectedParentIssue: {
			key: 'PROJ-123',
			summary: 'Parent issue summary',
			statusName: 'In Progress',
			url: 'https://jira.example.test/browse/PROJ-123',
		},
	} as any);
	expect(scriptErrors).toEqual([]);

	const parentCard = dom.window.document.querySelector(
		'.issue-sidebar .parent-picker-card'
	) as HTMLButtonElement | null;
	const title = parentCard?.querySelector('.parent-picker-card-title');
	const detail = parentCard?.querySelector('.parent-picker-card-detail');
	expect(parentCard).toBeTruthy();
	expect(title?.textContent).toBe('Choose a parent ticket');
	expect(detail?.textContent).toContain('PROJ-123 - Parent issue summary');
});

it('renders the issue parent section as the shared parent picker card', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		parent: {
			key: 'PROJ-123',
			summary: 'Parent issue summary',
			statusName: 'In Progress',
			url: 'https://jira.example.test/browse/PROJ-123',
		},
	});
	expect(scriptErrors).toEqual([]);

	const parentCard = dom.window.document.querySelector(
		'.issue-sidebar .parent-picker-card'
	) as HTMLButtonElement | null;
	const title = parentCard?.querySelector('.parent-picker-card-title');
	const detail = parentCard?.querySelector('.parent-picker-card-detail');
	expect(parentCard).toBeTruthy();
	expect(title?.textContent).toBe('Choose a parent ticket');
	expect(detail?.textContent).toContain('PROJ-123 - Parent issue summary');
	expect(dom.window.document.querySelector('.issue-sidebar .parent-section-body')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:dom -- --run tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts`
Expected: FAIL because the issue details/edit sidebar still renders the old `.parent-section-body` row layout and does not include `.parent-picker-card`.

- [ ] **Step 3: Write the minimal test adjustments for empty-state structure**

```ts
it('renders the empty parent state with the shared detail label in the issue sidebar', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom();
	expect(scriptErrors).toEqual([]);

	const parentSection = Array.from(
		dom.window.document.querySelectorAll('.issue-sidebar .meta-section')
	).find((section) => section.textContent?.includes('Parent Ticket')) as HTMLElement | undefined;
	const detail = dom.window.document.querySelector(
		'.issue-sidebar .parent-picker-card-detail'
	) as HTMLSpanElement | null;
	expect(parentSection).toBeTruthy();
	expect(detail).toBeTruthy();
	expect(detail?.textContent).toContain('No parent selected');
	expect(detail?.textContent).toContain('Unassigned');
	expect(parentSection?.querySelector('.parent-section-body')).toBeNull();
});
```

- [ ] **Step 4: Run the test to verify it still fails for the right reason**

Run: `npm run test:dom -- --run tests/dom/issuePanelEditing.dom.test.ts`
Expected: FAIL with assertions about missing `.parent-picker-card` or lingering `.parent-section-body`, confirming the tests are targeting the current design mismatch instead of unrelated script errors.

- [ ] **Step 5: Commit**

```bash
git add tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts
git commit -m "test: lock shared parent ticket card expectations"
```

### Task 2: Add the shared Parent Ticket renderer and route the create sidebar through it

**Files:**
- Add: `src/views/webview/shared-parent-picker.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps the create parent hidden field wired while using the shared card renderer', () => {
	const { dom, scriptErrors } = renderCreateIssuePanelDom({
		createFields: [
			{
				id: 'parent',
				name: 'Parent',
				required: true,
				multiline: false,
				isParentField: true,
			},
		],
		values: {
			customFields: {
				parent: 'PROJ-321',
			},
		},
		selectedParentIssue: {
			key: 'PROJ-321',
			summary: 'Parent from shared renderer',
			statusName: 'To Do',
			url: 'https://jira.example.test/browse/PROJ-321',
		},
	} as any);
	expect(scriptErrors).toEqual([]);

	const hiddenInput = dom.window.document.querySelector(
		'.issue-sidebar [data-create-custom-field="parent"]'
	) as HTMLInputElement | null;
	const parentCard = dom.window.document.querySelector(
		'.issue-sidebar [data-parent-picker-open].parent-picker-card'
	) as HTMLButtonElement | null;
	expect(hiddenInput?.value).toBe('PROJ-321');
	expect(parentCard?.getAttribute('aria-label')).toBe('Parent Ticket');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:dom -- --run tests/dom/createIssuePanel.dom.test.ts`
Expected: FAIL after the shared renderer assertions are present because `webview.panel.ts` still owns the card HTML inline and the shared renderer file is not implemented.

- [ ] **Step 3: Write the minimal implementation**

```ts
import { JiraRelatedIssue } from '../../model/jira.type';
import { HtmlHelper } from '../../shared/html.helper';

/**
 * Carries the data required to render the shared Parent Ticket picker card.
 */
type SharedParentPickerCardOptions = {
	/** Describes the accessible label announced for the picker trigger. */
	ariaLabel: string;
	/** Carries the Jira field id when the create form needs a hidden input. */
	fieldId?: string;
	/** Carries the Jira field value that the create form submits. */
	fieldValue?: string;
	/** Provides the resolved parent issue shown by the card detail label. */
	selectedParent?: JiraRelatedIssue;
	/** Disables the picker trigger while form submission is pending. */
	disabled?: boolean;
};

/**
 * Renders the shared Parent Ticket picker card used by create and issue detail sidebars.
 */
export class SharedParentPicker {
	/**
	 * Builds the shared card markup and optional hidden input used by the create form.
	 */
	static renderCard(options: SharedParentPickerCardOptions): string {
		const detailLabel = options.selectedParent
			? `${options.selectedParent.key} - ${options.selectedParent.summary ?? options.selectedParent.key}`
			: 'No parent selected - Unassigned';
		const hiddenInput = options.fieldId
			? `<input type="hidden" id="${HtmlHelper.escapeAttribute(options.fieldId)}" data-create-custom-field="${HtmlHelper.escapeAttribute(options.fieldId)}" value="${HtmlHelper.escapeAttribute(options.fieldValue ?? '')}" />`
			: '';
		return `${hiddenInput}<button type="button" class="parent-picker-trigger parent-picker-card" data-parent-picker-open aria-label="${HtmlHelper.escapeAttribute(options.ariaLabel)}" ${options.disabled ? 'disabled' : ''}>
			<span class="parent-picker-card-title">Choose a parent ticket</span>
			<span class="parent-picker-card-detail">${HtmlHelper.escapeHtml(detailLabel)}</span>
		</button>`;
	}
}
```

```ts
import { SharedParentPicker } from './shared-parent-picker';

static renderCreateParentFieldInput(
	state: CreateIssuePanelState,
	field: CreateIssueFieldDefinition,
	value: string,
	disabledAttr: string,
	label: string
): string {
	return `<div class="create-custom-field-label parent-field" data-create-parent-field="${HtmlHelper.escapeAttribute(field.id)}">
		${SharedParentPicker.renderCard({
			ariaLabel: label,
			fieldId: field.id,
			fieldValue: value,
			selectedParent: state.selectedParentIssue,
			disabled: !!disabledAttr,
		})}
	</div>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:dom -- --run tests/dom/createIssuePanel.dom.test.ts`
Expected: PASS. The create sidebar should still submit the hidden parent field value and render the same visible card through `SharedParentPicker.renderCard`.

- [ ] **Step 5: Commit**

```bash
git add src/views/webview/shared-parent-picker.ts src/views/webview/webview.panel.ts tests/dom/createIssuePanel.dom.test.ts
git commit -m "refactor: share create parent ticket card renderer"
```

### Task 3: Move the issue details/edit sidebar to the shared renderer and verify picker behavior

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('opens the parent picker modal from the shared issue parent card', () => {
	const { dom, messages, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		parent: {
			key: 'PROJ-123',
			summary: 'Parent issue summary',
			statusName: 'In Progress',
			url: 'https://jira.example.test/browse/PROJ-123',
		},
	});
	expect(scriptErrors).toEqual([]);

	const parentCard = dom.window.document.querySelector(
		'.issue-sidebar [data-parent-picker-open].parent-picker-card'
	) as HTMLButtonElement | null;
	expect(parentCard).toBeTruthy();

	IssuePanelTestHarness.click(parentCard as Element, dom.window);

	const openMessage = messages.find((message) => message?.type === 'openParentPicker');
	expect(openMessage).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:dom -- --run tests/dom/issuePanelEditing.dom.test.ts`
Expected: FAIL because `renderParentMetadataSection` still returns the old related-issue row plus separate button stack instead of the shared card.

- [ ] **Step 3: Write the minimal implementation**

```ts
static renderParentMetadataSection(issue: JiraIssue): string {
	return `<div class="meta-section">
		<div class="section-title">Parent Ticket</div>
		${SharedParentPicker.renderCard({
			ariaLabel: 'Parent Ticket',
			selectedParent: issue.parent,
		})}
	</div>`;
}
```

```ts
it('renders the issue parent section before assignee using the shared card', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		parent: {
			key: 'PROJ-123',
			summary: 'Parent issue summary',
			statusName: 'In Progress',
			url: 'https://jira.example.test/browse/PROJ-123',
		},
	});
	expect(scriptErrors).toEqual([]);

	const sidebarSections = Array.from(
		dom.window.document.querySelectorAll('.issue-sidebar .meta-section')
	) as HTMLElement[];
	const parentSectionIndex = sidebarSections.findIndex((section) =>
		section.textContent?.includes('Parent Ticket')
	);
	const assigneeSectionIndex = sidebarSections.findIndex((section) =>
		section.textContent?.includes('Assignee')
	);
	expect(parentSectionIndex).toBeGreaterThan(-1);
	expect(assigneeSectionIndex).toBeGreaterThan(-1);
	expect(parentSectionIndex).toBeLessThan(assigneeSectionIndex);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:dom -- --run tests/dom/issuePanelEditing.dom.test.ts`
Expected: PASS. The issue sidebar should now render the same card structure as create and still post `openParentPicker` when clicked.

- [ ] **Step 5: Commit**

```bash
git add src/views/webview/webview.panel.ts tests/dom/issuePanelEditing.dom.test.ts
git commit -m "refactor: reuse parent ticket card in issue sidebar"
```

### Task 4: Run focused and full verification for the shared Parent Ticket renderer

**Files:**
- Modify: `src/views/webview/shared-parent-picker.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Run the focused DOM verification**

```bash
npm run test:dom -- --run tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts
```

Expected: PASS. Both create and issue sidebar DOM suites should be green with the shared card assertions and existing parent-picker click assertions intact.

- [ ] **Step 2: Fix any last shared-renderer regressions**

```ts
/**
 * Normalizes the parent detail label so both create and issue sidebars show the same selection text.
 */
static renderCard(options: SharedParentPickerCardOptions): string {
	const selectedParent = options.selectedParent;
	const detailLabel = selectedParent
		? `${selectedParent.key} - ${selectedParent.summary?.trim() || selectedParent.key}`
		: 'No parent selected - Unassigned';
	// Keep the hidden input optional so the issue sidebar does not render create-only form wiring.
}
```

- [ ] **Step 3: Run the full verification**

Run: `npm test`
Expected: PASS with `test:node`, `test:dom`, and `test:smoke` all green.

- [ ] **Step 4: Commit**

```bash
git add src/views/webview/shared-parent-picker.ts src/views/webview/webview.panel.ts tests/dom/createIssuePanel.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts
git commit -m "test: verify shared parent ticket renderer"
```

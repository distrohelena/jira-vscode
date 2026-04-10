# Edit Assignee Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the issue-details assignee card title read `Assignee` when an assignee already exists, while preserving `Choose an assignee` for unassigned issue-details cards and the create-issue flow.

**Architecture:** Keep the change narrowly scoped to the issue-details assignee card. The initial title comes from [`src/views/webview/webview.panel.ts`](C:/dev/jira-vscode/.worktrees/edit-assignee-title/src/views/webview/webview.panel.ts), and the live picker-driven rewrite comes from [`src/views/webview/assignee-picker.overlay.ts`](C:/dev/jira-vscode/.worktrees/edit-assignee-title/src/views/webview/assignee-picker.overlay.ts), so both layers must apply the same issue-details-only rule while create-issue remains untouched.

**Tech Stack:** TypeScript, VS Code webview HTML, Vitest DOM tests

---

## File Map

- Modify: `src/views/webview/webview.panel.ts`
  - Initial issue-details assignee card title selection.
- Modify: `src/views/webview/assignee-picker.overlay.ts`
  - Live issue-details assignee card title sync after picker selection changes.
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`
  - Issue-details DOM assertions for assigned and unassigned assignee card titles.
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
  - Guardrail proving create-issue still renders `Choose an assignee`.

### Task 1: Issue Details Initial Assignee Card Title

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Test: `tests/dom/issuePanelEditing.dom.test.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Write the failing DOM assertions for initial render behavior**

```ts
it('renders Assignee as the issue-details card title when the issue already has an assignee', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
		assigneeName: 'Helena',
	});
	expect(scriptErrors).toEqual([]);

	const assigneeCardTitle = dom.window.document.querySelector(
		'.issue-sidebar .assignee-picker-card-title'
	) as HTMLSpanElement | null;

	expect(assigneeCardTitle?.textContent?.trim()).toBe('Assignee');
});

it('keeps Choose an assignee as the issue-details card title when the issue is unassigned', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom();
	expect(scriptErrors).toEqual([]);

	const assigneeCardTitle = dom.window.document.querySelector(
		'.issue-sidebar .assignee-picker-card-title'
	) as HTMLSpanElement | null;

	expect(assigneeCardTitle?.textContent?.trim()).toBe('Choose an assignee');
});
```

```ts
it('keeps Choose an assignee as the create-issue card title', () => {
	const { dom, scriptErrors } = renderCreateIssuePanelDom({
		currentUser: {
			accountId: 'acct-123',
			displayName: 'Helena',
		},
	});
	expect(scriptErrors).toEqual([]);

	const assigneeCardTitle = dom.window.document.querySelector(
		'.issue-sidebar .assignee-picker-card-title'
	) as HTMLSpanElement | null;

	expect(assigneeCardTitle?.textContent?.trim()).toBe('Choose an assignee');
});
```

- [ ] **Step 2: Run the focused DOM tests to verify the new expectations fail**

Run: `npx vitest run --config vitest.config.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: FAIL because the issue-details assignee renderer in `webview.panel.ts` still hardcodes `Choose an assignee` even when `issue.assigneeName` exists.

- [ ] **Step 3: Write the minimal issue-details renderer change**

```ts
static renderAssigneeControl(
	issue: JiraIssue,
	currentAssigneeLabel: string,
	options?: IssuePanelOptions
): string {
	const disabledAttr = options?.assigneePending ? 'disabled' : '';
	const assigneeCardTitle = currentAssigneeLabel?.trim() ? 'Assignee' : 'Choose an assignee';
```

```ts
<span style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0;">
	<span class="assignee-picker-card-title">${HtmlHelper.escapeHtml(assigneeCardTitle)}</span>
	<span class="assignee-picker-card-detail">${HtmlHelper.escapeHtml(currentAssigneeLabel || 'Unassigned')}</span>
</span>
```

- [ ] **Step 4: Run the focused DOM tests again**

Run: `npx vitest run --config vitest.config.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: PASS with issue-details showing `Assignee` only when already assigned, and create-issue still showing `Choose an assignee`.

- [ ] **Step 5: Commit the initial-render change**

```bash
git add tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts src/views/webview/webview.panel.ts
git commit -m "feat: adjust issue assignee card title"
```

### Task 2: Assignee Picker Sync Keeps The Edit-Only Title Rule

**Files:**
- Modify: `src/views/webview/assignee-picker.overlay.ts`
- Test: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the failing DOM assertion for picker-driven issue-details updates**

```ts
it('keeps Assignee as the issue-details card title after picker selection updates', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom();
	expect(scriptErrors).toEqual([]);

	const assigneeButton = dom.window.document.querySelector(
		'.issue-sidebar [data-assignee-picker-open]'
	) as HTMLButtonElement | null;
	expect(assigneeButton).toBeTruthy();

	dom.window.dispatchEvent(
		new dom.window.MessageEvent('message', {
			data: {
				type: 'assigneePickerSelectionApplied',
				user: {
					accountId: 'acct-123',
					displayName: 'Helena',
					avatarUrl: 'https://jira.example.test/avatar.png',
				},
			},
		})
	);

	const selectedText = assigneeButton?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	expect(selectedText).toContain('Assignee');
	expect(selectedText).toContain('Helena');
});
```

- [ ] **Step 2: Run the focused issue-details DOM suite to confirm the sync still resets to the old title**

Run: `npx vitest run --config vitest.config.ts tests/dom/issuePanelEditing.dom.test.ts`

Expected: FAIL because the issue-details sync logic in `assignee-picker.overlay.ts` still sets `titleEl.textContent = 'Choose an assignee'` after a user is applied.

- [ ] **Step 3: Write the minimal sync change for the issue-details card**

```ts
const assigneePickerSyncIssueDetailsAssigneeField = (user) => {
	const field = document.querySelector('.issue-sidebar .assignee-card');
	if (!field) {
		return;
	}
	const titleEl = field.querySelector('.assignee-picker-card-title');
	const detailEl = field.querySelector('.assignee-picker-card-detail');
	const avatarSlot = field.querySelector('[data-assignee-card-avatar]');
```

```ts
if (!user) {
	if (titleEl) {
		titleEl.textContent = 'Choose an assignee';
	}
	if (detailEl) {
		detailEl.textContent = 'Unassigned';
	}
	applyAvatar('Unassigned', '');
	return;
}

if (titleEl) {
	titleEl.textContent = 'Assignee';
}
if (detailEl) {
	detailEl.textContent = user.displayName || user.accountId || 'Assigned';
}
applyAvatar(user.displayName || user.accountId || 'Assigned', user.avatarUrl || '');
```

```ts
if (message.type === 'assigneePickerSelectionApplied') {
	assigneePickerSyncCreateAssigneeField(message.user);
	assigneePickerSyncIssueDetailsAssigneeField(message.user);
}
```

- [ ] **Step 4: Run the focused DOM suite again**

Run: `npx vitest run --config vitest.config.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: PASS with issue-details keeping `Assignee` after picker updates and create-issue behavior unchanged.

- [ ] **Step 5: Commit the sync-path change**

```bash
git add tests/dom/issuePanelEditing.dom.test.ts src/views/webview/assignee-picker.overlay.ts
git commit -m "feat: preserve issue assignee title after picker updates"
```

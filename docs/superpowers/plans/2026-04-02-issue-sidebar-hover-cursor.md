# Issue Sidebar Hover Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a pointer cursor on hover for the issue details/edit sidebar Parent Ticket and Assignee controls without changing the create-ticket flow.

**Architecture:** Keep this as a CSS-only issue-sidebar refinement inside the existing webview stylesheet block in `src/views/webview/webview.panel.ts`. Lock the scoped behavior with one focused DOM test in the issue-panel suite so the rule stays attached to the edit/details controls only.

**Tech Stack:** TypeScript, VS Code webviews, Vitest, JSDOM.

---

### Task 1: Scope the hover-cursor contract to issue-sidebar interactive cards

**Files:**
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('includes a pointer cursor rule for the issue sidebar parent and assignee picker cards', () => {
	const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom();
	expect(scriptErrors).toEqual([]);

	const stylesheet = dom.window.document.head.innerHTML;
	expect(stylesheet).toContain('.issue-sidebar [data-parent-picker-open]');
	expect(stylesheet).toContain('.issue-sidebar [data-assignee-picker-open]');
	expect(stylesheet).toContain('cursor: pointer');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:dom -- --run tests/dom/issuePanelEditing.dom.test.ts`
Expected: FAIL because the stylesheet does not yet include an issue-sidebar-scoped cursor rule for those selectors.

- [ ] **Step 3: Commit**

```bash
git add tests/dom/issuePanelEditing.dom.test.ts
git commit -m "test: lock issue sidebar hover cursor contract"
```

### Task 2: Add the scoped issue-sidebar cursor rule

**Files:**
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`

- [ ] **Step 1: Write the minimal implementation**

```ts
.issue-sidebar [data-parent-picker-open],
.issue-sidebar [data-assignee-picker-open] {
	cursor: pointer;
}

.issue-sidebar [data-parent-picker-open]:disabled,
.issue-sidebar [data-assignee-picker-open]:disabled {
	cursor: not-allowed;
}
```

- [ ] **Step 2: Run the focused test to verify it passes**

Run: `npm run test:dom -- --run tests/dom/issuePanelEditing.dom.test.ts`
Expected: PASS.

- [ ] **Step 3: Run create-panel regression coverage**

Run: `npm run test:dom -- --run tests/dom/createIssuePanel.dom.test.ts`
Expected: PASS, confirming the create flow remains unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/views/webview/webview.panel.ts tests/dom/issuePanelEditing.dom.test.ts
git commit -m "style: add issue sidebar hover cursor"
```

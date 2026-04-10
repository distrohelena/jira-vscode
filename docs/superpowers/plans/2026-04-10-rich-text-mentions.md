# Rich Text Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real Jira `@mentions` to every shared rich text field, keep wiki mode as read-only visualization, and migrate shared rich text submit paths to Atlassian Document Format.

**Architecture:** Keep the shared Tiptap editor shell, but make ADF the canonical document contract and treat wiki as preview-only text generated from the live visual document. Add one mention extension/controller inside the editor runtime, one DOM event bridge between the webview and extension host for candidate lookup, and extension-side services/controllers that rank issue participants first and expand with assignable Jira users.

**Tech Stack:** TypeScript, Tiptap, VS Code webviews, Atlassian Document Format, Vitest, node:test, JSDOM.

---

## File Map

- `package.json`
  - Adds the official Tiptap mention dependencies used by the shared editor bundle.
- `package-lock.json`
  - Records the resolved mention dependency graph.
- `src/model/jira.type.ts`
  - Adds ADF document types, shared rich text payload types, and mention candidate DTOs.
- `src/model/jira-api.client.ts`
  - Maps Jira issue/comment ADF payloads, sends ADF for comments and description updates, and creates issues with ADF descriptions.
- `src/jira-api/services/jira-api.client.ts`
  - Exposes the new ADF-aware client methods through the service wrapper.
- `src/jira-api/contracts/jira-api.client.contract.ts`
  - Updates the client contract signatures for ADF-backed rich text operations.
- `src/views/webview/editors/jira-adf-document-codec.ts`
  - Converts between editor content, Jira ADF, readable plain text, and wiki preview text.
- `src/views/webview/editors/jira-wiki-document-codec.ts`
  - Stays as the legacy import fallback and preview helper for non-ADF content.
- `src/views/webview/editors/rich-text-editor.view.ts`
  - Renders the hidden ADF field, read-only wiki preview surface, and serialized mention context contract.
- `src/views/webview/editors/rich-text-editor.controller.ts`
  - Seeds the editor from ADF, keeps hidden preview/ADF fields synchronized, and owns mention bridge wiring.
- `src/views/webview/editors/rich-text-editor.behavior.ts`
  - Coordinates keyboard behavior with the mention popup so arrow and enter keys do the right thing.
- `src/views/webview/editors/rich-text-mention.extension.ts`
  - Creates the shared Tiptap mention node/extension.
- `src/views/webview/editors/rich-text-mention.controller.ts`
  - Detects active `@query` tokens, renders the popup, requests candidates, and inserts mention nodes.
- `src/views/webview/editors/rich-text-mention-host.bridge.ts`
  - Bridges candidate requests/results between editor hosts and the outer webview script through DOM events.
- `src/views/webview/webview.panel.ts`
  - Emits mention context for each rich text host, forwards candidate requests to the extension host, and posts ADF payloads on submit.
- `src/services/issue-mention-candidate.service.ts`
  - Builds local issue participant candidates and merges them with remote assignable users.
- `src/services/project-assignable-mention.service.ts`
  - Wraps assignable-user search so controllers can request normalized mention candidates.
- `src/controllers/issue.controller.ts`
  - Handles mention-candidate requests for issue-bound editors and accepts ADF-rich comment/description payloads.
- `src/controllers/create-issue.controller.ts`
  - Handles mention-candidate requests for create-issue editors and accepts ADF-backed description payloads.
- `tests/node/jiraAdfDocumentCodec.node.test.ts`
  - Verifies ADF parsing, serialization, preview rendering, and mention-node roundtrips.
- `tests/node/jiraApiTransport.node.test.ts`
  - Verifies the Jira transport sends ADF for comments, descriptions, and create-issue payloads.
- `tests/node/issueMentionCandidateService.node.test.ts`
  - Verifies participant ranking and deduplication.
- `tests/node/createIssueController.node.test.ts`
  - Verifies create-issue mention lookups and ADF description submission.
- `tests/node/issueController.node.test.ts`
  - Verifies issue-panel mention lookups and ADF comment/description submission.
- `tests/dom/support/richTextEditorDomTestHarness.ts`
  - Exposes hidden preview/ADF fields, wiki preview, and mention helpers for DOM tests.
- `tests/dom/richTextEditorView.dom.test.ts`
  - Verifies the shared editor host contract for read-only wiki preview plus hidden ADF state.
- `tests/dom/richTextEditorController.dom.test.ts`
  - Verifies ADF synchronization, read-only wiki mode, and shared editor lifecycle.
- `tests/dom/richTextMentionController.dom.test.ts`
  - Verifies popup open/close, keyboard selection, mouse selection, and mention insertion.
- `tests/dom/richTextEditor.dom.test.ts`
  - Verifies comment-composer integration uses mention lookup and posts ADF payloads.
- `tests/dom/issuePanelEditing.dom.test.ts`
  - Verifies issue description edit and comment edit integration use mention lookup and ADF payloads.
- `tests/dom/createIssuePanel.dom.test.ts`
  - Verifies create-issue description integration uses mention lookup and ADF payloads.

## Task 1: Add The Shared ADF And Mention Document Contract

**Files:**
- Create: `src/views/webview/editors/jira-adf-document-codec.ts`
- Modify: `src/model/jira.type.ts`
- Create: `tests/node/jiraAdfDocumentCodec.node.test.ts`
- Test: `tests/node/jiraAdfDocumentCodec.node.test.ts`

- [ ] **Step 1: Write the failing ADF codec tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraAdfDocumentCodec } from '../../src/views/webview/editors/jira-adf-document-codec';
import type { JiraAdfDocument } from '../../src/model/jira.type';

test('convertAdfToWikiPreview renders mention nodes as readable @Display Name text', () => {
	const document: JiraAdfDocument = {
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Hello ' },
					{
						type: 'mention',
						attrs: {
							id: 'acct-123',
							text: '@Helena',
							userType: 'DEFAULT',
						},
					},
				],
			},
		],
	};

	assert.equal(JiraAdfDocumentCodec.convertAdfToWikiPreview(document), 'Hello @Helena');
});

test('parseSerializedDocument round-trips a mention-bearing ADF payload', () => {
	const serialized = JSON.stringify({
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: {
							id: 'acct-123',
							text: '@Helena',
							userType: 'DEFAULT',
						},
					},
				],
			},
		],
	});

	const parsed = JiraAdfDocumentCodec.parseSerializedDocument(serialized);
	assert.equal(parsed?.content[0]?.type, 'paragraph');
	assert.equal((parsed?.content[0] as any).content?.[0]?.type, 'mention');
	assert.equal(((parsed?.content[0] as any).content?.[0] as any).attrs?.id, 'acct-123');
});

test('extractPlainText collapses mention nodes into readable inline text', () => {
	const document: JiraAdfDocument = {
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Ping ' },
					{
						type: 'mention',
						attrs: {
							id: 'acct-123',
							text: '@Helena',
						},
					},
					{ type: 'text', text: ' please' },
				],
			},
		],
	};

	assert.equal(JiraAdfDocumentCodec.extractPlainText(document), 'Ping @Helena please');
});
```

- [ ] **Step 2: Run the codec test to verify it fails**

Run: `node --test tests/node/jiraAdfDocumentCodec.node.test.ts`

Expected: FAIL because `src/views/webview/editors/jira-adf-document-codec.ts` does not exist and `JiraAdfDocument` is not defined in `src/model/jira.type.ts`.

- [ ] **Step 3: Add the ADF types and shared codec**

```ts
export type JiraAdfMark = {
	type: 'strong' | 'em' | 'underline' | 'link';
	attrs?: Record<string, string>;
};

export type JiraAdfTextNode = {
	type: 'text';
	text: string;
	marks?: JiraAdfMark[];
};

export type JiraAdfMentionNode = {
	type: 'mention';
	attrs: {
		id: string;
		text?: string;
		userType?: string;
		accessLevel?: string;
	};
};

export type JiraAdfHardBreakNode = {
	type: 'hardBreak';
};

export type JiraAdfParagraphNode = {
	type: 'paragraph';
	content?: JiraAdfInlineNode[];
};

export type JiraAdfListItemNode = {
	type: 'listItem';
	content: JiraAdfBlockNode[];
};

export type JiraAdfBulletListNode = {
	type: 'bulletList';
	content: JiraAdfListItemNode[];
};

export type JiraAdfOrderedListNode = {
	type: 'orderedList';
	content: JiraAdfListItemNode[];
};

export type JiraAdfInlineNode = JiraAdfTextNode | JiraAdfMentionNode | JiraAdfHardBreakNode;
export type JiraAdfBlockNode = JiraAdfParagraphNode | JiraAdfBulletListNode | JiraAdfOrderedListNode | JiraAdfListItemNode;

export type JiraAdfDocument = {
	type: 'doc';
	version: 1;
	content: JiraAdfBlockNode[];
};

export type RichTextMentionCandidate = {
	accountId: string;
	displayName: string;
	mentionText: string;
	avatarUrl?: string;
	userType?: 'DEFAULT' | 'SPECIAL' | 'APP';
	source: 'participant' | 'assignable';
};
```

```ts
export class JiraAdfDocumentCodec {
	static parseSerializedDocument(serialized: string | undefined): JiraAdfDocument | undefined {
		if (!serialized?.trim()) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(serialized) as JiraAdfDocument;
			return parsed?.type === 'doc' && parsed.version === 1 ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	static stringifyDocument(document: JiraAdfDocument | undefined): string {
		return document ? JSON.stringify(document) : '';
	}

	static convertAdfToWikiPreview(document: JiraAdfDocument | undefined): string {
		if (!document) {
			return '';
		}

		return document.content
			.map((node) => JiraAdfDocumentCodec.serializeBlockNode(node))
			.filter((value) => value.length > 0)
			.join('\n\n')
			.trim();
	}

	static extractPlainText(document: JiraAdfDocument | undefined): string {
		if (!document) {
			return '';
		}

		return document.content
			.map((node) => JiraAdfDocumentCodec.collectBlockText(node))
			.filter((value) => value.length > 0)
			.join('\n\n')
			.trim();
	}

	static convertAdfToEditorHtml(document: JiraAdfDocument | undefined): string {
		if (!document || document.content.length === 0) {
			return '<p></p>';
		}

		return document.content.map((node) => JiraAdfDocumentCodec.serializeBlockNodeToHtml(node)).join('');
	}

	static convertEditorHtmlToAdf(html: string): JiraAdfDocument {
		const wikiPreview = JiraWikiDocumentCodec.convertEditorHtmlToWiki(html);
		return JiraAdfDocumentCodec.buildDocumentFromPlainText(wikiPreview);
	}

	static buildDocumentFromPlainText(text: string): JiraAdfDocument {
		const normalized = text.replace(/\r\n?/g, '\n').trim();
		if (!normalized) {
			return {
				type: 'doc',
				version: 1,
				content: [{ type: 'paragraph', content: [] }],
			};
		}

		return {
			type: 'doc',
			version: 1,
			content: normalized.split(/\n{2,}/).map((paragraph) => ({
				type: 'paragraph',
				content: paragraph.split('\n').flatMap((line, index, lines) => {
					const parts: JiraAdfInlineNode[] = [];
					if (line.length > 0) {
						parts.push({ type: 'text', text: line });
					}
					if (index < lines.length - 1) {
						parts.push({ type: 'hardBreak' });
					}
					return parts;
				}),
			})),
		};
	}

	private static serializeInlineNode(node: JiraAdfInlineNode): string {
		if (node.type === 'text') {
			return node.text;
		}

		if (node.type === 'hardBreak') {
			return '\\\\';
		}

		return node.attrs.text?.trim() || '@unknown';
	}
}
```

- [ ] **Step 4: Run the codec test to verify it passes**

Run: `node --test tests/node/jiraAdfDocumentCodec.node.test.ts`

Expected: PASS with all three codec tests green.

- [ ] **Step 5: Commit the shared ADF contract**

```bash
git add src/model/jira.type.ts src/views/webview/editors/jira-adf-document-codec.ts tests/node/jiraAdfDocumentCodec.node.test.ts
git commit -m "feat: add shared jira adf rich text contract"
```

## Task 2: Migrate Jira Transport And Models To ADF-Backed Rich Text

**Files:**
- Modify: `src/model/jira.type.ts`
- Modify: `src/model/jira-api.client.ts`
- Modify: `src/jira-api/services/jira-api.client.ts`
- Modify: `src/jira-api/contracts/jira-api.client.contract.ts`
- Modify: `tests/node/jiraApiTransport.node.test.ts`
- Test: `tests/node/jiraApiTransport.node.test.ts`

- [ ] **Step 1: Write the failing transport tests**

```ts
test('mapIssueInternal preserves ADF description payloads and extracts readable text', () => {
	const issue = (JiraApiTransport as any).mapIssueInternal(
		{
			id: '10001',
			key: 'PROJ-1',
			fields: {
				summary: 'ADF issue',
				status: { name: 'In Progress' },
				description: {
					type: 'doc',
					version: 1,
					content: [
						{
							type: 'paragraph',
							content: [
								{ type: 'text', text: 'Hello ' },
								{
									type: 'mention',
									attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
								},
							],
						},
					],
				},
				updated: '2026-04-10T12:00:00.000Z',
			},
		},
		'https://example.atlassian.net'
	);

	assert.equal(issue.description, 'Hello @Helena');
	assert.equal(issue.descriptionDocument?.type, 'doc');
	assert.equal(issue.descriptionHtml?.includes('@Helena'), true);
});

test('updateIssueDescriptionInternal sends ADF instead of plain text for cloud rich text fields', async () => {
	const originalPut = axios.put;
	let capturedBody: any;
	axios.put = (async (_url: string, body: any) => {
		capturedBody = body;
		return { data: {} };
	}) as typeof axios.put;

	try {
		await (JiraApiTransport as any).updateIssueDescriptionInternal(
			{
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			'token-123',
			'PROJ-1',
			{
				type: 'doc',
				version: 1,
				content: [
					{
						type: 'paragraph',
						content: [
							{
								type: 'mention',
								attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
							},
						],
					},
				],
			}
		);
	} finally {
		axios.put = originalPut;
	}

	assert.deepEqual(capturedBody, {
		fields: {
			description: {
				type: 'doc',
				version: 1,
				content: [
					{
						type: 'paragraph',
						content: [
							{
								type: 'mention',
								attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
							},
						],
					},
				],
			},
		},
	});
});

test('addIssueCommentInternal sends ADF mention nodes through the comment body', async () => {
	const originalPost = axios.post;
	let capturedBody: any;
	axios.post = (async (_url: string, body: any) => {
		capturedBody = body;
		return {
			data: {
				id: '10000',
				body: body.body,
				author: { displayName: 'Helena', accountId: 'acct-123' },
			},
		};
	}) as typeof axios.post;

	try {
		await (JiraApiTransport as any).addIssueCommentInternal(
			{
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			'token-123',
			'PROJ-1',
			{
				type: 'doc',
				version: 1,
				content: [
					{
						type: 'paragraph',
						content: [
							{
								type: 'mention',
								attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
							},
						],
					},
				],
			},
			undefined
		);
	} finally {
		axios.post = originalPost;
	}

	assert.equal(capturedBody.body.content[0].content[0].type, 'mention');
	assert.equal(capturedBody.body.content[0].content[0].attrs.id, 'acct-123');
});
```

- [ ] **Step 2: Run the transport test suite to verify it fails**

Run: `node --test tests/node/jiraApiTransport.node.test.ts`

Expected: FAIL because `JiraIssue` has no `descriptionDocument`, `updateIssueDescriptionInternal` still expects a string, and `addIssueCommentInternal` still accepts the legacy `body + format` contract.

- [ ] **Step 3: Update the transport, contracts, and mapped models to use ADF**

```ts
export type JiraRichTextPayload = {
	adf: JiraAdfDocument;
	preview: string;
};

export type JiraIssue = {
	// existing fields...
	description?: string;
	descriptionHtml?: string;
	descriptionDocument?: JiraAdfDocument;
};

export type CreateIssueFormValues = {
	summary: string;
	description: string;
	descriptionDocument?: JiraAdfDocument;
	issueType: string;
	status: string;
	// existing fields...
};
```

```ts
async updateIssueDescription(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	descriptionDocument?: JiraAdfDocument
): Promise<void> {
	return JiraApiTransport.updateIssueDescription(authInfo, token, issueKey, descriptionDocument);
}

async addIssueComment(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	bodyDocument: JiraAdfDocument,
	parentId?: string
): Promise<JiraIssueComment> {
	return JiraApiTransport.addIssueComment(authInfo, token, issueKey, bodyDocument, parentId);
}
```

```ts
static async updateIssueDescriptionInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	descriptionDocument?: JiraAdfDocument
): Promise<void> {
	const descriptionValue = descriptionDocument && descriptionDocument.content.length > 0
		? descriptionDocument
		: null;

	await axios.put(endpoint, {
		fields: {
			description: descriptionValue,
		},
	}, requestOptions);
}

static async addIssueCommentInternal(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	bodyDocument: JiraAdfDocument,
	parentId?: string
): Promise<JiraIssueComment> {
	const payload: Record<string, unknown> = {
		body: bodyDocument,
	};
	if (parentId) {
		payload.parentId = parentId;
	}

	const response = await axios.post(endpoint, payload, requestOptions);
	return mapIssueComment(response.data, authInfo)!;
}

static async createJiraIssueInternal(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	values: CreateIssueFormValues
): Promise<JiraIssue> {
	const payload = {
		fields: {
			project: { key: projectKey },
			summary: values.summary.trim(),
			description: values.descriptionDocument && values.descriptionDocument.content.length > 0
				? values.descriptionDocument
				: undefined,
			issuetype: { name: values.issueType?.trim() || 'Task' },
		},
	};
}
```

```ts
const rawDescription = fields?.description;
const descriptionDocument =
	rawDescription && typeof rawDescription === 'object' && !Array.isArray(rawDescription)
		? (rawDescription as JiraAdfDocument)
		: undefined;
const descriptionText = descriptionDocument
	? JiraAdfDocumentCodec.extractPlainText(descriptionDocument)
	: (typeof rawDescription === 'string' ? rawDescription : undefined);
const descriptionHtml = renderedDescription
	? HtmlHelper.sanitizeRenderedHtml(renderedDescription)
	: descriptionDocument
	? JiraAdfDocumentCodec.convertAdfToEditorHtml(descriptionDocument)
	: (typeof rawDescription === 'string'
		? `<p>${HtmlHelper.escapeHtml(rawDescription).replace(/\r?\n/g, '<br />')}</p>`
		: undefined);
```

- [ ] **Step 4: Run the transport test suite to verify it passes**

Run: `node --test tests/node/jiraApiTransport.node.test.ts`

Expected: PASS with the new ADF mapping and payload tests green.

- [ ] **Step 5: Commit the ADF transport migration**

```bash
git add src/model/jira.type.ts src/model/jira-api.client.ts src/jira-api/services/jira-api.client.ts src/jira-api/contracts/jira-api.client.contract.ts tests/node/jiraApiTransport.node.test.ts
git commit -m "feat: send jira rich text payloads as adf"
```

## Task 3: Change The Shared Editor Contract To Canonical ADF Plus Read-Only Wiki Preview

**Files:**
- Modify: `src/views/webview/editors/rich-text-editor.view.ts`
- Modify: `src/views/webview/editors/rich-text-editor.controller.ts`
- Modify: `src/views/webview/editors/rich-text-toolbar.controller.ts`
- Modify: `tests/dom/support/richTextEditorDomTestHarness.ts`
- Modify: `tests/dom/richTextEditorView.dom.test.ts`
- Modify: `tests/dom/richTextEditorController.dom.test.ts`
- Test: `tests/dom/richTextEditorView.dom.test.ts`
- Test: `tests/dom/richTextEditorController.dom.test.ts`

- [ ] **Step 1: Write the failing shared-editor contract tests**

```ts
it('renders a hidden canonical adf field and a read-only wiki preview surface', () => {
	const host = document.createElement('div');
	host.innerHTML = RichTextEditorView.render({
		fieldId: 'description',
		fieldName: 'description',
		value: 'Hello @Helena',
		adfValue: '{"type":"doc","version":1,"content":[]}',
		plainValue: 'Hello @Helena',
		placeholder: 'Describe the issue',
	});

	const previewField = host.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;
	const adfField = host.querySelector('.jira-rich-editor-adf') as HTMLTextAreaElement | null;
	const wikiPreview = host.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement | null;

	expect(previewField?.value).toBe('Hello @Helena');
	expect(adfField?.value).toBe('{"type":"doc","version":1,"content":[]}');
	expect(wikiPreview?.readOnly).toBe(true);
});
```

```ts
it('switches to wiki mode without reparsing user edits back into the visual document', () => {
	const harness = new RichTextEditorDomTestHarness({
		value: 'Hello @Helena',
		adfValue: JSON.stringify({
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'paragraph',
					content: [
						{
							type: 'mention',
							attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
						},
					],
				},
			],
		}),
		plainValue: 'Hello @Helena',
	});

	harness.initialize();
	harness.click(harness.getModeToggleButton());
	expect(harness.host.getAttribute('data-mode')).toBe('wiki');
	expect(harness.plainTextarea.readOnly).toBe(true);

	harness.plainTextarea.value = 'Changed preview only';
	harness.click(harness.getModeToggleButton());

	expect(harness.host.getAttribute('data-mode')).toBe('visual');
	expect(harness.getAdfValueField().value).toContain('"mention"');
	expect(harness.getPreviewValueField().value).toBe('Hello @Helena');
});
```

- [ ] **Step 2: Run the shared-editor DOM suites to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts tests/dom/richTextEditorController.dom.test.ts`

Expected: FAIL because `RichTextEditorView.render` does not expose `.jira-rich-editor-adf`, wiki mode is still editable, and the controller still reparses wiki textarea changes.

- [ ] **Step 3: Update the shared editor view and controller contract**

```ts
export type RichTextEditorViewOptions = {
	fieldId: string;
	fieldName: string;
	value: string;
	adfValue?: string;
	plainValue: string;
	placeholder: string;
	editorId?: string;
	mentionContextJson?: string;
	disabled?: boolean;
	mode?: RichTextEditorViewMode;
	ariaLabelledById?: string;
};
```

```ts
return `<div
	class="jira-rich-editor-host"
	data-jira-rich-editor
	data-mode="${toolbarStateAttr}"
	data-editor-id="${HtmlHelper.escapeAttribute(options.editorId ?? options.fieldId)}"
>
	<div class="jira-rich-editor-toolbar" role="toolbar" aria-label="Rich text editor formatting">
		<!-- existing buttons -->
	</div>
	<div class="jira-rich-editor-frame">
		<div class="jira-rich-editor-surface jira-rich-editor-visual" ...></div>
		<textarea
			class="jira-rich-editor-plain"
			id="${fieldId}-plain"
			readonly
			aria-readonly="true"
			...
		>${plainValue}</textarea>
	</div>
	<textarea class="jira-rich-editor-value" id="${fieldId}" name="${fieldName}" hidden aria-hidden="true">${value}</textarea>
	<textarea class="jira-rich-editor-adf" id="${fieldId}-adf" hidden aria-hidden="true">${HtmlHelper.escapeHtml(options.adfValue ?? '')}</textarea>
	<script type="application/json" class="jira-rich-editor-mention-context">${options.mentionContextJson ?? '{}'}</script>
</div>`;
```

```ts
private readonly adfValueField: HTMLTextAreaElement;

private createEditor(): Editor {
	const initialAdf = JiraAdfDocumentCodec.parseSerializedDocument(this.adfValueField.value);
	const initialHtml = initialAdf
		? JiraAdfDocumentCodec.convertAdfToEditorHtml(initialAdf)
		: JiraWikiDocumentCodec.convertWikiToEditorHtml(this.resolvePreviewValue());

	return new Editor({
		element: this.mountedSurface,
		content: initialHtml,
		// existing editor options
	});
}

private synchronizeSerializedFieldsFromEditor(): void {
	const adfDocument = JiraAdfDocumentCodec.convertEditorHtmlToAdf(this.editor.getHTML());
	this.adfValueField.value = JiraAdfDocumentCodec.stringifyDocument(adfDocument);
	this.hiddenValueField.value = JiraAdfDocumentCodec.extractPlainText(adfDocument);
	this.plainTextarea.value = JiraAdfDocumentCodec.convertAdfToWikiPreview(adfDocument);
	this.applyMountedSurfaceState(this.editor.isEmpty);
}

private setMode(mode: RichTextEditorViewMode): void {
	if (mode === this.currentMode) {
		this.toolbarController.refreshState();
		return;
	}

	if (mode === 'wiki') {
		this.synchronizeSerializedFieldsFromEditor();
		this.resolveMountedEditorElement()?.blur();
	}

	this.currentMode = mode;
	this.applyCurrentMode();
	this.toolbarController.refreshState();
}
```

- [ ] **Step 4: Run the shared-editor DOM suites to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditorView.dom.test.ts tests/dom/richTextEditorController.dom.test.ts`

Expected: PASS with the hidden ADF contract and read-only wiki preview behavior green.

- [ ] **Step 5: Commit the shared editor contract migration**

```bash
git add src/views/webview/editors/rich-text-editor.view.ts src/views/webview/editors/rich-text-editor.controller.ts src/views/webview/editors/rich-text-toolbar.controller.ts tests/dom/support/richTextEditorDomTestHarness.ts tests/dom/richTextEditorView.dom.test.ts tests/dom/richTextEditorController.dom.test.ts
git commit -m "refactor: make shared rich text editor adf-backed"
```

## Task 4: Add The Shared Mention Extension, Popup, And Host Bridge

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/views/webview/editors/rich-text-mention.extension.ts`
- Create: `src/views/webview/editors/rich-text-mention.controller.ts`
- Create: `src/views/webview/editors/rich-text-mention-host.bridge.ts`
- Modify: `src/views/webview/editors/rich-text-editor.behavior.ts`
- Modify: `src/views/webview/editors/rich-text-editor.controller.ts`
- Create: `tests/dom/richTextMentionController.dom.test.ts`
- Modify: `tests/dom/support/richTextEditorDomTestHarness.ts`
- Test: `tests/dom/richTextMentionController.dom.test.ts`

- [ ] **Step 1: Install the official Tiptap mention dependencies**

Run: `npm install @tiptap/extension-mention @tiptap/suggestion`

Expected: `package.json` and `package-lock.json` update with the new dependencies and no install errors.

- [ ] **Step 2: Write the failing mention DOM tests**

```ts
it('opens a compact mention popup when the user types @ and inserts the selected account as a mention node', async () => {
	const harness = new RichTextEditorDomTestHarness({
		value: '',
		plainValue: '',
		adfValue: '',
		mentionContextJson: JSON.stringify({
			editorId: 'comment-input',
			scope: 'issue',
			participants: [
				{
					accountId: 'acct-123',
					displayName: 'Helena',
					mentionText: '@Helena',
					source: 'participant',
				},
			],
		}),
	});

	harness.initialize();
	harness.typeInEditor('@He');

	const popup = await harness.findMentionPopup();
	expect(popup).toBeTruthy();
	expect(popup?.textContent).toContain('@Helena');

	harness.pressEditorKey('ArrowDown');
	harness.pressEditorKey('Enter');

	expect(harness.getEditorHtml()).toContain('data-mention-id="acct-123"');
	expect(harness.getPreviewValueField().value).toContain('@Helena');
	expect(harness.getAdfValueField().value).toContain('"type":"mention"');
	expect(harness.getAdfValueField().value).toContain('"id":"acct-123"');
});

it('closes the mention popup on escape without mutating the document', async () => {
	const harness = new RichTextEditorDomTestHarness({
		value: '',
		plainValue: '',
		adfValue: '',
		mentionContextJson: JSON.stringify({
			editorId: 'comment-input',
			scope: 'issue',
			participants: [
				{
					accountId: 'acct-123',
					displayName: 'Helena',
					mentionText: '@Helena',
					source: 'participant',
				},
			],
		}),
	});

	harness.initialize();
	harness.typeInEditor('@He');
	await harness.findMentionPopup();

	harness.pressEditorKey('Escape');

	expect(harness.queryMentionPopup()).toBeNull();
	expect(harness.getAdfValueField().value).not.toContain('"type":"mention"');
});
```

- [ ] **Step 3: Run the mention DOM test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextMentionController.dom.test.ts`

Expected: FAIL because the mention extension, mention controller, and mention bridge do not exist yet.

- [ ] **Step 4: Add the shared mention extension, popup controller, and host bridge**

```ts
import Mention from '@tiptap/extension-mention';

export class RichTextMentionExtension {
	static create(): ReturnType<typeof Mention.configure> {
		return Mention.configure({
			HTMLAttributes: {
				class: 'jira-rich-editor-mention',
			},
			renderText({ node }) {
				return node.attrs.mentionText || node.attrs.label || '@unknown';
			},
			renderHTML({ node, HTMLAttributes }) {
				return [
					'span',
					{
						...HTMLAttributes,
						'data-mention-id': node.attrs.accountId,
						'data-mention-text': node.attrs.mentionText,
						'data-mention-user-type': node.attrs.userType || 'DEFAULT',
					},
					node.attrs.mentionText || '@unknown',
				];
			},
		}).extend({
			addAttributes() {
				return {
					accountId: { default: null },
					displayName: { default: null },
					mentionText: { default: null },
					userType: { default: 'DEFAULT' },
				};
			},
		});
	}
}
```

```ts
export class RichTextMentionHostBridge {
	private readonly hostElement: HTMLElement;
	private readonly pendingRequests: Map<string, (candidates: RichTextMentionCandidate[]) => void>;

	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
		this.pendingRequests = new Map();
		this.hostElement.addEventListener('jira-rich-editor-mention-results', this.handleResults as EventListener);
	}

	requestCandidates(editorId: string, query: string): Promise<RichTextMentionCandidate[]> {
		const requestId = `${editorId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
		return new Promise((resolve) => {
			this.pendingRequests.set(requestId, resolve);
			this.hostElement.dispatchEvent(new CustomEvent('jira-rich-editor-mention-query', {
				bubbles: true,
				detail: { editorId, query, requestId },
			}));
		});
	}

	private readonly handleResults = (event: CustomEvent<{ requestId: string; candidates: RichTextMentionCandidate[] }>): void => {
		const resolve = this.pendingRequests.get(event.detail.requestId);
		if (!resolve) {
			return;
		}

		this.pendingRequests.delete(event.detail.requestId);
		resolve(event.detail.candidates);
	};
}
```

```ts
export class RichTextMentionController {
	constructor(
		private readonly editor: Editor,
		private readonly hostBridge: RichTextMentionHostBridge,
		private readonly hostElement: HTMLElement
	) {}

	async handleQuery(editorId: string, query: string): Promise<void> {
		const candidates = await this.hostBridge.requestCandidates(editorId, query);
		this.renderPopup(candidates);
	}

	selectCandidate(candidate: RichTextMentionCandidate): void {
		this.editor
			.chain()
			.focus()
			.insertContent([
				{
					type: 'mention',
					attrs: {
						accountId: candidate.accountId,
						displayName: candidate.displayName,
						mentionText: candidate.mentionText,
						userType: candidate.userType ?? 'DEFAULT',
					},
				},
				{ type: 'text', text: ' ' },
			])
			.run();
		this.closePopup();
	}
}
```

```ts
extensions: [
	StarterKit.configure({ /* existing options */ }),
	Underline,
	Link.configure({ autolink: false, linkOnPaste: false, openOnClick: false }),
	RichTextMentionExtension.create(),
],
```

- [ ] **Step 5: Run the mention DOM test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextMentionController.dom.test.ts`

Expected: PASS with popup open/close and insertion behavior green.

- [ ] **Step 6: Commit the shared mention UI**

```bash
git add package.json package-lock.json src/views/webview/editors/rich-text-mention.extension.ts src/views/webview/editors/rich-text-mention.controller.ts src/views/webview/editors/rich-text-mention-host.bridge.ts src/views/webview/editors/rich-text-editor.behavior.ts src/views/webview/editors/rich-text-editor.controller.ts tests/dom/richTextMentionController.dom.test.ts tests/dom/support/richTextEditorDomTestHarness.ts
git commit -m "feat: add shared rich text mention popup"
```

## Task 5: Wire Mention Lookup And ADF Submit Through The Webview And Controllers

**Files:**
- Create: `src/services/issue-mention-candidate.service.ts`
- Create: `src/services/project-assignable-mention.service.ts`
- Modify: `src/controllers/issue.controller.ts`
- Create: `tests/node/createIssueController.node.test.ts`
- Modify: `tests/node/issueController.node.test.ts`
- Modify: `src/controllers/create-issue.controller.ts`
- Modify: `src/views/webview/webview.panel.ts`
- Modify: `tests/dom/richTextEditor.dom.test.ts`
- Modify: `tests/dom/issuePanelEditing.dom.test.ts`
- Modify: `tests/dom/createIssuePanel.dom.test.ts`
- Create: `tests/node/issueMentionCandidateService.node.test.ts`
- Test: `tests/node/issueMentionCandidateService.node.test.ts`
- Test: `tests/node/issueController.node.test.ts`
- Test: `tests/node/createIssueController.node.test.ts`
- Test: `tests/dom/richTextEditor.dom.test.ts`
- Test: `tests/dom/issuePanelEditing.dom.test.ts`
- Test: `tests/dom/createIssuePanel.dom.test.ts`

- [ ] **Step 1: Write the failing candidate-service and controller tests**

```ts
test('buildIssueCandidates ranks reporter assignee reply target and comment authors before assignable fallbacks', () => {
	const candidates = IssueMentionCandidateService.buildIssueCandidates(
		{
			reporterAccountId: 'acct-reporter',
			reporterName: 'Reporter',
			assigneeAccountId: 'acct-assignee',
			assigneeName: 'Assignee',
		} as any,
		[
			{ authorAccountId: 'acct-commenter', authorName: 'Commenter', updated: '2026-04-10T12:00:00.000Z' } as any,
		],
		{ commentId: 'comment-1', authorName: 'Reply Target' },
		{ accountId: 'acct-current', displayName: 'Current User' }
	);

	assert.deepEqual(
		candidates.map((candidate) => candidate.accountId),
		['acct-commenter', 'acct-reporter', 'acct-assignee', 'acct-current']
	);
});
```

```ts
test('issue controller responds to queryMentionCandidates with ranked participants and assignable users', async () => {
	const { IssueControllerFactory, JiraWebviewPanel, jiraApiClient } = loadIssueControllerModules();
	const postedMessages: any[] = [];
	let onMessage: ((message: unknown) => Promise<void>) | undefined;

	JiraWebviewPanel.showIssueDetailsPanel = ((issueKey, issue, options, handler) => {
		onMessage = handler;
		return {
			webview: {
				postMessage: async (message: unknown) => {
					postedMessages.push(message);
					return true;
				},
			},
			reveal: () => undefined,
			onDidDispose: () => ({ dispose() {} }),
		} as any;
	}) as typeof JiraWebviewPanel.showIssueDetailsPanel;

	jiraApiClient.fetchIssueDetails = (async () => createIssueFixture({
		reporterAccountId: 'acct-reporter',
		reporterName: 'Reporter',
		assigneeAccountId: 'acct-assignee',
		assigneeName: 'Assignee',
	})) as typeof jiraApiClient.fetchIssueDetails;
	jiraApiClient.fetchIssueComments = (async () => [
		{ id: '10000', authorAccountId: 'acct-commenter', authorName: 'Commenter' } as any,
	]) as typeof jiraApiClient.fetchIssueComments;
	jiraApiClient.fetchAssignableUsers = (async () => [
		{ accountId: 'acct-remote', displayName: 'Remote User' },
	]) as typeof jiraApiClient.fetchAssignableUsers;

	const controller = IssueControllerFactory.create(/* existing deps */);
	await controller.openIssueDetails('PROJ-1');
	await onMessage?.({
		type: 'queryMentionCandidates',
		editorId: 'comment-input',
		requestId: 'req-1',
		query: 're',
	});

	assert.equal(postedMessages.at(-1)?.type, 'richTextMentionCandidatesLoaded');
	assert.equal(postedMessages.at(-1)?.requestId, 'req-1');
	assert.deepEqual(
		postedMessages.at(-1)?.candidates.map((candidate: any) => candidate.accountId),
		['acct-commenter', 'acct-reporter', 'acct-assignee', 'acct-remote']
	);
});
```

```ts
it('posts ADF comment payloads instead of wiki strings from the shared comment editor', () => {
	const { dom, messages } = RichTextEditorHarness.renderIssuePanelDom();
	const editorAdfField = dom.window.document.querySelector('.comment-form .jira-rich-editor-adf') as HTMLTextAreaElement;
	const submitButton = dom.window.document.querySelector('.comment-submit') as HTMLButtonElement;

	editorAdfField.value = JSON.stringify({
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: { id: 'acct-123', text: '@Helena', userType: 'DEFAULT' },
					},
				],
			},
		],
	});

	submitButton.click();

	const addCommentMessage = messages.find((message) => message?.type === 'addComment');
	expect(addCommentMessage?.bodyDocument?.content?.[0]?.content?.[0]?.type).toBe('mention');
	expect(addCommentMessage?.format).toBeUndefined();
});
```

- [ ] **Step 2: Run the node and DOM suites to verify they fail**

Run: `node --test tests/node/issueMentionCandidateService.node.test.ts tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts`

Expected: FAIL because the mention candidate services do not exist, `queryMentionCandidates` is not handled, and there is no create-issue mention test file yet.

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: FAIL because the webview still posts wiki strings, does not emit mention bridge messages, and does not render mention context per editor host.

- [ ] **Step 3: Add candidate services and controller message handling**

```ts
export class IssueMentionCandidateService {
	static buildIssueCandidates(
		issue: JiraIssue,
		comments: JiraIssueComment[] | undefined,
		replyContext: CommentReplyContext | undefined,
		currentUser: CurrentJiraUser | undefined
	): RichTextMentionCandidate[] {
		const ordered: RichTextMentionCandidate[] = [];
		const pushCandidate = (accountId: string | undefined, displayName: string | undefined, source: 'participant' | 'assignable'): void => {
			const normalizedId = accountId?.trim();
			const normalizedName = displayName?.trim();
			if (!normalizedId || !normalizedName || ordered.some((candidate) => candidate.accountId === normalizedId)) {
				return;
			}

			ordered.push({
				accountId: normalizedId,
				displayName: normalizedName,
				mentionText: `@${normalizedName}`,
				source,
				userType: 'DEFAULT',
			});
		};

		for (const comment of [...(comments ?? [])].sort((a, b) => Date.parse(b.updated ?? b.created ?? '') - Date.parse(a.updated ?? a.created ?? ''))) {
			pushCandidate(comment.authorAccountId, comment.authorName, 'participant');
		}

		pushCandidate(issue.reporterAccountId, issue.reporterName, 'participant');
		pushCandidate(issue.assigneeAccountId, issue.assigneeName, 'participant');
		pushCandidate(currentUser?.accountId, currentUser?.displayName, 'participant');
		return ordered;
	}

	static mergeCandidates(
		localCandidates: RichTextMentionCandidate[],
		remoteCandidates: RichTextMentionCandidate[]
	): RichTextMentionCandidate[] {
		const merged = [...localCandidates];
		for (const candidate of remoteCandidates) {
			if (merged.some((existing) => existing.accountId === candidate.accountId)) {
				continue;
			}

			merged.push(candidate);
		}

		return merged;
	}
}
```

```ts
export class ProjectAssignableMentionService {
	static async search(
		authInfo: JiraAuthInfo,
		token: string,
		scopeOrIssueKey: string | { projectKey: string },
		query: string
	): Promise<RichTextMentionCandidate[]> {
		const users = await jiraApiClient.fetchAssignableUsers(authInfo, token, scopeOrIssueKey, query);
		return users.map((user) => ({
			accountId: user.accountId,
			displayName: user.displayName,
			mentionText: `@${user.displayName}`,
			avatarUrl: user.avatarUrl,
			userType: 'DEFAULT',
			source: 'assignable',
		}));
	}
}
```

```ts
const initialIssueState = initialIssue ?? IssueModel.createPlaceholderIssue(resolvedIssueKey);
const panelState: {
	// existing fields...
	commentDraft: string;
	commentDraftDocument?: JiraAdfDocument;
	commentEditDraft?: string;
	commentEditDraftDocument?: JiraAdfDocument;
	descriptionEditDraft?: string;
	descriptionEditDraftDocument?: JiraAdfDocument;
} = {
	// existing field initializers...
	commentDraft: '',
	commentDraftDocument: undefined,
	commentEditDraft: undefined,
	commentEditDraftDocument: undefined,
	descriptionEditDraft: initialIssueState.description ?? '',
	descriptionEditDraftDocument: initialIssueState.descriptionDocument,
};
```

```ts
if (message?.type === 'queryMentionCandidates' && typeof message.requestId === 'string') {
	const localCandidates = IssueMentionCandidateService.buildIssueCandidates(
		panelState.issue,
		panelState.comments,
		panelState.commentReplyContext,
		panelState.currentUser
	);
	const remoteCandidates = await ProjectAssignableMentionService.search(
		authInfo,
		token,
		resolvedIssueKey,
		typeof message.query === 'string' ? message.query : ''
	);
	const candidates = IssueMentionCandidateService.mergeCandidates(localCandidates, remoteCandidates);
	await panel.webview.postMessage({
		type: 'richTextMentionCandidatesLoaded',
		editorId: message.editorId,
		requestId: message.requestId,
		candidates,
	});
	return;
}
```

```ts
if (message.type === 'queryMentionCandidates' && typeof message.requestId === 'string') {
	const candidates = await ProjectAssignableMentionService.search(
		authenticatedInfo,
		authenticatedToken,
		{ projectKey: selectedProject.key },
		typeof message.query === 'string' ? message.query : ''
	);
	await panel.webview.postMessage({
		type: 'richTextMentionCandidatesLoaded',
		editorId: message.editorId,
		requestId: message.requestId,
		candidates,
	});
	return;
}
```

- [ ] **Step 4: Update the webview host markup and submit bridge**

```ts
${RichTextEditorView.render({
	fieldId: 'comment-input',
	fieldName: 'commentDraft',
	value: draftValue,
	adfValue: panelState.commentDraftDocument
		? JiraAdfDocumentCodec.stringifyDocument(panelState.commentDraftDocument)
		: '',
	plainValue: draftValue,
	placeholder,
	editorId: 'comment-input',
	mentionContextJson: HtmlHelper.escapeHtml(JSON.stringify({
		editorId: 'comment-input',
		scope: 'issue',
		issueKey: issue.key,
		projectKey: IssueControllerFactory.deriveProjectKeyFromIssueKey(issue.key),
		participants: IssueMentionCandidateService.buildIssueCandidates(issue, options?.comments, options?.commentReplyContext, options?.currentUser),
	})),
	disabled: pending,
	ariaLabelledById: 'comment-form-title',
})}
```

```ts
document.addEventListener('jira-rich-editor-mention-query', (event) => {
	const mentionEvent = event as CustomEvent<{ editorId: string; query: string; requestId: string }>;
	vscode.postMessage({
		type: 'queryMentionCandidates',
		editorId: mentionEvent.detail.editorId,
		query: mentionEvent.detail.query,
		requestId: mentionEvent.detail.requestId,
	});
});

window.addEventListener('message', (event) => {
	const message = event.data;
	if (message?.type !== 'richTextMentionCandidatesLoaded') {
		return;
	}

	const host = document.querySelector(`[data-jira-rich-editor][data-editor-id="${message.editorId}"]`);
	if (!(host instanceof HTMLElement)) {
		return;
	}

	host.dispatchEvent(new CustomEvent('jira-rich-editor-mention-results', {
		detail: {
			requestId: message.requestId,
			candidates: message.candidates ?? [],
		},
	}));
});
```

```ts
vscode.postMessage({
	type: 'addComment',
	body: valueEl.value,
	bodyDocument: JSON.parse(adfEl.value || '{"type":"doc","version":1,"content":[]}'),
	parentId,
});

vscode.postMessage({
	type: 'saveEditComment',
	commentId: editCommentId,
	body: valueEl.value,
	bodyDocument: JSON.parse(adfEl.value || '{"type":"doc","version":1,"content":[]}'),
});

vscode.postMessage({
	type: 'updateDescription',
	description: descriptionValue.value,
	descriptionDocument: JSON.parse(descriptionAdf.value || '{"type":"doc","version":1,"content":[]}'),
});

payload.descriptionDocument = JSON.parse(descriptionAdfField.value || '{"type":"doc","version":1,"content":[]}');
```

- [ ] **Step 5: Run the node and DOM suites to verify they pass**

Run: `node --test tests/node/issueMentionCandidateService.node.test.ts tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts`

Expected: PASS with the candidate-service ranking and controller message handling green.

Run: `npx vitest run --config vitest.config.ts tests/dom/richTextEditor.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts`

Expected: PASS with comment/description/create-issue ADF submit behavior and mention bridge behavior green.

- [ ] **Step 6: Run broad verification**

Run: `node --test tests/node/jiraAdfDocumentCodec.node.test.ts tests/node/jiraApiTransport.node.test.ts tests/node/issueMentionCandidateService.node.test.ts tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts`

Expected: PASS for the ADF, transport, mention-service, and controller suites touched by this feature.

Run: `npm run test:dom`

Expected: PASS with the shared editor and issue/create panel suites green.

Run: `npm run bundle`

Expected: PASS with rebuilt extension and webview bundles.

- [ ] **Step 7: Commit the integrated mention flow**

```bash
git add src/services/issue-mention-candidate.service.ts src/services/project-assignable-mention.service.ts src/controllers/issue.controller.ts src/controllers/create-issue.controller.ts src/views/webview/webview.panel.ts tests/node/issueMentionCandidateService.node.test.ts tests/node/issueController.node.test.ts tests/node/createIssueController.node.test.ts tests/dom/richTextEditor.dom.test.ts tests/dom/issuePanelEditing.dom.test.ts tests/dom/createIssuePanel.dom.test.ts
git commit -m "feat: wire jira rich text mentions end to end"
```

## Self-Review

### Spec Coverage

- Shared `@mention` behavior in every shared rich text host: covered by Tasks 3, 4, and 5.
- Real Jira mention identity via ADF mention nodes: covered by Tasks 1, 2, and 4.
- Issue participants first, assignable fallback second: covered by Task 5.
- Wiki mode as read-only visualization only: covered by Task 3.
- ADF-backed submit for comments, description edit, and create description: covered by Tasks 2 and 5.
- DOM and real controller coverage for popup behavior and submit payloads: covered by Tasks 4 and 5.

### Placeholder Scan

- No `TODO`, `TBD`, deferred implementation notes, or “similar to previous task” shortcuts remain.
- Every task includes exact file paths, concrete tests, exact commands, and named implementation seams.

### Type And Contract Consistency

- `JiraAdfDocument` is the canonical shared rich text payload type throughout the plan.
- `.jira-rich-editor-adf` is the hidden canonical submit field throughout the plan.
- `.jira-rich-editor-value` stays the readable preview field throughout the plan.
- `queryMentionCandidates` and `richTextMentionCandidatesLoaded` are the only mention bridge message types throughout the plan.
- `RichTextMentionCandidate` is the candidate DTO used by the editor, services, and controllers throughout the plan.

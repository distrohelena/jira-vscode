import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

import { EnvironmentRuntime } from '../../src/environment.runtime';
import { JiraIssue, JiraIssueComment, IssuePanelOptions } from '../../src/model/jira.type';
import { JiraWebviewPanel } from '../../src/views/webview/webview.panel';
import { RichTextEditorDomTestHarness } from './support/richTextEditorDomTestHarness';
import { Uri } from 'vscode';

type RenderedDom = {
	dom: JSDOM;
	messages: any[];
	scriptErrors: string[];
};

class IssuePanelTestHarness {
	static createIssue(overrides?: Partial<JiraIssue>): JiraIssue {
		return {
			id: overrides?.id ?? '1000',
			key: overrides?.key ?? 'PROJ-1000',
			summary: overrides?.summary ?? 'Original issue title',
			statusName: overrides?.statusName ?? 'In Progress',
			url: overrides?.url ?? 'https://jira.example.test/browse/PROJ-1000',
			updated: overrides?.updated ?? '2026-02-23T12:00:00.000Z',
			created: overrides?.created ?? '2026-02-22T12:00:00.000Z',
			description: overrides?.description ?? 'Original description text',
			descriptionHtml: overrides?.descriptionHtml ?? '<p>Original description text</p>',
			assigneeName: overrides?.assigneeName,
			assigneeUsername: overrides?.assigneeUsername,
			assigneeKey: overrides?.assigneeKey,
			assigneeAccountId: overrides?.assigneeAccountId,
			assigneeAvatarUrl: overrides?.assigneeAvatarUrl,
			reporterName: overrides?.reporterName,
			reporterUsername: overrides?.reporterUsername,
			reporterKey: overrides?.reporterKey,
			reporterAccountId: overrides?.reporterAccountId,
			reporterAvatarUrl: overrides?.reporterAvatarUrl,
			issueTypeId: overrides?.issueTypeId,
			issueTypeName: overrides?.issueTypeName ?? 'Task',
			issueTypeIconUrl: overrides?.issueTypeIconUrl,
			issueTypeIconSrc: (overrides as any)?.issueTypeIconSrc,
			statusIconUrl: overrides?.statusIconUrl,
			statusIconSrc: (overrides as any)?.statusIconSrc,
			parent: overrides?.parent,
			children: overrides?.children,
		};
	}

	static createComment(overrides?: Partial<JiraIssueComment>): JiraIssueComment {
		return {
			id: overrides?.id ?? 'comment-1',
			body: overrides?.body ?? 'Original comment body',
			renderedBody: overrides?.renderedBody ?? '<p>Original comment body</p>',
			authorName: overrides?.authorName ?? 'Helena',
			authorAccountId: overrides?.authorAccountId,
			authorAvatarUrl: overrides?.authorAvatarUrl,
			created: overrides?.created ?? '2026-02-23T12:30:00.000Z',
			updated: overrides?.updated ?? '2026-02-23T12:30:00.000Z',
			isCurrentUser: overrides?.isCurrentUser ?? false,
		};
	}

	static renderIssuePanelDom(options?: IssuePanelOptions, issueOverrides?: Partial<JiraIssue>): RenderedDom {
		EnvironmentRuntime.initializeEnvironment(new Uri('file:///workspace/jira-vscode'));
		const issue = IssuePanelTestHarness.createIssue(issueOverrides);
		const panel: any = {
			iconPath: undefined,
			webview: {
				cspSource: 'vscode-resource://test',
				html: '',
				asWebviewUri: (uri: Uri) => ({ toString: () => uri.toString() }),
			},
		};
		JiraWebviewPanel.renderIssuePanelContent(panel, issue, options);

		const scriptErrors: string[] = [];
		const scriptMatch = panel.webview.html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
		if (scriptMatch?.[1]) {
			try {
				new vm.Script(scriptMatch[1], { filename: 'issue-panel-inline.js' });
			} catch (error) {
				const message = error instanceof Error ? error.stack ?? error.message : String(error);
				scriptErrors.push(`inline-compile: ${message}`);
			}
		}

		const virtualConsole = new VirtualConsole();
		virtualConsole.on('jsdomError', (error) => {
			scriptErrors.push(error.stack ?? error.message);
		});

		const messages: any[] = [];
		const dom = new JSDOM(panel.webview.html, {
			runScripts: 'dangerously',
			pretendToBeVisual: true,
			virtualConsole,
			beforeParse(window) {
				(window as any).acquireVsCodeApi = () => ({
					postMessage: (message: any) => messages.push(message),
				});
			},
		});
		RichTextEditorDomTestHarness.initialize(dom.window.document);

		return {
			dom,
			messages,
			scriptErrors,
		};
	}

	static click(element: Element, window: Window): void {
		element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	}
}

afterEach(() => {
	RichTextEditorDomTestHarness.cleanup();
});

describe('Issue panel editor interactions', () => {
	it('renders status icons in the issue status picker and posts the selected transition', () => {
		const { dom, messages, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(
			{
				statusOptions: [
					{
						id: 'transition-1',
						name: 'Code Review',
						category: 'inProgress',
						iconSrc: 'vscode-resource://test/jira-icon-cache/code-review.svg',
					} as any,
					{
						id: 'transition-2',
						name: 'Done',
						category: 'done',
					},
				],
			},
			{
				statusName: 'In Progress',
				statusIconSrc: 'vscode-resource://test/jira-icon-cache/current-status.svg',
			} as any
		);
		expect(scriptErrors).toEqual([]);

		const trigger = dom.window.document.querySelector(
			'.issue-status-picker .jira-status-picker-trigger'
		) as HTMLButtonElement | null;
		const nativeSelect = dom.window.document.querySelector(
			'.issue-status-picker select, .jira-status-select'
		) as HTMLSelectElement | null;
		const triggerIcon = trigger?.querySelector('.status-icon') as HTMLImageElement | null;
		expect(trigger).toBeTruthy();
		expect(nativeSelect).toBeNull();
		expect(triggerIcon).toBeTruthy();
		expect(triggerIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/current-status.svg');

		trigger!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

		const transitionOption = dom.window.document.querySelector(
			'.issue-status-picker .jira-status-picker-option[data-transition-id="transition-1"]'
		) as HTMLButtonElement | null;
		const transitionIcon = transitionOption?.querySelector('.status-icon') as HTMLImageElement | null;
		const doneOption = dom.window.document.querySelector(
			'.issue-status-picker .jira-status-picker-option[data-transition-id="transition-2"]'
		) as HTMLButtonElement | null;
		const doneIcon = doneOption?.querySelector('.status-icon') as HTMLImageElement | null;
		expect(transitionOption).toBeTruthy();
		expect(transitionIcon).toBeTruthy();
		expect(transitionIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/code-review.svg');
		expect(doneOption).toBeTruthy();
		expect(doneIcon).toBeTruthy();
		expect(doneIcon?.getAttribute('src')).toContain('/media/status-done.png');

		IssuePanelTestHarness.click(transitionOption as Element, dom.window);

		const changeMessage = messages.find((message) => message?.type === 'changeStatus');
		expect(changeMessage).toBeTruthy();
		expect(changeMessage.transitionId).toBe('transition-1');
		expect(changeMessage.issueKey).toBe('PROJ-1000');
	});

	it('falls back to the packaged current-status icon when the issue status image fails to load', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(
			{
				statusOptions: [
					{
						id: 'transition-1',
						name: 'Done',
						category: 'done',
					},
				],
			},
			{
				statusName: 'In Progress',
				statusIconSrc: 'https://jira.example.test/icons/current-status.svg',
			} as any
		);
		expect(scriptErrors).toEqual([]);

		const triggerIcon = dom.window.document.querySelector(
			'.issue-status-picker .jira-status-picker-trigger .status-icon'
		) as HTMLImageElement | null;
		expect(triggerIcon).toBeTruthy();
		expect(triggerIcon?.getAttribute('src')).toBe('https://jira.example.test/icons/current-status.svg');

		triggerIcon!.dispatchEvent(new dom.window.Event('error'));

		expect(triggerIcon?.getAttribute('src')).toBe('file:///workspace/jira-vscode/media/status-inprogress.png');
	});

	it('opens title editor on title click', () => {
		const { dom, scriptErrors, messages } = IssuePanelTestHarness.renderIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const summaryBlock = dom.window.document.querySelector('.issue-summary-block');
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display');
		expect(summaryBlock).toBeTruthy();
		expect(summaryDisplay).toBeTruthy();

		IssuePanelTestHarness.click(summaryDisplay as Element, dom.window);
		expect(summaryBlock?.classList.contains('editor-open')).toBe(true);
		expect(messages.some((message) => message?.type === 'debugLog' && message?.event === 'summary.click')).toBe(
			true
		);
	});

	it('prefills title editor with existing summary', () => {
		const { dom } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			summary: 'Current summary text',
		});
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display') as Element;
		const summaryInput = dom.window.document.querySelector('.jira-summary-input') as HTMLInputElement;
		expect(summaryDisplay).toBeTruthy();
		expect(summaryInput).toBeTruthy();

		IssuePanelTestHarness.click(summaryDisplay, dom.window);
		expect(summaryInput.value).toBe('Current summary text');
	});

	it('opens description editor on description click', () => {
		const { dom, scriptErrors, messages } = IssuePanelTestHarness.renderIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const descriptionBlock = dom.window.document.querySelector('.issue-description-block');
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display');
		expect(descriptionBlock).toBeTruthy();
		expect(descriptionDisplay).toBeTruthy();

		IssuePanelTestHarness.click(descriptionDisplay as Element, dom.window);
		expect(descriptionBlock?.classList.contains('editor-open')).toBe(true);
		expect(
			messages.some((message) => message?.type === 'debugLog' && message?.event === 'description.clickDisplay')
		).toBe(true);
	});

	it('renders the shared rich text editor inside the description edit form', () => {
		const { dom } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			description: 'First line\nSecond line',
			descriptionHtml: '<p><strong>First line</strong><br />Second line</p>',
		});
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element;
		const descriptionEditor = dom.window.document.querySelector('.jira-description-editor') as HTMLFormElement;
		expect(descriptionDisplay).toBeTruthy();
		expect(descriptionEditor).toBeTruthy();
		expect(descriptionEditor.querySelector('.jira-rich-editor-surface')).toBeTruthy();

		IssuePanelTestHarness.click(descriptionDisplay, dom.window);
		expect(descriptionEditor.querySelector('[data-jira-rich-editor]')).toBeTruthy();
		expect(descriptionEditor.querySelector('.jira-rich-editor-button[data-command="bold"]')).toBeTruthy();
	});

	it('labels the mounted issue description editor surface from the visible section title', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const sectionTitle = dom.window.document.querySelector('.description-card > .section-title') as HTMLElement | null;
		const mountedEditor = dom.window.document.querySelector(
			'.jira-description-editor .jira-rich-editor-prosemirror'
		) as HTMLElement | null;

		expect(sectionTitle).toBeTruthy();
		expect(sectionTitle?.getAttribute('id')).toBe('issue-description-title');
		expect(sectionTitle?.textContent?.trim()).toBe('Description');
		expect(mountedEditor).toBeTruthy();
		expect(mountedEditor?.getAttribute('aria-labelledby')).toBe('issue-description-title');
	});

	it('posts updateSummary on title submit', () => {
		const { dom, messages } = IssuePanelTestHarness.renderIssuePanelDom();
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display') as Element;
		const summaryInput = dom.window.document.querySelector('.jira-summary-input') as HTMLInputElement;
		const summaryForm = dom.window.document.querySelector('.jira-summary-editor') as HTMLFormElement;
		expect(summaryDisplay).toBeTruthy();
		expect(summaryInput).toBeTruthy();
		expect(summaryForm).toBeTruthy();

		IssuePanelTestHarness.click(summaryDisplay, dom.window);
		summaryInput.value = 'Updated issue title';
		summaryForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const updateMessage = messages.find((message) => message?.type === 'updateSummary');
		expect(updateMessage).toBeTruthy();
		expect(updateMessage.issueKey).toBe('PROJ-1000');
		expect(updateMessage.summary).toBe('Updated issue title');
	});

	it('posts updateDescription on description submit', () => {
		const { dom, messages } = IssuePanelTestHarness.renderIssuePanelDom();
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element;
		const descriptionForm = dom.window.document.querySelector('.jira-description-editor') as HTMLFormElement;
		const descriptionHiddenValue = dom.window.document.querySelector(
			'.jira-description-editor .jira-rich-editor-value'
		) as HTMLTextAreaElement | null;
		const descriptionSurface = dom.window.document.querySelector(
			'.jira-description-editor .jira-rich-editor-surface'
		) as HTMLElement | null;
		expect(descriptionDisplay).toBeTruthy();
		expect(descriptionForm).toBeTruthy();

		IssuePanelTestHarness.click(descriptionDisplay, dom.window);
		expect(descriptionHiddenValue).toBeTruthy();
		expect(descriptionSurface).toBeTruthy();
		descriptionHiddenValue!.value = '*Updated description body*';
		descriptionSurface!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
		descriptionForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const updateMessage = messages.find((message) => message?.type === 'updateDescription');
		expect(updateMessage).toBeTruthy();
		expect(updateMessage.issueKey).toBe('PROJ-1000');
		expect(updateMessage.description).toBe('*Updated description body*');
	});

	it('restores the original description when cancel is pressed after switching to wiki mode', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			description: 'Original wiki body',
			descriptionHtml: '<p>Original <strong>rich</strong> body</p>',
		});
		expect(scriptErrors).toEqual([]);

		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element | null;
		const descriptionBlock = dom.window.document.querySelector('.issue-description-block') as HTMLElement | null;
		const descriptionHost = dom.window.document.querySelector(
			'.jira-description-editor [data-jira-rich-editor]'
		) as HTMLElement | null;
		const descriptionPlain = dom.window.document.querySelector(
			'.jira-description-editor .jira-rich-editor-plain'
		) as HTMLTextAreaElement | null;
		const descriptionValue = dom.window.document.querySelector(
			'.jira-description-editor .jira-rich-editor-value'
		) as HTMLTextAreaElement | null;
		const toggleModeButton = dom.window.document.querySelector(
			'.jira-description-editor .jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]'
		) as HTMLButtonElement | null;
		const cancelButton = dom.window.document.querySelector('.jira-description-cancel') as HTMLButtonElement | null;

		expect(descriptionDisplay).toBeTruthy();
		expect(descriptionBlock).toBeTruthy();
		expect(descriptionHost).toBeTruthy();
		expect(descriptionPlain).toBeTruthy();
		expect(descriptionValue).toBeTruthy();
		expect(toggleModeButton).toBeTruthy();
		expect(cancelButton).toBeTruthy();

		IssuePanelTestHarness.click(descriptionDisplay as Element, dom.window);
		expect(descriptionBlock?.classList.contains('editor-open')).toBe(true);
		expect(descriptionHost?.getAttribute('data-mode')).toBe('visual');

		IssuePanelTestHarness.click(toggleModeButton as Element, dom.window);
		expect(descriptionHost?.getAttribute('data-mode')).toBe('wiki');

		descriptionPlain!.value = 'Changed wiki body';
		descriptionPlain!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
		expect(descriptionValue?.value).toBe('Changed wiki body');

		IssuePanelTestHarness.click(cancelButton as Element, dom.window);

		expect(descriptionBlock?.classList.contains('editor-open')).toBe(false);
		expect(descriptionHost?.getAttribute('data-mode')).toBe('visual');
		expect(descriptionPlain?.value).toBe('Original wiki body');
		expect(descriptionValue?.value).toBe('Original wiki body');
	});

	it('does not open editors while update is pending', () => {
		const { dom } = IssuePanelTestHarness.renderIssuePanelDom({
			summaryEditPending: true,
			descriptionEditPending: true,
		});
		const summaryBlock = dom.window.document.querySelector('.issue-summary-block');
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display');
		const descriptionBlock = dom.window.document.querySelector('.issue-description-block');
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display');

		IssuePanelTestHarness.click(summaryDisplay as Element, dom.window);
		IssuePanelTestHarness.click(descriptionDisplay as Element, dom.window);

		expect(summaryBlock?.classList.contains('editor-open')).toBe(false);
		expect(descriptionBlock?.classList.contains('editor-open')).toBe(false);
	});

	it('posts startCommentReply when reply is clicked', () => {
		const { dom, messages } = IssuePanelTestHarness.renderIssuePanelDom({
			comments: [IssuePanelTestHarness.createComment({ id: 'comment-42' })],
		});
		const replyButton = dom.window.document.querySelector('.comment-reply');
		expect(replyButton).toBeTruthy();

		IssuePanelTestHarness.click(replyButton as Element, dom.window);

		const replyMessage = messages.find((message) => message?.type === 'startCommentReply');
		expect(replyMessage).toBeTruthy();
		expect(replyMessage.commentId).toBe('comment-42');
	});

	it('posts cancelCommentReply when cancel reply is clicked', () => {
		const { dom, messages } = IssuePanelTestHarness.renderIssuePanelDom({
			commentReplyContext: {
				commentId: 'comment-42',
				authorName: 'Helena',
				timestampLabel: '2/23/2026, 12:30:00 PM',
				excerpt: 'Original comment body',
			},
		});
		const cancelButton = dom.window.document.querySelector('.comment-reply-cancel');
		expect(cancelButton).toBeTruthy();

		IssuePanelTestHarness.click(cancelButton as Element, dom.window);

		expect(messages.some((message) => message?.type === 'cancelCommentReply')).toBe(true);
	});

	it('renders the shared editor in comment edit mode and saves the hidden wiki value', () => {
		const { dom, messages, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(
			{
				comments: [IssuePanelTestHarness.createComment({ id: 'comment-42' })],
				commentEditingId: 'comment-42',
			},
			undefined
		);
		expect(scriptErrors).toEqual([]);
		const editForm = dom.window.document.querySelector('.comment-edit-form') as HTMLFormElement | null;
		const editEditor = editForm?.querySelector('[data-jira-rich-editor]') as HTMLElement | null;
		const hiddenValueField = editForm?.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;
		const visualSurface = editForm?.querySelector('.jira-rich-editor-surface') as HTMLElement | null;
		expect(editForm).toBeTruthy();
		expect(editEditor).toBeTruthy();
		expect(editForm?.querySelector('.jira-rich-editor-surface')).toBeTruthy();
		expect(editForm?.querySelector('.jira-rich-editor-raw')).toBeNull();
		expect(editForm?.querySelector('.jira-rich-editor-button[data-command="bold"]')).toBeTruthy();
		expect(editForm?.querySelector('.jira-rich-editor-button[data-command="orderedList"]')).toBeTruthy();
		expect(editForm?.querySelector('.jira-rich-editor-mode-button')).toBeNull();
		expect(
			editForm?.querySelector('.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]')
		).toBeTruthy();
		expect(hiddenValueField).toBeTruthy();
		expect(visualSurface).toBeTruthy();

		hiddenValueField!.value = '*Edited comment body*';
		visualSurface!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
		editForm!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const saveMessage = messages.find((message) => message?.type === 'saveEditComment');
		expect(saveMessage).toBeTruthy();
		expect(saveMessage.commentId).toBe('comment-42');
		expect(saveMessage.body).toBe('*Edited comment body*');
		expect(saveMessage.format).toBe('wiki');
	});

	it('labels the mounted comment edit editor surface from a field-specific label', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom({
			comments: [IssuePanelTestHarness.createComment({ id: 'comment-42' })],
			commentEditingId: 'comment-42',
		});
		expect(scriptErrors).toEqual([]);

		const label = dom.window.document.querySelector(
			'.comment-edit-form .comment-edit-label'
		) as HTMLElement | null;
		const mountedEditor = dom.window.document.querySelector(
			'.comment-edit-form .jira-rich-editor-prosemirror'
		) as HTMLElement | null;

		expect(label).toBeTruthy();
		expect(label?.getAttribute('id')).toBe('edit-comment-comment-42-label');
		expect(label?.textContent?.trim()).toBe('Edit comment');
		expect(mountedEditor).toBeTruthy();
		expect(mountedEditor?.getAttribute('aria-labelledby')).toBe('edit-comment-comment-42-label');
	});

	it('opens the parent picker modal from the issue parent section', () => {
		const { dom, messages, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			parent: {
				key: 'PROJ-123',
				summary: 'Parent issue summary',
				statusName: 'In Progress',
				url: 'https://jira.example.test/browse/PROJ-123',
			},
		});
		expect(scriptErrors).toEqual([]);

		const parentButton = dom.window.document.querySelector('.issue-sidebar [data-parent-picker-open]');
		const sidebarSections = Array.from(dom.window.document.querySelectorAll('.issue-sidebar .meta-section')) as HTMLElement[];
		const parentSectionIndex = sidebarSections.findIndex((section) => section.textContent?.includes('Parent Ticket'));
		const assigneeSectionIndex = sidebarSections.findIndex((section) => section.textContent?.includes('Assignee'));
		expect(parentButton).toBeTruthy();
		expect(parentButton?.classList.contains('parent-picker-card')).toBe(true);
		expect(parentSectionIndex).toBeGreaterThan(-1);
		expect(assigneeSectionIndex).toBeGreaterThan(-1);
		expect(parentSectionIndex).toBeLessThan(assigneeSectionIndex);

		IssuePanelTestHarness.click(parentButton as Element, dom.window);

		const openMessage = messages.find((message) => message?.type === 'openParentPicker');
		expect(openMessage).toBeTruthy();
	});

	it('renders the shared parent ticket card for an existing parent issue', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			parent: {
				key: 'PROJ-123',
				summary: 'Parent issue summary',
				statusName: 'In Progress',
				url: 'https://jira.example.test/browse/PROJ-123',
			},
		});
		expect(scriptErrors).toEqual([]);

		const parentSection = Array.from(dom.window.document.querySelectorAll('.issue-sidebar .meta-section')).find(
			(section) => section.textContent?.includes('Parent Ticket')
		) as HTMLElement | undefined;
		const parentCard = parentSection?.querySelector('.parent-picker-card');
		const parentCardTitle = parentSection?.querySelector('.parent-picker-card-title') as HTMLSpanElement | null;
		const parentCardDetail = parentSection?.querySelector('.parent-picker-card-detail') as HTMLSpanElement | null;
		const parentSectionBody = parentSection?.querySelector('.parent-section-body');
		expect(parentSection).toBeTruthy();
		expect(parentCard).toBeTruthy();
		expect(parentCardTitle?.textContent?.trim()).toBe('Choose a parent ticket');
		expect(parentCardDetail?.textContent).toContain('PROJ-123 - Parent issue summary');
		expect(parentSectionBody).toBeNull();
	});

	it('keeps a direct parent issue opening affordance alongside the shared parent picker card', () => {
		const { dom, messages, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			parent: {
				key: 'PROJ-123',
				summary: 'Parent issue summary',
				statusName: 'In Progress',
				url: 'https://jira.example.test/browse/PROJ-123',
			},
		});
		expect(scriptErrors).toEqual([]);

		const parentSection = Array.from(dom.window.document.querySelectorAll('.issue-sidebar .meta-section')).find(
			(section) => section.textContent?.includes('Parent Ticket')
		) as HTMLElement | undefined;
		const parentCard = parentSection?.querySelector('.parent-picker-card');
		const parentIssueLink = parentSection?.querySelector('.issue-link') as HTMLButtonElement | null;
		expect(parentCard).toBeTruthy();
		expect(parentIssueLink).toBeTruthy();
		expect(parentIssueLink?.textContent).toContain('PROJ-123');

		IssuePanelTestHarness.click(parentIssueLink as Element, dom.window);

		const openMessage = messages.find((message) => message?.type === 'openIssue');
		expect(openMessage).toBeTruthy();
		expect(openMessage.key).toBe('PROJ-123');
	});

	it('renders packaged fallback status icons for related issue links when Jira does not provide one', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			parent: {
				key: 'PROJ-123',
				summary: 'Parent issue summary',
				statusName: 'In Progress',
				url: 'https://jira.example.test/browse/PROJ-123',
			},
			children: [
				{
					key: 'PROJ-124',
					summary: 'Child issue summary',
					statusName: 'To Do',
					url: 'https://jira.example.test/browse/PROJ-124',
				},
			] as any,
		});
		expect(scriptErrors).toEqual([]);

		const parentSection = Array.from(dom.window.document.querySelectorAll('.issue-sidebar .meta-section')).find(
			(section) => section.textContent?.includes('Parent Ticket')
		) as HTMLElement | undefined;
		const parentStatusIcon = parentSection?.querySelector('.issue-link .status-icon') as HTMLImageElement | null;
		const subtaskStatusIcon = dom.window.document.querySelector('.issue-list .issue-link .status-icon') as HTMLImageElement | null;

		expect(parentStatusIcon).toBeTruthy();
		expect(parentStatusIcon?.getAttribute('src')).toBe('file:///workspace/jira-vscode/media/status-inprogress.png');
		expect(subtaskStatusIcon).toBeTruthy();
		expect(subtaskStatusIcon?.getAttribute('src')).toBe('file:///workspace/jira-vscode/media/status-open.png');
	});

	it('renders the empty parent state as a shared card shell without the legacy row layout', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const parentSection = Array.from(dom.window.document.querySelectorAll('.issue-sidebar .meta-section')).find(
			(section) => section.textContent?.includes('Parent Ticket')
		) as HTMLElement | undefined;
		const parentCard = parentSection?.querySelector('.parent-picker-card');
		const parentCardTitle = parentSection?.querySelector('.parent-picker-card-title') as HTMLSpanElement | null;
		const parentCardDetail = parentSection?.querySelector('.parent-picker-card-detail') as HTMLSpanElement | null;
		const parentSectionBody = parentSection?.querySelector('.parent-section-body');
		const parentDetailText = parentCardDetail?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(parentSection).toBeTruthy();
		expect(parentCard).toBeTruthy();
		expect(parentCardTitle?.textContent?.trim()).toBe('Choose a parent ticket');
		expect(parentCardDetail).toBeTruthy();
		expect(parentDetailText).toContain('No parent selected');
		expect(parentDetailText).toContain('Unassigned');
		expect(parentSectionBody).toBeNull();
	});

	it('opens the assignee picker modal from the issue assignee section', () => {
		const { dom, messages, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom({
			currentUser: {
				accountId: 'acct-123',
				displayName: 'Helena',
			},
		});
		expect(scriptErrors).toEqual([]);

		const assigneeButton = dom.window.document.querySelector('.issue-sidebar [data-assignee-picker-open]');
		expect(assigneeButton).toBeTruthy();

		IssuePanelTestHarness.click(assigneeButton as Element, dom.window);

		const openMessage = messages.find((message) => message?.type === 'openAssigneePicker');
		expect(openMessage).toBeTruthy();
	});

	it('renders the edit assignee action as the same shared assign-to-me button contract', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom({
			currentUser: {
				accountId: 'acct-123',
				displayName: 'Helena',
			},
		});
		expect(scriptErrors).toEqual([]);

		const assignMeButton = dom.window.document.querySelector(
			'.issue-sidebar .assignee-actions .jira-assignee-assign-me'
		) as HTMLButtonElement | null;
		expect(assignMeButton).toBeTruthy();
		expect(assignMeButton?.textContent?.trim()).toBe('Assign to Me');
		expect(assignMeButton?.getAttribute('data-account-id')).toBe('acct-123');
		expect(assignMeButton?.classList.contains('jira-shared-assign-me')).toBe(true);
	});

	it('styles the edit assign-to-me action with the shared pill rules', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom({
			currentUser: {
				accountId: 'acct-123',
				displayName: 'Helena',
			},
		});
		expect(scriptErrors).toEqual([]);

		const stylesheet = Array.from(dom.window.document.querySelectorAll('style'))
			.map((style) => style.textContent ?? '')
			.join('\n');

		expect(stylesheet).toMatch(
			/\.jira-shared-assign-me,\s*[\r\n\t .,\w-]*\.jira-assignee-assign-me\s*\{[^}]*border-radius:\s*999px;[^}]*width:\s*100%;/s
		);
	});

	it('keeps the edit assign-to-me action wired to changeAssignee', () => {
		const { dom, messages, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom({
			currentUser: {
				accountId: 'acct-123',
				displayName: 'Helena',
			},
		});
		expect(scriptErrors).toEqual([]);

		const assignMeButton = dom.window.document.querySelector(
			'.issue-sidebar .assignee-actions .jira-assignee-assign-me'
		) as HTMLButtonElement | null;
		expect(assignMeButton).toBeTruthy();

		IssuePanelTestHarness.click(assignMeButton as Element, dom.window);

		const changeMessage = messages.find((message) => message?.type === 'changeAssignee');
		expect(changeMessage).toBeTruthy();
		expect(changeMessage?.issueKey).toBe('PROJ-1000');
		expect(changeMessage?.accountId).toBe('acct-123');
	});

	it('renders authenticated local issue type and status icons in the issue header', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			issueTypeName: 'Bug',
			issueTypeIconUrl: 'https://jira.example.test/icons/bug.svg',
			issueTypeIconSrc: 'vscode-resource://test/jira-icon-cache/bug.svg',
			statusName: 'In Progress',
			statusIconUrl: 'https://jira.example.test/icons/in-progress.svg',
			statusIconSrc: 'vscode-resource://test/jira-icon-cache/in-progress.svg',
		} as any);
		expect(scriptErrors).toEqual([]);

		const header = dom.window.document.querySelector('.issue-header');
		const issueTypeIcon = dom.window.document.querySelector('.issue-header .issue-type-icon') as HTMLImageElement | null;
		const statusIcon = dom.window.document.querySelector('.issue-header .status-icon') as HTMLImageElement | null;

		expect(header).toBeTruthy();
		expect(issueTypeIcon).toBeTruthy();
		expect(issueTypeIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/bug.svg');
		expect(statusIcon).toBeTruthy();
		expect(statusIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/in-progress.svg');
	});

	it('keeps the issue header icon slots and packaged status fallback when Jira icon URLs are absent', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			issueTypeIconUrl: undefined,
			statusIconUrl: undefined,
		});
		expect(scriptErrors).toEqual([]);

		const statusIcon = dom.window.document.querySelector('.issue-header .status-icon') as HTMLImageElement | null;

		expect(dom.window.document.querySelector('.issue-header .issue-type-icon')).toBeNull();
		expect(dom.window.document.querySelector('.issue-header .issue-type-icon-placeholder')).toBeNull();
		expect(statusIcon).toBeTruthy();
		expect(statusIcon?.getAttribute('src')).toContain('/media/status-inprogress.png');
	});

	it('removes broken issue header type icons and keeps the packaged status fallback', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom(undefined, {
			issueTypeName: 'Subtask',
			issueTypeIconUrl: 'https://jira.example.test/icons/subtask.svg',
			issueTypeIconSrc: 'https://jira.example.test/icons/missing-subtask.svg',
			statusName: 'In Progress',
			statusIconUrl: 'https://jira.example.test/icons/in-progress.svg',
			statusIconSrc: 'https://jira.example.test/icons/missing-status.svg',
		} as any);
		expect(scriptErrors).toEqual([]);

		const issueTypeIcon = dom.window.document.querySelector('.issue-header .issue-type-icon') as HTMLImageElement | null;
		const statusIcon = dom.window.document.querySelector('.issue-header .status-icon') as HTMLImageElement | null;
		expect(issueTypeIcon).toBeTruthy();
		expect(statusIcon).toBeTruthy();

		issueTypeIcon!.dispatchEvent(new dom.window.Event('error'));
		statusIcon!.dispatchEvent(new dom.window.Event('error'));

		const fallbackStatusIcon = dom.window.document.querySelector('.issue-header .status-icon') as HTMLImageElement | null;

		expect(dom.window.document.querySelector('.issue-header .issue-type-icon')).toBeNull();
		expect(dom.window.document.querySelector('.issue-header .issue-type-icon-placeholder')).toBeNull();
		expect(fallbackStatusIcon).toBeTruthy();
		expect(fallbackStatusIcon?.getAttribute('src')).toBe('file:///workspace/jira-vscode/media/status-inprogress.png');
	});
	it('includes scoped cursor rules for the issue sidebar parent and assignee picker cards', () => {
		const { dom, scriptErrors } = IssuePanelTestHarness.renderIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const detailsSidebar = dom.window.document.querySelector('.issue-sidebar[data-issue-details-sidebar]');
		const stylesheet = Array.from(dom.window.document.querySelectorAll('style'))
			.map((style) => style.textContent ?? '')
			.join('\n');

		expect(detailsSidebar).toBeTruthy();
		expect(stylesheet).toMatch(
			/\.issue-sidebar\[data-issue-details-sidebar\]\s+\[data-parent-picker-open\][^{}]*\{[^}]*cursor:\s*pointer;/s
		);
		expect(stylesheet).toMatch(
			/\.issue-sidebar\[data-issue-details-sidebar\]\s+\[data-assignee-picker-open\][^{}]*\{[^}]*cursor:\s*pointer;/s
		);
		expect(stylesheet).toMatch(
			/\.issue-sidebar\[data-issue-details-sidebar\]\s+\[data-parent-picker-open\]:disabled[^{}]*\{[^}]*cursor:\s*not-allowed;/s
		);
		expect(stylesheet).toMatch(
			/\.issue-sidebar\[data-issue-details-sidebar\]\s+\[data-assignee-picker-open\]:disabled[^{}]*\{[^}]*cursor:\s*not-allowed;/s
		);
	});
});

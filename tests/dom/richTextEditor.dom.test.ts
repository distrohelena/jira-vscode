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

/**
 * Hosts the DOM assertions for the issue-panel rich text editor integration.
 */
class RichTextEditorHarness {
	/**
	 * Creates a renderable issue record with stable defaults for DOM tests.
	 */
	static createIssue(overrides?: Partial<JiraIssue>): JiraIssue {
		return {
			id: overrides?.id ?? '1000',
			key: overrides?.key ?? 'PROJ-1000',
			summary: overrides?.summary ?? 'Test issue',
			statusName: overrides?.statusName ?? 'In Progress',
			url: overrides?.url ?? 'https://jira.example.test/browse/PROJ-1000',
			updated: overrides?.updated ?? '2026-02-23T12:00:00.000Z',
			created: overrides?.created ?? '2026-02-22T12:00:00.000Z',
			description: overrides?.description ?? '',
			descriptionHtml: overrides?.descriptionHtml ?? '',
		};
	}

	/**
	 * Creates a renderable comment record with stable defaults for DOM tests.
	 */
	static createComment(overrides?: Partial<JiraIssueComment>): JiraIssueComment {
		return {
			id: overrides?.id ?? 'comment-1',
			body: overrides?.body ?? 'Original comment body',
			renderedBody: overrides?.renderedBody ?? '<p>Original comment body</p>',
			authorName: overrides?.authorName ?? 'Helena',
			created: overrides?.created ?? '2026-02-23T12:30:00.000Z',
			updated: overrides?.updated ?? '2026-02-23T12:30:00.000Z',
			isCurrentUser: overrides?.isCurrentUser ?? false,
		};
	}

	/**
	 * Renders the issue panel HTML so tests can inspect the generated webview contract.
	 */
	static renderIssuePanelHtml(options?: IssuePanelOptions, issueOverrides?: Partial<JiraIssue>): string {
		EnvironmentRuntime.initializeEnvironment(new Uri('file:///workspace/jira-vscode'));
		const issue = RichTextEditorHarness.createIssue(issueOverrides);
		const panel: any = {
			webview: {
				cspSource: 'vscode-resource://test',
				html: '',
				asWebviewUri: (uri: Uri) => ({ toString: () => uri.toString() }),
			},
		};
		JiraWebviewPanel.renderIssuePanelContent(panel, issue, options);
		return panel.webview.html;
	}

	/**
	 * Renders the issue panel into JSDOM so tests can exercise the editor runtime.
	 */
	static renderIssuePanelDom(options?: IssuePanelOptions, issueOverrides?: Partial<JiraIssue>): RenderedDom {
		const html = RichTextEditorHarness.renderIssuePanelHtml(options, issueOverrides);
		const scriptErrors: string[] = [];
		const inlineScriptMatches = html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
		let inlineScriptIndex = 0;
		for (const scriptMatch of inlineScriptMatches) {
			const scriptBody = scriptMatch[1];
			if (!scriptBody) {
				continue;
			}
			try {
				new vm.Script(scriptBody, { filename: `issue-panel-inline-${inlineScriptIndex}.js` });
			} catch (error) {
				const message = error instanceof Error ? error.stack ?? error.message : String(error);
				scriptErrors.push(`inline-compile-${inlineScriptIndex}: ${message}`);
			}
			inlineScriptIndex++;
		}

		const virtualConsole = new VirtualConsole();
		virtualConsole.on('jsdomError', (error) => {
			scriptErrors.push(error.stack ?? error.message);
		});

		const messages: any[] = [];
		const dom = new JSDOM(html, {
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

		return { dom, messages, scriptErrors };
	}

	/**
	 * Returns the shared editor contract rendered inside the issue panel.
	 */
	static getSharedEditor(dom: JSDOM): { host: HTMLElement; visual: HTMLElement; plain: HTMLTextAreaElement; value: HTMLTextAreaElement } | null {
		const host = dom.window.document.querySelector('.comment-form [data-jira-rich-editor]') as HTMLElement | null;
		if (!host) {
			return null;
		}
		const visual = host.querySelector('.jira-rich-editor-surface') as HTMLElement | null;
		const plain = host.querySelector('.jira-rich-editor-plain') as HTMLTextAreaElement | null;
		const value = host.querySelector('.jira-rich-editor-value') as HTMLTextAreaElement | null;
		if (!visual || !plain || !value) {
			return null;
		}
		return { host, visual, plain, value };
	}

	/**
	 * Dispatches a click event on a rendered element.
	 */
	static click(element: Element, window: Window): void {
		element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	}
}

afterEach(() => {
	RichTextEditorDomTestHarness.cleanup();
});

describe('Rich text editor WYSIWYG behavior', () => {
	it('does not render the legacy execCommand bootstrap path', () => {
		const html = RichTextEditorHarness.renderIssuePanelHtml({
			comments: [RichTextEditorHarness.createComment()],
		});

		expect(html).toContain('dist/webview/rich-text-editor.js');
		expect(html).not.toContain('document.execCommand');
		expect(html).not.toContain('initializeJiraRichTextEditors(document);');
		expect(html).toContain('window.initializeJiraRichTextEditors?.(document);');
	});

	it('compiles without script errors', () => {
		const { scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);
	});

	it('renders the shared comment reply editor contract with the stable toolbar buttons', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
			commentReplyContext: {
				commentId: 'comment-42',
				authorName: 'Helena',
				timestampLabel: '2/23/2026, 12:30:00 PM',
				excerpt: 'Original comment body',
			},
		});
		expect(scriptErrors).toEqual([]);

		const commentForm = dom.window.document.querySelector('.comment-form') as HTMLFormElement | null;
		const editor = RichTextEditorHarness.getSharedEditor(dom);
		const mountedEditor = editor?.visual.querySelector('.jira-rich-editor-prosemirror') as HTMLElement | null;
		expect(commentForm).toBeTruthy();
		expect(editor).toBeTruthy();
		expect(editor!.host.getAttribute('data-mode')).toBe('visual');
		expect(mountedEditor).toBeTruthy();
		expect(mountedEditor?.getAttribute('contenteditable')).toBe('true');
		expect(editor!.plain.getAttribute('placeholder')).toBe('Write your reply');
		expect(editor!.value.getAttribute('name')).toBe('commentDraft');
		expect(editor!.value.classList.contains('jira-rich-editor-value')).toBe(true);
		expect(commentForm?.querySelector('.jira-rich-editor-raw')).toBeNull();
		expect(commentForm?.querySelector('.jira-rich-editor-button[data-command="bold"]')).toBeTruthy();
		expect(commentForm?.querySelector('.jira-rich-editor-button[data-command="orderedList"]')).toBeTruthy();
		expect(commentForm?.querySelector('.jira-rich-editor-mode-button')).toBeNull();
		expect(
			commentForm?.querySelector('.jira-rich-editor-secondary-button[data-secondary-action="toggleMode"]')
		).toBeTruthy();
	});

	it('labels the mounted comment reply editor surface from the visible form label', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
			commentReplyContext: {
				commentId: 'comment-42',
				authorName: 'Helena',
				timestampLabel: '2/23/2026, 12:30:00 PM',
				excerpt: 'Original comment body',
			},
		});
		expect(scriptErrors).toEqual([]);

		const label = dom.window.document.querySelector('.comment-form > label.section-title') as HTMLLabelElement | null;
		const mountedEditor = dom.window.document.querySelector(
			'.comment-form .jira-rich-editor-prosemirror'
		) as HTMLElement | null;

		expect(label).toBeTruthy();
		expect(label?.getAttribute('id')).toBe('comment-form-title');
		expect(label?.textContent?.trim()).toBe('Reply to comment');
		expect(mountedEditor).toBeTruthy();
		expect(mountedEditor?.getAttribute('aria-labelledby')).toBe('comment-form-title');
	});

	it('posts comment draft changes and reply submits from the canonical shared editor fields', () => {
		const { dom, messages, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
			commentReplyContext: {
				commentId: 'comment-42',
				authorName: 'Helena',
				timestampLabel: '2/23/2026, 12:30:00 PM',
				excerpt: 'Original comment body',
			},
		});
		expect(scriptErrors).toEqual([]);

		const commentForm = dom.window.document.querySelector('.comment-form') as HTMLFormElement | null;
		const editor = RichTextEditorHarness.getSharedEditor(dom);
		const adfField = commentForm?.querySelector('.jira-rich-editor-adf') as HTMLTextAreaElement | null;
		expect(commentForm).toBeTruthy();
		expect(editor).toBeTruthy();
		expect(adfField).toBeTruthy();

		editor!.value.value = '*typed reply*';
		adfField!.value = JSON.stringify({
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
		editor!.visual.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

		const draftMessage = messages.find((message) => message?.type === 'commentDraftChanged');
		expect(draftMessage).toBeTruthy();
		expect(draftMessage.value).toBe('*typed reply*');
		expect(draftMessage.bodyDocument?.content?.[0]?.content?.[0]?.type).toBe('mention');

		commentForm!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const addCommentMsg = messages.find((message) => message?.type === 'addComment');
		expect(addCommentMsg).toBeTruthy();
		expect(addCommentMsg.body).toBe('*typed reply*');
		expect(addCommentMsg.bodyDocument?.content?.[0]?.content?.[0]?.type).toBe('mention');
		expect(addCommentMsg.format).toBeUndefined();
		expect(addCommentMsg.parentId).toBe('comment-42');
	});

	it('forwards mention queries from the shared comment editor and routes host results back to that editor', () => {
		const { dom, messages, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const host = dom.window.document.querySelector('.comment-form [data-jira-rich-editor]') as HTMLElement | null;
		const routedResults: any[] = [];
		expect(host).toBeTruthy();

		host!.addEventListener('jira-rich-editor-mention-results', ((event: Event) => {
			routedResults.push((event as CustomEvent).detail);
		}) as EventListener);

		host!.dispatchEvent(
			new dom.window.CustomEvent('jira-rich-editor-mention-query', {
				bubbles: true,
				detail: {
					editorId: 'comment-input',
					query: 'he',
					requestId: 'req-1',
				},
			})
		);

		const queryMessage = messages.find((message) => message?.type === 'queryMentionCandidates');
		expect(queryMessage).toBeTruthy();
		expect(queryMessage.editorId).toBe('comment-input');
		expect(queryMessage.query).toBe('he');
		expect(queryMessage.requestId).toBe('req-1');

		dom.window.dispatchEvent(
			new dom.window.MessageEvent('message', {
				data: {
					type: 'richTextMentionCandidatesLoaded',
					editorId: 'comment-input',
					requestId: 'req-1',
					candidates: [
						{
							accountId: 'acct-123',
							displayName: 'Helena',
							mentionText: '@Helena',
							source: 'assignable',
						},
					],
				},
			})
		);

		expect(routedResults).toEqual([
			{
				requestId: 'req-1',
				candidates: [
					{
						accountId: 'acct-123',
						displayName: 'Helena',
						mentionText: '@Helena',
						source: 'assignable',
					},
				],
			},
		]);
	});
});

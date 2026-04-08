import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { EnvironmentRuntime } from '../../src/environment.runtime';
import { JiraIssue, JiraIssueComment, IssuePanelOptions } from '../../src/model/jira.type';
import { JiraWebviewPanel } from '../../src/views/webview/webview.panel';
import { Uri } from 'vscode';

type RenderedDom = {
	dom: JSDOM;
	messages: any[];
	scriptErrors: string[];
};

/**
 * Hosts the DOM assertions for the rich text editor issue panel.
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

		return { dom, messages, scriptErrors };
	}

	static click(element: Element, window: Window): void {
		element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	}

	static getRichTextEditor(dom: JSDOM): { editor: Element; visual: HTMLElement; raw: HTMLTextAreaElement } | null {
		const editor = dom.window.document.querySelector('.jira-rich-editor');
		if (!editor) return null;
		const visual = editor.querySelector('.jira-rich-editor-visual') as HTMLElement;
		const raw = editor.querySelector('.jira-rich-editor-raw') as HTMLTextAreaElement;
		if (!visual || !raw) return null;
		return { editor, visual, raw };
	}

	static getToolbarButton(dom: JSDOM, action: string): HTMLButtonElement | null {
		return dom.window.document.querySelector(`.jira-rich-editor-action[data-action="${action}"]`) as HTMLButtonElement | null;
	}
}

describe('Rich text editor WYSIWYG behavior', () => {
	it('loads the rich text editor bundle as an external webview script', () => {
		const html = RichTextEditorHarness.renderIssuePanelHtml({
			comments: [RichTextEditorHarness.createComment()],
		});

		expect(html).toContain('dist/webview/rich-text-editor.js');
		expect(html).toContain('window.initializeJiraRichTextEditors?.(document);');
	});

	it('compiles without script errors', () => {
		const { scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);
	});

	it('renders a visual editor and a hidden raw textarea', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const editorEl = RichTextEditorHarness.getRichTextEditor(dom);
		expect(editorEl).toBeTruthy();
		expect(editorEl!.visual.getAttribute('contenteditable')).toBe('true');
		expect(editorEl!.raw.style.display).toBe('none');
	});

	it('renders the full toolbar with all action buttons', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const actions = ['bold', 'italic', 'underline', 'strike', 'code', 'h2', 'bullet', 'number', 'quote', 'codeblock', 'link', 'toggleRaw'];
		for (const action of actions) {
			const btn = RichTextEditorHarness.getToolbarButton(dom, action);
			expect(btn).toBeTruthy();
		}
	});

	it('renders the toggle raw button', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const toggleBtn = RichTextEditorHarness.getToolbarButton(dom, 'toggleRaw');
		expect(toggleBtn).toBeTruthy();
		expect(toggleBtn!.textContent?.trim()).toBe('</>');
	});

	it('toggles to raw mode when toggle button is clicked', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const editorEl = RichTextEditorHarness.getRichTextEditor(dom);
		const toggleBtn = RichTextEditorHarness.getToolbarButton(dom, 'toggleRaw');
		expect(editorEl).toBeTruthy();
		expect(toggleBtn).toBeTruthy();

		RichTextEditorHarness.click(toggleBtn!, dom.window);

		expect(editorEl!.editor.classList.contains('raw-mode')).toBe(true);
		expect(editorEl!.visual.style.display).toBe('none');
		expect(editorEl!.raw.style.display).toBe('block');
		expect(toggleBtn!.classList.contains('active')).toBe(true);
	});

	it('toggles back to visual mode when toggle button is clicked again', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const editorEl = RichTextEditorHarness.getRichTextEditor(dom);
		const toggleBtn = RichTextEditorHarness.getToolbarButton(dom, 'toggleRaw');
		expect(editorEl).toBeTruthy();
		expect(toggleBtn).toBeTruthy();

		// Toggle to raw
		RichTextEditorHarness.click(toggleBtn!, dom.window);
		expect(editorEl!.editor.classList.contains('raw-mode')).toBe(true);

		// Toggle back to visual
		RichTextEditorHarness.click(toggleBtn!, dom.window);
		expect(editorEl!.editor.classList.contains('raw-mode')).toBe(false);
		expect(editorEl!.visual.style.display).toBe('block');
		expect(editorEl!.raw.style.display).toBe('none');
		expect(toggleBtn!.classList.contains('active')).toBe(false);
	});

	it('renders wiki markup as HTML when toggling from raw to visual', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
			commentDraft: '*bold* and _italic_',
		});
		expect(scriptErrors).toEqual([]);

		const editorEl = RichTextEditorHarness.getRichTextEditor(dom);
		const toggleBtn = RichTextEditorHarness.getToolbarButton(dom, 'toggleRaw');
		expect(editorEl).toBeTruthy();
		expect(toggleBtn).toBeTruthy();

		// Go to raw mode
		RichTextEditorHarness.click(toggleBtn!, dom.window);
		editorEl!.raw.value = '**new bold** and __new italic__';
		editorEl!.raw.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

		// Go back to visual
		RichTextEditorHarness.click(toggleBtn!, dom.window);
		expect(editorEl!.visual.innerHTML).toContain('<strong>new bold</strong>');
		expect(editorEl!.visual.innerHTML).toContain('<em>new italic</em>');
	});

	it('populates raw textarea when typing in visual editor', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const editorEl = RichTextEditorHarness.getRichTextEditor(dom);
		expect(editorEl).toBeTruthy();

		// Simulate typing by setting innerHTML and dispatching input
		editorEl!.visual.innerHTML = '<strong>bold text</strong>';
		editorEl!.visual.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

		expect(editorEl!.raw.value).toBe('*bold text*');
	});

	it('converts wiki markup to rendered HTML on initialization', () => {
		const { dom, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom(
			{
				comments: [RichTextEditorHarness.createComment()],
				commentDraft: '*bold text* and _italic_',
			},
		);
		expect(scriptErrors).toEqual([]);

		const editorEl = RichTextEditorHarness.getRichTextEditor(dom);
		expect(editorEl).toBeTruthy();
		// Raw should have the wiki markup
		expect(editorEl!.raw.value).toBe('*bold text* and _italic_');
		// Visual should have HTML rendered from wiki
		expect(editorEl!.visual.innerHTML).toContain('<strong>bold text</strong>');
		expect(editorEl!.visual.innerHTML).toContain('<em>italic</em>');
	});

	it.skip('bold button wraps selection in strong tags (requires real browser)', () => {
		// document.execCommand is not implemented in jsdom
	});

	it('posts addComment with wiki markup on comment form submit', () => {
		const { dom, messages, scriptErrors } = RichTextEditorHarness.renderIssuePanelDom({
			comments: [RichTextEditorHarness.createComment()],
		});
		expect(scriptErrors).toEqual([]);

		const editorEl = RichTextEditorHarness.getRichTextEditor(dom);
		const submitBtn = dom.window.document.querySelector('.comment-submit');
		expect(editorEl).toBeTruthy();
		expect(submitBtn).toBeTruthy();

		// Set bold content directly in visual and sync
		editorEl!.visual.innerHTML = '<strong>my comment</strong>';
		editorEl!.visual.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

		// Submit the form
		const form = dom.window.document.querySelector('.comment-form');
		form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const addCommentMsg = messages.find((m) => m?.type === 'addComment');
		expect(addCommentMsg).toBeTruthy();
		expect(addCommentMsg.body).toBe('*my comment*');
		expect(addCommentMsg.format).toBe('wiki');
	});

	it.skip('handles heading formatting (requires real browser)', () => {
		// document.execCommand('formatBlock') is not implemented in jsdom
	});

	it.skip('handles list formatting (requires real browser)', () => {
		// document.execCommand('insertUnorderedList') is not implemented in jsdom
	});

	it.skip('handles blockquote formatting (requires real browser)', () => {
		// document.execCommand('formatBlock') is not implemented in jsdom
	});
});

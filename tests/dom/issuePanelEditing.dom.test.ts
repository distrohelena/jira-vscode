import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { initializeEnvironment } from '../../src/environment.runtime';
import { JiraIssue, IssuePanelOptions } from '../../src/model/jira.type';
import { renderIssuePanelContent } from '../../src/views/webview/webview.panel';
import { Uri } from 'vscode';

type RenderedDom = {
	dom: JSDOM;
	messages: any[];
	scriptErrors: string[];
};

function createIssue(overrides?: Partial<JiraIssue>): JiraIssue {
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
		parent: overrides?.parent,
		children: overrides?.children,
	};
}

function renderIssuePanelDom(options?: IssuePanelOptions, issueOverrides?: Partial<JiraIssue>): RenderedDom {
	initializeEnvironment(new Uri('file:///workspace/jira-vscode'));
	const issue = createIssue(issueOverrides);
	const panel: any = {
		iconPath: undefined,
		webview: {
			cspSource: 'vscode-resource://test',
			html: '',
			asWebviewUri: (uri: Uri) => ({ toString: () => uri.toString() }),
		},
	};
	renderIssuePanelContent(panel, issue, options);

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

	return {
		dom,
		messages,
		scriptErrors,
	};
}

function click(element: Element, window: Window): void {
	element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

describe('Issue panel editor interactions', () => {
	it('opens title editor on title click', () => {
		const { dom, scriptErrors, messages } = renderIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const summaryBlock = dom.window.document.querySelector('.issue-summary-block');
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display');
		expect(summaryBlock).toBeTruthy();
		expect(summaryDisplay).toBeTruthy();

		click(summaryDisplay as Element, dom.window);
		expect(summaryBlock?.classList.contains('editor-open')).toBe(true);
		expect(messages.some((message) => message?.type === 'debugLog' && message?.event === 'summary.click')).toBe(
			true
		);
	});

	it('prefills title editor with existing summary', () => {
		const { dom } = renderIssuePanelDom(undefined, {
			summary: 'Current summary text',
		});
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display') as Element;
		const summaryInput = dom.window.document.querySelector('.jira-summary-input') as HTMLInputElement;
		expect(summaryDisplay).toBeTruthy();
		expect(summaryInput).toBeTruthy();

		click(summaryDisplay, dom.window);
		expect(summaryInput.value).toBe('Current summary text');
	});

	it('opens description editor on description click', () => {
		const { dom, scriptErrors, messages } = renderIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const descriptionBlock = dom.window.document.querySelector('.issue-description-block');
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display');
		expect(descriptionBlock).toBeTruthy();
		expect(descriptionDisplay).toBeTruthy();

		click(descriptionDisplay as Element, dom.window);
		expect(descriptionBlock?.classList.contains('editor-open')).toBe(true);
		expect(
			messages.some((message) => message?.type === 'debugLog' && message?.event === 'description.clickDisplay')
		).toBe(true);
	});

	it('prefills description editor with existing rendered description', () => {
		const { dom } = renderIssuePanelDom(undefined, {
			description: 'First line\nSecond line',
			descriptionHtml: '<p><strong>First line</strong><br />Second line</p>',
		});
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element;
		const descriptionInput = dom.window.document.querySelector('.jira-description-editor-input') as HTMLElement;
		expect(descriptionDisplay).toBeTruthy();
		expect(descriptionInput).toBeTruthy();

		click(descriptionDisplay, dom.window);
		expect(descriptionInput.innerHTML).toContain('<strong>First line</strong>');
		expect(descriptionInput.textContent).toContain('Second line');
	});

	it('posts updateSummary on title submit', () => {
		const { dom, messages } = renderIssuePanelDom();
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display') as Element;
		const summaryInput = dom.window.document.querySelector('.jira-summary-input') as HTMLInputElement;
		const summaryForm = dom.window.document.querySelector('.jira-summary-editor') as HTMLFormElement;
		expect(summaryDisplay).toBeTruthy();
		expect(summaryInput).toBeTruthy();
		expect(summaryForm).toBeTruthy();

		click(summaryDisplay, dom.window);
		summaryInput.value = 'Updated issue title';
		summaryForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const updateMessage = messages.find((message) => message?.type === 'updateSummary');
		expect(updateMessage).toBeTruthy();
		expect(updateMessage.issueKey).toBe('PROJ-1000');
		expect(updateMessage.summary).toBe('Updated issue title');
	});

	it('posts updateDescription on description submit', () => {
		const { dom, messages } = renderIssuePanelDom();
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display') as Element;
		const descriptionInput = dom.window.document.querySelector('.jira-description-editor-input') as HTMLElement;
		const descriptionForm = dom.window.document.querySelector('.jira-description-editor') as HTMLFormElement;
		expect(descriptionDisplay).toBeTruthy();
		expect(descriptionInput).toBeTruthy();
		expect(descriptionForm).toBeTruthy();

		click(descriptionDisplay, dom.window);
		descriptionInput.innerHTML = '<p>Updated description body</p>';
		descriptionForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const updateMessage = messages.find((message) => message?.type === 'updateDescription');
		expect(updateMessage).toBeTruthy();
		expect(updateMessage.issueKey).toBe('PROJ-1000');
		expect(updateMessage.description).toBe('Updated description body');
	});

	it('does not open editors while update is pending', () => {
		const { dom } = renderIssuePanelDom({
			summaryEditPending: true,
			descriptionEditPending: true,
		});
		const summaryBlock = dom.window.document.querySelector('.issue-summary-block');
		const summaryDisplay = dom.window.document.querySelector('.jira-summary-display');
		const descriptionBlock = dom.window.document.querySelector('.issue-description-block');
		const descriptionDisplay = dom.window.document.querySelector('.jira-description-display');

		click(summaryDisplay as Element, dom.window);
		click(descriptionDisplay as Element, dom.window);

		expect(summaryBlock?.classList.contains('editor-open')).toBe(false);
		expect(descriptionBlock?.classList.contains('editor-open')).toBe(false);
	});
});

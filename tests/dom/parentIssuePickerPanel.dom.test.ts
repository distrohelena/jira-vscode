import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { EnvironmentRuntime } from '../../src/environment.runtime';
import { JiraIssue, SelectedProjectInfo } from '../../src/model/jira.type';
import { ParentIssuePickerPanel } from '../../src/views/webview/parent-issue-picker.panel';
import { Uri } from 'vscode';
import { ParentIssuePickerPanelState } from '../../src/views/webview/parent-issue-picker.panel';

type RenderedParentPickerDom = {
	dom: JSDOM;
	messages: any[];
	scriptErrors: string[];
};

const createProject = (): SelectedProjectInfo => ({
	key: 'PROJ',
	name: 'Project',
});

const createIssue = (overrides?: Partial<JiraIssue>): JiraIssue => ({
	id: overrides?.id ?? '1000',
	key: overrides?.key ?? 'PROJ-1000',
	summary: overrides?.summary ?? 'Parent candidate',
	statusName: overrides?.statusName ?? 'In Progress',
	url: overrides?.url ?? 'https://jira.example.test/browse/PROJ-1000',
	updated: overrides?.updated ?? '2026-03-18T12:00:00.000Z',
	created: overrides?.created ?? '2026-03-17T12:00:00.000Z',
	issueTypeName: overrides?.issueTypeName ?? 'Task',
	assigneeName: overrides?.assigneeName,
});

const renderParentIssuePickerPanelDom = (overrides?: Partial<ParentIssuePickerPanelState>): RenderedParentPickerDom => {
	EnvironmentRuntime.initializeEnvironment(new Uri('file:///workspace/jira-vscode'));
	const state: ParentIssuePickerPanelState = {
		loading: false,
		loadingMore: false,
		hasMore: false,
		searchQuery: '',
		issueTypeName: '',
		statusName: '',
		issues: [],
		...overrides,
	};
	const panel: any = {
		iconPath: undefined,
		webview: {
			cspSource: 'vscode-resource://test',
			html: '',
			asWebviewUri: (uri: Uri) => ({ toString: () => uri.toString() }),
		},
	};

	ParentIssuePickerPanel.renderParentIssuePickerPanel(panel, createProject(), state);

	const scriptErrors: string[] = [];
	const scriptMatch = panel.webview.html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
	if (scriptMatch?.[1]) {
		try {
			new vm.Script(scriptMatch[1], { filename: 'parent-issue-picker-inline.js' });
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
};

describe('Parent issue picker modal', () => {
	it('reserves layout space for search, results, and preview regions', () => {
		const { dom, scriptErrors } = renderParentIssuePickerPanelDom();
		expect(scriptErrors).toEqual([]);

		const shell = dom.window.document.querySelector('.parent-picker-shell');
		expect(shell).toBeTruthy();
		expect(dom.window.document.body.innerHTML).toContain('width: 92vw');
		expect(dom.window.document.body.innerHTML).toContain('height: min(84vh, 860px)');
		expect(dom.window.document.body.innerHTML).toContain('min-height: 280px');
		expect(dom.window.document.body.innerHTML).toContain('min-height: 120px');
	});

	it('posts a project-scoped search request with filters from the modal form', () => {
		const { dom, messages, scriptErrors } = renderParentIssuePickerPanelDom();
		expect(scriptErrors).toEqual([]);

		const queryInput = dom.window.document.querySelector('[name="searchQuery"]') as HTMLInputElement | null;
		const issueTypeInput = dom.window.document.querySelector('[name="issueTypeName"]') as HTMLInputElement | null;
		const statusSelect = dom.window.document.querySelector('[name="statusName"]') as HTMLSelectElement | null;
		const searchButton = dom.window.document.querySelector('.parent-picker-search') as HTMLButtonElement | null;
		expect(queryInput).toBeTruthy();
		expect(issueTypeInput).toBeTruthy();
		expect(statusSelect).toBeTruthy();
		expect(searchButton).toBeTruthy();

		queryInput!.value = 'backend';
		issueTypeInput!.value = 'Bug';
		statusSelect!.value = 'Closed';
		searchButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

		const searchMessage = messages.find((message) => message?.type === 'loadParentIssues');
		expect(searchMessage).toBeTruthy();
		expect(searchMessage.filters.searchQuery).toBe('backend');
		expect(searchMessage.filters.issueTypeName).toBe('Bug');
		expect(searchMessage.filters.statusName).toBe('Closed');
	});

	it('lets the user select a parent candidate and confirm it', () => {
		const { dom, messages, scriptErrors } = renderParentIssuePickerPanelDom({
			issues: [createIssue()],
			selectedIssueKey: 'PROJ-1000',
		});
		expect(scriptErrors).toEqual([]);

		const resultButton = dom.window.document.querySelector('[data-parent-issue-key="PROJ-1000"]') as HTMLButtonElement | null;
		const confirmButton = dom.window.document.querySelector('.parent-picker-confirm') as HTMLButtonElement | null;
		expect(resultButton).toBeTruthy();
		expect(confirmButton).toBeTruthy();

		resultButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		confirmButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

		expect(messages.some((message) => message?.type === 'selectParentIssue')).toBe(true);
		expect(messages.some((message) => message?.type === 'confirmParentIssue')).toBe(true);
	});
});

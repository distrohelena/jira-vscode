import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { EnvironmentRuntime } from '../../src/environment.runtime';
import { CreateIssuePanelState } from '../../src/model/jira.type';
import { JiraWebviewPanel } from '../../src/views/webview/webview.panel';
import { Uri } from 'vscode';

type RenderedCreateIssueDom = {
	dom: JSDOM;
	messages: any[];
	scriptErrors: string[];
};

const createBaseState = (): CreateIssuePanelState => ({
	values: {
		summary: '',
		description: '',
		issueType: 'Task',
		status: 'To Do',
		customFields: {},
	},
	createFields: [
		{
			id: 'parent',
			name: 'Parent',
			required: true,
			multiline: false,
		},
	],
	createFieldsPending: false,
	currentUser: {
		accountId: 'acct-123',
		displayName: 'Helena',
	},
});

const renderCreateIssuePanelDom = (overrides?: Partial<CreateIssuePanelState>): RenderedCreateIssueDom => {
	EnvironmentRuntime.initializeEnvironment(new Uri('file:///workspace/jira-vscode'));
	const baseState = createBaseState();
	const state: CreateIssuePanelState = {
		...baseState,
		...overrides,
		values: {
			...baseState.values,
			...overrides?.values,
			customFields: {
				...(baseState.values.customFields ?? {}),
				...(overrides?.values?.customFields ?? {}),
			},
		},
	};
	const panel: any = {
		iconPath: undefined,
		webview: {
			cspSource: 'vscode-resource://test',
			html: '',
			asWebviewUri: (uri: Uri) => ({ toString: () => uri.toString() }),
		},
	};

	JiraWebviewPanel.renderCreateIssuePanel(panel, { key: 'PROJ', name: 'Project' }, state);

	const scriptErrors: string[] = [];
	const scriptMatch = panel.webview.html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
	if (scriptMatch?.[1]) {
		try {
			new vm.Script(scriptMatch[1], { filename: 'create-issue-panel-inline.js' });
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

describe('Create issue panel', () => {
	it('posts parent metadata from Jira create fields when the form is submitted', () => {
		const { dom, messages, scriptErrors } = renderCreateIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const summaryInput = dom.window.document.querySelector('input[name="summary"]') as HTMLInputElement | null;
		const parentInput = dom.window.document.querySelector(
			'[data-create-custom-field="parent"]'
		) as HTMLInputElement | null;
		const form = dom.window.document.getElementById('create-issue-form') as HTMLFormElement | null;
		expect(summaryInput).toBeTruthy();
		expect(parentInput).toBeTruthy();
		expect(form).toBeTruthy();

		summaryInput!.value = 'Child ticket';
		parentInput!.value = 'PROJ-123';
		form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const message = messages.find((entry) => entry?.type === 'createIssue');
		expect(message).toBeTruthy();
		expect(message.values.summary).toBe('Child ticket');
		expect(message.values.customFields.parent).toBe('PROJ-123');
	});
});

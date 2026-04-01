import { JSDOM, VirtualConsole } from 'jsdom';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { EnvironmentRuntime } from '../../src/environment.runtime';
import { CreateIssuePanelState } from '../../src/model/jira.type';
import { ParentIssuePickerOverlay } from '../../src/views/webview/parent-issue-picker.overlay';
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
			'.issue-sidebar [data-create-custom-field="parent"]'
		) as HTMLInputElement | null;
		const parentButton = dom.window.document.querySelector(
			'.issue-sidebar [data-parent-picker-open]'
		) as HTMLButtonElement | null;
		const assigneeButton = dom.window.document.querySelector(
			'.issue-sidebar [data-assignee-picker-open]'
		) as HTMLButtonElement | null;
		const form = dom.window.document.getElementById('create-issue-form') as HTMLFormElement | null;
		expect(summaryInput).toBeTruthy();
		expect(parentInput).toBeTruthy();
		expect(parentButton).toBeTruthy();
		const parentButtonText = parentButton?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(parentButtonText).toContain('Choose a parent ticket');
		expect(parentButtonText).toContain('No parent selected');
		expect(parentButtonText).toContain('Unassigned');
		expect(assigneeButton).toBeTruthy();
		expect(form).toBeTruthy();
		expect(parentInput!.compareDocumentPosition(assigneeButton!)).toBe(
			dom.window.Node.DOCUMENT_POSITION_FOLLOWING
		);

		summaryInput!.value = 'Child ticket';
		parentInput!.value = 'PROJ-123';
		form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

		const message = messages.find((entry) => entry?.type === 'createIssue');
		expect(message).toBeTruthy();
		expect(message.values.summary).toBe('Child ticket');
		expect(message.values.customFields.parent).toBe('PROJ-123');
	});

	it('opens the parent picker modal from the parent field control', () => {
		const { dom, messages, scriptErrors } = renderCreateIssuePanelDom({
			createFields: [
				{
					id: 'parent',
					name: 'Parent',
					required: true,
					multiline: false,
					isParentField: true,
				},
			],
		});
		expect(scriptErrors).toEqual([]);

		const parentButton = dom.window.document.querySelector('.issue-sidebar [data-parent-picker-open]');
		expect(parentButton).toBeTruthy();

		parentButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

		const openMessage = messages.find((entry) => entry?.type === 'openParentPicker');
		expect(openMessage).toBeTruthy();
	});

	it('opens the assignee picker modal from the assignee field control', () => {
		const { dom, messages, scriptErrors } = renderCreateIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const assigneeButton = dom.window.document.querySelector('.issue-sidebar [data-assignee-picker-open]');
		expect(assigneeButton).toBeTruthy();

		assigneeButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

		const openMessage = messages.find((entry) => entry?.type === 'openAssigneePicker');
		expect(openMessage).toBeTruthy();
	});

	it('renders the parent picker overlay inside the existing webview', () => {
		const { dom, scriptErrors } = renderCreateIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const host = dom.window.document.getElementById('parent-picker-host');
		expect(host).toBeTruthy();
		expect(dom.window.document.head.innerHTML).toContain('place-items: center');
		expect(dom.window.document.head.innerHTML).toMatch(/\.parent-picker-host\.active\s*\{\s*display:\s*grid;/);
		expect(dom.window.document.head.innerHTML).toContain('justify-self: center');
		expect(dom.window.document.head.innerHTML).toContain('height: min(84vh, 860px)');

		dom.window.dispatchEvent(
			new dom.window.MessageEvent('message', {
				data: {
					type: 'parentPickerRender',
					html: '<div class="parent-picker-shell"><div class="parent-picker-title">Select Parent Ticket</div></div>',
				},
			})
		);

		expect(host?.classList.contains('active')).toBe(true);
		expect(host?.innerHTML).toContain('Select Parent Ticket');
	});

	it('updates the parent card when the picker applies and clears a selection', () => {
		const { dom, scriptErrors } = renderCreateIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const parentButton = dom.window.document.querySelector(
			'.issue-sidebar [data-parent-picker-open]'
		) as HTMLButtonElement | null;
		const parentInput = dom.window.document.querySelector(
			'.issue-sidebar [data-create-custom-field="parent"]'
		) as HTMLInputElement | null;
		expect(parentButton).toBeTruthy();
		expect(parentInput).toBeTruthy();

		dom.window.dispatchEvent(
			new dom.window.MessageEvent('message', {
				data: {
					type: 'parentPickerSelectionApplied',
					issue: {
						key: 'PROJ-123',
						summary: 'Selected parent ticket',
						statusName: 'Closed',
						assigneeName: 'Helena',
					},
				},
			})
		);

		const selectedText = parentButton?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(parentInput?.value).toBe('PROJ-123');
		expect(selectedText).toContain('Choose a parent ticket');
		expect(selectedText).toContain('PROJ-123 - Selected parent ticket');

		dom.window.dispatchEvent(
			new dom.window.MessageEvent('message', {
				data: {
					type: 'parentPickerSelectionApplied',
				},
			})
		);

		const clearedText = parentButton?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(parentInput?.value).toBe('');
		expect(clearedText).toContain('Choose a parent ticket');
		expect(clearedText).toContain('No parent selected');
		expect(clearedText).toContain('Unassigned');
	});

	it('syncs the selected parent into a nonliteral parent field id', () => {
		const parentFieldId = 'customfield_10016';
		const { dom, scriptErrors } = renderCreateIssuePanelDom({
			createFields: [
				{
					id: parentFieldId,
					name: 'Parent Link',
					required: false,
					multiline: false,
					isParentField: true,
				},
			],
			values: {
				customFields: {
					[parentFieldId]: '',
				},
			},
		});
		expect(scriptErrors).toEqual([]);

		const parentField = dom.window.document.querySelector(
			`[data-create-parent-field="${parentFieldId}"]`
		) as HTMLElement | null;
		const parentInput = dom.window.document.querySelector(
			`input[data-create-custom-field="${parentFieldId}"]`
		) as HTMLInputElement | null;
		expect(parentField).toBeTruthy();
		expect(parentInput).toBeTruthy();

		dom.window.dispatchEvent(
			new dom.window.MessageEvent('message', {
				data: {
					type: 'parentPickerSelectionApplied',
					issue: {
						key: 'PROJ-456',
						summary: 'Parent from dynamic field',
					},
				},
			})
		);

		expect(parentInput?.value).toBe('PROJ-456');
	});

	it('renders authenticated local issue icons in the parent picker results and preview', () => {
		const { dom, scriptErrors } = renderCreateIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		const issue = {
			id: '1001',
			key: 'PROJ-1001',
			summary: 'Parent candidate',
			statusName: 'In Progress',
			statusIconUrl: 'https://jira.example.test/icons/status.svg',
			statusIconSrc: 'vscode-resource://test/jira-icon-cache/status.svg',
			issueTypeName: 'Story',
			issueTypeIconUrl: 'https://jira.example.test/icons/story.svg',
			issueTypeIconSrc: 'vscode-resource://test/jira-icon-cache/story.svg',
			url: 'https://jira.example.test/browse/PROJ-1001',
			updated: '2026-03-18T12:00:00.000Z',
		} as any;

		dom.window.dispatchEvent(
			new dom.window.MessageEvent('message', {
				data: {
					type: 'parentPickerRender',
					html: ParentIssuePickerOverlay.renderOverlayHtml({
						projectKey: 'PROJ',
						projectLabel: 'Project',
						searchQuery: '',
						issueTypeName: '',
						statusName: '',
						loading: false,
						loadingMore: false,
						issues: [issue],
						hasMore: false,
						selectedIssueKey: 'PROJ-1001',
					}),
				},
			})
		);

		const host = dom.window.document.getElementById('parent-picker-host');
		expect(host?.classList.contains('active')).toBe(true);

		const resultRow = dom.window.document.querySelector('[data-parent-issue-key="PROJ-1001"]');
		const preview = dom.window.document.querySelector('.parent-picker-preview');
		const resultIssueTypeIcon = dom.window.document.querySelector(
			'.parent-picker-result [data-parent-issue-key="PROJ-1001"] .issue-type-icon'
		) as HTMLImageElement | null;
		const resultStatusIcon = dom.window.document.querySelector(
			'.parent-picker-result [data-parent-issue-key="PROJ-1001"] .status-icon'
		) as HTMLImageElement | null;
		const previewIssueTypeIcon = dom.window.document.querySelector(
			'.parent-picker-preview .issue-type-icon'
		) as HTMLImageElement | null;
		const previewStatusIcon = dom.window.document.querySelector(
			'.parent-picker-preview .status-icon'
		) as HTMLImageElement | null;

		expect(resultRow).toBeTruthy();
		expect(preview).toBeTruthy();
		expect(resultIssueTypeIcon).toBeTruthy();
		expect(resultIssueTypeIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/story.svg');
		expect(resultStatusIcon).toBeTruthy();
		expect(resultStatusIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/status.svg');
		expect(previewIssueTypeIcon).toBeTruthy();
		expect(previewIssueTypeIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/story.svg');
		expect(previewStatusIcon).toBeTruthy();
		expect(previewStatusIcon?.getAttribute('src')).toBe('vscode-resource://test/jira-icon-cache/status.svg');
		expect(dom.window.document.head.innerHTML).toContain('result-icon-stack');
		expect(dom.window.document.head.innerHTML).toContain('preview-icon-stack');
	});

	it('keeps parent picker icon slots with issue-type placeholders and packaged status fallback when Jira icon URLs are absent', () => {
		const { dom, scriptErrors } = renderCreateIssuePanelDom();
		expect(scriptErrors).toEqual([]);

		dom.window.dispatchEvent(
			new dom.window.MessageEvent('message', {
				data: {
					type: 'parentPickerRender',
					html: ParentIssuePickerOverlay.renderOverlayHtml({
						projectKey: 'PROJ',
						projectLabel: 'Project',
						searchQuery: '',
						issueTypeName: '',
						statusName: '',
						loading: false,
						loadingMore: false,
						statusIconFallbacks: {
							inProgress: 'vscode-resource://test/media/status-inprogress.png',
							open: 'vscode-resource://test/media/status-open.png',
							done: 'vscode-resource://test/media/status-done.png',
							default: 'vscode-resource://test/media/status-default.png',
						},
						issues: [
							{
								id: '1002',
								key: 'PROJ-1002',
								summary: 'Fallback candidate',
								statusName: 'In Progress',
								url: 'https://jira.example.test/browse/PROJ-1002',
								updated: '2026-03-18T12:00:00.000Z',
							},
						],
						hasMore: false,
						selectedIssueKey: 'PROJ-1002',
					}),
				},
			})
		);

		const resultIconSlots = Array.from(dom.window.document.querySelectorAll('.parent-picker-result .result-icon-slot'));
		const previewIconSlots = Array.from(dom.window.document.querySelectorAll('.parent-picker-preview .preview-icon-slot'));
		const resultIssueTypePlaceholder = dom.window.document.querySelector(
			'.parent-picker-result .issue-type-icon-placeholder'
		);
		const resultStatusIcon = dom.window.document.querySelector(
			'.parent-picker-result .status-icon'
		) as HTMLImageElement | null;
		const previewIssueTypePlaceholder = dom.window.document.querySelector(
			'.parent-picker-preview .issue-type-icon-placeholder'
		);
		const previewStatusIcon = dom.window.document.querySelector(
			'.parent-picker-preview .status-icon'
		) as HTMLImageElement | null;

		expect(resultIconSlots).toHaveLength(2);
		expect(previewIconSlots).toHaveLength(2);
		expect(resultIssueTypePlaceholder).toBeTruthy();
		expect(resultStatusIcon).toBeTruthy();
		expect(resultStatusIcon?.getAttribute('src')).toBe('vscode-resource://test/media/status-inprogress.png');
		expect(previewIssueTypePlaceholder).toBeTruthy();
		expect(previewStatusIcon).toBeTruthy();
		expect(previewStatusIcon?.getAttribute('src')).toBe('vscode-resource://test/media/status-inprogress.png');
	});

	it('renders dynamic parent picker status options from the current project context', () => {
		const html = ParentIssuePickerOverlay.renderOverlayHtml({
			projectKey: 'PROJ',
			projectLabel: 'Project',
			searchQuery: '',
			issueTypeName: '',
			statusName: 'Ready for QA',
			availableStatusNames: ['Ready for QA', 'Blocked', 'Awaiting Sign-Off'],
			loading: false,
			loadingMore: false,
			issues: [],
			hasMore: false,
			selectedIssueKey: undefined,
		});
		const dom = new JSDOM(html);
		const options = Array.from(dom.window.document.querySelectorAll('select[name="statusName"] option')).map((option) => ({
			value: option.getAttribute('value'),
			label: option.textContent?.trim(),
			selected: option.hasAttribute('selected'),
		}));

		expect(options).toEqual([
			{ value: '', label: 'All', selected: false },
			{ value: 'Ready for QA', label: 'Ready for QA', selected: true },
			{ value: 'Blocked', label: 'Blocked', selected: false },
			{ value: 'Awaiting Sign-Off', label: 'Awaiting Sign-Off', selected: false },
		]);
		expect(html).not.toContain('>To Do<');
		expect(html).not.toContain('>In Progress<');
	});
});

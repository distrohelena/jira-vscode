import assert from 'node:assert/strict';
import Module from 'node:module';
import test from 'node:test';

/**
 * Describes the subset of the VS Code API required by the issue controller test harness.
 */
type VscodeIssueControllerTestModule = {
	ViewColumn: {
		Active: number;
	};
	commands: {
		executeCommand(command: string, ...args: unknown[]): Promise<void>;
	};
	window: {
		showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
		showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
		showWarningMessage(
			message: string,
			options?: { modal?: boolean },
			...items: string[]
		): Promise<string | undefined>;
	};
};

/**
 * Represents the issue-controller modules loaded through a local VS Code runtime stub.
 */
type IssueControllerTestModules = {
	vscode: VscodeIssueControllerTestModule;
	IssueControllerFactory: typeof import('../../src/controllers/issue.controller').IssueControllerFactory;
	JiraWebviewPanel: typeof import('../../src/views/webview/webview.panel').JiraWebviewPanel;
	jiraApiClient: typeof import('../../src/jira-api').jiraApiClient;
};

/**
 * Builds one Jira issue fixture suitable for issue-controller roundtrip tests.
 */
function createIssueFixture(
	overrides: Partial<import('../../src/model/jira.type').JiraIssue> = {}
): import('../../src/model/jira.type').JiraIssue {
	return {
		id: overrides.id ?? '10001',
		key: overrides.key ?? 'PROJ-1',
		summary: overrides.summary ?? 'Roundtrip parent selection',
		statusName: overrides.statusName ?? 'In Progress',
		updated: overrides.updated ?? '2026-04-01T12:00:00.000Z',
		created: overrides.created ?? '2026-03-31T12:00:00.000Z',
		issueTypeId: overrides.issueTypeId ?? '10000',
		issueTypeName: overrides.issueTypeName ?? 'Task',
		url: overrides.url ?? 'https://example.atlassian.net/browse/PROJ-1',
		parent: overrides.parent,
		children: overrides.children,
		...overrides,
	};
}

/**
 * Waits for queued asynchronous work to settle across a few microtask and macrotask turns.
 */
async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	await Promise.resolve();
}

/**
 * Loads the issue-controller modules with a local VS Code stub so the controller can be tested in isolation.
 */
function loadIssueControllerModules(): IssueControllerTestModules {
	const requireFromTest = Module.createRequire(import.meta.url);
	const moduleLoader = Module as typeof Module & {
		_load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
	};
	const originalLoad = moduleLoader._load;

	const vscode: VscodeIssueControllerTestModule = {
		ViewColumn: {
			Active: 1,
		},
		commands: {
			async executeCommand(): Promise<void> {
				return undefined;
			},
		},
		window: {
			async showInformationMessage(): Promise<string | undefined> {
				return undefined;
			},
			async showErrorMessage(): Promise<string | undefined> {
				return undefined;
			},
			async showWarningMessage(): Promise<string | undefined> {
				return undefined;
			},
		},
	};

	moduleLoader._load = function patchedLoad(request: string, parent: NodeModule, isMain: boolean): unknown {
		if (request === 'vscode') {
			return vscode;
		}
		return originalLoad.call(this, request, parent, isMain);
	};

	try {
		const controllerModulePath = requireFromTest.resolve('../../src/controllers/issue.controller.ts');
		const panelModulePath = requireFromTest.resolve('../../src/views/webview/webview.panel.ts');
		const jiraApiModulePath = requireFromTest.resolve('../../src/jira-api/index.ts');
		delete requireFromTest.cache[controllerModulePath];
		delete requireFromTest.cache[panelModulePath];
		delete requireFromTest.cache[jiraApiModulePath];

		const controllerModule =
			requireFromTest(controllerModulePath) as typeof import('../../src/controllers/issue.controller');
		const panelModule =
			requireFromTest(panelModulePath) as typeof import('../../src/views/webview/webview.panel');
		const jiraApiModule = requireFromTest(jiraApiModulePath) as typeof import('../../src/jira-api');

		return {
			vscode,
			IssueControllerFactory: controllerModule.IssueControllerFactory,
			JiraWebviewPanel: panelModule.JiraWebviewPanel,
			jiraApiClient: jiraApiModule.jiraApiClient,
		};
	} finally {
		moduleLoader._load = originalLoad;
	}
}

test('openParentPicker updates the issue parent, refetches details, and rerenders the issue panel', async () => {
	const { IssueControllerFactory, JiraWebviewPanel, jiraApiClient } = loadIssueControllerModules();
	const initialIssue = createIssueFixture({
		parent: {
			key: 'PROJ-10',
			summary: 'Old parent',
			statusName: 'Done',
			url: 'https://example.atlassian.net/browse/PROJ-10',
			updated: '2026-03-30T12:00:00.000Z',
		},
	});
	const selectedParentIssue = createIssueFixture({
		id: '10002',
		key: 'PROJ-20',
		summary: 'New parent',
		statusName: 'Done',
		url: 'https://example.atlassian.net/browse/PROJ-20',
	});
	const updatedIssue = createIssueFixture({
		parent: {
			key: 'PROJ-20',
			summary: 'New parent',
			statusName: 'Done',
			url: 'https://example.atlassian.net/browse/PROJ-20',
			updated: '2026-04-01T12:00:00.000Z',
		},
	});
	const renderCalls: Array<{ issue: import('../../src/model/jira.type').JiraIssue; options: unknown }> = [];
	const fetchedIssueKeys: string[] = [];
	const updateParentCalls: Array<{ issueKey: string; parentIssueKey: string | undefined }> = [];
	const panelDisposeHandlers: Array<() => void> = [];
	let panelMessageHandler: ((message: unknown) => Promise<void>) | undefined;
	let parentPickerSessionsCreated = 0;

	const fakePanel: any = {
		webview: {
			postMessage: async () => true,
		},
		reveal: () => undefined,
		onDidDispose: (handler: () => void) => {
			panelDisposeHandlers.push(handler);
			return { dispose() {} };
		},
	};

	const originalShowIssueDetailsPanel = JiraWebviewPanel.showIssueDetailsPanel;
	const originalRenderIssuePanelContent = JiraWebviewPanel.renderIssuePanelContent;
	const originalFetchIssueDetails = jiraApiClient.fetchIssueDetails;
	const originalFetchIssueTransitions = jiraApiClient.fetchIssueTransitions;
	const originalFetchIssueComments = jiraApiClient.fetchIssueComments;
	const originalUpdateIssueParent = jiraApiClient.updateIssueParent;

	JiraWebviewPanel.showIssueDetailsPanel = ((issueKey, issue, options, onMessage) => {
		panelMessageHandler = onMessage;
		renderCalls.push({ issue, options });
		return fakePanel;
	}) as typeof JiraWebviewPanel.showIssueDetailsPanel;
	JiraWebviewPanel.renderIssuePanelContent = ((panel, issue, options) => {
		renderCalls.push({ issue, options });
	}) as typeof JiraWebviewPanel.renderIssuePanelContent;
	jiraApiClient.fetchIssueDetails = (async (_authInfo, _token, issueKey) => {
		fetchedIssueKeys.push(issueKey);
		return fetchedIssueKeys.length === 1 ? initialIssue : updatedIssue;
	}) as typeof jiraApiClient.fetchIssueDetails;
	jiraApiClient.fetchIssueTransitions = (async () => []) as typeof jiraApiClient.fetchIssueTransitions;
	jiraApiClient.fetchIssueComments = (async () => []) as typeof jiraApiClient.fetchIssueComments;
	jiraApiClient.updateIssueParent = (async (_authInfo, _token, issueKey, parentIssueKey) => {
		updateParentCalls.push({ issueKey, parentIssueKey });
	}) as typeof jiraApiClient.updateIssueParent;

	try {
		const controller = IssueControllerFactory.create({
			authManager: {
				async getAuthInfo(): Promise<any> {
					return {
						baseUrl: 'https://example.atlassian.net',
						username: 'helena@example.com',
						displayName: 'Helena',
						accountId: 'account-123',
						serverLabel: 'cloud',
					};
				},
				async getToken(): Promise<string> {
					return 'token-123';
				},
			} as any,
			assigneePicker: {
				pickAssignee: () => {
					throw new Error('assignee picker should not be used in this test');
				},
			} as any,
			parentIssuePicker: {
				pickParentIssue: () => {
					parentPickerSessionsCreated++;
					return {
						handleMessage: async () => false,
						dispose: () => undefined,
						promise: Promise.resolve({
							kind: 'issue',
							issue: selectedParentIssue,
						}),
					};
				},
			} as any,
			projectStatusStore: {
				getIssueTypeStatuses: () => undefined,
				get: () => undefined,
				ensure: async () => [],
				ensureAllIssueTypeStatuses: async () => [],
			} as any,
			transitionStore: {
				get: () => undefined,
				remember: () => undefined,
			} as any,
			transitionPrefetcher: {
				prefetch: () => undefined,
				prefetchIssues: () => undefined,
			} as any,
			webviewIconService: {
				async createIssueWithResolvedIconSources(_webview: unknown, issue: import('../../src/model/jira.type').JiraIssue) {
					return {
						...issue,
						issueTypeIconSrc: issue.issueTypeIconSrc ?? 'vscode-resource:/cached/type.svg',
						statusIconSrc: issue.statusIconSrc ?? 'vscode-resource:/cached/status.svg',
					};
				},
			} as any,
			refreshAll: () => undefined,
		});

		await controller.openIssueDetails('PROJ-1');
		await flushAsyncWork();

		assert.equal(typeof panelMessageHandler, 'function');
		assert.equal(parentPickerSessionsCreated, 0);

		await panelMessageHandler?.({ type: 'openParentPicker' });
		await flushAsyncWork();

		assert.equal(parentPickerSessionsCreated, 1);
		assert.deepEqual(updateParentCalls, [
			{
				issueKey: 'PROJ-1',
				parentIssueKey: 'PROJ-20',
			},
		]);
		assert.deepEqual(fetchedIssueKeys, ['PROJ-1', 'PROJ-1']);
		assert.equal(panelDisposeHandlers.length, 1);

		const latestRender = renderCalls[renderCalls.length - 1];
		assert.equal(latestRender.issue.parent?.key, 'PROJ-20');
		assert.equal(latestRender.issue.parent?.summary, 'New parent');
	} finally {
		JiraWebviewPanel.showIssueDetailsPanel = originalShowIssueDetailsPanel;
		JiraWebviewPanel.renderIssuePanelContent = originalRenderIssuePanelContent;
		jiraApiClient.fetchIssueDetails = originalFetchIssueDetails;
		jiraApiClient.fetchIssueTransitions = originalFetchIssueTransitions;
		jiraApiClient.fetchIssueComments = originalFetchIssueComments;
		jiraApiClient.updateIssueParent = originalUpdateIssueParent;
	}
});

test('issue controller responds to queryMentionCandidates with ranked participants and assignable users', async () => {
	const { IssueControllerFactory, JiraWebviewPanel, jiraApiClient } = loadIssueControllerModules();
	const postedMessages: any[] = [];
	let panelMessageHandler: ((message: unknown) => Promise<void>) | undefined;

	const originalShowIssueDetailsPanel = JiraWebviewPanel.showIssueDetailsPanel;
	const originalRenderIssuePanelContent = JiraWebviewPanel.renderIssuePanelContent;
	const originalFetchIssueDetails = jiraApiClient.fetchIssueDetails;
	const originalFetchIssueTransitions = jiraApiClient.fetchIssueTransitions;
	const originalFetchIssueComments = jiraApiClient.fetchIssueComments;
	const originalFetchAssignableUsers = jiraApiClient.fetchAssignableUsers;

	JiraWebviewPanel.showIssueDetailsPanel = ((issueKey, issue, options, onMessage) => {
		panelMessageHandler = onMessage;
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
	JiraWebviewPanel.renderIssuePanelContent = (() => undefined) as typeof JiraWebviewPanel.renderIssuePanelContent;
	jiraApiClient.fetchIssueDetails = (async () =>
		createIssueFixture({
			reporterAccountId: 'acct-reporter',
			reporterName: 'Reporter',
			assigneeAccountId: 'acct-assignee',
			assigneeName: 'Assignee',
		})) as typeof jiraApiClient.fetchIssueDetails;
	jiraApiClient.fetchIssueTransitions = (async () => []) as typeof jiraApiClient.fetchIssueTransitions;
	jiraApiClient.fetchIssueComments = (async () => [
		{
			id: 'comment-1',
			authorAccountId: 'acct-commenter',
			authorName: 'Commenter',
			updated: '2026-04-10T12:30:00.000Z',
		} as any,
	]) as typeof jiraApiClient.fetchIssueComments;
	jiraApiClient.fetchAssignableUsers = (async () => [
		{
			accountId: 'acct-remote',
			displayName: 'Remote User',
		},
	]) as typeof jiraApiClient.fetchAssignableUsers;

	try {
		const controller = IssueControllerFactory.create({
			authManager: {
				async getAuthInfo(): Promise<any> {
					return {
						baseUrl: 'https://example.atlassian.net',
						username: 'helena@example.com',
						displayName: 'Helena',
						accountId: 'acct-current',
						serverLabel: 'cloud',
					};
				},
				async getToken(): Promise<string> {
					return 'token-123';
				},
			} as any,
			assigneePicker: {
				pickAssignee: () => {
					throw new Error('assignee picker should not be used in this test');
				},
			} as any,
			parentIssuePicker: {
				pickParentIssue: () => {
					throw new Error('parent picker should not be used in this test');
				},
			} as any,
			projectStatusStore: {
				getIssueTypeStatuses: () => undefined,
				get: () => undefined,
				ensure: async () => [],
				ensureAllIssueTypeStatuses: async () => [],
			} as any,
			transitionStore: {
				get: () => undefined,
				remember: () => undefined,
			} as any,
			transitionPrefetcher: {
				prefetch: () => undefined,
				prefetchIssues: () => undefined,
			} as any,
			webviewIconService: {
				async createIssueWithResolvedIconSources(_webview: unknown, issue: import('../../src/model/jira.type').JiraIssue) {
					return issue;
				},
				async createStatusOptionsWithResolvedIconSources(_webview: unknown, options?: unknown) {
					return options as any;
				},
			} as any,
			refreshAll: () => undefined,
		});

		await controller.openIssueDetails('PROJ-1');
		await flushAsyncWork();

		assert.equal(typeof panelMessageHandler, 'function');

		await panelMessageHandler?.({
			type: 'queryMentionCandidates',
			editorId: 'comment-input',
			requestId: 'req-1',
			query: 're',
		});
		await flushAsyncWork();

		assert.equal(postedMessages.at(-1)?.type, 'richTextMentionCandidatesLoaded');
		assert.equal(postedMessages.at(-1)?.requestId, 'req-1');
		assert.deepEqual(
			postedMessages.at(-1)?.candidates.map((candidate: any) => candidate.accountId),
			['acct-commenter', 'acct-reporter', 'acct-assignee', 'acct-current', 'acct-remote']
		);
	} finally {
		JiraWebviewPanel.showIssueDetailsPanel = originalShowIssueDetailsPanel;
		JiraWebviewPanel.renderIssuePanelContent = originalRenderIssuePanelContent;
		jiraApiClient.fetchIssueDetails = originalFetchIssueDetails;
		jiraApiClient.fetchIssueTransitions = originalFetchIssueTransitions;
		jiraApiClient.fetchIssueComments = originalFetchIssueComments;
		jiraApiClient.fetchAssignableUsers = originalFetchAssignableUsers;
	}
});

test('issue controller opens mention search with the typed query and posts the selected user back to the editor', async () => {
	const { IssueControllerFactory, JiraWebviewPanel, jiraApiClient } = loadIssueControllerModules();
	const postedMessages: any[] = [];
	let panelMessageHandler: ((message: unknown) => Promise<void>) | undefined;
	const pickerRequests: any[] = [];
	let resolveSelection: ((value: unknown) => void) | undefined;

	const originalShowIssueDetailsPanel = JiraWebviewPanel.showIssueDetailsPanel;
	const originalRenderIssuePanelContent = JiraWebviewPanel.renderIssuePanelContent;
	const originalFetchIssueDetails = jiraApiClient.fetchIssueDetails;
	const originalFetchIssueTransitions = jiraApiClient.fetchIssueTransitions;
	const originalFetchIssueComments = jiraApiClient.fetchIssueComments;

	JiraWebviewPanel.showIssueDetailsPanel = ((issueKey, issue, options, onMessage) => {
		panelMessageHandler = onMessage;
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
	JiraWebviewPanel.renderIssuePanelContent = (() => undefined) as typeof JiraWebviewPanel.renderIssuePanelContent;
	jiraApiClient.fetchIssueDetails = (async () => createIssueFixture()) as typeof jiraApiClient.fetchIssueDetails;
	jiraApiClient.fetchIssueTransitions = (async () => []) as typeof jiraApiClient.fetchIssueTransitions;
	jiraApiClient.fetchIssueComments = (async () => []) as typeof jiraApiClient.fetchIssueComments;

	try {
		const controller = IssueControllerFactory.create({
			authManager: {
				async getAuthInfo(): Promise<any> {
					return {
						baseUrl: 'https://example.atlassian.net',
						username: 'helena@example.com',
						displayName: 'Helena',
						accountId: 'acct-current',
						serverLabel: 'cloud',
					};
				},
				async getToken(): Promise<string> {
					return 'token-123';
				},
			} as any,
			assigneePicker: {
				pickAssignee: (request: unknown) => {
					pickerRequests.push(request);
					return {
						handleMessage: async () => false,
						dispose: () => undefined,
						promise: new Promise((resolve) => {
							resolveSelection = resolve;
						}),
					};
				},
			} as any,
			parentIssuePicker: {
				pickParentIssue: () => {
					throw new Error('parent picker should not be used in this test');
				},
			} as any,
			projectStatusStore: {
				getIssueTypeStatuses: () => undefined,
				get: () => undefined,
				ensure: async () => [],
				ensureAllIssueTypeStatuses: async () => [],
			} as any,
			transitionStore: {
				get: () => undefined,
				remember: () => undefined,
			} as any,
			transitionPrefetcher: {
				prefetch: () => undefined,
				prefetchIssues: () => undefined,
			} as any,
			webviewIconService: {
				async createIssueWithResolvedIconSources(_webview: unknown, issue: import('../../src/model/jira.type').JiraIssue) {
					return issue;
				},
				async createStatusOptionsWithResolvedIconSources(_webview: unknown, options?: unknown) {
					return options as any;
				},
			} as any,
			refreshAll: () => undefined,
		});

		await controller.openIssueDetails('PROJ-1');
		await flushAsyncWork();

		assert.equal(typeof panelMessageHandler, 'function');

		await panelMessageHandler?.({
			type: 'openRichTextMentionSearch',
			editorId: 'comment-input',
			query: 'hel',
		});
		await flushAsyncWork();

		assert.equal(pickerRequests.length, 1);
		assert.equal(pickerRequests[0]?.mode, 'mention');
		assert.equal(pickerRequests[0]?.editorId, 'comment-input');
		assert.equal(pickerRequests[0]?.initialSearchQuery, 'hel');

		resolveSelection?.({
			kind: 'user',
			user: {
				accountId: 'acct-remote',
				displayName: 'Remote User',
				avatarUrl: 'https://example.test/avatar.png',
			},
		});
		await flushAsyncWork();

		assert.equal(postedMessages.at(-1)?.type, 'richTextMentionSearchSelectionApplied');
		assert.equal(postedMessages.at(-1)?.editorId, 'comment-input');
		assert.equal(postedMessages.at(-1)?.candidate?.accountId, 'acct-remote');
		assert.equal(postedMessages.at(-1)?.candidate?.mentionText, '@Remote User');
	} finally {
		JiraWebviewPanel.showIssueDetailsPanel = originalShowIssueDetailsPanel;
		JiraWebviewPanel.renderIssuePanelContent = originalRenderIssuePanelContent;
		jiraApiClient.fetchIssueDetails = originalFetchIssueDetails;
		jiraApiClient.fetchIssueTransitions = originalFetchIssueTransitions;
		jiraApiClient.fetchIssueComments = originalFetchIssueComments;
	}
});

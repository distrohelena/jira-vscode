import assert from 'node:assert/strict';
import Module from 'node:module';
import test from 'node:test';

/**
 * Describes the subset of the VS Code API required by the create-issue controller test harness.
 */
type VscodeCreateIssueControllerTestModule = {
	ViewColumn: {
		Active: number;
	};
	window: {
		createWebviewPanel: (...args: unknown[]) => any;
		showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
		showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
	};
	commands: {
		executeCommand(command: string, ...args: unknown[]): Promise<void>;
	};
};

/**
 * Represents the create-issue-controller modules loaded through a local VS Code runtime stub.
 */
type CreateIssueControllerTestModules = {
	vscode: VscodeCreateIssueControllerTestModule;
	CreateIssueControllerFactory: typeof import('../../src/controllers/create-issue.controller').CreateIssueControllerFactory;
	JiraWebviewPanel: typeof import('../../src/views/webview/webview.panel').JiraWebviewPanel;
	jiraApiClient: typeof import('../../src/jira-api').jiraApiClient;
};

/**
 * Waits for queued asynchronous work to settle across a few microtask and macrotask turns.
 */
async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	await Promise.resolve();
}

/**
 * Loads the create-issue-controller modules with a local VS Code stub so the controller can be tested in isolation.
 */
function loadCreateIssueControllerModules(): CreateIssueControllerTestModules {
	const requireFromTest = Module.createRequire(import.meta.url);
	const moduleLoader = Module as typeof Module & {
		_load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
	};
	const originalLoad = moduleLoader._load;

	let onMessage: ((message: unknown) => Promise<void>) | undefined;
	const vscode: VscodeCreateIssueControllerTestModule = {
		ViewColumn: {
			Active: 1,
		},
		window: {
			createWebviewPanel: () => ({
				webview: {
					cspSource: 'vscode-resource://test',
					html: '',
					asWebviewUri: (value: unknown) => ({ toString: () => String(value) }),
					postMessage: async () => true,
					onDidReceiveMessage: (handler: (message: unknown) => Promise<void>) => {
						onMessage = handler;
						return { dispose() {} };
					},
				},
				onDidDispose: () => ({ dispose() {} }),
			}),
			async showInformationMessage(): Promise<string | undefined> {
				return undefined;
			},
			async showErrorMessage(): Promise<string | undefined> {
				return undefined;
			},
		},
		commands: {
			async executeCommand(): Promise<void> {
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
		const controllerModulePath = requireFromTest.resolve('../../src/controllers/create-issue.controller.ts');
		const panelModulePath = requireFromTest.resolve('../../src/views/webview/webview.panel.ts');
		const jiraApiModulePath = requireFromTest.resolve('../../src/jira-api/index.ts');
		delete requireFromTest.cache[controllerModulePath];
		delete requireFromTest.cache[panelModulePath];
		delete requireFromTest.cache[jiraApiModulePath];

		const controllerModule =
			requireFromTest(controllerModulePath) as typeof import('../../src/controllers/create-issue.controller');
		const panelModule =
			requireFromTest(panelModulePath) as typeof import('../../src/views/webview/webview.panel');
		const jiraApiModule = requireFromTest(jiraApiModulePath) as typeof import('../../src/jira-api');

		return {
			vscode,
			CreateIssueControllerFactory: controllerModule.CreateIssueControllerFactory,
			JiraWebviewPanel: panelModule.JiraWebviewPanel,
			jiraApiClient: Object.assign(jiraApiModule.jiraApiClient, {
				__getOnMessage: () => onMessage,
			}),
		} as CreateIssueControllerTestModules & { jiraApiClient: typeof jiraApiModule.jiraApiClient & { __getOnMessage?: () => ((message: unknown) => Promise<void>) | undefined } };
	} finally {
		moduleLoader._load = originalLoad;
	}
}

test('create issue controller responds to queryMentionCandidates with assignable users for the selected project', async () => {
	const modules = loadCreateIssueControllerModules() as CreateIssueControllerTestModules & {
		jiraApiClient: typeof import('../../src/jira-api').jiraApiClient & {
			__getOnMessage?: () => ((message: unknown) => Promise<void>) | undefined;
		};
	};
	const { CreateIssueControllerFactory, JiraWebviewPanel, jiraApiClient } = modules;
	const postedMessages: any[] = [];
	const originalShowCreateIssuePanel = JiraWebviewPanel.showCreateIssuePanel;
	const originalRenderCreateIssuePanel = JiraWebviewPanel.renderCreateIssuePanel;
	const originalFetchCreateIssueFields = jiraApiClient.fetchCreateIssueFields;
	const originalFetchAssignableUsers = jiraApiClient.fetchAssignableUsers;

	JiraWebviewPanel.showCreateIssuePanel = (() => ({
		webview: {
			cspSource: 'vscode-resource://test',
			html: '',
			asWebviewUri: (value: unknown) => ({ toString: () => String(value) }),
			postMessage: async (message: unknown) => {
				postedMessages.push(message);
				return true;
			},
			onDidReceiveMessage: (handler: (message: unknown) => Promise<void>) => {
				jiraApiClient.__getOnMessage = () => handler;
				return { dispose() {} };
			},
		},
		onDidDispose: () => ({ dispose() {} }),
	})) as typeof JiraWebviewPanel.showCreateIssuePanel;
	JiraWebviewPanel.renderCreateIssuePanel = (() => undefined) as typeof JiraWebviewPanel.renderCreateIssuePanel;
	jiraApiClient.fetchCreateIssueFields = (async () => []) as typeof jiraApiClient.fetchCreateIssueFields;
	jiraApiClient.fetchAssignableUsers = (async () => [
		{
			accountId: 'acct-remote',
			displayName: 'Remote User',
		},
	]) as typeof jiraApiClient.fetchAssignableUsers;

	try {
		const controller = CreateIssueControllerFactory.create({
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
			focusManager: {
				getSelectedProject: () => ({ key: 'PROJ', name: 'Project' }),
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
				get: () => undefined,
				ensure: async () => [],
			} as any,
			webviewIconService: {
				async createStatusOptionsWithResolvedIconSources(_webview: unknown, options?: unknown) {
					return options as any;
				},
			} as any,
			revealIssueInItemsView: async () => undefined,
			openIssueDetails: async () => undefined,
		});

		await controller.createIssue();
		await flushAsyncWork();

		const onMessage = jiraApiClient.__getOnMessage?.();
		assert.equal(typeof onMessage, 'function');

		await onMessage?.({
			type: 'queryMentionCandidates',
			editorId: 'create-description-input',
			requestId: 'req-1',
			query: 'he',
		});
		await flushAsyncWork();

		assert.equal(postedMessages.at(-1)?.type, 'richTextMentionCandidatesLoaded');
		assert.equal(postedMessages.at(-1)?.requestId, 'req-1');
		assert.deepEqual(
			postedMessages.at(-1)?.candidates.map((candidate: any) => candidate.accountId),
			['acct-remote']
		);
	} finally {
		JiraWebviewPanel.showCreateIssuePanel = originalShowCreateIssuePanel;
		JiraWebviewPanel.renderCreateIssuePanel = originalRenderCreateIssuePanel;
		jiraApiClient.fetchCreateIssueFields = originalFetchCreateIssueFields;
		jiraApiClient.fetchAssignableUsers = originalFetchAssignableUsers;
	}
});

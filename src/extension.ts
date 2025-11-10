import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';

const AUTH_STATE_KEY = 'jira.authInfo';
const SECRET_PREFIX = 'jira-token';
const SELECTED_PROJECT_KEY = 'jira.selectedProject';

type JiraAuthInfo = {
	baseUrl: string;
	username: string;
	displayName?: string;
	accountId?: string;
	serverLabel: 'cloud' | 'custom';
};

type JiraIssue = {
	id: string;
	key: string;
	summary: string;
	statusName: string;
	assigneeName?: string;
	url: string;
	updated: string;
};

type JiraProject = {
	id: string;
	key: string;
	name: string;
	typeKey?: string;
	url: string;
};

type SelectedProjectInfo = {
	key: string;
	name?: string;
	typeKey?: string;
};

type JiraProfileResponse = {
	displayName?: string;
	name?: string;
	accountId?: string;
	accountType?: string;
	key?: string;
};

export async function activate(context: vscode.ExtensionContext) {
	const authManager = new JiraAuthManager(context);
	const focusManager = new JiraFocusManager(context, authManager);

	const projectsProvider = new JiraProjectsTreeDataProvider(authManager, focusManager);
	const projectsView = vscode.window.createTreeView('jiraProjectsView', {
		treeDataProvider: projectsProvider,
	});
	projectsProvider.bindView(projectsView);

	const settingsProvider = new JiraSettingsTreeDataProvider(authManager, focusManager);
	const settingsView = vscode.window.createTreeView('jiraSettingsView', {
		treeDataProvider: settingsProvider,
	});
	settingsProvider.bindView(settingsView);

	const itemsProvider = new JiraItemsTreeDataProvider(authManager, focusManager);
	const itemsView = vscode.window.createTreeView('jiraItemsView', {
		treeDataProvider: itemsProvider,
	});
	itemsProvider.bindView(itemsView);

	const refreshAll = () => {
		projectsProvider.refresh();
		settingsProvider.refresh();
		itemsProvider.refresh();
	};

	context.subscriptions.push(
		projectsView,
		settingsView,
		itemsView,
		vscode.commands.registerCommand('jira.login', async () => {
			await authManager.login();
			refreshAll();
		}),
		vscode.commands.registerCommand('jira.logout', async () => {
			await authManager.logout();
			refreshAll();
		}),
		vscode.commands.registerCommand('jira.focusProject', async (project?: JiraProject) => {
			const changed = await focusManager.focusProject(project);
			if (changed) {
				refreshAll();
			}
		}),
		vscode.commands.registerCommand('jira.clearProjectFocus', async () => {
			const changed = await focusManager.clearProjectFocus();
			if (changed) {
				refreshAll();
			}
		})
	);
}

export function deactivate() {
	// nothing to clean up yet
}

type JiraNodeKind = 'loginPrompt' | 'info' | 'logout' | 'project' | 'issue';

abstract class JiraTreeDataProvider implements vscode.TreeDataProvider<JiraTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<JiraTreeItem | undefined | null | void> =
		new vscode.EventEmitter();
	readonly onDidChangeTreeData: vscode.Event<JiraTreeItem | undefined | null | void> =
		this._onDidChangeTreeData.event;
	private treeView?: vscode.TreeView<JiraTreeItem>;

	constructor(protected authManager: JiraAuthManager, protected focusManager: JiraFocusManager) {}

	bindView(view: vscode.TreeView<JiraTreeItem>): void {
		this.treeView = view;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: JiraTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: JiraTreeItem): Promise<JiraTreeItem[]> {
		if (element) {
			return [];
		}

		const authInfo = await this.authManager.getAuthInfo();
		if (!authInfo) {
			this.updateBadge();
			this.updateDescription();
			return [
				new JiraTreeItem(
					'loginPrompt',
					'Log in to Jira',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'jira.login',
						title: 'Log In',
					}
				),
			];
		}

		return this.getSectionChildren(authInfo);
	}

	protected abstract getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]>;

	protected updateBadge(value?: number, tooltip?: string) {
		if (!this.treeView) {
			return;
		}
		if (value === undefined) {
			this.treeView.badge = undefined;
			return;
		}
		const tooltipText = tooltip ?? `${value}`;
		this.treeView.badge = { value, tooltip: tooltipText };
	}

	protected updateDescription(text?: string) {
		if (this.treeView) {
			this.treeView.description = text || undefined;
		}
	}
}

class JiraProjectsTreeDataProvider extends JiraTreeDataProvider {
	protected getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		return this.loadProjects(authInfo);
	}

	private async loadProjects(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		const token = await this.authManager.getToken();
		if (!token) {
			this.updateBadge();
			this.updateDescription();
			return [
				new JiraTreeItem(
					'info',
					'Missing auth token. Please log in again.',
					vscode.TreeItemCollapsibleState.None
				),
			];
		}

		try {
			const projects = await fetchAccessibleProjects(authInfo, token);
			this.updateBadge(
				projects.length,
				projects.length === 1 ? '1 accessible project' : `${projects.length} accessible projects`
			);
			this.updateDescription(extractHost(authInfo.baseUrl));

			if (projects.length === 0) {
				return [
					new JiraTreeItem('info', 'No projects available.', vscode.TreeItemCollapsibleState.None),
				];
			}

			const selectedProject = this.focusManager.getSelectedProject();
			const nodes = projects.map((project) => {
				const item = new JiraTreeItem(
					'project',
					project.name ?? project.key,
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'jira.focusProject',
						title: 'Focus Project',
						arguments: [project],
					}
				);
				const isSelected = selectedProject?.key === project.key;
				item.iconPath = isSelected
					? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
					: new vscode.ThemeIcon('repo');
				item.description = isSelected ? `${project.key} • focused` : project.key;
				item.tooltip = project.name ? `${project.name} (${project.key})` : project.key;
				return item;
			});

			return nodes;
		} catch (error) {
			const message = deriveErrorMessage(error);
			this.updateBadge();
			return [
				new JiraTreeItem('info', `Failed to load projects: ${message}`, vscode.TreeItemCollapsibleState.None),
			];
		}
	}
}

class JiraItemsTreeDataProvider extends JiraTreeDataProvider {
	protected getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		return this.loadItems(authInfo);
	}

	private async loadItems(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			this.updateBadge();
			this.updateDescription('Select project');
			return [
				new JiraTreeItem(
					'info',
					'Select a project in Projects to view Jira issues.',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'jira.focusProject',
						title: 'Focus Project',
					}
				),
			];
		}

		this.updateDescription(selectedProject.key);

		const nodes: JiraTreeItem[] = [];

		const token = await this.authManager.getToken();
		if (!token) {
			this.updateBadge();
			nodes.push(
				new JiraTreeItem(
					'info',
					'Missing auth token. Please log in again.',
					vscode.TreeItemCollapsibleState.None
				)
			);
			return nodes;
		}

		try {
			const issues = await fetchProjectIssues(authInfo, token, selectedProject.key);
			if (issues.length === 0) {
				this.updateBadge(0, 'No Jira issues in this project');
				nodes.push(
					new JiraTreeItem(
						'info',
						'No issues in this project (first 50 shown).',
						vscode.TreeItemCollapsibleState.None
					)
				);
				return nodes;
			}

			this.updateBadge(
				issues.length,
				issues.length === 1 ? '1 Jira issue' : `${issues.length} Jira issues`
			);

			nodes.push(
				...issues.map((issue) => {
					const item = new JiraTreeItem(
						'issue',
						`${issue.key} · ${issue.summary}`,
						vscode.TreeItemCollapsibleState.None
					);
					item.tooltip = `${issue.summary}\nStatus: ${issue.statusName}\nUpdated: ${new Date(
						issue.updated
					).toLocaleString()}`;
					contextualizeIssue(item, issue);
					return item;
				})
			);

			return nodes;
		} catch (error) {
			const message = deriveErrorMessage(error);
			this.updateBadge();
			nodes.push(
				new JiraTreeItem(
					'info',
					`Failed to load project issues: ${message}`,
					vscode.TreeItemCollapsibleState.None
				)
			);
			return nodes;
		}
	}
}

class JiraSettingsTreeDataProvider extends JiraTreeDataProvider {
	protected async getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		this.updateBadge();
		this.updateDescription(extractHost(authInfo.baseUrl));

		const nodes = buildAccountNodes(authInfo);
		const token = await this.authManager.getToken();
		if (!token) {
			nodes.unshift(
				new JiraTreeItem(
					'info',
					'Missing auth token. Please log in again.',
					vscode.TreeItemCollapsibleState.None
				)
			);
		}
		return nodes;
	}
}

class JiraFocusManager {
	constructor(private context: vscode.ExtensionContext, private authManager: JiraAuthManager) {}

	getSelectedProject(): SelectedProjectInfo | undefined {
		return this.context.globalState.get<SelectedProjectInfo>(SELECTED_PROJECT_KEY);
	}

	private async saveSelectedProject(project: SelectedProjectInfo | undefined): Promise<void> {
		await this.context.globalState.update(SELECTED_PROJECT_KEY, project);
	}

	async focusProject(project?: JiraProject): Promise<boolean> {
		const authInfo = await this.authManager.getAuthInfo();
		if (!authInfo) {
			await vscode.window.showInformationMessage('Log in to Jira before selecting a project.');
			return false;
		}

		const previousKey = this.getSelectedProject()?.key;

		if (!project) {
			return this.promptForProjectSelection(authInfo, previousKey);
		}

		await this.saveSelectedProject({
			key: project.key,
			name: project.name,
			typeKey: project.typeKey,
		});
		return previousKey !== project.key;
	}

	async clearProjectFocus(): Promise<boolean> {
		const hadSelection = !!this.getSelectedProject();
		if (hadSelection) {
			await this.saveSelectedProject(undefined);
		}
		return hadSelection;
	}

	private async promptForProjectSelection(authInfo: JiraAuthInfo, previousKey?: string): Promise<boolean> {
		const token = await this.authManager.getToken();
		if (!token) {
			await vscode.window.showInformationMessage('Log in to Jira before selecting a project.');
			return false;
		}

		try {
			const projects = await fetchAccessibleProjects(authInfo, token);
			if (projects.length === 0) {
				await vscode.window.showInformationMessage('No projects available to select.');
				return false;
			}

			type ProjectPickItem = vscode.QuickPickItem & { project?: JiraProject; clear?: boolean };
			const picks: ProjectPickItem[] = projects.map((project) => ({
				label: project.name ?? project.key,
				description: project.key,
				detail: project.typeKey ? project.typeKey.toUpperCase() : undefined,
				project,
			}));
			picks.push({
				label: 'Clear selection',
				description: 'Stop focusing on a project',
				clear: true,
			});

			const selection = await vscode.window.showQuickPick<ProjectPickItem>(picks, {
				placeHolder: 'Select a project to focus',
				ignoreFocusOut: true,
			});

			if (!selection) {
				return false;
			}

			if (selection.clear) {
				await this.saveSelectedProject(undefined);
			} else if (selection.project) {
				const project = selection.project;
				await this.saveSelectedProject({
					key: project.key,
					name: project.name,
					typeKey: project.typeKey,
				});
			}

			const newKey = this.getSelectedProject()?.key;
			return previousKey !== newKey;
		} catch (error) {
			const message = deriveErrorMessage(error);
			await vscode.window.showErrorMessage(`Failed to load projects: ${message}`);
			return false;
		}
	}
}

function buildAccountNodes(authInfo: JiraAuthInfo): JiraTreeItem[] {
	const nodes: JiraTreeItem[] = [];
	const userItem = new JiraTreeItem(
		'info',
		`Signed in as ${authInfo.displayName ?? authInfo.username}`,
		vscode.TreeItemCollapsibleState.None
	);
	userItem.iconPath = new vscode.ThemeIcon('account');
	nodes.push(userItem);

	const urlItem = new JiraTreeItem('info', authInfo.baseUrl, vscode.TreeItemCollapsibleState.None);
	urlItem.iconPath = new vscode.ThemeIcon('globe');
	nodes.push(urlItem);

	const logoutItem = new JiraTreeItem('logout', 'Log out', vscode.TreeItemCollapsibleState.None, {
		command: 'jira.logout',
		title: 'Log Out',
	});
	logoutItem.iconPath = new vscode.ThemeIcon('sign-out');
	nodes.push(logoutItem);

	return nodes;
}

function extractHost(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		return parsed.host;
	} catch {
		return undefined;
	}
}

class JiraTreeItem extends vscode.TreeItem {
	constructor(
		public nodeType: JiraNodeKind,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		command?: vscode.Command
	) {
		super(label, collapsibleState);
		this.command = command;
	}
}

function contextualizeIssue(item: JiraTreeItem, issue: JiraIssue) {
	item.contextValue = 'jiraIssue';
	item.description = issue.assigneeName ? `${issue.statusName} • ${issue.assigneeName}` : issue.statusName;
	item.iconPath = deriveIssueIcon(issue.statusName);
}

function deriveIssueIcon(statusName?: string): vscode.ThemeIcon {
	const status = statusName?.toLowerCase().trim() ?? '';
	if (!status) {
		return new vscode.ThemeIcon('issues');
	}

	if (status.includes('done') || status.includes('closed') || status.includes('resolved') || status.includes('complete')) {
		return new vscode.ThemeIcon('pass');
	}

	if (status.includes('progress') || status.includes('doing') || status.includes('active') || status.includes('working')) {
		return new vscode.ThemeIcon('sync');
	}

	if (status.includes('todo') || status.includes('to do') || status.includes('open') || status.includes('backlog')) {
		return new vscode.ThemeIcon('circle-outline');
	}

	return new vscode.ThemeIcon('issues');
}

class JiraAuthManager {
	constructor(private context: vscode.ExtensionContext) {}

	async getAuthInfo(): Promise<JiraAuthInfo | undefined> {
		return this.context.globalState.get<JiraAuthInfo>(AUTH_STATE_KEY);
	}

	private async saveAuthInfo(info: JiraAuthInfo | undefined) {
		await this.context.globalState.update(AUTH_STATE_KEY, info);
	}

	async login(): Promise<void> {
		const selection = await vscode.window.showQuickPick<{ label: string; value: 'cloud' | 'custom' }>(
			[
				{ label: 'Jira Cloud (Atlassian)', value: 'cloud' },
				{ label: 'Custom Jira Server/Data Center', value: 'custom' },
			],
			{
				title: 'Select Jira deployment type',
				ignoreFocusOut: true,
			}
		);

		if (!selection) {
			return;
		}

		const configBaseUrl = vscode.workspace.getConfiguration('jira').get<string>('baseUrl')?.trim();
		const baseUrlInput = await vscode.window.showInputBox({
			title: 'Jira base URL',
			prompt:
				selection.value === 'cloud'
					? 'Example: https://your-domain.atlassian.net'
					: 'Example: https://jira.my-company.internal',
			value: configBaseUrl && configBaseUrl !== 'https://your-domain.atlassian.net' ? configBaseUrl : undefined,
			validateInput: (value) => {
				if (!value) {
					return 'Base URL is required';
				}
				try {
					new URL(value);
					return undefined;
				} catch {
					return 'Enter a valid URL starting with http or https';
				}
			},
			ignoreFocusOut: true,
		});

		if (!baseUrlInput) {
			return;
		}

		const normalizedBaseUrl = normalizeBaseUrl(baseUrlInput);

		const username = await vscode.window.showInputBox({
			title: selection.value === 'cloud' ? 'Atlassian account email' : 'Jira username/email',
			prompt: 'This will be used with your API token.',
			validateInput: (value) => (!value ? 'Username or email is required' : undefined),
			ignoreFocusOut: true,
		});

		if (!username) {
			return;
		}

		const token = await vscode.window.showInputBox({
			title: selection.value === 'cloud' ? 'Atlassian API token' : 'Jira API token/password',
			prompt:
				selection.value === 'cloud'
					? 'Create/manage tokens at https://id.atlassian.com/manage-profile/security/api-tokens'
					: 'Provide a Personal Access Token or password (sent over HTTPS).',
			password: true,
			validateInput: (value) => (!value ? 'Token or password is required' : undefined),
			ignoreFocusOut: true,
		});

		if (!token) {
			return;
		}

		const accountKey = buildAccountKey(normalizedBaseUrl, username);

		try {
			const profile = await verifyCredentials(
				normalizedBaseUrl,
				username,
				token,
				selection.value
			);
			const serverLabel = inferServerLabelFromProfile(profile) ?? selection.value;
			await this.context.secrets.store(buildSecretKey(accountKey), token);
			await this.saveAuthInfo({
				baseUrl: normalizedBaseUrl,
				username,
				displayName: profile.displayName ?? profile.name ?? username,
				accountId: profile.accountId ?? profile.key,
				serverLabel,
			});

			await vscode.window.showInformationMessage(`Connected to Jira as ${profile.displayName ?? username}`);
		} catch (error) {
			const message = deriveErrorMessage(error);
			await vscode.window.showErrorMessage(`Failed to connect to Jira: ${message}`);
		}
	}

	async logout(): Promise<void> {
		const authInfo = await this.getAuthInfo();
		if (!authInfo) {
			return;
		}
		const accountKey = buildAccountKey(authInfo.baseUrl, authInfo.username);
		await this.context.secrets.delete(buildSecretKey(accountKey));
		await this.saveAuthInfo(undefined);
		await vscode.window.showInformationMessage('Disconnected from Jira.');
	}

	async getToken(): Promise<string | undefined> {
		const authInfo = await this.getAuthInfo();
		if (!authInfo) {
			return undefined;
		}
		const accountKey = buildAccountKey(authInfo.baseUrl, authInfo.username);
		const token = await this.context.secrets.get(buildSecretKey(accountKey));
		return token ?? undefined;
	}
}

async function verifyCredentials(
	baseUrl: string,
	username: string,
	token: string,
	serverLabel: 'cloud' | 'custom'
): Promise<JiraProfileResponse> {
	const urlRoot = normalizeBaseUrl(baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, serverLabel, 'myself');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				auth: {
					username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});

			return response.data;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

function normalizeBaseUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) {
		return '';
	}
	return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function buildAccountKey(baseUrl: string, username: string): string {
	return `${baseUrl}:${username}`;
}

function buildSecretKey(accountKey: string): string {
	return `${SECRET_PREFIX}:${accountKey}`;
}

async function fetchProjectIssues(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string
): Promise<JiraIssue[]> {
	const sanitizedKey = projectKey?.trim();
	if (!sanitizedKey) {
		return [];
	}
	return searchJiraIssues(authInfo, token, {
		jql: `project = ${sanitizedKey} ORDER BY created DESC`,
		maxResults: 50,
		fields: ['summary', 'status', 'assignee', 'updated'],
	});
}

type JiraIssueSearchOptions = {
	jql: string;
	maxResults?: number;
	fields?: string[];
};

async function searchJiraIssues(
	authInfo: JiraAuthInfo,
	token: string,
	options: JiraIssueSearchOptions
): Promise<JiraIssue[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(
		urlRoot,
		authInfo.serverLabel,
		'search/jql',
		'search',
		'jql/search',
		'issue/search'
	);
	const searchPayload = {
		jql: options.jql,
		maxResults: options.maxResults ?? 50,
		fields: options.fields ?? ['summary', 'status', 'assignee', 'updated'],
	};

	let lastError: unknown;
	for (const endpoint of endpoints) {
		const supportsGet = !/\/search\/jql$/.test(endpoint);
		const config = {
			auth: {
				username: authInfo.username,
				password: token,
			},
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'jira-vscode',
			},
		} as const;

		const tryGet = async () => {
			const response = await axios.get(endpoint, {
				params: {
					jql: searchPayload.jql,
					maxResults: searchPayload.maxResults,
					fields: searchPayload.fields.join(','),
				},
				...config,
			});
			return response.data;
		};

		const tryPost = async () => {
			const response = await axios.post(endpoint, searchPayload, config);
			return response.data;
		};

		try {
			const data = await tryPost();
			return mapIssues(data, urlRoot);
		} catch (postError) {
			lastError = postError;

			if (!supportsGet || !shouldFallbackToGet(postError)) {
				continue;
			}

			try {
				const data = await tryGet();
				return mapIssues(data, urlRoot);
			} catch (getError) {
				lastError = getError;
			}
		}
	}

	throw lastError;
}

function mapIssues(data: any, urlRoot: string): JiraIssue[] {
	const issues = data?.issues ?? [];
	return issues.map((issue: any) => ({
		id: issue.id,
		key: issue.key,
		summary: issue.fields?.summary ?? 'Untitled',
		statusName: issue.fields?.status?.name ?? 'Unknown',
		assigneeName: issue.fields?.assignee?.displayName ?? issue.fields?.assignee?.name ?? undefined,
		url: `${urlRoot}/browse/${issue.key}`,
		updated: issue.fields?.updated ?? '',
	}));
}

async function fetchAccessibleProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'project/search');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					startAt: 0,
					maxResults: 50,
					orderBy: 'name',
					status: 'live',
				},
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});

			const projects = response.data.values ?? [];
			return projects.map((project: any) => ({
				id: project.id,
				key: project.key,
				name: project.name ?? 'Untitled',
				typeKey: project.projectTypeKey,
				url: `${urlRoot}/browse/${project.key}`,
			}));
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

function deriveErrorMessage(error: unknown): string {
	if (axios.isAxiosError(error)) {
		const axiosError = error as AxiosError<any>;
		const status = axiosError.response?.status;
		const statusText = axiosError.response?.statusText;
		if (status) {
			return `${status}${statusText ? ` ${statusText}` : ''}`;
		}
		if (axiosError.code === 'ENOTFOUND') {
			return 'Unable to reach Jira server (host not found).';
		}
		return axiosError.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return 'Unknown error';
}

type JiraApiVersion = '3' | 'latest' | '2';
type JiraServerLabel = JiraAuthInfo['serverLabel'];

const API_VERSION_PRIORITY: Record<JiraServerLabel, JiraApiVersion[]> = {
	cloud: ['3', 'latest', '2'],
	custom: ['latest', '2', '3'],
};

function buildRestApiEndpoints(
	baseUrl: string,
	preference: JiraServerLabel,
	...resources: string[]
): string[] {
	const orderedVersions = API_VERSION_PRIORITY[preference];
	const seen = new Set<string>();
	const endpoints: string[] = [];
	const baseCandidates = expandBaseUrlCandidates(baseUrl);
	const resourceList = resources.length > 0 ? resources : [''];

	for (const baseCandidate of baseCandidates) {
		for (const version of orderedVersions) {
			for (const resource of resourceList) {
				const endpoint = `${baseCandidate}/rest/api/${version}/${resource}`;
				if (!seen.has(endpoint)) {
					seen.add(endpoint);
					endpoints.push(endpoint);
				}
			}
		}
	}

	return endpoints;
}

function inferServerLabelFromProfile(profile: JiraProfileResponse | undefined): JiraServerLabel | undefined {
	if (!profile) {
		return undefined;
	}
	if (typeof profile.accountId === 'string' && profile.accountId.trim().length > 0) {
		return 'cloud';
	}
	if (typeof profile.accountType === 'string' && profile.accountType.toLowerCase() === 'atlassian') {
		return 'cloud';
	}
	if (typeof profile.key === 'string' && profile.key.trim().length > 0) {
		return 'custom';
	}
	return undefined;
}

function shouldFallbackToGet(error: unknown): boolean {
	if (!axios.isAxiosError(error)) {
		return false;
	}
	const status = error.response?.status;
	return status === 410 || status === 404 || status === 405;
}

function expandBaseUrlCandidates(baseUrl: string): string[] {
	const normalized = normalizeBaseUrl(baseUrl);
	if (!normalized) {
		return [];
	}

	const candidates = [normalized];

	try {
		const parsed = new URL(normalized);
		const origin = parsed.origin;
		const path = parsed.pathname.replace(/\/+$/, '');

		if (path && path !== '/') {
			const segments = path.split('/').filter(Boolean);
			if (segments.length > 1) {
				const firstPath = `/${segments[0]}`;
				const firstCandidate = `${origin}${firstPath}`;
				if (!candidates.includes(firstCandidate)) {
					candidates.push(firstCandidate);
				}
			}
			if (!candidates.includes(origin)) {
				candidates.push(origin);
			}
		}
	} catch {
		// ignore invalid URLs (should not happen due to validation)
	}

	return candidates;
}

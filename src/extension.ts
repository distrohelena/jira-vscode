import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';

const AUTH_STATE_KEY = 'jira.authInfo';
const SECRET_PREFIX = 'jira-token';
const SELECTED_PROJECT_KEY = 'jira.selectedProject';
const PROJECTS_VIEW_MODE_KEY = 'jira.projectsViewMode';
const PROJECTS_VIEW_MODE_CONTEXT = 'jiraProjectsViewMode';
const ITEMS_VIEW_MODE_KEY = 'jira.itemsViewMode';
const ITEMS_VIEW_MODE_CONTEXT = 'jiraItemsViewMode';
const RECENT_ITEMS_LIMIT = 20;
const ISSUE_DETAIL_FIELDS = ['summary', 'status', 'assignee', 'updated', 'parent', 'subtasks'];
let extensionUri: vscode.Uri;

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
	assigneeUsername?: string;
	assigneeAccountId?: string;
	assigneeAvatarUrl?: string;
	url: string;
	updated: string;
	parent?: JiraRelatedIssue;
	children?: JiraRelatedIssue[];
};

type JiraRelatedIssue = {
	key: string;
	summary: string;
	statusName?: string;
	assigneeName?: string;
	url: string;
	updated?: string;
};

type IssueStatusCategory = 'done' | 'inProgress' | 'open' | 'default';

const STATUS_ICON_FILES: Record<IssueStatusCategory, string> = {
	done: 'status-done.png',
	inProgress: 'status-inprogress.png',
	open: 'status-open.png',
	default: 'status-default.png',
};

const ISSUE_TYPE_OPTIONS = ['Task', 'Bug', 'Story', 'Epic', 'Sub-task'];
const ISSUE_STATUS_OPTIONS = ['To Do', 'In Progress', 'Done'];

type IssuePanelOptions = {
	loading?: boolean;
	error?: string;
	statusOptions?: IssueStatusOption[];
	statusPending?: boolean;
	statusError?: string;
	assigneeOptions?: IssueAssignableUser[];
	assigneePending?: boolean;
	assigneeError?: string;
	assigneeQuery?: string;
	assigneeAutoFocus?: boolean;
};

type IssueStatusOption = {
	id: string;
	name: string;
	category?: IssueStatusCategory;
};

type IssueAssignableUser = {
	accountId: string;
	displayName: string;
	avatarUrl?: string;
};

type CreateIssueFormValues = {
	summary: string;
	description: string;
	issueType: string;
	status: string;
};

type CreateIssuePanelState = {
	values: CreateIssueFormValues;
	submitting?: boolean;
	error?: string;
	successIssue?: JiraIssue;
};

type GitExtensionExports = {
	getAPI(version: number): GitAPI;
};

type GitAPI = {
	repositories: GitRepository[];
};

type GitRepository = {
	inputBox: vscode.SourceControlInputBox;
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

type ProjectsViewMode = 'recent' | 'all';
type ItemsViewMode = 'recent' | 'all';

type JiraProfileResponse = {
	displayName?: string;
	name?: string;
	accountId?: string;
	accountType?: string;
	key?: string;
};

export async function activate(context: vscode.ExtensionContext) {
	extensionUri = context.extensionUri;
	const authManager = new JiraAuthManager(context);
	const focusManager = new JiraFocusManager(context, authManager);

	const projectsProvider = new JiraProjectsTreeDataProvider(context, authManager, focusManager);
	const projectsView = vscode.window.createTreeView('jiraProjectsView', {
		treeDataProvider: projectsProvider,
	});
	projectsProvider.bindView(projectsView);

	const settingsProvider = new JiraSettingsTreeDataProvider(authManager, focusManager);
	const settingsView = vscode.window.createTreeView('jiraSettingsView', {
		treeDataProvider: settingsProvider,
	});
	settingsProvider.bindView(settingsView);

	const itemsProvider = new JiraItemsTreeDataProvider(context, authManager, focusManager);
	const itemsView = vscode.window.createTreeView('jiraItemsView', {
		treeDataProvider: itemsProvider,
	});
	itemsProvider.bindView(itemsView);

	const refreshAll = () => {
		projectsProvider.refresh();
		settingsProvider.refresh();
		itemsProvider.refresh();
	};

	const authChangeDisposable = authManager.onDidChangeAuth(() => {
		refreshAll();
	});

	const openIssueDetails = async (issueOrKey?: JiraIssue | string): Promise<void> => {
		const issueKeyValue = typeof issueOrKey === 'string' ? issueOrKey : issueOrKey?.key;
		if (!issueKeyValue) {
			await vscode.window.showInformationMessage('Unable to open issue details.');
			return;
		}
		const resolvedIssueKey: string = issueKeyValue;

		const initialIssue = typeof issueOrKey === 'string' ? undefined : issueOrKey;
	const panelState: {
		issue: JiraIssue;
		transitions?: IssueStatusOption[];
		assignableUsers?: IssueAssignableUser[];
		assigneeQuery: string;
	} = {
		issue: initialIssue ?? createPlaceholderIssue(resolvedIssueKey),
		transitions: undefined,
		assignableUsers: undefined,
		assigneeQuery: '',
	};

		let disposed = false;

				const panel = showIssueDetailsPanel(
					resolvedIssueKey,
					panelState.issue,
					{ loading: true },
		async (message) => {
						if (message?.type === 'changeStatus' && typeof message.transitionId === 'string') {
							await handleStatusChange(message.transitionId);
						} else if (
							message?.type === 'changeAssignee' &&
							typeof message.accountId === 'string'
						) {
							await handleAssigneeChange(message.accountId);
				} else if (message?.type === 'loadAssignees') {
					const queryValue =
						typeof message.query === 'string' ? message.query : panelState.assigneeQuery ?? '';
					await handleAssigneeSearch(queryValue, !!message.force);
						}
					}
				);

		panel.onDidDispose(() => {
			disposed = true;
		});

		await loadIssueDetails();

		async function loadIssueDetails(): Promise<void> {
			const authInfo = await authManager.getAuthInfo();
			if (!authInfo) {
				if (!disposed) {
					renderIssuePanelContent(panel, panelState.issue, {
						error: 'Log in to Jira to view issue details.',
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showInformationMessage('Log in to Jira to view issue details.');
				return;
			}

			const token = await authManager.getToken();
			if (!token) {
				if (!disposed) {
					renderIssuePanelContent(panel, panelState.issue, {
						error: 'Missing auth token. Please log in again.',
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showInformationMessage('Missing auth token. Please log in again.');
				return;
			}

			try {
				const issue = await fetchIssueDetails(authInfo, token, resolvedIssueKey);
				let transitions: IssueStatusOption[] | undefined;
				let transitionsError: string | undefined;
				try {
					transitions = await fetchIssueTransitions(authInfo, token, resolvedIssueKey);
				} catch (transitionError) {
					transitionsError = deriveErrorMessage(transitionError);
				}
				let assignees: IssueAssignableUser[] | undefined;
				let assigneeError: string | undefined;
				try {
					assignees = await fetchAssignableUsers(authInfo, token, resolvedIssueKey);
				} catch (assignError) {
					assigneeError = deriveErrorMessage(assignError);
				}

				if (disposed) {
					return;
				}

				panelState.issue = issue;
				panelState.transitions = transitions;
				panelState.assignableUsers = assignees;
				renderIssuePanelContent(panel, issue, {
					statusOptions: transitions,
					statusError: transitionsError
						? `Unable to load available statuses: ${transitionsError}`
						: undefined,
					assigneeOptions: assignees,
					assigneeError: assigneeError
						? `Unable to load assignable users: ${assigneeError}`
						: undefined,
					assigneeQuery: panelState.assigneeQuery,
				});
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					renderIssuePanelContent(panel, panelState.issue, {
						error: `Failed to load issue details: ${message}`,
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showErrorMessage(`Failed to load issue details: ${message}`);
			}
		}

		async function handleStatusChange(transitionId: string): Promise<void> {
			if (disposed || !transitionId) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to change issue status.');
				return;
			}

			renderIssuePanelContent(panel, panelState.issue, {
				statusOptions: panelState.transitions,
				statusPending: true,
				assigneeOptions: panelState.assignableUsers,
				assigneeQuery: panelState.assigneeQuery,
			});

			try {
				await transitionIssueStatus(authInfo, token, resolvedIssueKey, transitionId);
				const updatedIssue = await fetchIssueDetails(authInfo, token, resolvedIssueKey);
				let transitions: IssueStatusOption[] | undefined;
				try {
					transitions = await fetchIssueTransitions(authInfo, token, resolvedIssueKey);
				} catch {
					transitions = panelState.transitions;
				}
				if (disposed) {
					return;
				}
				panelState.issue = updatedIssue;
				panelState.transitions = transitions;
				renderIssuePanelContent(panel, updatedIssue, {
					statusOptions: transitions,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
				});
				refreshAll();
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					renderIssuePanelContent(panel, panelState.issue, {
						statusOptions: panelState.transitions,
						statusError: `Failed to update status: ${message}`,
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showErrorMessage(`Failed to update status: ${message}`);
			}
		}

		async function handleAssigneeChange(accountId: string): Promise<void> {
			if (disposed || !accountId) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to change the assignee.');
				return;
			}

			renderIssuePanelContent(panel, panelState.issue, {
				statusOptions: panelState.transitions,
				assigneeOptions: panelState.assignableUsers,
				assigneePending: true,
				assigneeQuery: panelState.assigneeQuery,
			});

			try {
				await assignIssue(authInfo, token, resolvedIssueKey, accountId);
				const updatedIssue = await fetchIssueDetails(authInfo, token, resolvedIssueKey);
				if (disposed) {
					return;
				}
				panelState.issue = updatedIssue;
				renderIssuePanelContent(panel, updatedIssue, {
					statusOptions: panelState.transitions,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
				});
				refreshAll();
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					renderIssuePanelContent(panel, panelState.issue, {
						statusOptions: panelState.transitions,
						assigneeOptions: panelState.assignableUsers,
						assigneeError: `Failed to update assignee: ${message}`,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showErrorMessage(`Failed to update assignee: ${message}`);
			}
		}

		async function handleAssigneeSearch(query?: string, force = false): Promise<void> {
			if (disposed) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to view assignable users.');
				return;
			}

			const normalizedQuery = query?.trim() ?? '';
			if (
				!force &&
				normalizedQuery === panelState.assigneeQuery &&
				panelState.assignableUsers &&
				panelState.assignableUsers.length > 0
			) {
				renderIssuePanelContent(panel, panelState.issue, {
					statusOptions: panelState.transitions,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
				});
				return;
			}

			renderIssuePanelContent(panel, panelState.issue, {
				statusOptions: panelState.transitions,
				assigneeOptions: panelState.assignableUsers,
				assigneePending: true,
				assigneeQuery: normalizedQuery,
			});

			try {
				const users = await fetchAssignableUsers(authInfo, token, resolvedIssueKey, normalizedQuery);
				if (disposed) {
					return;
				}
				panelState.assignableUsers = users;
				panelState.assigneeQuery = normalizedQuery;
				renderIssuePanelContent(panel, panelState.issue, {
					statusOptions: panelState.transitions,
					assigneeOptions: users,
					assigneeQuery: normalizedQuery,
					assigneeAutoFocus: true,
				});
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					renderIssuePanelContent(panel, panelState.issue, {
						statusOptions: panelState.transitions,
						assigneeOptions: panelState.assignableUsers,
						assigneeError: `Failed to load assignable users: ${message}`,
						assigneeQuery: normalizedQuery,
						assigneeAutoFocus: true,
					});
				}
				await vscode.window.showErrorMessage(`Failed to load assignable users: ${message}`);
			}
		}
	};

	context.subscriptions.push(
		authManager,
		authChangeDisposable,
		projectsView,
		settingsView,
		itemsView,
		vscode.commands.registerCommand('jira.login', async () => {
			await authManager.login();
			refreshAll();
		}),
		vscode.commands.registerCommand('jira.showAllProjects', async () => {
			await projectsProvider.showAllProjects();
		}),
		vscode.commands.registerCommand('jira.showRecentProjects', async () => {
			await projectsProvider.showRecentProjects();
		}),
		vscode.commands.registerCommand('jira.showAllItems', async () => {
			await itemsProvider.showAllItems();
		}),
		vscode.commands.registerCommand('jira.showRecentItems', async () => {
			await itemsProvider.showRecentItems();
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
		}),
		vscode.commands.registerCommand('jira.refreshItemsView', () => {
			itemsProvider.refresh();
		}),
		vscode.commands.registerCommand('jira.refreshProjectsView', () => {
			projectsProvider.refresh();
		}),
		vscode.commands.registerCommand('jira.createIssue', async () => {
			const project = focusManager.getSelectedProject();
			if (!project) {
				await vscode.window.showInformationMessage('Select a project before creating a Jira ticket.');
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			if (!authInfo) {
				await vscode.window.showInformationMessage('Log in to Jira before creating a ticket.');
				return;
			}

			const token = await authManager.getToken();
			if (!token) {
				await vscode.window.showInformationMessage('Missing auth token. Please log in again.');
				return;
			}

			let state: CreateIssuePanelState = {
				values: {
					summary: '',
					description: '',
					issueType: 'Task',
					status: ISSUE_STATUS_OPTIONS[0],
				},
			};
			const panel = showCreateIssuePanel(project, state);
			let disposed = false;
			panel.onDidDispose(() => {
				disposed = true;
			});

			const updatePanel = (updates: Partial<CreateIssuePanelState>) => {
				if (disposed) {
					return;
				}
				state = { ...state, ...updates };
				renderCreateIssuePanel(panel, project, state);
			};

			renderCreateIssuePanel(panel, project, state);

			panel.webview.onDidReceiveMessage(async (message) => {
				if (message?.type !== 'createIssue') {
					return;
				}
				const values = sanitizeCreateIssueValues(message.values, state.values);
				if (!values.summary.trim()) {
					updatePanel({ error: 'Summary is required.', values });
					return;
				}
				updatePanel({ submitting: true, error: undefined, successIssue: undefined, values });
				try {
					const createdIssue = await createJiraIssue(authInfo, token, project.key, values);
					updatePanel({
						values: {
							summary: '',
							description: '',
							issueType: values.issueType,
							status: values.status,
						},
						submitting: false,
						successIssue: createdIssue,
					});
					itemsProvider.refresh();
					await openIssueDetails(createdIssue);
				} catch (error) {
					const messageText = deriveErrorMessage(error);
					updatePanel({ submitting: false, error: `Failed to create issue: ${messageText}` });
				}
			});
		}),
		vscode.commands.registerCommand('jira.openIssueDetails', async (issueOrKey?: JiraIssue | string) => {
			await openIssueDetails(issueOrKey);
		}),
		vscode.commands.registerCommand('jira.commitFromIssue', async (node?: JiraTreeItem) => {
			await commitFromIssue(node);
		})
	);
}

export function deactivate() {
	// nothing to clean up yet
}

type JiraNodeKind = 'loginPrompt' | 'info' | 'logout' | 'project' | 'issue' | 'statusGroup';

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
	private viewMode: ProjectsViewMode;

	constructor(
		private extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager
	) {
		super(authManager, focusManager);
		const stored = this.extensionContext.workspaceState.get<ProjectsViewMode>(
			PROJECTS_VIEW_MODE_KEY
		);
		this.viewMode = stored === 'all' ? 'all' : 'recent';
		void this.updateViewModeContext();
	}

	async showAllProjects(): Promise<void> {
		await this.setViewMode('all');
	}

	async showRecentProjects(): Promise<void> {
		await this.setViewMode('recent');
	}

	private async setViewMode(mode: ProjectsViewMode): Promise<void> {
		if (this.viewMode === mode) {
			return;
		}
		this.viewMode = mode;
		await this.extensionContext.workspaceState.update(PROJECTS_VIEW_MODE_KEY, mode);
		await this.updateViewModeContext();
		this.refresh();
	}

	private updateViewModeContext(): Thenable<void> {
		return vscode.commands.executeCommand('setContext', PROJECTS_VIEW_MODE_CONTEXT, this.viewMode);
	}

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

		const showingRecent = this.viewMode === 'recent';

		try {
			const projects = showingRecent
				? await fetchRecentProjects(authInfo, token)
				: await fetchAccessibleProjects(authInfo, token);
			const noun = showingRecent ? 'recent' : 'accessible';
			this.updateBadge(
				projects.length,
				projects.length === 1 ? `1 ${noun} project` : `${projects.length} ${noun} projects`
			);
			const host = extractHost(authInfo.baseUrl);
			const description = host
				? showingRecent
					? `${host} • recent`
					: host
				: showingRecent
					? 'recent projects'
					: undefined;
			this.updateDescription(description);

			if (projects.length === 0) {
				return [
					new JiraTreeItem(
						'info',
						showingRecent ? 'No recent projects. Use Show All to see everything.' : 'No projects available.',
						vscode.TreeItemCollapsibleState.None
					),
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
	private viewMode: ItemsViewMode;

	constructor(
		private extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager
	) {
		super(authManager, focusManager);
		const stored = this.extensionContext.workspaceState.get<ItemsViewMode>(ITEMS_VIEW_MODE_KEY);
		this.viewMode = stored === 'all' ? 'all' : 'recent';
		void this.updateViewModeContext();
	}

	async showAllItems(): Promise<void> {
		await this.setViewMode('all');
	}

	async showRecentItems(): Promise<void> {
		await this.setViewMode('recent');
	}

	private async setViewMode(mode: ItemsViewMode): Promise<void> {
		if (this.viewMode === mode) {
			return;
		}
		this.viewMode = mode;
		await this.extensionContext.workspaceState.update(ITEMS_VIEW_MODE_KEY, mode);
		await this.updateViewModeContext();
		this.refresh();
	}

	private updateViewModeContext(): Thenable<void> {
		return vscode.commands.executeCommand('setContext', ITEMS_VIEW_MODE_CONTEXT, this.viewMode);
	}

	async getChildren(element?: JiraTreeItem): Promise<JiraTreeItem[]> {
		if (element?.nodeType === 'statusGroup') {
			return element.children ?? [];
		}
		return super.getChildren(element);
	}

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

		const token = await this.authManager.getToken();
		if (!token) {
			this.updateBadge();
			return [
				new JiraTreeItem(
					'info',
					'Missing auth token. Please log in again.',
					vscode.TreeItemCollapsibleState.None
				),
			];
		}

		const projectLabel = selectedProject.name
			? `${selectedProject.name} (${selectedProject.key})`
			: selectedProject.key;
		const showingRecent = this.viewMode === 'recent';

		try {
			const issues = await fetchProjectIssues(authInfo, token, selectedProject.key);
			const sortedIssues = sortIssuesByUpdatedDesc(issues);
			const relevantIssues = showingRecent ? filterIssuesRelatedToUser(sortedIssues, authInfo) : sortedIssues;
			if (relevantIssues.length === 0) {
				this.updateBadge(
					0,
					showingRecent ? 'No personal issues in this project' : 'No Jira issues in this project'
				);
				this.updateDescription(showingRecent ? `${projectLabel} • my latest` : projectLabel);
				return [
					new JiraTreeItem(
						'info',
						showingRecent
							? 'No recent items assigned to you. Use Show All to list every issue.'
							: 'No issues in this project (latest 50 shown).',
						vscode.TreeItemCollapsibleState.None
					),
				];
			}

			const visibleIssues = showingRecent
				? relevantIssues.slice(0, RECENT_ITEMS_LIMIT)
				: relevantIssues;

			if (showingRecent) {
				this.updateBadge(
					visibleIssues.length,
					visibleIssues.length === 1 ? '1 of your latest issues' : `${visibleIssues.length} of your latest issues`
				);
				this.updateDescription(projectLabel ? `${projectLabel} • my latest` : 'My latest project issues');
			} else {
				this.updateBadge(
					visibleIssues.length,
					visibleIssues.length === 1 ? '1 Jira issue' : `${visibleIssues.length} Jira issues`
				);
				this.updateDescription(projectLabel);
			}

			const groupedNodes = groupIssuesByStatus(visibleIssues).map((group) => {
				const childNodes = group.issues.map((issue) => createIssueTreeItem(issue));
				const label =
					group.issues.length > 0 ? `${group.statusName} (${group.issues.length})` : group.statusName;
				const groupItem = new JiraTreeItem(
					'statusGroup',
					label,
					vscode.TreeItemCollapsibleState.Collapsed,
					undefined,
					undefined,
					childNodes
				);
				groupItem.iconPath = deriveIssueIcon(group.statusName);
				groupItem.tooltip =
					group.issues.length === 1
						? `1 issue in ${group.statusName}`
						: `${group.issues.length} issues in ${group.statusName}`;
				return groupItem;
			});

			if (showingRecent && relevantIssues.length > visibleIssues.length) {
				groupedNodes.push(
					new JiraTreeItem(
						'info',
						`Showing latest ${visibleIssues.length} of ${relevantIssues.length} of your issues. Use Show All to see more.`,
						vscode.TreeItemCollapsibleState.None
					)
				);
			}

			return groupedNodes;
		} catch (error) {
			const message = deriveErrorMessage(error);
			this.updateBadge();
			return [
				new JiraTreeItem(
					'info',
					`Failed to load project issues: ${message}`,
					vscode.TreeItemCollapsibleState.None
				),
			];
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
		command?: vscode.Command,
		public issue?: JiraIssue,
		public children?: JiraTreeItem[]
	) {
		super(label, collapsibleState);
		this.command = command;
	}
}

function createIssueTreeItem(issue: JiraIssue): JiraTreeItem {
	const item = new JiraTreeItem(
		'issue',
		`${issue.key} · ${issue.summary}`,
		vscode.TreeItemCollapsibleState.None,
		undefined,
		issue
	);
	item.tooltip = `${issue.summary}\nStatus: ${issue.statusName}\nUpdated: ${new Date(issue.updated).toLocaleString()}`;
	contextualizeIssue(item, issue);
	return item;
}

function createPlaceholderIssue(issueKey: string): JiraIssue {
	return {
		id: issueKey,
		key: issueKey,
		summary: 'Loading issue details…',
		statusName: 'Loading',
		assigneeAccountId: undefined,
		assigneeUsername: undefined,
		url: '',
		updated: '',
	};
}

function contextualizeIssue(item: JiraTreeItem, issue: JiraIssue) {
	item.contextValue = 'jiraIssue';
	item.description = issue.assigneeName ? `${issue.statusName} • ${issue.assigneeName}` : issue.statusName;
	item.iconPath = deriveIssueIcon(issue.statusName);
	if (issue.key) {
		item.command = {
			command: 'jira.openIssueDetails',
			title: 'Open Issue Details',
			arguments: [issue],
		};
	}
}

function groupIssuesByStatus(
	issues: JiraIssue[]
): Array<{ statusName: string; category: IssueStatusCategory; issues: JiraIssue[] }> {
	const groups = new Map<
		string,
		{
			statusName: string;
			category: IssueStatusCategory;
			issues: JiraIssue[];
		}
	>();

	for (const issue of issues) {
		const statusName = (issue.statusName || 'Unknown').trim() || 'Unknown';
		const key = statusName.toLowerCase();
		let group = groups.get(key);
		if (!group) {
			group = {
				statusName,
				category: determineStatusCategory(statusName),
				issues: [],
			};
			groups.set(key, group);
		}
		group.issues.push(issue);
	}

	return Array.from(groups.values()).sort((a, b) => a.statusName.localeCompare(b.statusName));
}

function sortIssuesByUpdatedDesc(issues: JiraIssue[]): JiraIssue[] {
	return [...issues].sort((a, b) => getIssueUpdatedTimestamp(b) - getIssueUpdatedTimestamp(a));
}

function getIssueUpdatedTimestamp(issue: JiraIssue): number {
	const value = issue.updated ? Date.parse(issue.updated) : NaN;
	return Number.isNaN(value) ? 0 : value;
}

function filterIssuesRelatedToUser(issues: JiraIssue[], authInfo: JiraAuthInfo): JiraIssue[] {
	const accountId = authInfo.accountId?.trim();
	const username = authInfo.username?.trim().toLowerCase();
	const displayName = authInfo.displayName?.trim().toLowerCase();
	return issues.filter((issue) => {
		if (accountId && issue.assigneeAccountId && issue.assigneeAccountId === accountId) {
			return true;
		}
		const assigneeUsername = issue.assigneeUsername?.trim().toLowerCase();
		if (username && assigneeUsername && assigneeUsername === username) {
			return true;
		}
		const assigneeName = issue.assigneeName?.trim().toLowerCase();
		if (username && assigneeName && assigneeName === username) {
			return true;
		}
		if (displayName && assigneeName && assigneeName === displayName) {
			return true;
		}
		return false;
	});
}

async function commitFromIssue(node?: JiraTreeItem) {
	const issue = node?.issue;
	if (!issue?.key) {
		await vscode.window.showInformationMessage('Select a Jira item to prepare a commit message.');
		return;
	}

	const commitMessage = `${issue.key}: `;
	await vscode.commands.executeCommand('workbench.view.scm');

	const gitApplied = await setCommitMessageViaGitApi(commitMessage);
	if (gitApplied) {
		await revealScmInput();
		return;
	}

	const inputBox = await waitForScmInputBox();
	if (!inputBox) {
		await vscode.window.showInformationMessage('No Source Control input box is available.');
		return;
	}

	inputBox.value = commitMessage;
	await revealScmInput();
}

async function waitForScmInputBox(timeoutMs = 2000): Promise<vscode.SourceControlInputBox | undefined> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const inputBox = vscode.scm?.inputBox;
		if (inputBox) {
			return inputBox;
		}
		await delay(100);
	}
	return vscode.scm?.inputBox;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revealScmInput(): Promise<void> {
	await vscode.commands.executeCommand('git.showSCMInput').then(
		() => {},
		() => {}
	);
}

async function setCommitMessageViaGitApi(message: string): Promise<boolean> {
	try {
		const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
		if (!gitExtension) {
			return false;
		}
		const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
		const api = gitExports?.getAPI?.(1) as GitAPI | undefined;
		const repository = api?.repositories?.[0];
		if (!repository?.inputBox) {
			return false;
		}
		repository.inputBox.value = message;
		return true;
	} catch {
		return false;
	}
}

function showIssueDetailsPanel(
	issueKey: string,
	issue?: JiraIssue,
	options?: IssuePanelOptions,
	onMessage?: (message: any, panel: vscode.WebviewPanel) => void
): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		'jiraIssueDetails',
		`${issueKey} – Jira`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
		}
	);
	panel.webview.onDidReceiveMessage((message) => {
		if (message?.type === 'openIssue' && typeof message.key === 'string') {
			vscode.commands.executeCommand('jira.openIssueDetails', message.key);
			return;
		}
		onMessage?.(message, panel);
	});
	const issueData = issue ?? createPlaceholderIssue(issueKey);
	renderIssuePanelContent(panel, issueData, options);
	return panel;
}

function renderIssuePanelContent(panel: vscode.WebviewPanel, issue: JiraIssue, options?: IssuePanelOptions) {
	const statusCategory = determineStatusCategory(issue.statusName);
	const iconPath = getStatusIconPath(statusCategory);
	if (iconPath) {
		panel.iconPath = iconPath;
	}
	const statusIconSrc = getStatusIconWebviewSrc(panel.webview, statusCategory);
	panel.webview.html = renderIssueDetailsHtml(panel.webview, issue, statusIconSrc, options);
}

function showCreateIssuePanel(project: SelectedProjectInfo, state: CreateIssuePanelState): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		'jiraCreateIssue',
		`New Ticket (${project.key})`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
		}
	);
	const iconPath = getItemsIconPath();
	if (iconPath) {
		panel.iconPath = iconPath;
	}
	return panel;
}

function renderCreateIssuePanel(
	panel: vscode.WebviewPanel,
	project: SelectedProjectInfo,
	state: CreateIssuePanelState
): void {
	panel.webview.html = renderCreateIssuePanelHtml(panel.webview, project, state);
}

function renderIssueDetailsHtml(
	webview: vscode.Webview,
	issue: JiraIssue,
	statusIconSrc?: string,
	options?: IssuePanelOptions
): string {
	const updatedText = formatIssueUpdated(issue.updated);
	const assignee = issue.assigneeName ?? 'Unassigned';
	const nonce = generateNonce();
	const isLoading = options?.loading ?? false;
	const errorMessage = options?.error;
	const parentSection = errorMessage
		? ''
		: isLoading
		? renderLoadingSection('Parent', 'Loading parent issue…')
		: renderParentSection(issue);
	const childrenSection = errorMessage
		? ''
		: isLoading
		? renderLoadingSection('Subtasks', 'Loading subtasks…')
		: renderChildrenSection(issue);
	const cspSource = webview.cspSource;
	const metadataPanel = renderMetadataPanel(issue, assignee, updatedText, options);
	const statusIconMarkup = statusIconSrc
		? `<img class="status-icon" src="${escapeAttribute(statusIconSrc)}" alt="${escapeHtml(
				issue.statusName ?? 'Issue status'
		  )} status icon" />`
		: '';
	const messageBanner = errorMessage
		? `<div class="section error-banner">${escapeHtml(errorMessage)}</div>`
		: isLoading
		? `<div class="section loading-banner">Loading additional details…</div>`
		: '';
	const linkSection =
		issue.url && !errorMessage
			? `<div class="section">
		<a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer noopener">Open in Jira</a>
	</div>`
			: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<title>${escapeHtml(issue.key)}</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			padding: 24px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			line-height: 1.5;
			max-width: 1100px;
			margin: 0 auto;
		}
		.issue-header {
			display: flex;
			gap: 16px;
			align-items: flex-start;
			margin-bottom: 24px;
		}
		.status-icon {
			width: 56px;
			height: 56px;
			flex-shrink: 0;
			margin-top: 4px;
		}
		h1 {
			margin-top: 0;
			font-size: 2em;
			margin-bottom: 8px;
		}
		p.issue-summary {
			font-size: 1.1em;
			margin-top: 0;
			margin-bottom: 24px;
		}
		.section {
			margin-top: 24px;
		}
		.section-title {
			font-weight: 600;
			margin-bottom: 4px;
		}
		.label {
			font-weight: 600;
			margin-right: 8px;
		}
		a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		.issue-layout {
			display: grid;
			grid-template-columns: minmax(0, 2.5fr) minmax(280px, 1fr);
			gap: 32px;
			align-items: start;
		}
		.issue-sidebar {
			position: relative;
		}
		.meta-card {
			border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
			border-radius: 6px;
			padding: 16px;
			display: flex;
			flex-direction: column;
			gap: 18px;
		}
		.meta-section {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
			.assignee-card {
				flex-direction: row;
				gap: 12px;
				align-items: center;
			}
			.assignee-control-details {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.assignee-search-row {
				display: flex;
				gap: 8px;
			}
			.assignee-search-row input {
				flex: 1;
			}
			.jira-assignee-select {
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 4px 8px;
			}
			.jira-assignee-select:disabled {
				opacity: 0.7;
			}
			.status-select-wrapper {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.jira-status-select {
				width: 100%;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 4px 8px;
			}
			.jira-status-select:disabled {
				opacity: 0.7;
			}
			.assignee-avatar {
				width: 56px;
				height: 56px;
				border-radius: 50%;
				object-fit: cover;
			flex-shrink: 0;
			border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
			background-color: var(--vscode-sideBar-background);
		}
		.assignee-avatar.fallback {
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: 600;
			font-size: 1em;
		}
		.issue-link {
			background: transparent;
			border: 1px solid var(--vscode-button-border, var(--vscode-foreground));
			border-radius: 4px;
			color: var(--vscode-foreground);
			padding: 4px 8px;
			cursor: pointer;
			font-size: 0.95em;
			margin-top: 4px;
			text-align: left;
			width: 100%;
		}
		.issue-link:hover {
			background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.04));
		}
		.issue-list {
			list-style: none;
			padding-left: 0;
			margin: 4px 0 0 0;
		}
			.issue-list li {
				margin-top: 6px;
			}
			.muted {
				color: var(--vscode-descriptionForeground);
			}
			.loading-banner {
				color: var(--vscode-descriptionForeground);
			}
			.error-banner {
				background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
				border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
				border-radius: 6px;
				padding: 12px;
			}
			.status-error {
				color: var(--vscode-errorForeground);
				font-size: 0.9em;
			}
			@media (max-width: 900px) {
				.issue-layout {
					grid-template-columns: 1fr;
				}
		}
	</style>
</head>
<body>
	<div class="issue-layout">
		<div class="issue-main">
			<div class="issue-header">
				${statusIconMarkup}
				<div>
					<h1>${escapeHtml(issue.key)}</h1>
					<p class="issue-summary">${escapeHtml(issue.summary ?? 'Loading issue details…')}</p>
				</div>
			</div>
			${messageBanner}
			${parentSection}
			${childrenSection}
			${linkSection}
		</div>
		${metadataPanel}
	</div>
		<script nonce="${nonce}">
			(function () {
				const vscode = acquireVsCodeApi();
				document.querySelectorAll('.issue-link').forEach((el) => {
					el.addEventListener('click', () => {
					const key = el.getAttribute('data-issue-key');
					if (key) {
						vscode.postMessage({ type: 'openIssue', key });
					}
				});
				});
				document.querySelectorAll('.jira-status-select').forEach((select) => {
					select.addEventListener('change', () => {
						const transitionId = select.value;
						const issueKey = select.getAttribute('data-issue-key');
						if (!transitionId || !issueKey) {
							return;
						}
						select.setAttribute('disabled', 'true');
						vscode.postMessage({ type: 'changeStatus', transitionId, issueKey });
					});
				});
				const requestAssignees = (issueKey, query, force) => {
					if (!issueKey) {
						return;
					}
					vscode.postMessage({ type: 'loadAssignees', issueKey, query: query ?? '', force: !!force });
				};
				document.querySelectorAll('.jira-assignee-select').forEach((select) => {
					const issueKey = select.getAttribute('data-issue-key');
					select.addEventListener('focus', () => {
					const selector = '.jira-assignee-search[data-issue-key="' + issueKey + '"]';
					const searchInput = document.querySelector(selector);
					const query = searchInput ? searchInput.value : '';
					const loaded = select.getAttribute('data-loaded') === 'true';
					const lastQuery = select.getAttribute('data-query') || '';
					if (!loaded || lastQuery !== query) {
						select.setAttribute('data-loaded', 'pending');
						select.setAttribute('data-query', query);
						requestAssignees(issueKey, query);
					}
					});
					select.addEventListener('click', () => {
					const selector = '.jira-assignee-search[data-issue-key="' + issueKey + '"]';
					const searchInput = document.querySelector(selector);
					const query = searchInput ? searchInput.value : '';
					const loaded = select.getAttribute('data-loaded') === 'true';
					const lastQuery = select.getAttribute('data-query') || '';
					if (!loaded || lastQuery !== query) {
						select.setAttribute('data-loaded', 'pending');
						select.setAttribute('data-query', query);
						requestAssignees(issueKey, query);
					}
					});
					select.addEventListener('change', () => {
						const accountId = select.value;
						if (!accountId || !issueKey) {
							return;
						}
						select.setAttribute('disabled', 'true');
						vscode.postMessage({ type: 'changeAssignee', accountId, issueKey });
					});
				});
				document.querySelectorAll('.jira-assignee-search').forEach((input) => {
				const issueKey = input.getAttribute('data-issue-key');
				const triggerSearch = () => {
					requestAssignees(issueKey, input.value, true);
				};
				input.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						triggerSearch();
						input.dataset.loaded = 'true';
					}
				});
				});
			})();
		</script>
</body>
</html>`;
}

function renderCreateIssuePanelHtml(
	webview: vscode.Webview,
	project: SelectedProjectInfo,
	state: CreateIssuePanelState
): string {
	const nonce = generateNonce();
	const cspSource = webview.cspSource;
	const values = state.values;
	const disabledAttr = state.submitting ? 'disabled' : '';
	const errorBanner = state.error
		? `<div class="error-banner">${escapeHtml(state.error)}</div>`
		: '';
	const successBanner = state.successIssue
		? `<div class="success-banner">
			Created ticket <strong>${escapeHtml(state.successIssue.key)}</strong>.
			${state.successIssue.url ? `<a href="${escapeHtml(state.successIssue.url)}" target="_blank" rel="noreferrer noopener">Open in Jira</a>` : ''}
		</div>`
		: '';
	const projectLabel = project.name ? `${project.name} (${project.key})` : project.key;

	return `<!DOCTYPE html>
<html lang="en">
<head>
\t<meta charset="UTF-8" />
\t<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
\t<title>New Jira Ticket</title>
\t<style>
\t\tbody {
\t\tfont-family: var(--vscode-font-family);
\t\tfont-size: var(--vscode-font-size);
\t\tcolor: var(--vscode-foreground);
\t\tbackground-color: var(--vscode-editor-background);
\t\tpadding: 24px;
\t\tline-height: 1.5;
\t}
\t\th1 {
\t\tmargin-top: 0;
\t\tfont-size: 1.6em;
\t}
\t\tform {
\t\tdisplay: flex;
\t\tflex-direction: column;
\t\tgap: 16px;
\t\tmax-width: 520px;
\t}
\t\tlabel {
\t\tfont-weight: 600;
\t\tdisplay: flex;
\t\tflex-direction: column;
\t\tgap: 6px;
\t}
\t\tinput[type="text"], textarea, select {
\t\tbackground: var(--vscode-input-background);
\t\tcolor: var(--vscode-input-foreground);
\t\tborder: 1px solid var(--vscode-input-border);
\t\tborder-radius: 4px;
\t\tpadding: 6px 8px;
\t\tfont-size: 1em;
\t}
\t\ttextarea {
\t\tmin-height: 120px;
\t\tresize: vertical;
\t}
\t\tbutton {
\t\tbackground: var(--vscode-button-background);
\t\tcolor: var(--vscode-button-foreground);
\t\tborder: none;
\t\tborder-radius: 4px;
\t\tpadding: 8px 12px;
\t\tfont-size: 1em;
\t\tcursor: pointer;
\t\talign-self: flex-start;
\t}
\t\tbutton:disabled {
\t\topacity: 0.7;
\t\tcursor: default;
\t}
\t\t.section-title {
\t\tfont-weight: 600;
\t\tmargin-bottom: 4px;
\t}
\t\t.error-banner {
\t\tmargin-top: 16px;
\t\tbackground: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
\t\tborder: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
\t\tborder-radius: 6px;
\t\tpadding: 12px;
\t}
\t\t.success-banner {
\t\tmargin-top: 16px;
\t\tbackground: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 15%, transparent);
\t\tborder: 1px solid color-mix(in srgb, var(--vscode-terminal-ansiGreen) 40%, transparent);
\t\tborder-radius: 6px;
\t\tpadding: 12px;
\t}
\t\t.project-pill {
\t\tdisplay: inline-flex;
\t\talign-items: center;
\t\tgap: 6px;
\t\tbackground: var(--vscode-badge-background);
\t\tcolor: var(--vscode-badge-foreground);
\t\tpadding: 4px 10px;
\t\tborder-radius: 999px;
\t\tfont-size: 0.9em;
\t}
\t</style>
</head>
<body>
\t<h1>New Jira Ticket</h1>
\t<div class="project-pill">Project: ${escapeHtml(projectLabel)}</div>
\t${errorBanner}
\t${successBanner}
\t<form id="create-issue-form">
\t\t<label>
\t\t\tSummary
\t\t\t<input type="text" name="summary" value="${escapeAttribute(values.summary)}" placeholder="Ticket summary" ${disabledAttr} required />
\t\t</label>
\t\t<label>
\t\t\tDescription
\t\t\t<textarea name="description" placeholder="What needs to be done?" ${disabledAttr}>${escapeHtml(
			values.description
		)}</textarea>
\t\t</label>
\t\t<label>
\t\t\tIssue type
\t\t\t<select name="issueType" ${disabledAttr}>
\t\t\t	${renderIssueTypeOptions(values.issueType)}
\t\t\t</select>
\t\t</label>
\t\t<label>
\t\t\tStarting status
\t\t\t<select name="status" ${disabledAttr}>
\t\t\t	${renderIssueStatusOptions(values.status)}
\t\t\t</select>
\t\t</label>
\t\t<button type="submit" ${disabledAttr}>${state.submitting ? 'Creating…' : 'Create Ticket'}</button>
\t</form>
\t<script nonce="${nonce}">
\t\t(function () {
\t\t\tconst vscode = acquireVsCodeApi();
\t\t\tconst form = document.getElementById('create-issue-form');
\t\t\tif (!form) {
\t\t\t	return;
\t\t\t}
\t\t\tform.addEventListener('submit', (event) => {
\t\t\t	event.preventDefault();
\t\t\t	const formData = new FormData(form);
\t\t\t	const payload = {
\t\t\t\t	summary: formData.get('summary') ?? '',
\t\t\t\t	description: formData.get('description') ?? '',
\t\t\t\t	issueType: formData.get('issueType') ?? 'Task',
\t\t\t\t	status: formData.get('status') ?? '${ISSUE_STATUS_OPTIONS[0]}',
\t\t\t	};
\t\t\t	vscode.postMessage({ type: 'createIssue', values: payload });
\t\t\t});
\t\t})();
\t</script>
</body>
</html>`;
}

function renderParentSection(issue: JiraIssue): string {
	const parent = issue.parent;
	const content = parent
		? renderRelatedIssueButton(parent)
		: '<div class="muted">No parent issue.</div>';
	return `<div class="section">
		<div class="section-title">Parent</div>
		${content}
	</div>`;
}

function renderChildrenSection(issue: JiraIssue): string {
	const children = issue.children?.filter((child) => !!child) ?? [];
	if (children.length === 0) {
		return `<div class="section">
			<div class="section-title">Subtasks</div>
			<div class="muted">No subtasks.</div>
		</div>`;
	}

	const listItems = children
		.map((child) => `<li>${renderRelatedIssueButton(child)}</li>`)
		.join('');

	return `<div class="section">
		<div class="section-title">Subtasks</div>
		<ul class="issue-list">${listItems}</ul>
	</div>`;
}

function renderLoadingSection(title: string, message: string): string {
	return `<div class="section">
		<div class="section-title">${escapeHtml(title)}</div>
		<div class="loading-banner">${escapeHtml(message)}</div>
	</div>`;
}

function renderRelatedIssueButton(issue: JiraRelatedIssue): string {
	const summaryText = issue.summary ? ` · ${escapeHtml(issue.summary)}` : '';
	const statusText = issue.statusName ? ` — ${escapeHtml(issue.statusName)}` : '';
	return `<button class="issue-link" data-issue-key="${escapeHtml(issue.key)}">
		${escapeHtml(issue.key)}${summaryText}${statusText}
	</button>`;
}

function renderMetadataPanel(
	issue: JiraIssue,
	assignee: string,
	updatedText: string,
	options?: IssuePanelOptions
): string {
	const statusControl = renderStatusControl(issue, options);
	const assigneeControl = renderAssigneeControl(issue, assignee, options);
	return `<div class="issue-sidebar">
		<div class="meta-card">
			<div class="meta-section">
				<div class="section-title">Status</div>
				${statusControl}
			</div>
			<div class="meta-section">
				<div class="section-title">Assignee</div>
				${assigneeControl}
			</div>
			<div class="meta-section">
				<div class="section-title">Last Updated</div>
				<div>${escapeHtml(updatedText)}</div>
			</div>
		</div>
		</div>`;
}

function renderStatusControl(issue: JiraIssue, options?: IssuePanelOptions): string {
	const transitions = options?.statusOptions;
	const pending = options?.statusPending;
	const statusError = options?.statusError;

	if (!transitions || transitions.length === 0) {
		const message = statusError
			? statusError
			: options?.loading
			? 'Loading available statuses…'
			: 'No status transitions available.';
		return `<div>${escapeHtml(issue.statusName)}</div>
		<div class="muted">${escapeHtml(message)}</div>`;
	}

	const selectOptions = transitions
		.map(
			(option) =>
				`<option value="${escapeAttribute(option.id)}">${escapeHtml(option.name)}</option>`
		)
		.join('');
	const disabledAttr = pending ? 'disabled' : '';

	return `<div class="status-select-wrapper">
		<select class="jira-status-select" data-issue-key="${escapeAttribute(issue.key)}" ${disabledAttr}>
			<option value="" disabled selected>Current: ${escapeHtml(issue.statusName)}</option>
			${selectOptions}
		</select>
		${statusError ? `<div class="status-error">${escapeHtml(statusError)}</div>` : ''}
	</div>`;
}

function renderIssueTypeOptions(selected: string): string {
	return ISSUE_TYPE_OPTIONS.map((option) => {
		const isSelected = option === selected;
		return `<option value="${escapeAttribute(option)}" ${isSelected ? 'selected' : ''}>${escapeHtml(option)}</option>`;
	}).join('');
}

function renderIssueStatusOptions(selected: string): string {
	return ISSUE_STATUS_OPTIONS.map((option) => {
		const isSelected = option === selected;
		return `<option value="${escapeAttribute(option)}" ${isSelected ? 'selected' : ''}>${escapeHtml(option)}</option>`;
	}).join('');
}

function renderAssigneeControl(
	issue: JiraIssue,
	currentAssigneeLabel: string,
	options?: IssuePanelOptions
): string {
	const assigneeOptions = options?.assigneeOptions;
	const pending = options?.assigneePending;
	const assigneeError = options?.assigneeError;
	const currentAccountId = issue.assigneeAccountId;
	const queryValue = options?.assigneeQuery ?? '';
	const searchDisabledAttr = pending ? 'disabled' : '';

	if (!assigneeOptions || assigneeOptions.length === 0) {
		const message = assigneeError
			? assigneeError
			: 'Search to load assignable users.';
	return `<div class="assignee-card">
		${renderAssigneeAvatar(issue)}
		<div class="assignee-control-details">
			<div class="muted">Current: ${escapeHtml(currentAssigneeLabel || 'Unassigned')}</div>
			<div class="assignee-search-row">
				<input type="text" class="jira-assignee-search" data-issue-key="${escapeAttribute(
					issue.key
				)}" data-query="${escapeAttribute(queryValue)}" value="${escapeAttribute(
					queryValue
				)}" placeholder="Search people" ${searchDisabledAttr} />
			</div>
			<select class="jira-assignee-select" data-issue-key="${escapeAttribute(
				issue.key
			)}" data-loaded="false" data-query="${escapeAttribute(queryValue)}" ${searchDisabledAttr}>
				<option value="">${escapeHtml(message)}</option>
			</select>
		</div>
	</div>`;
}

	const selectDisabledAttr = pending ? 'disabled' : '';
	const selectOptions = assigneeOptions
		.map((user) => {
			const isCurrent =
				(currentAccountId && user.accountId === currentAccountId) ||
				user.displayName === issue.assigneeName;
			return `<option value="${escapeAttribute(user.accountId)}" ${
				isCurrent ? 'selected' : ''
			}>${escapeHtml(user.displayName)}</option>`;
		})
		.join('');
	const disabledAttr = pending ? 'disabled' : '';

	return `<div class="assignee-card">
		${renderAssigneeAvatar(issue)}
		<div class="assignee-control-details">
			<div class="muted">Current: ${escapeHtml(currentAssigneeLabel || 'Unassigned')}</div>
			<div class="assignee-search-row">
				<input type="text" class="jira-assignee-search" data-issue-key="${escapeAttribute(
					issue.key
				)}" value="${escapeAttribute(queryValue)}" placeholder="Search people" ${searchDisabledAttr} />
			</div>
			<select class="jira-assignee-select" data-issue-key="${escapeAttribute(
				issue.key
			)}" data-loaded="true" data-query="${escapeAttribute(queryValue)}" ${selectDisabledAttr}>
				${selectOptions}
			</select>
			${assigneeError ? `<div class="status-error">${escapeHtml(assigneeError)}</div>` : ''}
		</div>
	</div>`;
}

function sanitizeCreateIssueValues(
	raw: any,
	fallback: CreateIssueFormValues
): CreateIssueFormValues {
	const summary = typeof raw?.summary === 'string' ? raw.summary : fallback.summary;
	const description = typeof raw?.description === 'string' ? raw.description : fallback.description;
	const issueTypeRaw = typeof raw?.issueType === 'string' ? raw.issueType : fallback.issueType;
	const normalizedType = issueTypeRaw?.trim() || fallback.issueType;
	const issueType = ISSUE_TYPE_OPTIONS.includes(normalizedType) ? normalizedType : fallback.issueType;
	const statusRaw = typeof raw?.status === 'string' ? raw.status : fallback.status;
	const normalizedStatus = statusRaw?.trim() || fallback.status;
	const status = ISSUE_STATUS_OPTIONS.includes(normalizedStatus) ? normalizedStatus : fallback.status;
	return {
		summary,
		description,
		issueType,
		status,
	};
}

function renderAssigneeAvatar(issue: JiraIssue): string {
	if (issue.assigneeAvatarUrl) {
		return `<img class="assignee-avatar" src="${escapeAttribute(issue.assigneeAvatarUrl)}" alt="Assignee avatar" />`;
	}
	const initials = getInitials(issue.assigneeName);
	return `<div class="assignee-avatar fallback">${escapeHtml(initials)}</div>`;
}

function getInitials(name?: string): string {
	if (!name) {
		return '??';
	}
	const parts = name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? '');
	const combined = parts.join('');
	if (combined) {
		return combined;
	}
	const trimmed = name.replace(/\s+/g, '');
	return trimmed.slice(0, 2).toUpperCase() || '??';
}

function generateNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

function escapeHtml(value?: string): string {
	if (!value) {
		return '';
	}
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeAttribute(value?: string): string {
	return escapeHtml(value);
}

function formatIssueUpdated(updated: string | undefined): string {
	if (!updated) {
		return 'Unknown';
	}
	const date = new Date(updated);
	if (isNaN(date.getTime())) {
		return updated;
	}
	return date.toLocaleString();
}

function getStatusIconPath(category: IssueStatusCategory): vscode.Uri | undefined {
	if (!extensionUri) {
		return undefined;
	}
	const fileName = STATUS_ICON_FILES[category] ?? STATUS_ICON_FILES.default;
	return vscode.Uri.joinPath(extensionUri, 'media', fileName);
}

function getStatusIconWebviewSrc(webview: vscode.Webview, category: IssueStatusCategory): string | undefined {
	const iconPath = getStatusIconPath(category);
	if (!iconPath) {
		return undefined;
	}
	return webview.asWebviewUri(iconPath).toString();
}

function getItemsIconPath(): vscode.Uri | undefined {
	if (!extensionUri) {
		return undefined;
	}
	return vscode.Uri.joinPath(extensionUri, 'media', 'items.png');
}

function deriveIssueIcon(statusName?: string): vscode.ThemeIcon {
	const category = determineStatusCategory(statusName);
	switch (category) {
		case 'done':
			return new vscode.ThemeIcon('pass');
		case 'inProgress':
			return new vscode.ThemeIcon('sync');
		case 'open':
			return new vscode.ThemeIcon('circle-outline');
		default:
			return new vscode.ThemeIcon('issues');
	}
}

function determineStatusCategory(statusName?: string): IssueStatusCategory {
	const status = statusName?.toLowerCase().trim() ?? '';
	if (!status) {
		return 'default';
	}
	if (status.includes('done') || status.includes('closed') || status.includes('resolved') || status.includes('complete')) {
		return 'done';
	}
	if (status.includes('progress') || status.includes('doing') || status.includes('active') || status.includes('working')) {
		return 'inProgress';
	}
	if (status.includes('todo') || status.includes('to do') || status.includes('open') || status.includes('backlog')) {
		return 'open';
	}
	return 'default';
}

class JiraAuthManager implements vscode.Disposable {
	private authChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeAuth: vscode.Event<void> = this.authChangeEmitter.event;

	constructor(private context: vscode.ExtensionContext) {}

	dispose(): void {
		this.authChangeEmitter.dispose();
	}

	async getAuthInfo(): Promise<JiraAuthInfo | undefined> {
		return this.context.globalState.get<JiraAuthInfo>(AUTH_STATE_KEY);
	}

	private async saveAuthInfo(info: JiraAuthInfo | undefined) {
		await this.context.globalState.update(AUTH_STATE_KEY, info);
		this.authChangeEmitter.fire();
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
		jql: `project = ${sanitizedKey} ORDER BY updated DESC`,
		maxResults: 50,
		fields: ISSUE_DETAIL_FIELDS,
	});
}

async function fetchIssueDetails(authInfo: JiraAuthInfo, token: string, issueKey: string): Promise<JiraIssue> {
	const sanitizedKey = issueKey?.trim();
	if (!sanitizedKey) {
		throw new Error('Issue key is required.');
	}

	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(sanitizedKey)}`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					fields: ISSUE_DETAIL_FIELDS.join(','),
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

			return mapIssue(response.data, urlRoot);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load issue details.');
}

async function fetchIssueTransitions(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string
): Promise<IssueStatusOption[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(issueKey)}/transitions`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
			const transitions = response.data?.transitions ?? [];
				return transitions
					.map((transition: any) => mapTransitionToStatusOption(transition))
					.filter((option: IssueStatusOption | undefined): option is IssueStatusOption => !!option);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load issue transitions.');
}

async function transitionIssueStatus(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	transitionId: string
): Promise<void> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(issueKey)}/transitions`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			await axios.post(
				endpoint,
				{
					transition: {
						id: transitionId,
					},
				},
				{
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				}
			);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to update issue status.');
}

async function fetchAssignableUsers(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	query = '',
	maxResults = 50
): Promise<IssueAssignableUser[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const resource = `user/assignable/search`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					issueKey,
					maxResults,
					query: query?.trim() || undefined,
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

			const users: any[] = response.data ?? [];
			return users
				.map((user: any): IssueAssignableUser | undefined => {
					const identifier = user.accountId ?? user.key ?? user.name;
					if (!identifier) {
						return undefined;
					}
					return {
						accountId: String(identifier),
						displayName: user.displayName ?? user.name ?? 'Unnamed',
						avatarUrl:
							user.avatarUrls?.['48x48'] ??
							user.avatarUrls?.['32x32'] ??
							user.avatarUrls?.['24x24'] ??
							undefined,
					};
				})
				.filter((user): user is IssueAssignableUser => !!user);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to load assignable users.');
}

async function assignIssue(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	accountId: string
): Promise<void> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const resource = `issue/${encodeURIComponent(issueKey)}/assignee`;
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const body =
				authInfo.serverLabel === 'cloud'
					? { accountId }
					: { name: accountId, accountId };
			await axios.put(
				endpoint,
				body,
				{
					auth: {
						username: authInfo.username,
						password: token,
					},
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': 'jira-vscode',
					},
				}
			);
			return;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to update assignee.');
}
async function createJiraIssue(
	authInfo: JiraAuthInfo,
	token: string,
	projectKey: string,
	values: CreateIssueFormValues
): Promise<JiraIssue> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'issue');
	const payload = {
		fields: {
			project: { key: projectKey },
			summary: values.summary.trim(),
			description: values.description?.trim() ? values.description : undefined,
			issuetype: { name: values.issueType?.trim() || 'Task' },
		},
	};

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.post(endpoint, payload, {
				auth: {
					username: authInfo.username,
					password: token,
				},
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': 'jira-vscode',
				},
			});
			const createdKey = response.data?.key ?? response.data?.issueKey;
			if (!createdKey) {
				throw new Error('Jira did not return the new issue key.');
			}
			return finalizeCreatedIssue(authInfo, token, createdKey, values.status);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('Unable to create Jira issue.');
}

async function finalizeCreatedIssue(
	authInfo: JiraAuthInfo,
	token: string,
	issueKey: string,
	desiredStatus?: string
): Promise<JiraIssue> {
	const createdIssue = await fetchIssueDetails(authInfo, token, issueKey);
	if (!desiredStatus) {
		return createdIssue;
	}
	const normalizedDesired = desiredStatus.trim().toLowerCase();
	const currentStatus = createdIssue.statusName?.trim().toLowerCase();
	if (!normalizedDesired || normalizedDesired === currentStatus) {
		return createdIssue;
	}
	try {
		const transitions = await fetchIssueTransitions(authInfo, token, issueKey);
		const target = transitions.find(
			(option) => option.name.trim().toLowerCase() === normalizedDesired
		);
		if (!target) {
			return createdIssue;
		}
		await transitionIssueStatus(authInfo, token, issueKey, target.id);
		return fetchIssueDetails(authInfo, token, issueKey);
	} catch {
		return createdIssue;
	}
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
		fields: options.fields ?? ISSUE_DETAIL_FIELDS,
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
	return issues.map((issue: any) => mapIssue(issue, urlRoot));
}

function mapIssue(issue: any, urlRoot: string): JiraIssue {
	const fields = issue?.fields ?? {};
	const avatarUrls = fields?.assignee?.avatarUrls ?? issue?.assignee?.avatarUrls ?? {};
	const assigneeAvatarUrl =
		avatarUrls['128x128'] ??
		avatarUrls['96x96'] ??
		avatarUrls['72x72'] ??
		avatarUrls['48x48'] ??
		avatarUrls['32x32'] ??
		avatarUrls['24x24'] ??
		avatarUrls['16x16'];

	return {
		id: issue?.id,
		key: issue?.key,
		summary: fields?.summary ?? 'Untitled',
		statusName: fields?.status?.name ?? 'Unknown',
		assigneeName: fields?.assignee?.displayName ?? fields?.assignee?.name ?? undefined,
		assigneeUsername: fields?.assignee?.name ?? undefined,
		assigneeAccountId: fields?.assignee?.accountId ?? undefined,
		assigneeAvatarUrl,
		url: `${urlRoot}/browse/${issue?.key}`,
		updated: fields?.updated ?? '',
		parent: mapRelatedIssue(fields?.parent, urlRoot),
		children: mapRelatedIssues(fields?.subtasks, urlRoot),
	};
}

function mapRelatedIssues(rawList: any, urlRoot: string): JiraRelatedIssue[] | undefined {
	if (!Array.isArray(rawList) || rawList.length === 0) {
		return undefined;
	}
	const mapped = rawList
		.map((raw: any) => mapRelatedIssue(raw, urlRoot))
		.filter((related): related is JiraRelatedIssue => !!related);
	return mapped.length > 0 ? mapped : undefined;
}

function mapRelatedIssue(raw: any, urlRoot: string): JiraRelatedIssue | undefined {
	if (!raw) {
		return undefined;
	}
	const key = raw.key ?? raw.id;
	if (!key) {
		return undefined;
	}
	const fields = raw.fields ?? {};
	const summary = fields.summary ?? raw.summary ?? key;
	const statusName = fields.status?.name ?? raw.status?.name ?? undefined;
	const assigneeName =
		fields.assignee?.displayName ??
		fields.assignee?.name ??
		raw.assignee?.displayName ??
		raw.assignee?.name ??
		undefined;
	const updated = fields.updated ?? raw.updated ?? undefined;
	return {
		key,
		summary,
		statusName,
		assigneeName,
		url: `${urlRoot}/browse/${key}`,
		updated,
	};
}

function mapTransitionToStatusOption(transition: any): IssueStatusOption | undefined {
	if (!transition?.id) {
		return undefined;
	}
	const name = transition?.name ?? transition?.to?.name ?? 'Unnamed';
	const categorySource =
		transition?.to?.statusCategory?.name ??
		transition?.to?.statusCategory?.key ??
		transition?.to?.statusCategory?.id ??
		transition?.to?.statusCategoryName ??
		name;
	return {
		id: String(transition.id),
		name,
		category: determineStatusCategory(categorySource),
	};
}

function mapProject(project: any, urlRoot: string): JiraProject {
	return {
		id: project?.id,
		key: project?.key,
		name: project?.name ?? 'Untitled',
		typeKey: project?.projectTypeKey,
		url: project?.key ? `${urlRoot}/browse/${project.key}` : urlRoot,
	};
}

async function fetchRecentProjects(authInfo: JiraAuthInfo, token: string): Promise<JiraProject[]> {
	const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
	const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'project/recent');

	let lastError: unknown;
	for (const endpoint of endpoints) {
		try {
			const response = await axios.get(endpoint, {
				params: {
					maxResults: 20,
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

			const projects = Array.isArray(response.data)
				? response.data
				: Array.isArray(response.data?.values)
				? response.data.values
				: [];
			return projects.map((project: any) => mapProject(project, urlRoot));
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
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

			const projects = Array.isArray(response.data?.values) ? response.data.values : [];
			return projects.map((project: any) => mapProject(project, urlRoot));
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

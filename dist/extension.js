"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const AUTH_STATE_KEY = 'jira.authInfo';
const SECRET_PREFIX = 'jira-token';
const SELECTED_PROJECT_KEY = 'jira.selectedProject';
const ISSUE_DETAIL_FIELDS = ['summary', 'status', 'assignee', 'updated', 'parent', 'subtasks'];
let extensionUri;
const STATUS_ICON_FILES = {
    done: 'status-done.svg',
    inProgress: 'status-inprogress.svg',
    open: 'status-open.svg',
    default: 'status-default.svg',
};
async function activate(context) {
    extensionUri = context.extensionUri;
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
    context.subscriptions.push(projectsView, settingsView, itemsView, vscode.commands.registerCommand('jira.login', async () => {
        await authManager.login();
        refreshAll();
    }), vscode.commands.registerCommand('jira.logout', async () => {
        await authManager.logout();
        refreshAll();
    }), vscode.commands.registerCommand('jira.focusProject', async (project) => {
        const changed = await focusManager.focusProject(project);
        if (changed) {
            refreshAll();
        }
    }), vscode.commands.registerCommand('jira.clearProjectFocus', async () => {
        const changed = await focusManager.clearProjectFocus();
        if (changed) {
            refreshAll();
        }
    }), vscode.commands.registerCommand('jira.openIssueDetails', async (issueOrKey) => {
        const issueKey = typeof issueOrKey === 'string' ? issueOrKey : issueOrKey?.key;
        if (!issueKey) {
            await vscode.window.showInformationMessage('Unable to open issue details.');
            return;
        }
        const authInfo = await authManager.getAuthInfo();
        if (!authInfo) {
            await vscode.window.showInformationMessage('Log in to Jira to view issue details.');
            return;
        }
        const token = await authManager.getToken();
        if (!token) {
            await vscode.window.showInformationMessage('Missing auth token. Please log in again.');
            return;
        }
        try {
            const issue = await fetchIssueDetails(authInfo, token, issueKey);
            showIssueDetailsPanel(issue);
        }
        catch (error) {
            const message = deriveErrorMessage(error);
            await vscode.window.showErrorMessage(`Failed to load issue details: ${message}`);
        }
    }));
}
function deactivate() {
    // nothing to clean up yet
}
class JiraTreeDataProvider {
    constructor(authManager, focusManager) {
        this.authManager = authManager;
        this.focusManager = focusManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    bindView(view) {
        this.treeView = view;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element) {
            return [];
        }
        const authInfo = await this.authManager.getAuthInfo();
        if (!authInfo) {
            this.updateBadge();
            this.updateDescription();
            return [
                new JiraTreeItem('loginPrompt', 'Log in to Jira', vscode.TreeItemCollapsibleState.None, {
                    command: 'jira.login',
                    title: 'Log In',
                }),
            ];
        }
        return this.getSectionChildren(authInfo);
    }
    updateBadge(value, tooltip) {
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
    updateDescription(text) {
        if (this.treeView) {
            this.treeView.description = text || undefined;
        }
    }
}
class JiraProjectsTreeDataProvider extends JiraTreeDataProvider {
    getSectionChildren(authInfo) {
        return this.loadProjects(authInfo);
    }
    async loadProjects(authInfo) {
        const token = await this.authManager.getToken();
        if (!token) {
            this.updateBadge();
            this.updateDescription();
            return [
                new JiraTreeItem('info', 'Missing auth token. Please log in again.', vscode.TreeItemCollapsibleState.None),
            ];
        }
        try {
            const projects = await fetchAccessibleProjects(authInfo, token);
            this.updateBadge(projects.length, projects.length === 1 ? '1 accessible project' : `${projects.length} accessible projects`);
            this.updateDescription(extractHost(authInfo.baseUrl));
            if (projects.length === 0) {
                return [
                    new JiraTreeItem('info', 'No projects available.', vscode.TreeItemCollapsibleState.None),
                ];
            }
            const selectedProject = this.focusManager.getSelectedProject();
            const nodes = projects.map((project) => {
                const item = new JiraTreeItem('project', project.name ?? project.key, vscode.TreeItemCollapsibleState.None, {
                    command: 'jira.focusProject',
                    title: 'Focus Project',
                    arguments: [project],
                });
                const isSelected = selectedProject?.key === project.key;
                item.iconPath = isSelected
                    ? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
                    : new vscode.ThemeIcon('repo');
                item.description = isSelected ? `${project.key} • focused` : project.key;
                item.tooltip = project.name ? `${project.name} (${project.key})` : project.key;
                return item;
            });
            return nodes;
        }
        catch (error) {
            const message = deriveErrorMessage(error);
            this.updateBadge();
            return [
                new JiraTreeItem('info', `Failed to load projects: ${message}`, vscode.TreeItemCollapsibleState.None),
            ];
        }
    }
}
class JiraItemsTreeDataProvider extends JiraTreeDataProvider {
    getSectionChildren(authInfo) {
        return this.loadItems(authInfo);
    }
    async loadItems(authInfo) {
        const selectedProject = this.focusManager.getSelectedProject();
        if (!selectedProject) {
            this.updateBadge();
            this.updateDescription('Select project');
            return [
                new JiraTreeItem('info', 'Select a project in Projects to view Jira issues.', vscode.TreeItemCollapsibleState.None, {
                    command: 'jira.focusProject',
                    title: 'Focus Project',
                }),
            ];
        }
        this.updateDescription(selectedProject.key);
        const nodes = [];
        const token = await this.authManager.getToken();
        if (!token) {
            this.updateBadge();
            nodes.push(new JiraTreeItem('info', 'Missing auth token. Please log in again.', vscode.TreeItemCollapsibleState.None));
            return nodes;
        }
        try {
            const issues = await fetchProjectIssues(authInfo, token, selectedProject.key);
            if (issues.length === 0) {
                this.updateBadge(0, 'No Jira issues in this project');
                nodes.push(new JiraTreeItem('info', 'No issues in this project (first 50 shown).', vscode.TreeItemCollapsibleState.None));
                return nodes;
            }
            this.updateBadge(issues.length, issues.length === 1 ? '1 Jira issue' : `${issues.length} Jira issues`);
            nodes.push(...issues.map((issue) => {
                const item = new JiraTreeItem('issue', `${issue.key} · ${issue.summary}`, vscode.TreeItemCollapsibleState.None);
                item.tooltip = `${issue.summary}\nStatus: ${issue.statusName}\nUpdated: ${new Date(issue.updated).toLocaleString()}`;
                contextualizeIssue(item, issue);
                return item;
            }));
            return nodes;
        }
        catch (error) {
            const message = deriveErrorMessage(error);
            this.updateBadge();
            nodes.push(new JiraTreeItem('info', `Failed to load project issues: ${message}`, vscode.TreeItemCollapsibleState.None));
            return nodes;
        }
    }
}
class JiraSettingsTreeDataProvider extends JiraTreeDataProvider {
    async getSectionChildren(authInfo) {
        this.updateBadge();
        this.updateDescription(extractHost(authInfo.baseUrl));
        const nodes = buildAccountNodes(authInfo);
        const token = await this.authManager.getToken();
        if (!token) {
            nodes.unshift(new JiraTreeItem('info', 'Missing auth token. Please log in again.', vscode.TreeItemCollapsibleState.None));
        }
        return nodes;
    }
}
class JiraFocusManager {
    constructor(context, authManager) {
        this.context = context;
        this.authManager = authManager;
    }
    getSelectedProject() {
        return this.context.globalState.get(SELECTED_PROJECT_KEY);
    }
    async saveSelectedProject(project) {
        await this.context.globalState.update(SELECTED_PROJECT_KEY, project);
    }
    async focusProject(project) {
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
    async clearProjectFocus() {
        const hadSelection = !!this.getSelectedProject();
        if (hadSelection) {
            await this.saveSelectedProject(undefined);
        }
        return hadSelection;
    }
    async promptForProjectSelection(authInfo, previousKey) {
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
            const picks = projects.map((project) => ({
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
            const selection = await vscode.window.showQuickPick(picks, {
                placeHolder: 'Select a project to focus',
                ignoreFocusOut: true,
            });
            if (!selection) {
                return false;
            }
            if (selection.clear) {
                await this.saveSelectedProject(undefined);
            }
            else if (selection.project) {
                const project = selection.project;
                await this.saveSelectedProject({
                    key: project.key,
                    name: project.name,
                    typeKey: project.typeKey,
                });
            }
            const newKey = this.getSelectedProject()?.key;
            return previousKey !== newKey;
        }
        catch (error) {
            const message = deriveErrorMessage(error);
            await vscode.window.showErrorMessage(`Failed to load projects: ${message}`);
            return false;
        }
    }
}
function buildAccountNodes(authInfo) {
    const nodes = [];
    const userItem = new JiraTreeItem('info', `Signed in as ${authInfo.displayName ?? authInfo.username}`, vscode.TreeItemCollapsibleState.None);
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
function extractHost(url) {
    try {
        const parsed = new URL(url);
        return parsed.host;
    }
    catch {
        return undefined;
    }
}
class JiraTreeItem extends vscode.TreeItem {
    constructor(nodeType, label, collapsibleState, command) {
        super(label, collapsibleState);
        this.nodeType = nodeType;
        this.command = command;
    }
}
function contextualizeIssue(item, issue) {
    item.contextValue = 'jiraIssue';
    item.description = issue.assigneeName ? `${issue.statusName} • ${issue.assigneeName}` : issue.statusName;
    item.iconPath = deriveIssueIcon(issue.statusName);
    if (issue.key) {
        item.command = {
            command: 'jira.openIssueDetails',
            title: 'Open Issue Details',
            arguments: [issue.key],
        };
    }
}
function showIssueDetailsPanel(issue) {
    const panel = vscode.window.createWebviewPanel('jiraIssueDetails', `${issue.key} – Jira`, vscode.ViewColumn.Active, {
        enableScripts: true,
    });
    const statusCategory = determineStatusCategory(issue.statusName);
    const iconPath = getStatusIconPath(statusCategory);
    if (iconPath) {
        panel.iconPath = iconPath;
    }
    panel.webview.onDidReceiveMessage((message) => {
        if (message?.type === 'openIssue' && typeof message.key === 'string') {
            vscode.commands.executeCommand('jira.openIssueDetails', message.key);
        }
    });
    const statusIconSrc = getStatusIconWebviewSrc(panel.webview, statusCategory);
    panel.webview.html = renderIssueDetailsHtml(panel.webview, issue, statusIconSrc);
}
function renderIssueDetailsHtml(webview, issue, statusIconSrc) {
    const updatedText = formatIssueUpdated(issue.updated);
    const assignee = issue.assigneeName ?? 'Unassigned';
    const escapedUrl = escapeHtml(issue.url);
    const nonce = generateNonce();
    const parentSection = renderParentSection(issue);
    const childrenSection = renderChildrenSection(issue);
    const cspSource = webview.cspSource;
    const metadataPanel = renderMetadataPanel(issue, assignee, updatedText);
    const statusIconMarkup = statusIconSrc
        ? `<img class="status-icon" src="${escapeAttribute(statusIconSrc)}" alt="${escapeHtml(issue.statusName ?? 'Issue status')} status icon" />`
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
						<p class="issue-summary">${escapeHtml(issue.summary)}</p>
					</div>
				</div>
				${parentSection}
				${childrenSection}
				<div class="section">
					<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener">Open in Jira</a>
			</div>
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
		})();
	</script>
</body>
</html>`;
}
function renderParentSection(issue) {
    const parent = issue.parent;
    const content = parent
        ? renderRelatedIssueButton(parent)
        : '<div class="muted">No parent issue.</div>';
    return `<div class="section">
		<div class="section-title">Parent</div>
		${content}
	</div>`;
}
function renderChildrenSection(issue) {
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
function renderRelatedIssueButton(issue) {
    const summaryText = issue.summary ? ` · ${escapeHtml(issue.summary)}` : '';
    const statusText = issue.statusName ? ` — ${escapeHtml(issue.statusName)}` : '';
    return `<button class="issue-link" data-issue-key="${escapeHtml(issue.key)}">
		${escapeHtml(issue.key)}${summaryText}${statusText}
	</button>`;
}
function renderMetadataPanel(issue, assignee, updatedText) {
    return `<div class="issue-sidebar">
		<div class="meta-card">
			<div class="meta-section">
				<div class="section-title">Status</div>
				<div>${escapeHtml(issue.statusName)}</div>
			</div>
			<div class="meta-section assignee-card">
				${renderAssigneeAvatar(issue)}
				<div>
					<div class="section-title">Assignee</div>
					<div>${escapeHtml(assignee)}</div>
				</div>
			</div>
			<div class="meta-section">
				<div class="section-title">Last Updated</div>
				<div>${escapeHtml(updatedText)}</div>
			</div>
		</div>
	</div>`;
}
function renderAssigneeAvatar(issue) {
    if (issue.assigneeAvatarUrl) {
        return `<img class="assignee-avatar" src="${escapeAttribute(issue.assigneeAvatarUrl)}" alt="Assignee avatar" />`;
    }
    const initials = getInitials(issue.assigneeName);
    return `<div class="assignee-avatar fallback">${escapeHtml(initials)}</div>`;
}
function getInitials(name) {
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
function generateNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
function escapeHtml(value) {
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
function escapeAttribute(value) {
    return escapeHtml(value);
}
function formatIssueUpdated(updated) {
    if (!updated) {
        return 'Unknown';
    }
    const date = new Date(updated);
    if (isNaN(date.getTime())) {
        return updated;
    }
    return date.toLocaleString();
}
function getStatusIconPath(category) {
    if (!extensionUri) {
        return undefined;
    }
    const fileName = STATUS_ICON_FILES[category] ?? STATUS_ICON_FILES.default;
    return vscode.Uri.joinPath(extensionUri, 'media', fileName);
}
function getStatusIconWebviewSrc(webview, category) {
    const iconPath = getStatusIconPath(category);
    if (!iconPath) {
        return undefined;
    }
    return webview.asWebviewUri(iconPath).toString();
}
function deriveIssueIcon(statusName) {
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
function determineStatusCategory(statusName) {
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
class JiraAuthManager {
    constructor(context) {
        this.context = context;
    }
    async getAuthInfo() {
        return this.context.globalState.get(AUTH_STATE_KEY);
    }
    async saveAuthInfo(info) {
        await this.context.globalState.update(AUTH_STATE_KEY, info);
    }
    async login() {
        const selection = await vscode.window.showQuickPick([
            { label: 'Jira Cloud (Atlassian)', value: 'cloud' },
            { label: 'Custom Jira Server/Data Center', value: 'custom' },
        ], {
            title: 'Select Jira deployment type',
            ignoreFocusOut: true,
        });
        if (!selection) {
            return;
        }
        const configBaseUrl = vscode.workspace.getConfiguration('jira').get('baseUrl')?.trim();
        const baseUrlInput = await vscode.window.showInputBox({
            title: 'Jira base URL',
            prompt: selection.value === 'cloud'
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
                }
                catch {
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
            prompt: selection.value === 'cloud'
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
            const profile = await verifyCredentials(normalizedBaseUrl, username, token, selection.value);
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
        }
        catch (error) {
            const message = deriveErrorMessage(error);
            await vscode.window.showErrorMessage(`Failed to connect to Jira: ${message}`);
        }
    }
    async logout() {
        const authInfo = await this.getAuthInfo();
        if (!authInfo) {
            return;
        }
        const accountKey = buildAccountKey(authInfo.baseUrl, authInfo.username);
        await this.context.secrets.delete(buildSecretKey(accountKey));
        await this.saveAuthInfo(undefined);
        await vscode.window.showInformationMessage('Disconnected from Jira.');
    }
    async getToken() {
        const authInfo = await this.getAuthInfo();
        if (!authInfo) {
            return undefined;
        }
        const accountKey = buildAccountKey(authInfo.baseUrl, authInfo.username);
        const token = await this.context.secrets.get(buildSecretKey(accountKey));
        return token ?? undefined;
    }
}
async function verifyCredentials(baseUrl, username, token, serverLabel) {
    const urlRoot = normalizeBaseUrl(baseUrl);
    const endpoints = buildRestApiEndpoints(urlRoot, serverLabel, 'myself');
    let lastError;
    for (const endpoint of endpoints) {
        try {
            const response = await axios_1.default.get(endpoint, {
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
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
function normalizeBaseUrl(url) {
    const trimmed = url.trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
function buildAccountKey(baseUrl, username) {
    return `${baseUrl}:${username}`;
}
function buildSecretKey(accountKey) {
    return `${SECRET_PREFIX}:${accountKey}`;
}
async function fetchProjectIssues(authInfo, token, projectKey) {
    const sanitizedKey = projectKey?.trim();
    if (!sanitizedKey) {
        return [];
    }
    return searchJiraIssues(authInfo, token, {
        jql: `project = ${sanitizedKey} ORDER BY created DESC`,
        maxResults: 50,
        fields: ISSUE_DETAIL_FIELDS,
    });
}
async function fetchIssueDetails(authInfo, token, issueKey) {
    const sanitizedKey = issueKey?.trim();
    if (!sanitizedKey) {
        throw new Error('Issue key is required.');
    }
    const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
    const resource = `issue/${encodeURIComponent(sanitizedKey)}`;
    const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, resource);
    let lastError;
    for (const endpoint of endpoints) {
        try {
            const response = await axios_1.default.get(endpoint, {
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
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError ?? new Error('Unable to load issue details.');
}
async function searchJiraIssues(authInfo, token, options) {
    const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
    const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'search/jql', 'search', 'jql/search', 'issue/search');
    const searchPayload = {
        jql: options.jql,
        maxResults: options.maxResults ?? 50,
        fields: options.fields ?? ISSUE_DETAIL_FIELDS,
    };
    let lastError;
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
        };
        const tryGet = async () => {
            const response = await axios_1.default.get(endpoint, {
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
            const response = await axios_1.default.post(endpoint, searchPayload, config);
            return response.data;
        };
        try {
            const data = await tryPost();
            return mapIssues(data, urlRoot);
        }
        catch (postError) {
            lastError = postError;
            if (!supportsGet || !shouldFallbackToGet(postError)) {
                continue;
            }
            try {
                const data = await tryGet();
                return mapIssues(data, urlRoot);
            }
            catch (getError) {
                lastError = getError;
            }
        }
    }
    throw lastError;
}
function mapIssues(data, urlRoot) {
    const issues = data?.issues ?? [];
    return issues.map((issue) => mapIssue(issue, urlRoot));
}
function mapIssue(issue, urlRoot) {
    const fields = issue?.fields ?? {};
    const avatarUrls = fields?.assignee?.avatarUrls ?? issue?.assignee?.avatarUrls ?? {};
    const assigneeAvatarUrl = avatarUrls['128x128'] ??
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
        assigneeAvatarUrl,
        url: `${urlRoot}/browse/${issue?.key}`,
        updated: fields?.updated ?? '',
        parent: mapRelatedIssue(fields?.parent, urlRoot),
        children: mapRelatedIssues(fields?.subtasks, urlRoot),
    };
}
function mapRelatedIssues(rawList, urlRoot) {
    if (!Array.isArray(rawList) || rawList.length === 0) {
        return undefined;
    }
    const mapped = rawList
        .map((raw) => mapRelatedIssue(raw, urlRoot))
        .filter((related) => !!related);
    return mapped.length > 0 ? mapped : undefined;
}
function mapRelatedIssue(raw, urlRoot) {
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
    const assigneeName = fields.assignee?.displayName ??
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
async function fetchAccessibleProjects(authInfo, token) {
    const urlRoot = normalizeBaseUrl(authInfo.baseUrl);
    const endpoints = buildRestApiEndpoints(urlRoot, authInfo.serverLabel, 'project/search');
    let lastError;
    for (const endpoint of endpoints) {
        try {
            const response = await axios_1.default.get(endpoint, {
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
            return projects.map((project) => ({
                id: project.id,
                key: project.key,
                name: project.name ?? 'Untitled',
                typeKey: project.projectTypeKey,
                url: `${urlRoot}/browse/${project.key}`,
            }));
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
function deriveErrorMessage(error) {
    if (axios_1.default.isAxiosError(error)) {
        const axiosError = error;
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
const API_VERSION_PRIORITY = {
    cloud: ['3', 'latest', '2'],
    custom: ['latest', '2', '3'],
};
function buildRestApiEndpoints(baseUrl, preference, ...resources) {
    const orderedVersions = API_VERSION_PRIORITY[preference];
    const seen = new Set();
    const endpoints = [];
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
function inferServerLabelFromProfile(profile) {
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
function shouldFallbackToGet(error) {
    if (!axios_1.default.isAxiosError(error)) {
        return false;
    }
    const status = error.response?.status;
    return status === 410 || status === 404 || status === 405;
}
function expandBaseUrlCandidates(baseUrl) {
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
    }
    catch {
        // ignore invalid URLs (should not happen due to validation)
    }
    return candidates;
}
//# sourceMappingURL=extension.js.map
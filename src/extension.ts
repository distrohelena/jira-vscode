import * as vscode from 'vscode';

import { initializeEnvironment } from './environment';
import { JiraAuthManager } from './model/authManager';
import { JiraFocusManager } from './model/focusManager';
import { createIssueController } from './controllers/issueController';
import { createCreateIssueController } from './controllers/createIssueController';
import { commitFromIssue } from './controllers/commitController';
import { JiraItemsTreeDataProvider } from './views/tree/itemsTreeDataProvider';
import { JiraProjectsTreeDataProvider } from './views/tree/projectsTreeDataProvider';
import { JiraSettingsTreeDataProvider } from './views/tree/settingsTreeDataProvider';
import { JiraIssue, JiraProject } from './model/types';
import { JiraTreeItem } from './views/tree/treeItems';

export async function activate(context: vscode.ExtensionContext) {
	initializeEnvironment(context.extensionUri);

	const authManager = new JiraAuthManager(context);
	const focusManager = new JiraFocusManager(context, authManager);

	const projectsProvider = new JiraProjectsTreeDataProvider(context, authManager, focusManager);
	const itemsProvider = new JiraItemsTreeDataProvider(context, authManager, focusManager);
	const settingsProvider = new JiraSettingsTreeDataProvider(authManager, focusManager);

	const projectsView = vscode.window.createTreeView('jiraProjectsView', {
		treeDataProvider: projectsProvider,
	});
	projectsProvider.bindView(projectsView);

	const itemsView = vscode.window.createTreeView('jiraItemsView', {
		treeDataProvider: itemsProvider,
	});
	itemsProvider.bindView(itemsView);

	const settingsView = vscode.window.createTreeView('jiraSettingsView', {
		treeDataProvider: settingsProvider,
	});
	settingsProvider.bindView(settingsView);

	const refreshAll = () => {
		projectsProvider.refresh();
		settingsProvider.refresh();
		itemsProvider.refresh();
	};

	const issueController = createIssueController({ authManager, refreshAll });
	const issueCreationController = createCreateIssueController({
		authManager,
		focusManager,
		refreshItemsView: () => itemsProvider.refresh(),
		openIssueDetails: issueController.openIssueDetails,
	});

	const authChangeDisposable = authManager.onDidChangeAuth(() => {
		refreshAll();
	});

	context.subscriptions.push(
		authManager,
		authChangeDisposable,
		projectsView,
		itemsView,
		settingsView,
		vscode.commands.registerCommand('jira.login', async () => {
			await authManager.login();
			refreshAll();
		}),
		vscode.commands.registerCommand('jira.logout', async () => {
			await authManager.logout();
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
		vscode.commands.registerCommand('jira.searchItems', async () => {
			await itemsProvider.openRecentItemsSearch();
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
			await issueCreationController.createIssue();
		}),
		vscode.commands.registerCommand('jira.openIssueDetails', async (issueOrKey?: JiraIssue | string) => {
			await issueController.openIssueDetails(issueOrKey);
		}),
		vscode.commands.registerCommand('jira.commitFromIssue', async (node?: JiraTreeItem) => {
			await commitFromIssue(node);
		})
	);
}

export function deactivate() {
	// nothing to clean up yet
}

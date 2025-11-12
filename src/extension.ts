import * as vscode from 'vscode';

import { initializeEnvironment } from './environment';
import { JiraAuthManager } from './model/authManager';
import { JiraFocusManager } from './model/focusManager';
import { ProjectStatusStore } from './model/projectStatusStore';
import { IssueTransitionStore } from './model/issueTransitionStore';
import { ProjectTransitionPrefetcher } from './model/projectTransitionPrefetcher';
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
	const projectStatusStore = new ProjectStatusStore(authManager);
	const issueTransitionStore = new IssueTransitionStore();
	const transitionPrefetcher = new ProjectTransitionPrefetcher(authManager, projectStatusStore, issueTransitionStore);

	const projectsProvider = new JiraProjectsTreeDataProvider(context, authManager, focusManager);
	const itemsProvider = new JiraItemsTreeDataProvider(context, authManager, focusManager, transitionPrefetcher);
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

	const issueController = createIssueController({
		authManager,
		refreshAll,
		projectStatusStore,
		transitionStore: issueTransitionStore,
		transitionPrefetcher,
	});
	const issueCreationController = createCreateIssueController({
		authManager,
		focusManager,
		projectStatusStore,
		refreshItemsView: () => itemsProvider.refresh(),
		openIssueDetails: issueController.openIssueDetails,
	});

	const warmProjectCaches = (projectKey: string | undefined) => {
		if (!projectKey) {
			return;
		}
		void projectStatusStore.ensure(projectKey);
		void projectStatusStore.ensureAllIssueTypeStatuses(projectKey);
		transitionPrefetcher.prefetch(projectKey);
	};

	const authChangeDisposable = authManager.onDidChangeAuth(() => {
		projectStatusStore.clear();
		issueTransitionStore.clear();
		const selected = focusManager.getSelectedProject();
		if (selected) {
			warmProjectCaches(selected.key);
		}
		refreshAll();
	});

	const initiallySelectedProject = focusManager.getSelectedProject();
	if (initiallySelectedProject) {
		warmProjectCaches(initiallySelectedProject.key);
	}

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
			const selected = focusManager.getSelectedProject();
			if (selected) {
				warmProjectCaches(selected.key);
			}
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

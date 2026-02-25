import * as vscode from 'vscode';

import { EnvironmentRuntime } from './environment.runtime';
import { JiraAuthManager } from './model/auth.manager';
import { JiraFocusManager } from './model/focus.manager';
import { ProjectStatusStore } from './model/project-status.store';
import { IssueTransitionStore } from './model/issue-transition.store';
import { ProjectTransitionPrefetcher } from './model/project-transition.prefetcher';
import { IssueControllerFactory } from './controllers/issue.controller';
import { CreateIssueControllerFactory } from './controllers/create-issue.controller';
import { CommitController } from './controllers/commit.controller';
import { JiraItemsTreeDataProvider } from './views/tree/items-tree-data.provider';
import { JiraProjectsTreeDataProvider } from './views/tree/projects-tree-data.provider';
import { JiraSettingsTreeDataProvider } from './views/tree/settings-tree-data.provider';
import { JiraIssue, JiraProject } from './model/jira.type';
import { JiraTreeItem } from './views/tree/tree-item.view';

class ExtensionEntrypoint {
	static async activate(context: vscode.ExtensionContext): Promise<void> {
		EnvironmentRuntime.initializeEnvironment(context.extensionUri);

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

		const issueController = IssueControllerFactory.create({
		authManager,
		refreshAll,
		projectStatusStore,
		transitionStore: issueTransitionStore,
		transitionPrefetcher,
	});
		const issueCreationController = CreateIssueControllerFactory.create({
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
		void authManager.ensureCredentialValidation(true);
		refreshAll();
	});
	const credentialValidationDisposable = authManager.onDidChangeCredentialValidation(() => {
		refreshAll();
	});

	const initiallySelectedProject = focusManager.getSelectedProject();
	if (initiallySelectedProject) {
		warmProjectCaches(initiallySelectedProject.key);
	}
	void authManager.ensureCredentialValidation(false);

	context.subscriptions.push(
		authManager,
		authChangeDisposable,
		credentialValidationDisposable,
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
		vscode.commands.registerCommand('jira.validateCredentials', async () => {
			await authManager.validateStoredCredentials({
				showSuccessMessage: true,
				promptReLogin: true,
				silent: false,
				force: true,
			});
			refreshAll();
		}),
		vscode.commands.registerCommand('jira.showAllProjects', async () => {
			await projectsProvider.showAllProjects();
		}),
		vscode.commands.registerCommand('jira.showRecentProjects', async () => {
			await projectsProvider.showRecentProjects();
		}),
		vscode.commands.registerCommand('jira.showFavoriteProjects', async () => {
			await projectsProvider.showFavoriteProjects();
		}),
		vscode.commands.registerCommand('jira.showAllItems', async () => {
			await itemsProvider.showAllItems();
		}),
		vscode.commands.registerCommand('jira.showAssignedItems', async () => {
			await itemsProvider.showAssignedItems();
		}),
		vscode.commands.registerCommand('jira.showUnassignedItems', async () => {
			await itemsProvider.showUnassignedItems();
		}),
		vscode.commands.registerCommand('jira.showRecentItems', async () => {
			await itemsProvider.showAssignedItems();
		}),
		vscode.commands.registerCommand('jira.groupItemsByNone', async () => {
			await itemsProvider.setGroupMode('none');
		}),
		vscode.commands.registerCommand('jira.groupItemsByStatus', async () => {
			await itemsProvider.setGroupMode('status');
		}),
		vscode.commands.registerCommand('jira.groupItemsByType', async () => {
			await itemsProvider.setGroupMode('type');
		}),
		vscode.commands.registerCommand('jira.sortItemsByDate', async () => {
			await itemsProvider.setSortMode('date');
		}),
		vscode.commands.registerCommand('jira.sortItemsByLastUpdate', async () => {
			await itemsProvider.setSortMode('lastUpdate');
		}),
		vscode.commands.registerCommand('jira.sortItemsByAlphabetical', async () => {
			await itemsProvider.setSortMode('alphabetical');
		}),
		vscode.commands.registerCommand('jira.searchItems', async () => {
			await itemsProvider.openItemsFilter();
		}),
		vscode.commands.registerCommand('jira.remoteSearchItems', async () => {
			await itemsProvider.openItemsSearch();
		}),
		vscode.commands.registerCommand('jira.loadMoreItems', async () => {
			await itemsProvider.loadMoreItems();
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
		vscode.commands.registerCommand('jira.addProjectFavorite', async (node?: JiraTreeItem) => {
			await projectsProvider.favoriteProject(node?.project);
		}),
		vscode.commands.registerCommand('jira.removeProjectFavorite', async (node?: JiraTreeItem) => {
			await projectsProvider.unfavoriteProject(node?.project);
		}),
		vscode.commands.registerCommand('jira.createIssue', async () => {
			await issueCreationController.createIssue();
		}),
		vscode.commands.registerCommand('jira.openIssueDetails', async (issueOrKey?: JiraIssue | string) => {
			await issueController.openIssueDetails(issueOrKey);
		}),
			vscode.commands.registerCommand('jira.commitFromIssue', async (node?: JiraTreeItem) => {
				await CommitController.commitFromIssue(node);
			})
		);
	}
	static deactivate(): void {
		// nothing to clean up yet
	}
}

export const activate = ExtensionEntrypoint.activate;
export const deactivate = ExtensionEntrypoint.deactivate;

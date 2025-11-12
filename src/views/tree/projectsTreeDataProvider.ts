import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/authManager';
import { JiraFocusManager } from '../../model/focusManager';
import { PROJECTS_VIEW_MODE_CONTEXT, PROJECTS_VIEW_MODE_KEY } from '../../model/constants';
import { fetchAccessibleProjects, fetchRecentProjects } from '../../model/jiraApiClient';
import { JiraAuthInfo, JiraProject, ProjectsViewMode } from '../../model/types';
import { deriveErrorMessage } from '../../shared/errors';
import { extractHost } from '../../shared/urlUtils';
import { JiraTreeItem } from './treeItems';
import { JiraTreeDataProvider } from './baseTreeDataProvider';

export class JiraProjectsTreeDataProvider extends JiraTreeDataProvider {
	private viewMode: ProjectsViewMode;

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager
	) {
		super(authManager, focusManager);
		const stored = this.extensionContext.workspaceState.get<ProjectsViewMode>(PROJECTS_VIEW_MODE_KEY);
		this.viewMode = stored === 'all' ? 'all' : 'recent';
		void this.updateViewModeContext();
	}

	async showAllProjects(): Promise<void> {
		await this.setViewMode('all');
	}

	async showRecentProjects(): Promise<void> {
		await this.setViewMode('recent');
	}

	protected getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		return this.loadProjects(authInfo);
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
			this.updateBadge();
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

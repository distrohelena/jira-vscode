import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/authManager';
import { JiraFocusManager } from '../../model/focusManager';
import { PROJECT_FAVORITES_KEY, PROJECTS_VIEW_MODE_CONTEXT, PROJECTS_VIEW_MODE_KEY } from '../../model/constants';
import { fetchAccessibleProjects, fetchRecentProjects } from '../../model/jiraApiClient';
import { JiraAuthInfo, JiraProject, ProjectsViewMode } from '../../model/types';
import { deriveErrorMessage } from '../../shared/errors';
import { extractHost } from '../../shared/urlUtils';
import { JiraTreeItem } from './treeItems';
import { JiraTreeDataProvider } from './baseTreeDataProvider';

export class JiraProjectsTreeDataProvider extends JiraTreeDataProvider {
	private viewMode: ProjectsViewMode;
	private favoriteProjects: Map<string, JiraProject>;

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager
	) {
		super(authManager, focusManager);
		const stored = this.extensionContext.workspaceState.get<ProjectsViewMode>(PROJECTS_VIEW_MODE_KEY);
		this.viewMode = stored === 'all' || stored === 'favorites' ? stored : 'recent';
		const storedFavorites = this.extensionContext.workspaceState.get<JiraProject[]>(PROJECT_FAVORITES_KEY, []);
		this.favoriteProjects = new Map(
			(storedFavorites ?? [])
				.filter((project): project is JiraProject => Boolean(project?.key))
				.map((project) => [project.key, project])
		);
		void this.updateViewModeContext();
	}

	async showAllProjects(): Promise<void> {
		await this.setViewMode('all');
	}

	async showRecentProjects(): Promise<void> {
		await this.setViewMode('recent');
	}

	async showFavoriteProjects(): Promise<void> {
		await this.setViewMode('favorites');
	}

	async favoriteProject(project?: JiraProject): Promise<void> {
		if (!project?.key) {
			return;
		}
		this.favoriteProjects.set(project.key, {
			id: project.id,
			key: project.key,
			name: project.name,
			typeKey: project.typeKey,
			url: project.url,
		});
		await this.persistFavorites();
		this.refresh();
	}

	async unfavoriteProject(project?: JiraProject): Promise<void> {
		if (!project?.key) {
			return;
		}
		if (!this.favoriteProjects.has(project.key)) {
			return;
		}
		this.favoriteProjects.delete(project.key);
		await this.persistFavorites();
		this.refresh();
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

	private getFavoriteProjectList(): JiraProject[] {
		return Array.from(this.favoriteProjects.values()).sort((a, b) =>
			(a.name ?? a.key).localeCompare(b.name ?? b.key, undefined, { sensitivity: 'base' })
		);
	}

	private async persistFavorites(): Promise<void> {
		await this.extensionContext.workspaceState.update(
			PROJECT_FAVORITES_KEY,
			Array.from(this.favoriteProjects.values())
		);
	}

	private refreshFavoriteMetadata(projects: JiraProject[]): void {
		let changed = false;
		for (const project of projects) {
			if (!project?.key) {
				continue;
			}
			if (this.favoriteProjects.has(project.key)) {
				const stored = this.favoriteProjects.get(project.key);
				if (
					!stored ||
					stored.id !== project.id ||
					stored.name !== project.name ||
					stored.typeKey !== project.typeKey ||
					stored.url !== project.url
				) {
					this.favoriteProjects.set(project.key, {
						id: project.id,
						key: project.key,
						name: project.name,
						typeKey: project.typeKey,
						url: project.url,
					});
					changed = true;
				}
			}
		}
		if (changed) {
			void this.persistFavorites();
		}
	}

	private async loadProjects(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		const showingFavorites = this.viewMode === 'favorites';
		const token = await this.authManager.getToken();
		if (!token && !showingFavorites) {
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
			let projects: JiraProject[] = [];
			if (showingFavorites) {
				projects = this.getFavoriteProjectList();
			} else if (showingRecent) {
				projects = await fetchRecentProjects(authInfo, token!);
			} else {
				projects = await fetchAccessibleProjects(authInfo, token!);
			}

			if (!showingFavorites) {
				this.refreshFavoriteMetadata(projects);
			}

			this.updateBadge();
			const host = extractHost(authInfo.baseUrl);
			const description = host
				? showingRecent
					? `${host} • recent`
					: showingFavorites
					? `${host} • favorites`
					: host
				: showingRecent
				? 'recent projects'
				: showingFavorites
				? 'favorite projects'
				: undefined;
			this.updateDescription(description);

			if (projects.length === 0) {
				return [
					new JiraTreeItem(
						'info',
						showingFavorites
							? 'No favorite projects yet. Right-click a project and choose Favorite Project.'
							: showingRecent
							? 'No recent projects. Use Show All to see everything.'
							: 'No projects available.',
						vscode.TreeItemCollapsibleState.None
					),
				];
			}

			const selectedProject = this.focusManager.getSelectedProject();
			const nodes = projects.map((project) => {
				if (!project?.key) {
					return undefined;
				}
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
				const isFavorite = this.favoriteProjects.has(project.key);
				item.project = project;
				item.iconPath = isSelected
					? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
					: isFavorite
					? new vscode.ThemeIcon('star-full')
					: new vscode.ThemeIcon('repo');
				item.description = isSelected ? `${project.key} • focused` : project.key;
				item.tooltip = project.name ? `${project.name} (${project.key})` : project.key;
				item.contextValue = isFavorite ? 'jiraProjectFavorite' : 'jiraProject';
				return item;
			}).filter((item): item is JiraTreeItem => Boolean(item));

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

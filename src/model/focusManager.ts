import * as vscode from 'vscode';

import { JiraAuthManager } from './authManager';
import { fetchAccessibleProjects } from './jiraApiClient';
import { SELECTED_PROJECT_KEY } from './constants';
import { deriveErrorMessage } from '../shared/errors';
import { JiraAuthInfo, JiraProject, SelectedProjectInfo } from './types';

export class JiraFocusManager {
	constructor(private readonly context: vscode.ExtensionContext, private readonly authManager: JiraAuthManager) {}

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
				const selected = selection.project;
				await this.saveSelectedProject({
					key: selected.key,
					name: selected.name,
					typeKey: selected.typeKey,
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

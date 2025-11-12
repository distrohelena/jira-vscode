import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/authManager';
import { JiraFocusManager } from '../../model/focusManager';
import {
	ITEMS_SEARCH_QUERY_KEY,
	ITEMS_VIEW_MODE_CONTEXT,
	ITEMS_VIEW_MODE_KEY,
	RECENT_ITEMS_LIMIT,
} from '../../model/constants';
import { fetchProjectIssues } from '../../model/jiraApiClient';
import {
	determineStatusCategory,
	filterIssuesRelatedToUser,
	groupIssuesByStatus,
	sortIssuesByUpdatedDesc,
} from '../../model/issueModel';
import { JiraAuthInfo, JiraIssue, ItemsViewMode } from '../../model/types';
import { deriveErrorMessage } from '../../shared/errors';
import { JiraTreeDataProvider } from './baseTreeDataProvider';
import { JiraTreeItem, createIssueTreeItem, deriveIssueIcon } from './treeItems';

export class JiraItemsTreeDataProvider extends JiraTreeDataProvider {
	private viewMode: ItemsViewMode;
	private searchQuery: string;

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager
	) {
		super(authManager, focusManager);
		const stored = this.extensionContext.workspaceState.get<ItemsViewMode>(ITEMS_VIEW_MODE_KEY);
		this.viewMode = stored === 'all' ? 'all' : 'recent';
		const storedSearch = this.extensionContext.workspaceState.get<string>(ITEMS_SEARCH_QUERY_KEY) ?? '';
		this.searchQuery = storedSearch.trim();
		void this.updateViewModeContext();
	}

	async showAllItems(): Promise<void> {
		await this.setViewMode('all');
	}

	async showRecentItems(): Promise<void> {
		await this.setViewMode('recent');
	}

	async openRecentItemsSearch(): Promise<void> {
		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			await vscode.window.showInformationMessage('Select a project before searching items.');
			return;
		}

		if (this.viewMode !== 'recent') {
			const switchLabel = 'Switch to Recent';
			const choice = await vscode.window.showInformationMessage(
				'Search is available for your recent items. Switch the Items view to Recent?',
				switchLabel,
				'Cancel'
			);
			if (choice === switchLabel) {
				await this.setViewMode('recent');
			} else {
				return;
			}
		}

		const projectLabel = selectedProject.name
			? `${selectedProject.name} (${selectedProject.key})`
			: selectedProject.key;

		const input = await vscode.window.showInputBox({
			title: projectLabel ? `Filter Recent Items (${projectLabel})` : 'Filter Recent Items',
			placeHolder: 'Type to filter by issue key, summary, status, or assignee',
			prompt: 'Leave empty to clear the filter.',
			value: this.searchQuery,
			ignoreFocusOut: true,
		});

		if (input === undefined) {
			return;
		}

		const trimmed = input.trim();
		this.searchQuery = trimmed;
		await this.extensionContext.workspaceState.update(ITEMS_SEARCH_QUERY_KEY, trimmed);
		this.refresh();
	}

	protected getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		return this.loadItems(authInfo);
	}

	private async setViewMode(mode: ItemsViewMode): Promise<void> {
		if (this.viewMode === mode) {
			return;
		}
		this.viewMode = mode;
		await this.extensionContext.workspaceState.update(ITEMS_VIEW_MODE_KEY, mode);
		if (mode !== 'recent') {
			this.searchQuery = '';
			await this.extensionContext.workspaceState.update(ITEMS_SEARCH_QUERY_KEY, '');
		}
		await this.updateViewModeContext();
		this.refresh();
	}

	private updateViewModeContext(): Thenable<void> {
		return vscode.commands.executeCommand('setContext', ITEMS_VIEW_MODE_CONTEXT, this.viewMode);
	}

	private async loadItems(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
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

		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			this.updateBadge();
			this.updateDescription('No project selected');
			return [
				new JiraTreeItem(
				 'info',
				 'Select a project to see Jira issues.',
				 vscode.TreeItemCollapsibleState.None
				),
			];
		}

		const projectLabel = selectedProject.name
			? `${selectedProject.name} (${selectedProject.key})`
			: selectedProject.key;
		const showingRecent = this.viewMode === 'recent';
		const searchNode = showingRecent ? this.createSearchTreeItem(projectLabel) : undefined;
		const prependSearchNode = (items: JiraTreeItem[]): JiraTreeItem[] =>
			searchNode ? [searchNode, ...items] : items;

		try {
			const issues = await fetchProjectIssues(authInfo, token, selectedProject.key, {
				onlyAssignedToCurrentUser: showingRecent,
			});
			const sortedIssues = sortIssuesByUpdatedDesc(issues);
			const relevantIssues = showingRecent ? filterIssuesRelatedToUser(sortedIssues, authInfo) : sortedIssues;
			if (relevantIssues.length === 0) {
				const baseDescription = showingRecent ? `${projectLabel} • my latest` : projectLabel;
				const filtered = showingRecent && this.searchQuery.length > 0;
				const tooltip = this.buildInProgressTooltip(0, filtered, showingRecent);
				this.updateBadge(0, tooltip);
				this.updateDescription(
					showingRecent && this.searchQuery ? `${baseDescription} • filtered` : baseDescription
				);
				const emptyMessage =
					showingRecent && this.searchQuery
						? `No recent items match "${this.searchQuery}". Clear or edit the search to see more.`
						: showingRecent
						? 'No recent items assigned to you. Use Show All to list every issue.'
						: 'No issues in this project (latest 50 shown).';
				return prependSearchNode([
					new JiraTreeItem('info', emptyMessage, vscode.TreeItemCollapsibleState.None),
				]);
			}

			const limitedIssues = showingRecent ? relevantIssues.slice(0, RECENT_ITEMS_LIMIT) : relevantIssues;
			const displayedIssues = showingRecent ? this.applySearchFilter(limitedIssues) : limitedIssues;

			const filtered = showingRecent && this.searchQuery.length > 0;
			const inProgressCount = this.countInProgressIssues(displayedIssues);
			const tooltip = this.buildInProgressTooltip(inProgressCount, filtered, showingRecent);
			this.updateBadge(inProgressCount, tooltip);
			if (showingRecent) {
				const baseDescription = `${projectLabel} • my latest`;
				this.updateDescription(filtered ? `${baseDescription} • filtered` : baseDescription);
			} else {
				this.updateDescription(projectLabel);
			}

			if (displayedIssues.length === 0) {
				const noMatchMessage = `No recent items match "${this.searchQuery}". Clear or edit the search to see more.`;
				return prependSearchNode([
					new JiraTreeItem('info', noMatchMessage, vscode.TreeItemCollapsibleState.None),
				]);
			}

			const groupedNodes = groupIssuesByStatus(displayedIssues).map((group) => {
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

			if (showingRecent && relevantIssues.length > limitedIssues.length) {
				const infoText = this.searchQuery
					? `Showing matches from the latest ${limitedIssues.length} of ${relevantIssues.length} of your issues. Use Show All to see more.`
					: `Showing latest ${limitedIssues.length} of ${relevantIssues.length} of your issues. Use Show All to see more.`;
				groupedNodes.push(
					new JiraTreeItem('info', infoText, vscode.TreeItemCollapsibleState.None)
				);
			}

			return prependSearchNode(groupedNodes);
		} catch (error) {
			const message = deriveErrorMessage(error);
			this.updateBadge();
			return prependSearchNode([
				new JiraTreeItem(
					'info',
					`Failed to load project issues: ${message}`,
					vscode.TreeItemCollapsibleState.None
				),
			]);
		}
	}

	private createSearchTreeItem(projectLabel?: string): JiraTreeItem {
		const hasQuery = this.searchQuery.length > 0;
		const item = new JiraTreeItem(
			'search',
			'Search recent items',
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'jira.searchItems',
				title: 'Search Items',
			}
		);
		item.iconPath = new vscode.ThemeIcon('search');
		item.description = hasQuery ? this.searchQuery : 'Type to filter';
		item.tooltip = hasQuery
			? `Filtering recent items${projectLabel ? ` in ${projectLabel}` : ''} by "${this.searchQuery}". Click to update or clear.`
			: `Click to filter your recent items${projectLabel ? ` in ${projectLabel}` : ''}.`;
		item.contextValue = 'jiraItemsSearch';
		return item;
	}

	private applySearchFilter(issues: JiraIssue[]): JiraIssue[] {
		const query = this.searchQuery.toLowerCase();
		if (!query) {
			return issues;
		}
		return issues.filter((issue) => {
			const values = [
				issue.key,
				issue.summary,
				issue.statusName,
				issue.assigneeName,
				issue.assigneeUsername,
			];
			return values.some((value) => value?.toLowerCase().includes(query));
		});
	}

	private countInProgressIssues(issues: JiraIssue[]): number {
		return issues.reduce((count, issue) => {
			return determineStatusCategory(issue.statusName) === 'inProgress' ? count + 1 : count;
		}, 0);
	}

	private buildInProgressTooltip(count: number, filtered: boolean, showingRecent: boolean): string {
		if (filtered) {
			return count === 1 ? '1 matching in-progress issue' : `${count} matching in-progress issues`;
		}
		if (showingRecent) {
			return count === 1 ? '1 in-progress issue (recent)' : `${count} in-progress issues (recent)`;
		}
		return count === 1 ? '1 in-progress issue' : `${count} in-progress issues`;
	}
}

import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/authManager';
import { JiraFocusManager } from '../../model/focusManager';
import { ProjectTransitionPrefetcher } from '../../model/projectTransitionPrefetcher';
import {
	ITEMS_GROUP_MODE_CONTEXT,
	ITEMS_GROUP_MODE_KEY,
	ITEMS_SEARCH_QUERY_KEY,
	ITEMS_VIEW_MODE_CONTEXT,
	ITEMS_VIEW_MODE_KEY,
} from '../../model/constants';
import { fetchProjectIssues } from '../../model/jiraApiClient';
import {
	determineStatusCategory,
	filterIssuesRelatedToUser,
	groupIssuesByStatus,
	sortIssuesByUpdatedDesc,
} from '../../model/issueModel';
import { JiraAuthInfo, JiraIssue, ItemsGroupMode, ItemsViewMode } from '../../model/types';
import { deriveErrorMessage } from '../../shared/errors';
import { JiraTreeDataProvider } from './baseTreeDataProvider';
import { JiraTreeItem, createIssueTreeItem, deriveIssueIcon } from './treeItems';

export class JiraItemsTreeDataProvider extends JiraTreeDataProvider {
	private viewMode: ItemsViewMode;
	private searchQuery: string;
	private groupMode: ItemsGroupMode;

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager,
		private readonly transitionPrefetcher: ProjectTransitionPrefetcher
	) {
		super(authManager, focusManager);
		const stored = this.extensionContext.workspaceState.get<string>(ITEMS_VIEW_MODE_KEY);
		this.viewMode = stored === 'all' ? 'all' : 'assigned';
		if (stored === 'recent') {
			void this.extensionContext.workspaceState.update(ITEMS_VIEW_MODE_KEY, 'assigned');
		}
		const storedGroup = this.extensionContext.workspaceState.get<ItemsGroupMode>(ITEMS_GROUP_MODE_KEY);
		this.groupMode = storedGroup === 'none' || storedGroup === 'type' ? storedGroup : 'status';
		const storedSearch = this.extensionContext.workspaceState.get<string>(ITEMS_SEARCH_QUERY_KEY) ?? '';
		this.searchQuery = storedSearch.trim();
		void this.updateViewModeContext();
		void this.updateGroupModeContext();
	}

	async showAllItems(): Promise<void> {
		await this.setViewMode('all');
	}

	async showAssignedItems(): Promise<void> {
		await this.setViewMode('assigned');
	}

	async setGroupMode(mode: ItemsGroupMode): Promise<void> {
		if (this.groupMode === mode) {
			return;
		}
		this.groupMode = mode;
		await this.extensionContext.workspaceState.update(ITEMS_GROUP_MODE_KEY, mode);
		await this.updateGroupModeContext();
		this.refresh();
	}

	async openAssignedItemsSearch(): Promise<void> {
		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			await vscode.window.showInformationMessage('Select a project before searching items.');
			return;
		}

		if (this.viewMode !== 'assigned') {
			const switchLabel = 'Switch to Assigned';
			const choice = await vscode.window.showInformationMessage(
				'Search is available for your assigned items. Switch the Items view to Assigned?',
				switchLabel,
				'Cancel'
			);
			if (choice === switchLabel) {
				await this.setViewMode('assigned');
			} else {
				return;
			}
		}

		const projectLabel = selectedProject.name
			? `${selectedProject.name} (${selectedProject.key})`
			: selectedProject.key;

		const input = await vscode.window.showInputBox({
			title: projectLabel ? `Filter Assigned Items (${projectLabel})` : 'Filter Assigned Items',
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
		if (mode !== 'assigned') {
			this.searchQuery = '';
			await this.extensionContext.workspaceState.update(ITEMS_SEARCH_QUERY_KEY, '');
		}
		await this.updateViewModeContext();
		this.refresh();
	}

	private updateViewModeContext(): Thenable<void> {
		return vscode.commands.executeCommand('setContext', ITEMS_VIEW_MODE_CONTEXT, this.viewMode);
	}

	private updateGroupModeContext(): Thenable<void> {
		return vscode.commands.executeCommand('setContext', ITEMS_GROUP_MODE_CONTEXT, this.groupMode);
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
		const showingAssigned = this.viewMode === 'assigned';
		const searchNode = showingAssigned ? this.createSearchTreeItem(projectLabel) : undefined;
		const prependSearchNode = (items: JiraTreeItem[]): JiraTreeItem[] =>
			searchNode ? [searchNode, ...items] : items;

		try {
			const issues = await fetchProjectIssues(authInfo, token, selectedProject.key, {
				onlyAssignedToCurrentUser: showingAssigned,
			});
			const sortedIssues = sortIssuesByUpdatedDesc(issues);
			const relevantIssues = showingAssigned
				? filterIssuesRelatedToUser(sortedIssues, authInfo).filter(
						(issue) => determineStatusCategory(issue.statusName) !== 'done'
				  )
				: sortedIssues;
			if (relevantIssues.length === 0) {
				const baseDescription = showingAssigned ? `${projectLabel} • assigned to me` : projectLabel;
				const filtered = showingAssigned && this.searchQuery.length > 0;
				const tooltip = this.buildInProgressTooltip(0, filtered, showingAssigned);
				this.updateBadge(0, tooltip);
				this.updateDescription(
					showingAssigned && this.searchQuery ? `${baseDescription} • filtered` : baseDescription
				);
				const emptyMessage =
					showingAssigned && this.searchQuery
						? `No assigned items match "${this.searchQuery}". Clear or edit the search to see more.`
						: showingAssigned
						? 'No active assigned items. Use Show All to list every issue.'
						: 'No issues in this project.';
				return prependSearchNode([
					new JiraTreeItem('info', emptyMessage, vscode.TreeItemCollapsibleState.None),
				]);
			}

			this.transitionPrefetcher.prefetchIssues(selectedProject.key, relevantIssues);
			const displayedIssues = showingAssigned ? this.applySearchFilter(relevantIssues) : relevantIssues;

			const filtered = showingAssigned && this.searchQuery.length > 0;
			const inProgressCount = this.countInProgressIssues(displayedIssues);
			const tooltip = this.buildInProgressTooltip(inProgressCount, filtered, showingAssigned);
			this.updateBadge(inProgressCount, tooltip);
			if (showingAssigned) {
				const baseDescription = `${projectLabel} • assigned to me`;
				this.updateDescription(filtered ? `${baseDescription} • filtered` : baseDescription);
			} else {
				this.updateDescription(projectLabel);
			}

			if (displayedIssues.length === 0) {
				const noMatchMessage = `No assigned items match "${this.searchQuery}". Clear or edit the search to see more.`;
				return prependSearchNode([
					new JiraTreeItem('info', noMatchMessage, vscode.TreeItemCollapsibleState.None),
				]);
			}

			const issueNodes = this.buildIssueNodes(displayedIssues);
			return prependSearchNode(issueNodes);
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

	private buildIssueNodes(issues: JiraIssue[]): JiraTreeItem[] {
		switch (this.groupMode) {
			case 'none':
				return issues.map((issue) => createIssueTreeItem(issue));
			case 'type':
				return this.buildTypeGroupNodes(issues);
			case 'status':
			default:
				return this.buildStatusGroupNodes(issues);
		}
	}

	private buildStatusGroupNodes(issues: JiraIssue[]): JiraTreeItem[] {
		return groupIssuesByStatus(issues).map((group) => {
			const childNodes = group.issues.map((issue) => createIssueTreeItem(issue));
			const label = group.issues.length > 0 ? `${group.statusName} (${group.issues.length})` : group.statusName;
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
	}

	private buildTypeGroupNodes(issues: JiraIssue[]): JiraTreeItem[] {
		return this.groupIssuesByType(issues).map((group) => {
			const childNodes = group.issues.map((issue) => createIssueTreeItem(issue));
			const label = group.issues.length > 0 ? `${group.typeName} (${group.issues.length})` : group.typeName;
			const groupItem = new JiraTreeItem(
				'typeGroup',
				label,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				undefined,
				childNodes
			);
			groupItem.iconPath = new vscode.ThemeIcon('symbol-class');
			groupItem.tooltip =
				group.issues.length === 1
					? `1 issue in ${group.typeName}`
					: `${group.issues.length} issues in ${group.typeName}`;
			return groupItem;
		});
	}

	private groupIssuesByType(issues: JiraIssue[]): Array<{ typeName: string; issues: JiraIssue[] }> {
		const groups = new Map<string, { typeName: string; issues: JiraIssue[] }>();
		for (const issue of issues) {
			const typeName = issue.issueTypeName?.trim() || 'Other';
			const key = typeName.toLowerCase();
			let entry = groups.get(key);
			if (!entry) {
				entry = { typeName, issues: [] };
				groups.set(key, entry);
			}
			entry.issues.push(issue);
		}
		return Array.from(groups.values()).sort((a, b) => a.typeName.localeCompare(b.typeName));
	}

	private createSearchTreeItem(projectLabel?: string): JiraTreeItem {
		const hasQuery = this.searchQuery.length > 0;
		const item = new JiraTreeItem(
			'search',
			'Search assigned items',
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'jira.searchItems',
				title: 'Search Items',
			}
		);
		item.iconPath = new vscode.ThemeIcon('search');
		item.description = hasQuery ? this.searchQuery : 'Type to filter';
		item.tooltip = hasQuery
			? `Filtering assigned items${projectLabel ? ` in ${projectLabel}` : ''} by "${this.searchQuery}". Click to update or clear.`
			: `Click to filter your assigned items${projectLabel ? ` in ${projectLabel}` : ''}.`;
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

	private buildInProgressTooltip(count: number, filtered: boolean, showingAssigned: boolean): string {
		if (filtered) {
			return count === 1 ? '1 matching in-progress issue' : `${count} matching in-progress issues`;
		}
		if (showingAssigned) {
			return count === 1 ? '1 in-progress issue (assigned)' : `${count} in-progress issues (assigned)`;
		}
		return count === 1 ? '1 in-progress issue' : `${count} in-progress issues`;
	}
}

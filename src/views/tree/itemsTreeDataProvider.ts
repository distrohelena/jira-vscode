import * as vscode from 'vscode';

import { JiraAuthManager } from '../../model/authManager';
import { JiraFocusManager } from '../../model/focusManager';
import { ProjectTransitionPrefetcher } from '../../model/projectTransitionPrefetcher';
import {
	ITEMS_LOAD_BATCH_SIZE,
	ITEMS_GROUP_MODE_CONTEXT,
	ITEMS_GROUP_MODE_KEY,
	ITEMS_REMOTE_SEARCH_QUERY_KEY,
	ITEMS_SEARCH_QUERY_KEY,
	ITEMS_SORT_MODE_CONTEXT,
	ITEMS_SORT_MODE_KEY,
	ITEMS_VIEW_MODE_CONTEXT,
	ITEMS_VIEW_MODE_KEY,
} from '../../model/constants';
import { fetchProjectIssuesPage } from '../../model/jiraApiClient';
import {
	determineStatusCategory,
	filterIssuesRelatedToUser,
	groupIssuesByStatus,
} from '../../model/issueModel';
import { JiraAuthInfo, JiraIssue, ItemsGroupMode, ItemsSortMode, ItemsViewMode } from '../../model/types';
import { deriveErrorMessage } from '../../shared/errors';
import { JiraTreeDataProvider } from './baseTreeDataProvider';
import { JiraTreeItem, createIssueTreeItem, deriveIssueIcon } from './treeItems';

export class JiraItemsTreeDataProvider extends JiraTreeDataProvider {
	private viewMode: ItemsViewMode;
	private searchQuery: string;
	private remoteSearchQuery: string;
	private groupMode: ItemsGroupMode;
	private sortMode: ItemsSortMode;
	private forceRemoteReload = true;
	private pendingLoadMore = false;
	private issueCache?: {
		projectKey: string;
		viewMode: ItemsViewMode;
		remoteSearchQuery: string;
		issues: JiraIssue[];
		hasMore: boolean;
		nextStartAt?: number;
		nextPageToken?: string;
	};

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		authManager: JiraAuthManager,
		focusManager: JiraFocusManager,
		private readonly transitionPrefetcher: ProjectTransitionPrefetcher
	) {
		super(authManager, focusManager);
		const stored = this.extensionContext.workspaceState.get<string>(ITEMS_VIEW_MODE_KEY);
		this.viewMode = stored === 'all' || stored === 'unassigned' ? stored : 'assigned';
		if (stored === 'recent') {
			void this.extensionContext.workspaceState.update(ITEMS_VIEW_MODE_KEY, 'assigned');
		}
		const storedGroup = this.extensionContext.workspaceState.get<ItemsGroupMode>(ITEMS_GROUP_MODE_KEY);
		this.groupMode = storedGroup === 'none' || storedGroup === 'type' ? storedGroup : 'status';
		const storedSort = this.extensionContext.workspaceState.get<ItemsSortMode>(ITEMS_SORT_MODE_KEY);
		this.sortMode =
			storedSort === 'alphabetical' || storedSort === 'lastUpdate' ? storedSort : 'date';
		const storedSearch = this.extensionContext.workspaceState.get<string>(ITEMS_SEARCH_QUERY_KEY) ?? '';
		this.searchQuery = storedSearch.trim();
		const storedRemoteSearch =
			this.extensionContext.workspaceState.get<string>(ITEMS_REMOTE_SEARCH_QUERY_KEY) ?? '';
		this.remoteSearchQuery = storedRemoteSearch.trim();
		void this.updateViewModeContext();
		void this.updateGroupModeContext();
		void this.updateSortModeContext();
	}

	async showAllItems(): Promise<void> {
		await this.setViewMode('all');
	}

	async showAssignedItems(): Promise<void> {
		await this.setViewMode('assigned');
	}

	async showUnassignedItems(): Promise<void> {
		await this.setViewMode('unassigned');
	}

	async loadMoreItems(): Promise<void> {
		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			return;
		}
		if (
			!this.issueCache ||
			this.issueCache.projectKey !== selectedProject.key ||
			this.issueCache.viewMode !== this.viewMode ||
			this.issueCache.remoteSearchQuery !== this.remoteSearchQuery ||
			!this.issueCache.hasMore
		) {
			return;
		}
		this.pendingLoadMore = true;
		this.refresh();
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

	async setSortMode(mode: ItemsSortMode): Promise<void> {
		if (this.sortMode === mode) {
			return;
		}
		this.sortMode = mode;
		await this.extensionContext.workspaceState.update(ITEMS_SORT_MODE_KEY, mode);
		await this.updateSortModeContext();
		this.refreshFromCache();
	}

	async openItemsFilter(): Promise<void> {
		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			await vscode.window.showInformationMessage('Select a project before filtering items.');
			return;
		}

		if (this.viewMode === 'all') {
			const switchLabel = 'Switch to Assigned';
			const choice = await vscode.window.showInformationMessage(
				'Filter is available in Assigned and Unassigned modes. Switch the Items view to Assigned?',
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
		const filterScopeLabel = this.viewMode === 'unassigned' ? 'Unassigned' : 'Assigned';

		const input = await vscode.window.showInputBox({
			title: projectLabel ? `Filter ${filterScopeLabel} Items (${projectLabel})` : `Filter ${filterScopeLabel} Items`,
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
		this.refreshFromCache();
	}

	async openItemsSearch(): Promise<void> {
		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			await vscode.window.showInformationMessage('Select a project before searching items.');
			return;
		}

		const projectLabel = selectedProject.name
			? `${selectedProject.name} (${selectedProject.key})`
			: selectedProject.key;
		const scopeLabel = this.viewMode === 'assigned' ? 'Assigned' : this.viewMode === 'unassigned' ? 'Unassigned' : 'All';
		const input = await vscode.window.showInputBox({
			title: projectLabel ? `Search ${scopeLabel} Items (${projectLabel})` : `Search ${scopeLabel} Items`,
			placeHolder: 'Search Jira using JQL text search (server-side)',
			prompt: 'Leave empty to clear search.',
			value: this.remoteSearchQuery,
			ignoreFocusOut: true,
		});
		if (input === undefined) {
			return;
		}

		const trimmed = input.trim();
		if (trimmed === this.remoteSearchQuery) {
			return;
		}
		this.pendingLoadMore = false;
		this.remoteSearchQuery = trimmed;
		await this.extensionContext.workspaceState.update(ITEMS_REMOTE_SEARCH_QUERY_KEY, trimmed);
		this.refresh();
	}

	protected getSectionChildren(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		return this.loadItems(authInfo);
	}

	refresh(): void {
		this.forceRemoteReload = true;
		super.refresh();
	}

	private async setViewMode(mode: ItemsViewMode): Promise<void> {
		if (this.viewMode === mode) {
			return;
		}
		this.pendingLoadMore = false;
		this.viewMode = mode;
		await this.extensionContext.workspaceState.update(ITEMS_VIEW_MODE_KEY, mode);
		if (mode === 'all') {
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

	private updateSortModeContext(): Thenable<void> {
		return vscode.commands.executeCommand('setContext', ITEMS_SORT_MODE_CONTEXT, this.sortMode);
	}

	private refreshFromCache(): void {
		this.pendingLoadMore = false;
		this.forceRemoteReload = false;
		super.refresh();
	}

	private getCacheEntry(
		projectKey: string,
		viewMode: ItemsViewMode,
		remoteSearchQuery: string
	):
		| {
				projectKey: string;
				viewMode: ItemsViewMode;
				remoteSearchQuery: string;
				issues: JiraIssue[];
				hasMore: boolean;
				nextStartAt?: number;
				nextPageToken?: string;
		  }
		| undefined {
		if (!this.issueCache) {
			return undefined;
		}
		return this.issueCache.projectKey === projectKey &&
			this.issueCache.viewMode === viewMode &&
			this.issueCache.remoteSearchQuery === remoteSearchQuery
			? this.issueCache
			: undefined;
	}

	private async loadItems(authInfo: JiraAuthInfo): Promise<JiraTreeItem[]> {
		const token = await this.authManager.getToken();
		if (!token) {
			this.pendingLoadMore = false;
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
			this.pendingLoadMore = false;
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
		const showingUnassigned = this.viewMode === 'unassigned';
		const showingScopedItems = showingAssigned || showingUnassigned;
		const hasRemoteSearch = this.remoteSearchQuery.length > 0;
		const scopeLabel: 'assigned' | 'unassigned' = showingUnassigned ? 'unassigned' : 'assigned';
		const searchNode = showingScopedItems ? this.createSearchTreeItem(projectLabel, scopeLabel) : undefined;
		const prependSearchNode = (items: JiraTreeItem[]): JiraTreeItem[] =>
			searchNode ? [searchNode, ...items] : items;

		try {
			const cacheEntry = this.getCacheEntry(selectedProject.key, this.viewMode, this.remoteSearchQuery);
			const shouldLoadMore = !!(this.pendingLoadMore && cacheEntry && cacheEntry.hasMore);
			const shouldUseCache = !this.forceRemoteReload && !!cacheEntry && !shouldLoadMore;
			let issues: JiraIssue[];
			let hasMore = false;
			let nextStartAt: number | undefined;
			let nextPageToken: string | undefined;

			if (shouldUseCache && cacheEntry) {
				issues = cacheEntry.issues;
				hasMore = cacheEntry.hasMore;
				nextStartAt = cacheEntry.nextStartAt;
				nextPageToken = cacheEntry.nextPageToken;
			} else {
				const page = await fetchProjectIssuesPage(authInfo, token, selectedProject.key, {
					onlyAssignedToCurrentUser: showingAssigned,
					onlyUnassigned: showingUnassigned,
					searchQuery: this.remoteSearchQuery || undefined,
					maxResults: ITEMS_LOAD_BATCH_SIZE,
					startAt: shouldLoadMore ? cacheEntry?.nextStartAt : undefined,
					nextPageToken: shouldLoadMore ? cacheEntry?.nextPageToken : undefined,
				});
				issues = shouldLoadMore && cacheEntry ? [...cacheEntry.issues, ...page.issues] : page.issues;
				hasMore = page.hasMore;
				nextStartAt = page.nextStartAt;
				nextPageToken = page.nextPageToken;
				this.issueCache = {
					projectKey: selectedProject.key,
					viewMode: this.viewMode,
					remoteSearchQuery: this.remoteSearchQuery,
					issues,
					hasMore,
					nextStartAt,
					nextPageToken,
				};
			}
			this.pendingLoadMore = false;
			this.forceRemoteReload = false;
			const loadMoreNode = hasMore ? this.createLoadMoreTreeItem(issues.length, hasRemoteSearch) : undefined;
			const scopedIssues = showingAssigned
				? filterIssuesRelatedToUser(issues, authInfo).filter(
						(issue) => determineStatusCategory(issue.statusName) !== 'done'
				  )
				: showingUnassigned
				? issues.filter((issue) => this.isUnassignedIssue(issue))
				: issues;
			const relevantIssues = this.sortIssuesForDisplay(scopedIssues);
			if (relevantIssues.length === 0) {
				const baseDescription = showingAssigned
					? `${projectLabel} • assigned to me`
					: showingUnassigned
					? `${projectLabel} • unassigned`
					: projectLabel;
				const filtered = showingScopedItems && this.searchQuery.length > 0;
				const tooltip = this.buildInProgressTooltip(0, filtered || hasRemoteSearch, this.viewMode);
				this.updateBadge(0, tooltip);
				this.updateDescription(this.composeItemsDescription(baseDescription, filtered, hasRemoteSearch));
				const emptyMessage =
					hasRemoteSearch
						? `No items found for "${this.remoteSearchQuery}". Clear or refine the search.`
						: showingScopedItems && this.searchQuery
						? `No ${scopeLabel} items match "${this.searchQuery}". Clear or edit the filter to see more.`
						: showingAssigned
						? 'No active assigned items. Use Show All to list every issue.'
						: showingUnassigned
						? 'No unassigned items in this project. Use Show All to list every issue.'
						: 'No issues in this project.';
				const nodes = [new JiraTreeItem('info', emptyMessage, vscode.TreeItemCollapsibleState.None)];
				if (loadMoreNode) {
					nodes.push(loadMoreNode);
				}
				return prependSearchNode(nodes);
			}

			this.transitionPrefetcher.prefetchIssues(selectedProject.key, relevantIssues);
			const displayedIssues = showingScopedItems ? this.applySearchFilter(relevantIssues) : relevantIssues;

			const filtered = showingScopedItems && this.searchQuery.length > 0;
			const inProgressCount = this.countInProgressIssues(displayedIssues);
			const tooltip = this.buildInProgressTooltip(
				inProgressCount,
				filtered || hasRemoteSearch,
				this.viewMode
			);
			this.updateBadge(inProgressCount, tooltip);
			if (showingAssigned) {
				const baseDescription = `${projectLabel} • assigned to me`;
				this.updateDescription(this.composeItemsDescription(baseDescription, filtered, hasRemoteSearch));
			} else if (showingUnassigned) {
				const baseDescription = `${projectLabel} • unassigned`;
				this.updateDescription(this.composeItemsDescription(baseDescription, filtered, hasRemoteSearch));
			} else {
				this.updateDescription(this.composeItemsDescription(projectLabel, false, hasRemoteSearch));
			}

			if (displayedIssues.length === 0) {
				const noMatchMessage = `No ${scopeLabel} items match "${this.searchQuery}". Clear or edit the filter to see more.`;
				const nodes = [new JiraTreeItem('info', noMatchMessage, vscode.TreeItemCollapsibleState.None)];
				if (loadMoreNode) {
					nodes.push(loadMoreNode);
				}
				return prependSearchNode(nodes);
			}

			const issueNodes = this.buildIssueNodes(displayedIssues);
			if (loadMoreNode) {
				issueNodes.push(loadMoreNode);
			}
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

	private createSearchTreeItem(projectLabel: string | undefined, scopeLabel: 'assigned' | 'unassigned'): JiraTreeItem {
		const hasQuery = this.searchQuery.length > 0;
		const item = new JiraTreeItem(
			'search',
			`Filter ${scopeLabel} items`,
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'jira.searchItems',
				title: 'Filter Items',
			}
		);
		item.iconPath = new vscode.ThemeIcon('filter');
		item.description = hasQuery ? this.searchQuery : 'Type to filter';
		item.tooltip = hasQuery
			? `Filtering ${scopeLabel} items${projectLabel ? ` in ${projectLabel}` : ''} by "${this.searchQuery}". Click to update or clear.`
			: `Click to filter ${scopeLabel} items${projectLabel ? ` in ${projectLabel}` : ''}.`;
		item.contextValue = 'jiraItemsSearch';
		return item;
	}

	private createLoadMoreTreeItem(loadedCount: number, hasRemoteSearch: boolean): JiraTreeItem {
		const item = new JiraTreeItem(
			'info',
			'Load More',
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'jira.loadMoreItems',
				title: 'Load More Items',
			}
		);
		item.iconPath = new vscode.ThemeIcon('chevron-down');
		item.description = `${loadedCount} loaded`;
		item.tooltip = hasRemoteSearch
			? `Load ${ITEMS_LOAD_BATCH_SIZE} more matching items.`
			: `Load ${ITEMS_LOAD_BATCH_SIZE} more recent items.`;
		item.contextValue = 'jiraItemsLoadMore';
		return item;
	}

	private composeItemsDescription(baseDescription: string, filtered: boolean, hasRemoteSearch: boolean): string {
		let description = baseDescription;
		if (hasRemoteSearch) {
			description += ` • search: ${this.remoteSearchQuery}`;
		}
		if (filtered) {
			description += ' • filtered';
		}
		return description;
	}

	private isUnassignedIssue(issue: JiraIssue): boolean {
		return !issue.assigneeAccountId?.trim() &&
			!issue.assigneeUsername?.trim() &&
			!issue.assigneeKey?.trim() &&
			!issue.assigneeName?.trim();
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

	private buildInProgressTooltip(count: number, filtered: boolean, mode: ItemsViewMode): string {
		if (filtered) {
			return count === 1 ? '1 matching in-progress issue' : `${count} matching in-progress issues`;
		}
		if (mode === 'assigned') {
			return count === 1 ? '1 in-progress issue (assigned)' : `${count} in-progress issues (assigned)`;
		}
		if (mode === 'unassigned') {
			return count === 1 ? '1 in-progress issue (unassigned)' : `${count} in-progress issues (unassigned)`;
		}
		return count === 1 ? '1 in-progress issue' : `${count} in-progress issues`;
	}

	private sortIssuesForDisplay(issues: JiraIssue[]): JiraIssue[] {
		if (this.sortMode === 'alphabetical') {
			return [...issues].sort((a, b) => {
				const primary = (a.summary || '').localeCompare(b.summary || '', undefined, {
					sensitivity: 'base',
					numeric: true,
				});
				if (primary !== 0) {
					return primary;
				}
				return (a.key || '').localeCompare(b.key || '', undefined, {
					sensitivity: 'base',
					numeric: true,
				});
			});
		}
		if (this.sortMode === 'lastUpdate') {
			return [...issues].sort((a, b) => this.getIssueUpdatedTimestamp(b) - this.getIssueUpdatedTimestamp(a));
		}
		return [...issues].sort((a, b) => this.getIssueCreatedTimestamp(b) - this.getIssueCreatedTimestamp(a));
	}

	private getIssueUpdatedTimestamp(issue: JiraIssue): number {
		const parsed = issue.updated ? Date.parse(issue.updated) : NaN;
		return Number.isNaN(parsed) ? 0 : parsed;
	}

	private getIssueCreatedTimestamp(issue: JiraIssue): number {
		const parsed = issue.created ? Date.parse(issue.created) : NaN;
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
		return this.getIssueUpdatedTimestamp(issue);
	}
}

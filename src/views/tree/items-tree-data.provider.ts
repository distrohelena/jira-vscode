import * as vscode from 'vscode';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JiraAuthManager } from '../../model/auth.manager';
import { JiraFocusManager } from '../../model/focus.manager';
import { ProjectTransitionPrefetcher } from '../../model/project-transition.prefetcher';
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
} from '../../model/jira.constant';
import { jiraApiClient } from '../../jira-api';
import {
	IssueModel,
} from '../../model/issue.model';
import { JiraAuthInfo, JiraIssue, ItemsGroupMode, ItemsSortMode, ItemsViewMode } from '../../model/jira.type';
import { ErrorHelper } from '../../shared/error.helper';
import { ItemsTreeIdentityService } from '../../services/items-tree-identity.service';
import { JiraIconCacheService } from '../../services/jira-icon-cache.service';
import { JiraTreeDataProvider } from './base-tree-data.provider';
import { JiraTreeItem } from './tree-item.view';

/**
 * Provides the Items tree nodes, including grouping, sorting, filtering, reveal state, and Jira icon resolution.
 */
export class JiraItemsTreeDataProvider extends JiraTreeDataProvider {
	/**
	 * Defines the icon file formats the VS Code tree reliably renders for item icons.
	 */
	private static readonly supportedTreeIconExtensions = new Set<string>(['.png', '.jpg', '.jpeg', '.svg']);

	private viewMode: ItemsViewMode;
	private searchQuery: string;
	private remoteSearchQuery: string;
	private groupMode: ItemsGroupMode;
	private sortMode: ItemsSortMode;
	private forceRemoteReload = true;
	private pendingLoadMore = false;
	/**
	 * Stores parent relationships for the current tree snapshot so nested issue nodes can be revealed.
	 */
	private readonly parentByItem = new Map<JiraTreeItem, JiraTreeItem | undefined>();

	/**
	 * Indexes the current issue nodes by key for post-refresh selection and reveal operations.
	 */
	private readonly issueItemByKey = new Map<string, JiraTreeItem>();

	/**
	 * Tracks the issue that should be revealed after the next tree refresh finishes rebuilding nodes.
	 */
	private pendingRevealIssueKey?: string;

	/**
	 * Prevents multiple cache-only refreshes from being queued while one icon warm-up repaint is already scheduled.
	 */
	private iconWarmRefreshQueued = false;
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
		private readonly transitionPrefetcher: ProjectTransitionPrefetcher,
		private readonly iconCacheService?: JiraIconCacheService
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

	/**
	 * Returns the parent tree item for the current snapshot so VS Code can reveal nested issues.
	 */
	getParent(element: JiraTreeItem): JiraTreeItem | undefined {
		return this.parentByItem.get(element);
	}

	refresh(): void {
		this.forceRemoteReload = true;
		super.refresh();
	}

	/**
	 * Refreshes the Items tree and reveals the matching issue once the refreshed nodes are available.
	 */
	async revealIssue(issueOrKey?: JiraIssue | string): Promise<void> {
		const issueKey =
			typeof issueOrKey === 'string'
				? issueOrKey.trim()
				: issueOrKey?.key?.trim();
		if (!issueKey) {
			return;
		}
		this.pendingRevealIssueKey = issueKey;
		this.refresh();
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
			return this.finalizeTreeNodes([
				new JiraTreeItem(
					'info',
					'Missing auth token. Please log in again.',
					vscode.TreeItemCollapsibleState.None
				),
			]);
		}

		const selectedProject = this.focusManager.getSelectedProject();
		if (!selectedProject) {
			this.pendingLoadMore = false;
			this.updateBadge();
			this.updateDescription('No project selected');
			return this.finalizeTreeNodes([
				new JiraTreeItem(
				 'info',
				 'Select a project to see Jira issues.',
				 vscode.TreeItemCollapsibleState.None
				),
			]);
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
				const page = await jiraApiClient.fetchProjectIssuesPage(authInfo, token, selectedProject.key, {
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
				? IssueModel.filterIssuesRelatedToUser(issues, authInfo).filter(
						(issue) => IssueModel.determineStatusCategory(issue.statusName) !== 'done'
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
						: `${projectLabel} • all`;
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
				return this.finalizeTreeNodes(prependSearchNode(nodes));
			}

			this.transitionPrefetcher.prefetchIssues(selectedProject.key, relevantIssues);
			const displayedIssues = showingScopedItems ? this.applySearchFilter(relevantIssues) : relevantIssues;
			this.warmIssueIcons(displayedIssues);

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
					const baseDescription = `${projectLabel} • all`;
					this.updateDescription(this.composeItemsDescription(baseDescription, false, hasRemoteSearch));
				}

			if (displayedIssues.length === 0) {
				const noMatchMessage = `No ${scopeLabel} items match "${this.searchQuery}". Clear or edit the filter to see more.`;
				const nodes = [new JiraTreeItem('info', noMatchMessage, vscode.TreeItemCollapsibleState.None)];
				if (loadMoreNode) {
					nodes.push(loadMoreNode);
				}
				return this.finalizeTreeNodes(prependSearchNode(nodes));
			}

			const issueNodes = await this.buildIssueNodes(displayedIssues, selectedProject.key);
			if (loadMoreNode) {
				issueNodes.push(loadMoreNode);
			}
			return this.finalizeTreeNodes(prependSearchNode(issueNodes));
		} catch (error) {
			const message = ErrorHelper.deriveErrorMessage(error);
			this.updateBadge();
			return this.finalizeTreeNodes(prependSearchNode([
				new JiraTreeItem(
					'info',
					`Failed to load project issues: ${message}`,
					vscode.TreeItemCollapsibleState.None
				),
			]));
		}
	}

	/**
	 * Captures the current tree snapshot and performs any deferred reveal request against the rebuilt nodes.
	 */
	private finalizeTreeNodes(nodes: JiraTreeItem[]): JiraTreeItem[] {
		this.captureTreeState(nodes);
		void this.revealPendingIssueNode();
		return nodes;
	}

	/**
	 * Rebuilds the parent and issue lookup indexes for the latest set of root nodes.
	 */
	private captureTreeState(nodes: JiraTreeItem[]): void {
		this.parentByItem.clear();
		this.issueItemByKey.clear();
		for (const node of nodes) {
			this.registerTreeNode(node, undefined);
		}
	}

	/**
	 * Registers a tree item and its descendants so reveal operations can locate the correct node path.
	 */
	private registerTreeNode(node: JiraTreeItem, parent: JiraTreeItem | undefined): void {
		this.parentByItem.set(node, parent);
		const issueKey = node.issue?.key?.trim();
		if (issueKey) {
			this.issueItemByKey.set(issueKey, node);
		}
		for (const child of node.children ?? []) {
			this.registerTreeNode(child, node);
		}
	}

	/**
	 * Reveals the queued issue node after a refresh finishes rebuilding the Items tree.
	 */
	private async revealPendingIssueNode(): Promise<void> {
		const issueKey = this.pendingRevealIssueKey;
		if (!issueKey) {
			return;
		}
		this.pendingRevealIssueKey = undefined;

		const issueNode = this.issueItemByKey.get(issueKey);
		if (!issueNode) {
			return;
		}

		await this.revealTreeItem(issueNode, {
			select: true,
			focus: false,
			expand: 3,
		});
	}

	/**
	 * Builds the root ticket nodes using the active grouping mode.
	 */
	private async buildIssueNodes(issues: JiraIssue[], projectKey: string): Promise<JiraTreeItem[]> {
		switch (this.groupMode) {
			case 'none':
				return Promise.all(issues.map((issue) => this.createIssueTreeItem(issue)));
			case 'type':
				return this.buildTypeGroupNodes(issues, projectKey);
			case 'status':
			default:
				return this.buildStatusGroupNodes(issues, projectKey);
		}
	}

	/**
	 * Builds status-based group nodes with stable identifiers so expanded groups stay open after refreshes.
	 */
	private async buildStatusGroupNodes(issues: JiraIssue[], projectKey: string): Promise<JiraTreeItem[]> {
		return Promise.all(IssueModel.groupIssuesByStatus(issues).map(async (group) => {
			const childNodes = await Promise.all(group.issues.map((issue) => this.createIssueTreeItem(issue)));
			const label = group.issues.length > 0 ? `${group.statusName} (${group.issues.length})` : group.statusName;
			const groupItem = new JiraTreeItem(
				'statusGroup',
				label,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				undefined,
				childNodes
			);
			groupItem.id = ItemsTreeIdentityService.createStatusGroupId(projectKey, group.statusName);
			const resolvedStatusGroupIconPath = await this.resolveFirstCachedIconUri(group.issues.map((issue) => issue.statusIconUrl));
			groupItem.iconPath = resolvedStatusGroupIconPath
				? JiraTreeItem.createTreeIconPath(resolvedStatusGroupIconPath)
				: JiraTreeItem.deriveIssueIcon(group.statusName);
			groupItem.tooltip =
				group.issues.length === 1
					? `1 issue in ${group.statusName}`
					: `${group.issues.length} issues in ${group.statusName}`;
			return groupItem;
		}));
	}

	/**
	 * Builds issue-type group nodes with stable identifiers so expanded groups stay open after refreshes.
	 */
	private async buildTypeGroupNodes(issues: JiraIssue[], projectKey: string): Promise<JiraTreeItem[]> {
		return Promise.all(this.groupIssuesByType(issues).map(async (group) => {
			const childNodes = await Promise.all(group.issues.map((issue) => this.createIssueTreeItem(issue)));
			const label = group.issues.length > 0 ? `${group.typeName} (${group.issues.length})` : group.typeName;
			const groupItem = new JiraTreeItem(
				'typeGroup',
				label,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				undefined,
				childNodes
			);
			groupItem.id = ItemsTreeIdentityService.createTypeGroupId(projectKey, group.typeName);
			const resolvedTypeGroupIconPath = await this.resolveFirstCachedIconUri(group.issues.map((issue) => issue.issueTypeIconUrl));
			groupItem.iconPath = resolvedTypeGroupIconPath
				? JiraTreeItem.createTreeIconPath(resolvedTypeGroupIconPath)
				: JiraTreeItem.deriveIssueIcon(group.issues[0]?.statusName);
			groupItem.tooltip =
				group.issues.length === 1
					? `1 issue in ${group.typeName}`
					: `${group.issues.length} issues in ${group.typeName}`;
			return groupItem;
		}));
	}

	/**
	 * Groups issues by their Jira issue type name while preserving a predictable display order.
	 */
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

	/**
	 * Creates one issue node using the ticket's cached Jira issue type icon first, then the status icon when needed.
	 */
	private async createIssueTreeItem(issue: JiraIssue): Promise<JiraTreeItem> {
		const resolvedIconPath =
			(await this.resolveUsableCachedIconUri(issue.issueTypeIconUrl)) ??
			(await this.resolveUsableCachedIconUri(issue.statusIconUrl));
		return JiraTreeItem.createIssueTreeItem(issue, resolvedIconPath);
	}

	/**
	 * Resolves the first cached Jira icon available from the supplied URLs while preserving their precedence order.
	 */
	private async resolveFirstCachedIconUri(iconUrls: Array<string | undefined>): Promise<vscode.Uri | undefined> {
		if (!this.iconCacheService) {
			return undefined;
		}
		for (const iconUrl of iconUrls) {
			const resolvedIconUri = await this.resolveUsableCachedIconUri(iconUrl);
			if (resolvedIconUri) {
				return resolvedIconUri;
			}
		}
		return undefined;
	}

	/**
	 * Resolves one cached Jira icon URI and discards values that no longer point to a readable local file.
	 */
	private async resolveUsableCachedIconUri(iconUrl: string | undefined): Promise<vscode.Uri | undefined> {
		if (!this.iconCacheService) {
			return undefined;
		}
		const resolvedIconUri = await this.iconCacheService.getCachedIconUri(iconUrl);
		return (await this.isUsableTreeIconUri(resolvedIconUri)) ? vscode.Uri.parse(resolvedIconUri) : undefined;
	}

	/**
	 * Verifies that one cached tree icon URI still points to an on-disk file before the tree view tries to render it.
	 */
	private async isUsableTreeIconUri(iconUri: string | undefined): Promise<boolean> {
		const trimmedIconUri = iconUri?.trim();
		if (!trimmedIconUri) {
			return false;
		}

		let parsedIconUri: URL;
		try {
			parsedIconUri = new URL(trimmedIconUri);
		} catch {
			return false;
		}

		if (parsedIconUri.protocol !== 'file:') {
			return false;
		}

		try {
			const iconFilePath = fileURLToPath(parsedIconUri);
			const iconExtension = extname(iconFilePath).trim().toLowerCase();
			if (!JiraItemsTreeDataProvider.supportedTreeIconExtensions.has(iconExtension)) {
				return false;
			}
			const iconFileStats = await stat(iconFilePath);
			return iconFileStats.isFile();
		} catch {
			return false;
		}
	}

	/**
	 * Starts background warming for the issue type and status icons used by the current tree snapshot.
	 */
	private warmIssueIcons(issues: JiraIssue[]): void {
		if (!this.iconCacheService) {
			return;
		}
		const iconUrls = new Set<string>();
		for (const issue of issues) {
			if (issue.issueTypeIconUrl?.trim()) {
				iconUrls.add(issue.issueTypeIconUrl);
			}
			if (issue.statusIconUrl?.trim()) {
				iconUrls.add(issue.statusIconUrl);
			}
		}
		if (iconUrls.size === 0) {
			return;
		}

		void Promise.all(Array.from(iconUrls, (iconUrl) => this.iconCacheService.warmIcon(iconUrl))).then((results) => {
			if (!results.some((didWarm) => didWarm)) {
				return;
			}
			if (this.iconWarmRefreshQueued) {
				return;
			}
			this.iconWarmRefreshQueued = true;
			queueMicrotask(() => {
				this.iconWarmRefreshQueued = false;
				this.refreshFromCache();
			});
		});
	}

	/**
	 * Creates the search/filter entry shown above assigned and unassigned issue lists.
	 */
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

	/**
	 * Creates the load-more node used when paged Jira issue results are available.
	 */
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

	/**
	 * Builds the tree view description suffixes that reflect active remote search and local filtering state.
	 */
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

	/**
	 * Detects whether Jira returned an issue without any assignee identity populated.
	 */
	private isUnassignedIssue(issue: JiraIssue): boolean {
		return !issue.assigneeAccountId?.trim() &&
			!issue.assigneeUsername?.trim() &&
			!issue.assigneeKey?.trim() &&
			!issue.assigneeName?.trim();
	}

	/**
	 * Applies the in-memory search filter used by the scoped Items views.
	 */
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

	/**
	 * Counts the issues currently shown as in progress so the tree badge stays accurate.
	 */
	private countInProgressIssues(issues: JiraIssue[]): number {
		return issues.reduce((count, issue) => {
			return IssueModel.determineStatusCategory(issue.statusName) === 'inProgress' ? count + 1 : count;
		}, 0);
	}

	/**
	 * Builds the badge tooltip for the current Items view and filter state.
	 */
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

	/**
	 * Sorts issues according to the active Items view sort mode.
	 */
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

	/**
	 * Returns the parsed issue update timestamp or zero when Jira sends an invalid value.
	 */
	private getIssueUpdatedTimestamp(issue: JiraIssue): number {
		const parsed = issue.updated ? Date.parse(issue.updated) : NaN;
		return Number.isNaN(parsed) ? 0 : parsed;
	}

	/**
	 * Returns the parsed issue creation timestamp and falls back to the update timestamp when needed.
	 */
	private getIssueCreatedTimestamp(issue: JiraIssue): number {
		const parsed = issue.created ? Date.parse(issue.created) : NaN;
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
		return this.getIssueUpdatedTimestamp(issue);
	}
}

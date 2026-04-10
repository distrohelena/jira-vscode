import * as vscode from 'vscode';

import { jiraApiClient } from '../jira-api';
import { JiraAuthInfo, JiraIssue, IssueStatusOption, SelectedProjectInfo } from '../model/jira.type';
import { ProjectStatusStore } from '../model/project-status.store';
import { ErrorHelper } from '../shared/error.helper';
import { JiraWebviewIconService } from '../services/jira-webview-icon.service';
import {
	ParentIssuePickerFilters,
	ParentIssuePickerNoneSelectionKey,
	ParentIssuePickerOverlay,
	ParentIssuePickerOverlayState,
} from '../views/webview/parent-issue-picker.overlay';

/**
 * Describes the inputs required to open the parent issue picker for a project.
 */
export type ParentIssuePickerRequest = {
	/**
	 * The active webview panel that will host the inline parent picker overlay.
	 */
	panel: vscode.WebviewPanel;

	/**
	 * The Jira project whose issues should be searched by the picker.
	 */
	project: SelectedProjectInfo;

	/**
	 * The Jira auth identity used for API requests.
	 */
	authInfo: JiraAuthInfo;

	/**
	 * The Jira API token used for API requests.
	 */
	token: string;

	/**
	 * The issue key that should be excluded from results (for example, the current issue).
	 */
	excludeIssueKey?: string;

	/**
	 * The initial parent issue key to highlight when opening the modal.
	 */
	initialSelectedIssueKey?: string;
};

/**
 * Represents an active parent picker session bound to a specific webview panel.
 */
export type ParentIssuePickerSession = {
	/**
	 * Resolves once the user confirms or cancels the picker.
	 */
	promise: Promise<ParentIssuePickerSelection | undefined>;

	/**
	 * Routes picker-specific messages from the webview into the session.
	 */
	handleMessage(message: any): Promise<boolean>;

	/**
	 * Closes the picker overlay and resolves the session if it is still pending.
	 */
	dispose(): void;
};

/**
 * Represents a completed picker selection, either a Jira issue or an explicit no-parent choice.
 */
export type ParentIssuePickerSelection =
	| {
			/**
			 * Identifies a concrete Jira issue selection.
			 */
			kind: 'issue';

			/**
			 * Carries the selected Jira issue returned from the search results.
			 */
			issue: JiraIssue;
	  }
	| {
			/**
			 * Identifies the explicit "None" option that clears the parent relationship.
			 */
			kind: 'none';
	  };

/**
 * Provides a Promise-based API for searching and selecting a parent issue using a large modal picker.
 */
export class ParentIssuePickerController {
	/**
	 * Stores the fixed Jira issue type name used by the parent picker search contract.
	 */
	private static readonly parentEpicIssueTypeName = 'Epic';

	/**
	 * Stores the optional webview icon resolver used to convert Jira icon URLs into local webview-safe sources.
	 */
	private readonly webviewIconService?: JiraWebviewIconService;

	/**
	 * Stores the optional project status cache used to populate dynamic status filter options for the active project.
	 */
	private readonly projectStatusStore?: ProjectStatusStore;

	/**
	 * Creates one controller that can optionally resolve Jira-owned icons for inline webview rendering.
	 */
	constructor(webviewIconService?: JiraWebviewIconService, projectStatusStore?: ProjectStatusStore) {
		this.webviewIconService = webviewIconService;
		this.projectStatusStore = projectStatusStore;
	}

	/**
	 * Opens the picker overlay in the supplied webview panel and resolves with the selected Jira issue,
	 * an explicit no-parent selection, or undefined when cancelled.
	 */
	pickParentIssue(request: ParentIssuePickerRequest): ParentIssuePickerSession {
		const { panel, project, authInfo, token } = request;
		const excludeIssueKey = request.excludeIssueKey?.trim();
		const cachedStatuses = this.projectStatusStore?.get(project.key);

		const initialState: ParentIssuePickerOverlayState = {
			projectKey: project.key,
			projectLabel: project.name ? `${project.name} (${project.key})` : project.key,
			searchQuery: '',
			issueTypeName: ParentIssuePickerController.parentEpicIssueTypeName,
			statusName: '',
			availableStatusNames: ParentIssuePickerController.deriveStatusNameList(cachedStatuses),
			loading: false,
			loadingMore: false,
			error: undefined,
			issues: [],
			statusIconFallbacks: ParentIssuePickerController.createStatusIconFallbacks(panel.webview),
			hasMore: false,
			selectedIssueKey: request.initialSelectedIssueKey?.trim(),
		};

		let state: ParentIssuePickerOverlayState = initialState;
		let disposed = false;
		let nextStartAt: number | undefined;
		let nextPageToken: string | undefined;
		let resolver: ((value: ParentIssuePickerSelection | undefined) => void) | undefined;
		let resolved = false;
		const promise = new Promise<ParentIssuePickerSelection | undefined>((resolvePromise) => {
			resolver = resolvePromise;
		});

		const resolve = (value: ParentIssuePickerSelection | undefined): void => {
			if (resolved) {
				return;
			}
			resolved = true;
			resolver?.(value);
		};

		const postOverlay = (): Promise<boolean> => {
			if (disposed) {
				return Promise.resolve(false);
			}
			return panel.webview.postMessage({
				type: 'parentPickerRender',
				html: ParentIssuePickerOverlay.renderOverlayHtml(state),
			});
		};

		const hideOverlay = (): Promise<boolean> => {
			if (disposed) {
				return Promise.resolve(false);
			}
			return panel.webview.postMessage({
				type: 'parentPickerHide',
			});
		};

		const updateState = (updates: Partial<ParentIssuePickerOverlayState>): void => {
			if (disposed) {
				return;
			}
			state = { ...state, ...updates };
			void postOverlay();
		};

		const loadFirstPage = async (filters: ParentIssuePickerFilters): Promise<void> => {
			const enforcedIssueTypeName = ParentIssuePickerController.parentEpicIssueTypeName;
			nextStartAt = undefined;
			nextPageToken = undefined;
			updateState({
				loading: true,
				loadingMore: false,
				error: undefined,
				issues: [],
				hasMore: false,
				searchQuery: filters.searchQuery,
				issueTypeName: enforcedIssueTypeName,
				statusName: filters.statusName,
			});

			try {
				const page = await jiraApiClient.fetchProjectIssuesPage(authInfo, token, project.key, {
					searchQuery: filters.searchQuery,
					issueTypeName: enforcedIssueTypeName,
					statusName: filters.statusName || undefined,
					excludeIssueKey,
					maxResults: 25,
				});
				const resolvedIssues = await this.resolveIssuesForWebview(panel.webview, page.issues ?? []);
				nextStartAt = page.nextStartAt;
				nextPageToken = page.nextPageToken;
				updateState({
					loading: false,
					issues: resolvedIssues,
					hasMore: page.hasMore ?? false,
					error: undefined,
				});
			} catch (error) {
				updateState({
					loading: false,
					error: `Search failed: ${ErrorHelper.deriveErrorMessage(error)}`,
				});
			}
		};

		const loadMore = async (filters: ParentIssuePickerFilters): Promise<void> => {
			const enforcedIssueTypeName = ParentIssuePickerController.parentEpicIssueTypeName;
			if (state.loading || state.loadingMore || !state.hasMore) {
				return;
			}
			updateState({
				loadingMore: true,
				error: undefined,
			});
			try {
				const page = await jiraApiClient.fetchProjectIssuesPage(authInfo, token, project.key, {
					searchQuery: filters.searchQuery,
					issueTypeName: enforcedIssueTypeName,
					statusName: filters.statusName || undefined,
					excludeIssueKey,
					maxResults: 25,
					startAt: nextStartAt,
					nextPageToken,
				});
				const resolvedIssues = await this.resolveIssuesForWebview(panel.webview, page.issues ?? []);
				nextStartAt = page.nextStartAt;
				nextPageToken = page.nextPageToken;
				const mergedIssues = ParentIssuePickerController.mergeIssues(state.issues, resolvedIssues);
				updateState({
					loadingMore: false,
					issues: mergedIssues,
					hasMore: page.hasMore ?? false,
					error: undefined,
				});
			} catch (error) {
				updateState({
					loadingMore: false,
					error: `Load more failed: ${ErrorHelper.deriveErrorMessage(error)}`,
				});
			}
		};

		const handleMessage = async (message: any): Promise<boolean> => {
			if (disposed || !message?.type) {
				return false;
			}

			if (message.type === 'loadParentIssues') {
				const filters = ParentIssuePickerController.sanitizeFilters(message.filters, state);
				await loadFirstPage(filters);
				return true;
			}

			if (message.type === 'loadMoreParentIssues') {
				const filters = ParentIssuePickerController.sanitizeFilters(message.filters, state);
				await loadMore(filters);
				return true;
			}

			if (message.type === 'selectParentIssue') {
				const issueKey = typeof message.issueKey === 'string' ? message.issueKey.trim() : '';
				updateState({
					selectedIssueKey: issueKey || undefined,
					error: undefined,
				});
				return true;
			}

			if (message.type === 'cancelParentIssue') {
				void hideOverlay();
				resolve(undefined);
				return true;
			}

			if (message.type === 'confirmParentIssue') {
				const requestedIssueKey =
					typeof message.issueKey === 'string' ? message.issueKey.trim() : '';
				const issueKey = requestedIssueKey || state.selectedIssueKey?.trim() || '';
				if (issueKey.toUpperCase() === ParentIssuePickerNoneSelectionKey.toUpperCase()) {
					void hideOverlay();
					resolve({
						kind: 'none',
					});
					return true;
				}
				const issue = state.issues.find((candidate) => candidate?.key?.trim().toUpperCase() === issueKey.toUpperCase());
				if (!issue) {
					updateState({
						error: 'Select a loaded issue before confirming the parent.',
					});
					return true;
				}
				void hideOverlay();
				resolve({
					kind: 'issue',
					issue,
				});
				return true;
			}

			return false;
		};

		panel.onDidDispose(() => {
			disposed = true;
			resolve(undefined);
		});

		void postOverlay();
		if (!cachedStatuses && this.projectStatusStore) {
			void this.loadAvailableStatuses(project.key, updateState);
		}

		return {
			promise,
			handleMessage,
			dispose: () => {
				if (disposed) {
					return;
				}
				void hideOverlay();
				disposed = true;
				resolve(undefined);
			},
		};
	}

	/**
	 * Applies the selected parent issue relationship using the Jira issue update endpoint.
	 */
	async updateIssueParent(
		authInfo: JiraAuthInfo,
		token: string,
		issueKey: string,
		parentIssueKey?: string
	): Promise<void> {
		await jiraApiClient.updateIssueParent(authInfo, token, issueKey, parentIssueKey);
	}

	/**
	 * Normalizes raw filter data received from the webview message payload.
	 */
	private static sanitizeFilters(raw: any, fallback: ParentIssuePickerFilters): ParentIssuePickerFilters {
		const searchQuery = typeof raw?.searchQuery === 'string' ? raw.searchQuery : fallback.searchQuery;
		const statusName = typeof raw?.statusName === 'string' ? raw.statusName : fallback.statusName;
		return {
			searchQuery: searchQuery ?? '',
			issueTypeName: ParentIssuePickerController.parentEpicIssueTypeName,
			statusName: statusName ?? '',
		};
	}

	/**
	 * Merges paged issue results while avoiding duplicate keys in the final list.
	 */
	private static mergeIssues(existing: JiraIssue[], incoming: JiraIssue[] | undefined): JiraIssue[] {
		const result: JiraIssue[] = Array.isArray(existing) ? [...existing] : [];
		const seen = new Set<string>(result.map((issue) => issue.key?.trim().toUpperCase()).filter((key): key is string => !!key));
		for (const issue of incoming ?? []) {
			const key = issue?.key?.trim().toUpperCase();
			if (!key || seen.has(key)) {
				continue;
			}
			seen.add(key);
			result.push(issue);
		}
		return result;
	}

	/**
	 * Resolves Jira-owned icon URLs into safe local webview sources for the current picker host.
	 */
	private async resolveIssuesForWebview(webview: vscode.Webview, issues: JiraIssue[]): Promise<JiraIssue[]> {
		if (!this.webviewIconService) {
			return issues;
		}
		return this.webviewIconService.createIssuesWithResolvedIconSources(webview, issues);
	}

	/**
	 * Loads the available project statuses and pushes them into the active overlay without blocking the first render.
	 */
	private async loadAvailableStatuses(
		projectKey: string,
		updateState: (updates: Partial<ParentIssuePickerOverlayState>) => void
	): Promise<void> {
		if (!this.projectStatusStore) {
			return;
		}
		try {
			const statuses = await this.projectStatusStore.ensure(projectKey);
			updateState({
				availableStatusNames: ParentIssuePickerController.deriveStatusNameList(statuses),
			});
		} catch {
			updateState({
				availableStatusNames: [],
			});
		}
	}

	/**
	 * Builds the packaged status icon fallback map used by the overlay when Jira icons are unavailable.
	 */
	private static createStatusIconFallbacks(
		webview: vscode.Webview
	): ParentIssuePickerOverlayState['statusIconFallbacks'] {
		if (typeof webview.asWebviewUri !== 'function') {
			return undefined;
		}
		const { ViewResource } = require('../views/view.resource') as typeof import('../views/view.resource');
		return {
			open: ViewResource.getStatusIconWebviewSrc(webview, 'open'),
			inProgress: ViewResource.getStatusIconWebviewSrc(webview, 'inProgress'),
			done: ViewResource.getStatusIconWebviewSrc(webview, 'done'),
			default: ViewResource.getStatusIconWebviewSrc(webview, 'default'),
		};
	}

	/**
	 * Produces a stable, deduplicated list of status names for the picker filter.
	 */
	private static deriveStatusNameList(options?: IssueStatusOption[]): string[] {
		const seen = new Set<string>();
		const names: string[] = [];
		for (const option of options ?? []) {
			const name = option?.name?.trim();
			if (!name) {
				continue;
			}
			const key = name.toLowerCase();
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			names.push(name);
		}
		return names;
	}
}

import * as vscode from 'vscode';

import { JiraAuthManager } from '../model/authManager';
import {
	addIssueComment,
	assignIssue,
	deleteIssueComment,
	fetchAssignableUsers,
	fetchIssueComments,
	fetchIssueDetails,
	fetchIssueTransitions,
	transitionIssueStatus,
} from '../model/jiraApiClient';
import {
	IssueAssignableUser,
	IssuePanelOptions,
	IssueStatusOption,
	JiraCommentFormat,
	JiraIssue,
	JiraIssueComment,
	JiraAuthInfo,
} from '../model/types';
import { ProjectStatusStore } from '../model/projectStatusStore';
import { IssueTransitionStore } from '../model/issueTransitionStore';
import { ProjectTransitionPrefetcher } from '../model/projectTransitionPrefetcher';
import { createPlaceholderIssue } from '../model/issueModel';
import { deriveErrorMessage } from '../shared/errors';
import { renderIssuePanelContent, showIssueDetailsPanel } from '../views/webview/panels';

export type IssueControllerDeps = {
	authManager: JiraAuthManager;
	projectStatusStore: ProjectStatusStore;
	transitionStore: IssueTransitionStore;
	transitionPrefetcher: ProjectTransitionPrefetcher;
	refreshAll: () => void;
};

type OpenPanelEntry = {
	panel: vscode.WebviewPanel;
	refresh: () => void;
};

export function createIssueController(deps: IssueControllerDeps) {
	const { authManager, refreshAll, projectStatusStore, transitionStore, transitionPrefetcher } = deps;
	const openIssuePanels = new Map<string, OpenPanelEntry>();

	const openIssueDetails = async (issueOrKey?: JiraIssue | string): Promise<void> => {
		const issueKeyValue = typeof issueOrKey === 'string' ? issueOrKey : issueOrKey?.key;
		if (!issueKeyValue) {
			await vscode.window.showInformationMessage('Unable to open issue details.');
			return;
		}
		const resolvedIssueKey: string = issueKeyValue;

		const existingEntry = openIssuePanels.get(resolvedIssueKey);
		if (existingEntry) {
			existingEntry.panel.reveal(vscode.ViewColumn.Active);
			existingEntry.refresh();
			return;
		}

		const initialIssue = typeof issueOrKey === 'string' ? undefined : issueOrKey;
		const issueProjectKey = deriveProjectKeyFromIssueKey(resolvedIssueKey);
		const initialIssueType = initialIssue
			? {
					issueTypeId: initialIssue.issueTypeId,
					issueTypeName: initialIssue.issueTypeName,
			  }
			: undefined;
		const cachedTransitions =
			initialIssue && issueProjectKey
				? transitionStore.get({
						projectKey: issueProjectKey,
						issueTypeId: initialIssue.issueTypeId ?? initialIssue.issueTypeName,
						statusName: initialIssue.statusName,
				  })
				: undefined;
		const cachedStatuses =
			issueProjectKey
				? projectStatusStore.getIssueTypeStatuses(issueProjectKey, initialIssueType) ??
					projectStatusStore.get(issueProjectKey)
				: undefined;
		if (issueProjectKey) {
			void projectStatusStore.ensure(issueProjectKey);
			void projectStatusStore.ensureAllIssueTypeStatuses(issueProjectKey);
			transitionPrefetcher.prefetch(issueProjectKey);
		}
		const panelState: {
			issue: JiraIssue;
			transitions?: IssueStatusOption[];
			statusPrefill?: IssueStatusOption[];
			assignableUsers?: IssueAssignableUser[];
			assigneeQuery: string;
			comments?: JiraIssueComment[];
			commentsError?: string;
			commentsLoading: boolean;
			commentSubmitPending: boolean;
			commentSubmitError?: string;
			commentFormat: JiraCommentFormat;
			commentDraft: string;
			commentDeletingId?: string;
			loadingIssue: boolean;
		} = {
			issue: initialIssue ?? createPlaceholderIssue(resolvedIssueKey),
			transitions: cachedTransitions,
			statusPrefill: cachedStatuses,
			assignableUsers: undefined,
			assigneeQuery: '',
			comments: undefined,
			commentsError: undefined,
			commentsLoading: true,
			commentSubmitPending: false,
			commentSubmitError: undefined,
			commentFormat: 'wiki',
			commentDraft: '',
			commentDeletingId: undefined,
			loadingIssue: true,
		};

		const buildCommentOptions = (): IssuePanelOptions => ({
			comments: panelState.comments,
			commentsError: panelState.commentsError,
			commentsPending: panelState.commentsLoading,
			commentSubmitPending: panelState.commentSubmitPending,
			commentSubmitError: panelState.commentSubmitError,
			commentDeletingId: panelState.commentDeletingId,
			commentFormat: panelState.commentFormat,
			commentDraft: panelState.commentDraft,
		});

		let disposed = false;

		const initialStatusOptions = panelState.transitions ?? panelState.statusPrefill;
		const initialOptions: IssuePanelOptions = {
			...buildCommentOptions(),
			loading: true,
		};
		if (initialStatusOptions && initialStatusOptions.length > 0) {
			initialOptions.statusOptions = initialStatusOptions;
			initialOptions.statusPending = !panelState.transitions;
		}

		const panel = showIssueDetailsPanel(
			resolvedIssueKey,
			panelState.issue,
			initialOptions,
			async (message) => {
				if (message?.type === 'changeStatus' && typeof message.transitionId === 'string') {
					await handleStatusChange(message.transitionId);
				} else if (message?.type === 'changeAssignee' && typeof message.accountId === 'string') {
					await handleAssigneeChange(message.accountId);
				} else if (message?.type === 'loadAssignees') {
					const queryValue =
						typeof message.query === 'string' ? message.query : panelState.assigneeQuery ?? '';
					await handleAssigneeSearch(queryValue, !!message.force);
				} else if (message?.type === 'addComment' && typeof message.body === 'string') {
					const format =
						message.format === 'plain'
							? 'plain'
							: message.format === 'wiki'
								? 'wiki'
								: panelState.commentFormat;
					await handleAddComment(message.body, format);
				} else if (message?.type === 'deleteComment' && typeof message.commentId === 'string') {
					await handleDeleteComment(message.commentId);
				} else if (message?.type === 'refreshComments') {
					await refreshComments(true);
				} else if (message?.type === 'commentDraftChanged' && typeof message.value === 'string') {
					panelState.commentDraft = message.value;
					if (panelState.commentSubmitError) {
						panelState.commentSubmitError = undefined;
					}
				} else if (message?.type === 'changeCommentFormat' && typeof message.format === 'string') {
					const nextFormat: JiraCommentFormat = message.format === 'plain' ? 'plain' : 'wiki';
					if (panelState.commentFormat !== nextFormat) {
						panelState.commentFormat = nextFormat;
						renderPanel();
					}
				}
			}
		);

		const renderPanel = (options?: IssuePanelOptions) => {
			const fallbackStatusOptions = panelState.transitions ?? panelState.statusPrefill;
			const merged: IssuePanelOptions = {
				...buildCommentOptions(),
				...options,
			};
			if (merged.statusOptions === undefined && fallbackStatusOptions) {
				merged.statusOptions = fallbackStatusOptions;
			}
			if (merged.statusPending === undefined && !panelState.transitions) {
				merged.statusPending = true;
			}
			if (merged.loading === undefined) {
				merged.loading = panelState.loadingIssue;
			}
			renderIssuePanelContent(panel, panelState.issue, merged);
		};

		openIssuePanels.set(resolvedIssueKey, {
			panel,
			refresh: () => {
				if (disposed) {
					return;
				}
				void loadIssueDetails();
				void refreshComments(false);
			},
		});

		panel.onDidDispose(() => {
			disposed = true;
			openIssuePanels.delete(resolvedIssueKey);
		});

		void refreshComments(true);
		await loadIssueDetails();

		async function loadIssueDetails(): Promise<void> {
			panelState.loadingIssue = true;
			renderPanel({
				loading: true,
				statusPending: !panelState.transitions,
				assigneeOptions: panelState.assignableUsers,
				assigneeQuery: panelState.assigneeQuery,
			});
			const authInfo = await authManager.getAuthInfo();
			if (!authInfo) {
				if (!disposed) {
					panelState.loadingIssue = false;
					renderPanel({
						error: 'Log in to Jira to view issue details.',
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showInformationMessage('Log in to Jira to view issue details.');
				return;
			}

			const token = await authManager.getToken();
			if (!token) {
				if (!disposed) {
					panelState.loadingIssue = false;
					renderPanel({
						error: 'Missing auth token. Please log in again.',
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showInformationMessage('Missing auth token. Please log in again.');
				return;
			}

			try {
				const issue = await fetchIssueDetails(authInfo, token, resolvedIssueKey);
				const issueProjectKeyResolved = deriveProjectKeyFromIssueKey(issue.key);
				if (issueProjectKeyResolved) {
					void projectStatusStore.ensure(issueProjectKeyResolved);
					void projectStatusStore.ensureAllIssueTypeStatuses(issueProjectKeyResolved);
					transitionPrefetcher.prefetch(issueProjectKeyResolved);
				}
				const transitionResult = await resolveIssueTransitions(
					authInfo,
					token,
					issue,
					issueProjectKeyResolved
				);

				if (disposed) {
					return;
				}

				panelState.issue = issue;
				panelState.transitions = transitionResult.transitions;
				if (issueProjectKeyResolved) {
					const issueTypeCriteria = {
						issueTypeId: issue.issueTypeId,
						issueTypeName: issue.issueTypeName,
					};
					panelState.statusPrefill =
						projectStatusStore.getIssueTypeStatuses(issueProjectKeyResolved, issueTypeCriteria) ??
						projectStatusStore.get(issueProjectKeyResolved);
				}
				panelState.loadingIssue = false;
				renderPanel({
					statusOptions: panelState.transitions ?? panelState.statusPrefill,
					statusPending: false,
					statusError: transitionResult.error
						? `Unable to load available statuses: ${transitionResult.error}`
						: undefined,
					assigneeQuery: panelState.assigneeQuery,
				});
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					panelState.loadingIssue = false;
					renderPanel({
						error: `Failed to load issue details: ${message}`,
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showErrorMessage(`Failed to load issue details: ${message}`);
			}
		}

		async function handleStatusChange(transitionId: string): Promise<void> {
			if (disposed || !transitionId) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to change issue status.');
				return;
			}

			renderPanel({
				statusOptions: panelState.transitions,
				statusPending: true,
				assigneeOptions: panelState.assignableUsers,
				assigneeQuery: panelState.assigneeQuery,
			});

			try {
				await transitionIssueStatus(authInfo, token, resolvedIssueKey, transitionId);
				const updatedIssue = await fetchIssueDetails(authInfo, token, resolvedIssueKey);
				const updatedProjectKey = deriveProjectKeyFromIssueKey(updatedIssue.key);
				if (updatedProjectKey) {
					void projectStatusStore.ensure(updatedProjectKey);
					void projectStatusStore.ensureAllIssueTypeStatuses(updatedProjectKey);
					transitionPrefetcher.prefetch(updatedProjectKey);
				}
				const transitionResult = await resolveIssueTransitions(
					authInfo,
					token,
					updatedIssue,
					updatedProjectKey,
					{ useCache: false }
				);
				if (disposed) {
					return;
				}
				panelState.issue = updatedIssue;
				panelState.transitions = transitionResult.transitions;
				if (updatedProjectKey) {
					const issueTypeCriteria = {
						issueTypeId: updatedIssue.issueTypeId,
						issueTypeName: updatedIssue.issueTypeName,
					};
					panelState.statusPrefill =
						projectStatusStore.getIssueTypeStatuses(updatedProjectKey, issueTypeCriteria) ??
						projectStatusStore.get(updatedProjectKey);
				}
				renderPanel({
					statusOptions: panelState.transitions ?? panelState.statusPrefill,
					statusPending: false,
					statusError: transitionResult.error
						? `Unable to load available statuses: ${transitionResult.error}`
						: undefined,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
				});
				refreshAll();
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					renderPanel({
						statusOptions: panelState.transitions,
						statusError: `Failed to update status: ${message}`,
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showErrorMessage(`Failed to update status: ${message}`);
			}
		}

		async function handleAssigneeChange(accountId: string): Promise<void> {
			if (disposed || !accountId) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to change the assignee.');
				return;
			}

			renderPanel({
				statusOptions: panelState.transitions,
				assigneeOptions: panelState.assignableUsers,
				assigneePending: true,
				assigneeQuery: panelState.assigneeQuery,
			});

			try {
				await assignIssue(authInfo, token, resolvedIssueKey, accountId);
				const updatedIssue = await fetchIssueDetails(authInfo, token, resolvedIssueKey);
				if (disposed) {
					return;
				}
				panelState.issue = updatedIssue;
				renderPanel({
					statusOptions: panelState.transitions,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
				});
				refreshAll();
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					renderPanel({
						statusOptions: panelState.transitions,
						assigneeOptions: panelState.assignableUsers,
						assigneeError: `Failed to change assignee: ${message}`,
						assigneeQuery: panelState.assigneeQuery,
					});
				}
				await vscode.window.showErrorMessage(`Failed to change assignee: ${message}`);
			}
		}

		async function handleAssigneeSearch(query?: string, force = false): Promise<void> {
			if (disposed) {
				return;
			}
			const normalizedQuery = query?.trim() ?? '';
			if (!force && normalizedQuery === panelState.assigneeQuery && panelState.assignableUsers) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to search for assignees.');
				return;
			}

			renderPanel({
				statusOptions: panelState.transitions,
				assigneeOptions: panelState.assignableUsers,
				assigneePending: true,
				assigneeQuery: normalizedQuery,
				assigneeAutoFocus: true,
			});

			try {
				const users = await fetchAssignableUsers(authInfo, token, resolvedIssueKey, normalizedQuery);
				if (disposed) {
					return;
				}
				panelState.assignableUsers = users;
				panelState.assigneeQuery = normalizedQuery;
				renderPanel({
					statusOptions: panelState.transitions,
					assigneeOptions: users,
					assigneeQuery: normalizedQuery,
					assigneeAutoFocus: true,
				});
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
					renderPanel({
						statusOptions: panelState.transitions,
						assigneeOptions: panelState.assignableUsers,
						assigneeError: `Failed to load assignable users: ${message}`,
						assigneeQuery: normalizedQuery,
						assigneeAutoFocus: true,
					});
				}
				await vscode.window.showErrorMessage(`Failed to load assignable users: ${message}`);
			}
		}

		async function refreshComments(forceSpinner = false): Promise<void> {
			if (disposed) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				panelState.comments = undefined;
				panelState.commentsError = 'Log in to Jira to view comments.';
				panelState.commentsLoading = false;
				renderPanel();
				return;
			}

			panelState.commentsLoading = true;
			renderPanel();

			try {
				const comments = await fetchIssueComments(authInfo, token, resolvedIssueKey);
				if (disposed) {
					return;
				}
				panelState.comments = comments;
				panelState.commentsError = undefined;
				panelState.commentsLoading = false;
				renderPanel();
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (disposed) {
					return;
				}
				panelState.commentsError = `Failed to load comments: ${message}`;
				panelState.commentsLoading = false;
				renderPanel();
			}
		}

		async function handleAddComment(body: string, format: JiraCommentFormat): Promise<void> {
			if (disposed) {
				return;
			}
			const trimmedBody = body?.trim() ?? '';
			if (!trimmedBody) {
				panelState.commentSubmitError = 'Comment cannot be empty.';
				renderPanel();
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to add a comment.');
				return;
			}

			panelState.commentDraft = trimmedBody;
			panelState.commentFormat = format;
			panelState.commentSubmitPending = true;
			panelState.commentSubmitError = undefined;
			renderPanel();

			try {
				await addIssueComment(authInfo, token, resolvedIssueKey, trimmedBody, format);
				panelState.commentDraft = '';
				panelState.commentSubmitPending = false;
				panelState.commentSubmitError = undefined;
				renderPanel();
				await refreshComments(true);
			} catch (error) {
				const message = deriveErrorMessage(error);
				panelState.commentSubmitPending = false;
				panelState.commentSubmitError = `Failed to add comment: ${message}`;
				renderPanel();
				await vscode.window.showErrorMessage(`Failed to add comment: ${message}`);
			}
		}

		async function handleDeleteComment(commentId: string): Promise<void> {
			if (disposed || !commentId) {
				return;
			}
			const confirmation = await vscode.window.showWarningMessage(
				'Delete this Jira comment? This action cannot be undone.',
				{ modal: true },
				'Delete'
			);
			if (confirmation !== 'Delete') {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to delete comments.');
				return;
			}

			panelState.commentDeletingId = commentId;
			renderPanel();
			try {
				await deleteIssueComment(authInfo, token, resolvedIssueKey, commentId);
				panelState.commentDeletingId = undefined;
				renderPanel();
				await refreshComments(true);
			} catch (error) {
				const message = deriveErrorMessage(error);
				panelState.commentDeletingId = undefined;
				panelState.commentsError = `Failed to delete comment: ${message}`;
				renderPanel();
				await vscode.window.showErrorMessage(`Failed to delete comment: ${message}`);
			}
		}
	};

	async function resolveIssueTransitions(
		authInfo: JiraAuthInfo,
		token: string,
		targetIssue: JiraIssue,
		projectKey?: string,
		options?: { useCache?: boolean }
	): Promise<{ transitions?: IssueStatusOption[]; error?: string }> {
		const normalizedProjectKey = projectKey ?? deriveProjectKeyFromIssueKey(targetIssue.key);
		const cacheKey = {
			projectKey: normalizedProjectKey,
			issueTypeId: targetIssue.issueTypeId ?? targetIssue.issueTypeName,
			statusName: targetIssue.statusName,
		};
		const useCache = options?.useCache ?? true;
		if (useCache) {
			const cached = transitionStore.get(cacheKey);
			if (cached && cached.length > 0) {
				return { transitions: cached };
			}
		}

		try {
			const fetchedTransitions = await fetchIssueTransitions(authInfo, token, targetIssue.key);
			if (fetchedTransitions && fetchedTransitions.length > 0) {
				transitionStore.remember(cacheKey, fetchedTransitions);
			}
			return { transitions: fetchedTransitions };
		} catch (error) {
			return { error: deriveErrorMessage(error) };
		}
	}

	return {
		openIssueDetails,
	};
}

function deriveProjectKeyFromIssueKey(issueKey?: string): string | undefined {
	if (!issueKey) {
		return undefined;
	}
	const separatorIndex = issueKey.indexOf('-');
	const projectPart = separatorIndex === -1 ? issueKey : issueKey.slice(0, separatorIndex);
	const trimmed = projectPart.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

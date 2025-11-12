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
} from '../model/types';
import { createPlaceholderIssue } from '../model/issueModel';
import { deriveErrorMessage } from '../shared/errors';
import { renderIssuePanelContent, showIssueDetailsPanel } from '../views/webview/panels';

export type IssueControllerDeps = {
	authManager: JiraAuthManager;
	refreshAll: () => void;
};

export function createIssueController(deps: IssueControllerDeps) {
	const { authManager, refreshAll } = deps;

	const openIssueDetails = async (issueOrKey?: JiraIssue | string): Promise<void> => {
		const issueKeyValue = typeof issueOrKey === 'string' ? issueOrKey : issueOrKey?.key;
		if (!issueKeyValue) {
			await vscode.window.showInformationMessage('Unable to open issue details.');
			return;
		}
		const resolvedIssueKey: string = issueKeyValue;

		const initialIssue = typeof issueOrKey === 'string' ? undefined : issueOrKey;
		const panelState: {
			issue: JiraIssue;
			transitions?: IssueStatusOption[];
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
		} = {
			issue: initialIssue ?? createPlaceholderIssue(resolvedIssueKey),
			transitions: undefined,
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

		const panel = showIssueDetailsPanel(
			resolvedIssueKey,
			panelState.issue,
			{ ...buildCommentOptions(), loading: true },
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
			renderIssuePanelContent(panel, panelState.issue, {
				...buildCommentOptions(),
				...options,
			});
		};

		panel.onDidDispose(() => {
			disposed = true;
		});

		void refreshComments(true);
		await loadIssueDetails();

		async function loadIssueDetails(): Promise<void> {
			const authInfo = await authManager.getAuthInfo();
			if (!authInfo) {
				if (!disposed) {
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
				let transitions: IssueStatusOption[] | undefined;
				let transitionsError: string | undefined;
				try {
					transitions = await fetchIssueTransitions(authInfo, token, resolvedIssueKey);
				} catch (transitionError) {
					transitionsError = deriveErrorMessage(transitionError);
				}
				let assignees: IssueAssignableUser[] | undefined;
				let assigneeError: string | undefined;
				try {
					assignees = await fetchAssignableUsers(authInfo, token, resolvedIssueKey);
				} catch (assignError) {
					assigneeError = deriveErrorMessage(assignError);
				}

				if (disposed) {
					return;
				}

				panelState.issue = issue;
				panelState.transitions = transitions;
				panelState.assignableUsers = assignees;
				renderPanel({
					statusOptions: transitions,
					statusError: transitionsError ? `Unable to load available statuses: ${transitionsError}` : undefined,
					assigneeOptions: assignees,
					assigneeError: assigneeError ? `Unable to load assignable users: ${assigneeError}` : undefined,
					assigneeQuery: panelState.assigneeQuery,
				});
			} catch (error) {
				const message = deriveErrorMessage(error);
				if (!disposed) {
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
				let transitions: IssueStatusOption[] | undefined;
				try {
					transitions = await fetchIssueTransitions(authInfo, token, resolvedIssueKey);
				} catch {
					transitions = panelState.transitions;
				}
				if (disposed) {
					return;
				}
				panelState.issue = updatedIssue;
				panelState.transitions = transitions;
				renderPanel({
					statusOptions: transitions,
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

			if (forceSpinner) {
				panelState.commentsLoading = true;
				renderPanel();
			}

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

	return {
		openIssueDetails,
	};
}

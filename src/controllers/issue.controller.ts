import * as vscode from 'vscode';

import { JiraAuthManager } from '../model/auth.manager';
import { jiraApiClient } from '../jira-api';
import {
	IssueAssignableUser,
	IssuePanelOptions,
	IssueStatusOption,
	CommentReplyContext,
	JiraCommentFormat,
	JiraIssue,
	JiraIssueComment,
	JiraAuthInfo,
	JiraRelatedIssue,
} from '../model/jira.type';
import { ProjectStatusStore } from '../model/project-status.store';
import { IssueTransitionStore } from '../model/issue-transition.store';
import { ProjectTransitionPrefetcher } from '../model/project-transition.prefetcher';
import { IssueModel } from '../model/issue.model';
import { ErrorHelper } from '../shared/error.helper';
import { IssueCommentReplyService } from '../services/issue-comment-reply.service';
import { JiraWebviewIconService } from '../services/jira-webview-icon.service';
import { AssigneePickerController, AssigneePickerSession } from './assignee-picker.controller';
import { ParentIssuePickerController, ParentIssuePickerSession } from './parent-issue-picker.controller';
import { JiraWebviewPanel } from '../views/webview/webview.panel';

export type IssueControllerDeps = {
	authManager: JiraAuthManager;
	assigneePicker: AssigneePickerController;
	parentIssuePicker: ParentIssuePickerController;
	projectStatusStore: ProjectStatusStore;
	transitionStore: IssueTransitionStore;
	transitionPrefetcher: ProjectTransitionPrefetcher;
	webviewIconService: JiraWebviewIconService;
	refreshAll: () => void;
};

type OpenPanelEntry = {
	panel: vscode.WebviewPanel;
	refresh: () => void;
};

export class IssueControllerFactory {
	static create(deps: IssueControllerDeps) {
		return IssueControllerFactory.createIssueControllerInternal(deps);
	}

	private static createIssueControllerInternal(deps: IssueControllerDeps) {
	const { authManager, assigneePicker, parentIssuePicker, refreshAll, projectStatusStore, transitionStore, transitionPrefetcher, webviewIconService } = deps;
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
			const issueProjectKey = IssueControllerFactory.deriveProjectKeyFromIssueKey(resolvedIssueKey);
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
			commentReplyContext?: CommentReplyContext;
			summaryEditPending: boolean;
			summaryEditError?: string;
			descriptionEditPending: boolean;
			descriptionEditError?: string;
			loadingIssue: boolean;
			currentUser?: IssuePanelOptions['currentUser'];
		} = {
			issue: initialIssue ?? IssueModel.createPlaceholderIssue(resolvedIssueKey),
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
			commentReplyContext: undefined,
			summaryEditPending: false,
			summaryEditError: undefined,
			descriptionEditPending: false,
			descriptionEditError: undefined,
			loadingIssue: true,
			currentUser: undefined,
		};

		const buildCommentOptions = (): IssuePanelOptions => ({
			summaryEditPending: panelState.summaryEditPending,
			summaryEditError: panelState.summaryEditError,
			descriptionEditPending: panelState.descriptionEditPending,
			descriptionEditError: panelState.descriptionEditError,
			comments: panelState.comments,
			commentsError: panelState.commentsError,
			commentsPending: panelState.commentsLoading,
			commentSubmitPending: panelState.commentSubmitPending,
			commentSubmitError: panelState.commentSubmitError,
			commentDeletingId: panelState.commentDeletingId,
			commentFormat: panelState.commentFormat,
			commentDraft: panelState.commentDraft,
			commentReplyContext: panelState.commentReplyContext,
			currentUser: panelState.currentUser,
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

		const panel = JiraWebviewPanel.showIssueDetailsPanel(
			resolvedIssueKey,
			panelState.issue,
			initialOptions,
			async (message) => {
				if (assigneePickerSession && (await assigneePickerSession.handleMessage(message))) {
					return;
				}
				if (parentPickerSession && (await parentPickerSession.handleMessage(message))) {
					return;
				}
				if (message?.type === 'changeStatus' && typeof message.transitionId === 'string') {
					await handleStatusChange(message.transitionId);
				} else if (message?.type === 'changeAssignee' && typeof message.accountId === 'string') {
					await handleAssigneeChange(message.accountId);
				} else if (message?.type === 'openAssigneePicker') {
					await handleAssigneePicker();
				} else if (message?.type === 'openParentPicker') {
					await handleParentChange();
				} else if (message?.type === 'commitFromIssue') {
					await vscode.commands.executeCommand('jira.commitFromIssue', {
						issue: panelState.issue ?? { key: resolvedIssueKey },
					});
				} else if (message?.type === 'searchCommitHistory') {
					await vscode.commands.executeCommand('jira.searchCommitHistory', {
						issue: panelState.issue ?? { key: resolvedIssueKey },
					});
				} else if (message?.type === 'addComment' && typeof message.body === 'string') {
					await handleAddComment(message.body);
				} else if (message?.type === 'deleteComment' && typeof message.commentId === 'string') {
					await handleDeleteComment(message.commentId);
				} else if (message?.type === 'refreshComments') {
					await refreshComments(true);
				} else if (message?.type === 'startCommentReply' && typeof message.commentId === 'string') {
					handleStartCommentReply(message.commentId);
				} else if (message?.type === 'cancelCommentReply') {
					handleCancelCommentReply();
				} else if (message?.type === 'updateSummary' && typeof message.summary === 'string') {
					await handleSummaryUpdate(message.summary);
				} else if (message?.type === 'updateDescription' && typeof message.description === 'string') {
					await handleDescriptionUpdate(message.description);
				} else if (message?.type === 'commentDraftChanged' && typeof message.value === 'string') {
					panelState.commentDraft = message.value;
					if (panelState.commentSubmitError) {
						panelState.commentSubmitError = undefined;
					}
				}
			}
		);

		let assigneePickerSession: AssigneePickerSession | undefined;
		let parentPickerSession: ParentIssuePickerSession | undefined;

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
			JiraWebviewPanel.renderIssuePanelContent(panel, panelState.issue, merged);
		};

		/**
		 * Resolves Jira-owned icon URLs for the active issue header through the authenticated local cache.
		 */
		const resolveIssueForWebview = async (issue: JiraIssue): Promise<JiraIssue> => {
			return webviewIconService.createIssueWithResolvedIconSources(panel.webview, issue);
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
			assigneePickerSession?.dispose();
			parentPickerSession?.dispose();
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
			panelState.currentUser = {
				accountId: authInfo.accountId ?? authInfo.username,
				displayName: authInfo.displayName ?? authInfo.username,
			};

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
				const fetchedIssue = await jiraApiClient.fetchIssueDetails(authInfo, token, resolvedIssueKey);
				const issue = await resolveIssueForWebview(fetchedIssue);
				const issueProjectKeyResolved = IssueControllerFactory.deriveProjectKeyFromIssueKey(issue.key);
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
				panelState.summaryEditPending = false;
				panelState.summaryEditError = undefined;
				panelState.descriptionEditPending = false;
				panelState.descriptionEditError = undefined;
				renderPanel({
					statusOptions: panelState.transitions ?? panelState.statusPrefill,
					statusPending: false,
					statusError: transitionResult.error
						? `Unable to load available statuses: ${transitionResult.error}`
						: undefined,
					assigneeQuery: panelState.assigneeQuery,
				});
			} catch (error) {
				const message = ErrorHelper.deriveErrorMessage(error);
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
				await jiraApiClient.transitionIssueStatus(authInfo, token, resolvedIssueKey, transitionId);
				const fetchedUpdatedIssue = await jiraApiClient.fetchIssueDetails(authInfo, token, resolvedIssueKey);
				const updatedIssue = await resolveIssueForWebview(fetchedUpdatedIssue);
				const updatedProjectKey = IssueControllerFactory.deriveProjectKeyFromIssueKey(updatedIssue.key);
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
				const message = ErrorHelper.deriveErrorMessage(error);
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
				await jiraApiClient.assignIssue(authInfo, token, resolvedIssueKey, accountId);
				const fetchedUpdatedIssue = await jiraApiClient.fetchIssueDetails(authInfo, token, resolvedIssueKey);
				const updatedIssue = await resolveIssueForWebview(fetchedUpdatedIssue);
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
				const message = ErrorHelper.deriveErrorMessage(error);
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

		async function handleAssigneePicker(): Promise<void> {
			if (disposed) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to update the assignee.');
				return;
			}

			if (assigneePickerSession) {
				return;
			}
			assigneePickerSession = assigneePicker.pickAssignee({
				panel,
				scopeLabel: `Issue ${resolvedIssueKey}`,
				authInfo,
				token,
				scopeOrIssueKey: resolvedIssueKey,
				initialSelectedAccountId: panelState.issue.assigneeAccountId ?? undefined,
				initialSelectedUser: panelState.issue.assigneeAccountId
					? {
							accountId: panelState.issue.assigneeAccountId,
							displayName: panelState.issue.assigneeName ?? panelState.issue.assigneeAccountId,
							avatarUrl: panelState.issue.assigneeAvatarUrl,
					  }
					: undefined,
			});
			void assigneePickerSession.promise.then(async (selection) => {
				assigneePickerSession = undefined;
				if (!selection || disposed) {
					return;
				}
				const currentAccountId = panelState.issue.assigneeAccountId?.trim() ?? '';
				const nextAccountId =
					selection.kind === 'user'
						? selection.user.accountId?.trim() ?? ''
						: '';
				if (currentAccountId === nextAccountId) {
					return;
				}

				renderPanel({
					statusOptions: panelState.transitions,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
					loading: true,
				});

				try {
					await jiraApiClient.assignIssue(authInfo, token, resolvedIssueKey, nextAccountId || undefined);
					const fetchedUpdatedIssue = await jiraApiClient.fetchIssueDetails(authInfo, token, resolvedIssueKey);
					const updatedIssue = await resolveIssueForWebview(fetchedUpdatedIssue);
					if (disposed) {
						return;
					}
					panelState.issue = updatedIssue;
					renderPanel({
						statusOptions: panelState.transitions ?? panelState.statusPrefill,
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
						loading: false,
					});
					refreshAll();
				} catch (error) {
					const message = ErrorHelper.deriveErrorMessage(error);
					if (!disposed) {
						renderPanel({
							statusOptions: panelState.transitions,
							assigneeOptions: panelState.assignableUsers,
							assigneeQuery: panelState.assigneeQuery,
							loading: false,
							error: `Failed to update assignee: ${message}`,
						});
					}
					await vscode.window.showErrorMessage(`Failed to update assignee: ${message}`);
				}
			});
		}

		async function handleParentChange(): Promise<void> {
			if (disposed) {
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to update the parent issue.');
				return;
			}

			if (parentPickerSession) {
				return;
			}
			parentPickerSession = parentIssuePicker.pickParentIssue({
				panel,
				project: {
					key: IssueControllerFactory.deriveProjectKeyFromIssueKey(resolvedIssueKey) ?? resolvedIssueKey,
				},
				authInfo,
				token,
				excludeIssueKey: resolvedIssueKey,
				initialSelectedIssueKey: panelState.issue.parent?.key ?? undefined,
			});
			void parentPickerSession.promise.then(async (selection) => {
				parentPickerSession = undefined;
				if (!selection || disposed) {
					return;
				}
				const currentParentKey = panelState.issue.parent?.key?.trim() ?? '';
				const nextParentKey =
					selection.kind === 'issue'
						? selection.issue.key?.trim() ?? ''
						: '';
				if (nextParentKey === currentParentKey) {
					return;
				}

				renderPanel({
					statusOptions: panelState.transitions,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
					loading: true,
				});

				try {
					await jiraApiClient.updateIssueParent(
						authInfo,
						token,
						resolvedIssueKey,
						nextParentKey || undefined
					);
					const fetchedUpdatedIssue = await jiraApiClient.fetchIssueDetails(authInfo, token, resolvedIssueKey);
					const updatedIssue = await resolveIssueForWebview(fetchedUpdatedIssue);
					if (disposed) {
						return;
					}
					panelState.issue = updatedIssue;
					renderPanel({
						statusOptions: panelState.transitions ?? panelState.statusPrefill,
						assigneeOptions: panelState.assignableUsers,
						assigneeQuery: panelState.assigneeQuery,
						loading: false,
					});
					refreshAll();
				} catch (error) {
					const message = ErrorHelper.deriveErrorMessage(error);
					if (!disposed) {
						renderPanel({
							statusOptions: panelState.transitions,
							assigneeOptions: panelState.assignableUsers,
							assigneeQuery: panelState.assigneeQuery,
							loading: false,
							error: `Failed to update parent issue: ${message}`,
						});
					}
					await vscode.window.showErrorMessage(`Failed to update parent issue: ${message}`);
				}
			});
		}

		async function handleSummaryUpdate(summary: string): Promise<void> {
			if (disposed) {
				return;
			}

			const trimmed = summary?.trim() ?? '';
			if (!trimmed) {
				panelState.summaryEditError = 'Title cannot be empty.';
				renderPanel();
				return;
			}

			if (trimmed === (panelState.issue.summary ?? '').trim()) {
				panelState.summaryEditError = undefined;
				renderPanel();
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to update issue title.');
				return;
			}

			panelState.summaryEditPending = true;
			panelState.summaryEditError = undefined;
			renderPanel();

			try {
				await jiraApiClient.updateIssueSummary(authInfo, token, resolvedIssueKey, trimmed);
				const fetchedUpdatedIssue = await jiraApiClient.fetchIssueDetails(authInfo, token, resolvedIssueKey);
				const updatedIssue = await resolveIssueForWebview(fetchedUpdatedIssue);
				if (disposed) {
					return;
				}
				panelState.issue = updatedIssue;
				panelState.summaryEditPending = false;
				panelState.summaryEditError = undefined;
				renderPanel({
					statusOptions: panelState.transitions ?? panelState.statusPrefill,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
				});
				refreshAll();
			} catch (error) {
				const message = ErrorHelper.deriveErrorMessage(error);
				if (!disposed) {
					panelState.summaryEditPending = false;
					panelState.summaryEditError = `Failed to update title: ${message}`;
					renderPanel();
				}
				await vscode.window.showErrorMessage(`Failed to update title: ${message}`);
			}
		}

		async function handleDescriptionUpdate(description: string): Promise<void> {
			if (disposed) {
				return;
			}

			const currentDescription = panelState.issue.description ?? '';
			if (description === currentDescription) {
				panelState.descriptionEditError = undefined;
				renderPanel();
				return;
			}

			const authInfo = await authManager.getAuthInfo();
			const token = await authManager.getToken();
			if (!authInfo || !token) {
				await vscode.window.showInformationMessage('Log in to Jira to update issue description.');
				return;
			}

			panelState.descriptionEditPending = true;
			panelState.descriptionEditError = undefined;
			renderPanel();

			try {
				await jiraApiClient.updateIssueDescription(authInfo, token, resolvedIssueKey, description);
				const fetchedUpdatedIssue = await jiraApiClient.fetchIssueDetails(authInfo, token, resolvedIssueKey);
				const updatedIssue = await resolveIssueForWebview(fetchedUpdatedIssue);
				if (disposed) {
					return;
				}
				panelState.issue = updatedIssue;
				panelState.descriptionEditPending = false;
				panelState.descriptionEditError = undefined;
				renderPanel({
					statusOptions: panelState.transitions ?? panelState.statusPrefill,
					assigneeOptions: panelState.assignableUsers,
					assigneeQuery: panelState.assigneeQuery,
				});
				refreshAll();
			} catch (error) {
				const message = ErrorHelper.deriveErrorMessage(error);
				if (!disposed) {
					panelState.descriptionEditPending = false;
					panelState.descriptionEditError = `Failed to update description: ${message}`;
					renderPanel();
				}
				await vscode.window.showErrorMessage(`Failed to update description: ${message}`);
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
				const comments = await jiraApiClient.fetchIssueComments(authInfo, token, resolvedIssueKey);
				if (disposed) {
					return;
				}
				panelState.comments = comments;
				if (
					panelState.commentReplyContext &&
					!comments.some((comment) => comment.id === panelState.commentReplyContext?.commentId)
				) {
					panelState.commentReplyContext = undefined;
				}
				panelState.commentsError = undefined;
				panelState.commentsLoading = false;
				renderPanel();
			} catch (error) {
				const message = ErrorHelper.deriveErrorMessage(error);
				if (disposed) {
					return;
				}
				panelState.commentsError = `Failed to load comments: ${message}`;
				panelState.commentsLoading = false;
				renderPanel();
			}
		}

		async function handleAddComment(body: string): Promise<void> {
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
			panelState.commentFormat = 'wiki';
			panelState.commentSubmitPending = true;
			panelState.commentSubmitError = undefined;
			renderPanel();

			try {
				const commentBody = IssueCommentReplyService.buildCommentBody(trimmedBody, panelState.commentReplyContext);
				await jiraApiClient.addIssueComment(authInfo, token, resolvedIssueKey, commentBody, 'wiki');
				panelState.commentDraft = '';
				panelState.commentSubmitPending = false;
				panelState.commentSubmitError = undefined;
				panelState.commentReplyContext = undefined;
				renderPanel();
				await refreshComments(true);
			} catch (error) {
				const message = ErrorHelper.deriveErrorMessage(error);
				panelState.commentSubmitPending = false;
				panelState.commentSubmitError = `Failed to add comment: ${message}`;
				renderPanel();
				await vscode.window.showErrorMessage(`Failed to add comment: ${message}`);
			}
		}

		function handleStartCommentReply(commentId: string): void {
			if (disposed || !commentId) {
				return;
			}

			const sourceComment = panelState.comments?.find((comment) => comment.id === commentId);
			if (!sourceComment) {
				return;
			}

			panelState.commentReplyContext = IssueCommentReplyService.createReplyContext(sourceComment);
			panelState.commentSubmitError = undefined;
			renderPanel();
		}

		function handleCancelCommentReply(): void {
			if (disposed || !panelState.commentReplyContext) {
				return;
			}

			panelState.commentReplyContext = undefined;
			panelState.commentSubmitError = undefined;
			renderPanel();
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
				await jiraApiClient.deleteIssueComment(authInfo, token, resolvedIssueKey, commentId);
				panelState.commentDeletingId = undefined;
				renderPanel();
				await refreshComments(true);
			} catch (error) {
				const message = ErrorHelper.deriveErrorMessage(error);
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
			const normalizedProjectKey =
				projectKey ?? IssueControllerFactory.deriveProjectKeyFromIssueKey(targetIssue.key);
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
			const fetchedTransitions = await jiraApiClient.fetchIssueTransitions(authInfo, token, targetIssue.key);
			if (fetchedTransitions && fetchedTransitions.length > 0) {
				transitionStore.remember(cacheKey, fetchedTransitions);
			}
			return { transitions: fetchedTransitions };
		} catch (error) {
			return { error: ErrorHelper.deriveErrorMessage(error) };
		}
	}

		return {
			openIssueDetails,
		};
	}

	private static deriveProjectKeyFromIssueKey(issueKey?: string): string | undefined {
		if (!issueKey) {
			return undefined;
		}
		const separatorIndex = issueKey.indexOf('-');
		const projectPart = separatorIndex === -1 ? issueKey : issueKey.slice(0, separatorIndex);
		const trimmed = projectPart.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
}

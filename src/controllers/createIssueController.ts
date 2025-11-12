import * as vscode from 'vscode';

import { JiraAuthManager } from '../model/authManager';
import { JiraFocusManager } from '../model/focusManager';
import { ISSUE_STATUS_OPTIONS, ISSUE_TYPE_OPTIONS } from '../model/constants';
import { createJiraIssue, fetchAssignableUsers } from '../model/jiraApiClient';
import {
	CreateIssueFormValues,
	CreateIssuePanelState,
	IssueAssignableUser,
	JiraIssue,
	SelectedProjectInfo,
} from '../model/types';
import { deriveErrorMessage } from '../shared/errors';
import { renderCreateIssuePanel, showCreateIssuePanel } from '../views/webview/panels';

export type CreateIssueControllerDeps = {
	authManager: JiraAuthManager;
	focusManager: JiraFocusManager;
	refreshItemsView: () => void;
	openIssueDetails: (issueOrKey?: JiraIssue | string) => Promise<void>;
};

export function createCreateIssueController(deps: CreateIssueControllerDeps) {
	const { authManager, focusManager, refreshItemsView, openIssueDetails } = deps;

	const createIssue = async (): Promise<void> => {
		const project = focusManager.getSelectedProject();
		if (!project) {
			await vscode.window.showInformationMessage('Select a project before creating a Jira ticket.');
			return;
		}

		const authInfo = await authManager.getAuthInfo();
		if (!authInfo) {
			await vscode.window.showInformationMessage('Log in to Jira before creating a ticket.');
			return;
		}

		const token = await authManager.getToken();
		if (!token) {
			await vscode.window.showInformationMessage('Missing auth token. Please log in again.');
			return;
		}

		let state: CreateIssuePanelState = {
			values: {
				summary: '',
				description: '',
				issueType: 'Task',
				status: ISSUE_STATUS_OPTIONS[0],
			},
			assigneeQuery: '',
		};

		const panel = showCreateIssuePanel(project, state);
		let disposed = false;
		panel.onDidDispose(() => {
			disposed = true;
		});

		const updatePanel = (updates: Partial<CreateIssuePanelState>) => {
			if (disposed) {
				return;
			}
			state = { ...state, ...updates };
			renderCreateIssuePanel(panel, project, state);
		};

		panel.webview.onDidReceiveMessage(async (message) => {
			if (!message?.type) {
				return;
			}
				if (message.type === 'loadCreateAssignees') {
					const values = sanitizeCreateIssueValues(message.values, state.values);
					const normalizedQuery =
						typeof message.query === 'string' ? message.query.trim() : state.assigneeQuery?.trim() ?? '';
					updatePanel({
						assigneePending: true,
						assigneeError: undefined,
						assigneeQuery: normalizedQuery,
						values,
					});
				try {
					const users = await fetchAssignableUsers(
						authInfo,
						token,
						{ projectKey: project.key },
						normalizedQuery
					);
						updatePanel({
							assigneePending: false,
							assigneeOptions: users,
							assigneeQuery: normalizedQuery,
							values,
						});
				} catch (error) {
					const messageText = deriveErrorMessage(error);
						updatePanel({
							assigneePending: false,
							assigneeError: `Failed to load assignable users: ${messageText}`,
							assigneeQuery: normalizedQuery,
							values,
						});
				}
				return;
			}

			if (message.type === 'selectCreateAssignee') {
				const accountIdRaw =
					typeof message.accountId === 'string' ? message.accountId.trim() : undefined;
				const displayName =
					typeof message.displayName === 'string' ? message.displayName.trim() : undefined;
				updatePanel({
					values: {
						...state.values,
						assigneeAccountId: accountIdRaw || undefined,
						assigneeDisplayName: accountIdRaw ? displayName || accountIdRaw : undefined,
					},
					successIssue: undefined,
				});
				return;
			}

			if (message.type !== 'createIssue') {
				return;
			}

			const values = sanitizeCreateIssueValues(message.values, state.values);
			if (!values.summary.trim()) {
				updatePanel({ error: 'Summary is required.', values });
				return;
			}

			updatePanel({ submitting: true, error: undefined, successIssue: undefined, values });
			try {
				const createdIssue = await createJiraIssue(authInfo, token, project.key, values);
				updatePanel({
					values: {
						summary: '',
						description: '',
						issueType: values.issueType,
						status: values.status,
						assigneeAccountId: values.assigneeAccountId,
						assigneeDisplayName: values.assigneeDisplayName,
					},
					submitting: false,
					successIssue: createdIssue,
				});
				refreshItemsView();
				await openIssueDetails(createdIssue);
			} catch (error) {
				const messageText = deriveErrorMessage(error);
				updatePanel({ submitting: false, error: `Failed to create issue: ${messageText}` });
			}
		});
	};

	return {
		createIssue,
	};
}

function sanitizeCreateIssueValues(
	raw: any,
	fallback: CreateIssueFormValues
): CreateIssueFormValues {
	const summary = typeof raw?.summary === 'string' ? raw.summary : fallback.summary;
	const description = typeof raw?.description === 'string' ? raw.description : fallback.description;
	const issueTypeRaw = typeof raw?.issueType === 'string' ? raw.issueType : fallback.issueType;
	const normalizedType = issueTypeRaw?.trim() || fallback.issueType;
	const issueType = ISSUE_TYPE_OPTIONS.includes(normalizedType) ? normalizedType : fallback.issueType;
	const statusRaw = typeof raw?.status === 'string' ? raw.status : fallback.status;
	const normalizedStatus = statusRaw?.trim() || fallback.status;
	const status = ISSUE_STATUS_OPTIONS.includes(normalizedStatus) ? normalizedStatus : fallback.status;
	const assigneeAccountIdRaw =
		typeof raw?.assigneeAccountId === 'string' ? raw.assigneeAccountId.trim() : undefined;
	const fallbackAccountId = fallback.assigneeAccountId?.trim();
	const assigneeAccountId = assigneeAccountIdRaw || fallbackAccountId || undefined;
	let assigneeDisplayName: string | undefined;
	if (assigneeAccountId) {
		const displayNameRaw =
			typeof raw?.assigneeDisplayName === 'string' ? raw.assigneeDisplayName.trim() : undefined;
		const fallbackDisplayName = fallback.assigneeDisplayName?.trim();
		assigneeDisplayName = displayNameRaw || fallbackDisplayName || assigneeAccountId;
	}
	return {
		summary,
		description,
		issueType,
		status,
		assigneeAccountId,
		assigneeDisplayName,
	};
}

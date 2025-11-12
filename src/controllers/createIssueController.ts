import * as vscode from 'vscode';

import { JiraAuthManager } from '../model/authManager';
import { JiraFocusManager } from '../model/focusManager';
import { ProjectStatusStore } from '../model/projectStatusStore';
import { ISSUE_STATUS_OPTIONS, ISSUE_TYPE_OPTIONS } from '../model/constants';
import { createJiraIssue, fetchAssignableUsers } from '../model/jiraApiClient';
import {
	CreateIssueFormValues,
	CreateIssuePanelState,
	IssueAssignableUser,
	IssueStatusOption,
	JiraIssue,
	SelectedProjectInfo,
} from '../model/types';
import { deriveErrorMessage } from '../shared/errors';
import { renderCreateIssuePanel, showCreateIssuePanel } from '../views/webview/panels';

export type CreateIssueControllerDeps = {
	authManager: JiraAuthManager;
	focusManager: JiraFocusManager;
	projectStatusStore: ProjectStatusStore;
	refreshItemsView: () => void;
	openIssueDetails: (issueOrKey?: JiraIssue | string) => Promise<void>;
};

export function createCreateIssueController(deps: CreateIssueControllerDeps) {
	const { authManager, focusManager, projectStatusStore, refreshItemsView, openIssueDetails } = deps;

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

		const cachedStatuses = projectStatusStore.get(project.key);
		const initialStatus = deriveInitialStatusName(cachedStatuses);

		let state: CreateIssuePanelState = {
			values: {
				summary: '',
				description: '',
				issueType: 'Task',
				status: initialStatus,
			},
			assigneeQuery: '',
			statusOptions: cachedStatuses,
			statusPending: !cachedStatuses,
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

		if (!cachedStatuses) {
			void loadProjectStatuses(project.key);
		}

		async function loadProjectStatuses(projectKey: string): Promise<void> {
			try {
				const statuses = await projectStatusStore.ensure(projectKey);
				if (!statuses || statuses.length === 0) {
					updatePanel({
						statusOptions: [],
						statusPending: false,
						statusError: 'No statuses available for this project. Using defaults.',
					});
					return;
				}
				const availableNames = deriveStatusNameList(statuses);
				const currentStatus = state.values.status?.trim().toLowerCase();
				const hasCurrentSelection =
					currentStatus && availableNames.some((name) => name.toLowerCase() === currentStatus);
				updatePanel({
					statusOptions: statuses,
					statusPending: false,
					statusError: undefined,
					values: hasCurrentSelection
						? state.values
						: {
								...state.values,
								status: availableNames[0] ?? state.values.status,
						  },
				});
			} catch (error) {
				const messageText = deriveErrorMessage(error);
				updatePanel({
					statusPending: false,
					statusError: `Failed to load project statuses: ${messageText}`,
				});
			}
		}

		panel.webview.onDidReceiveMessage(async (message) => {
			if (!message?.type) {
				return;
			}
			if (message.type === 'loadCreateAssignees') {
				const values = sanitizeCreateIssueValues(message.values, state.values, state.statusOptions);
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

			const values = sanitizeCreateIssueValues(message.values, state.values, state.statusOptions);
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
	fallback: CreateIssueFormValues,
	statusOptions?: IssueStatusOption[]
): CreateIssueFormValues {
	const summary = typeof raw?.summary === 'string' ? raw.summary : fallback.summary;
	const description = typeof raw?.description === 'string' ? raw.description : fallback.description;
	const issueTypeRaw = typeof raw?.issueType === 'string' ? raw.issueType : fallback.issueType;
	const normalizedType = issueTypeRaw?.trim() || fallback.issueType;
	const issueType = ISSUE_TYPE_OPTIONS.includes(normalizedType) ? normalizedType : fallback.issueType;
	const statusRaw = typeof raw?.status === 'string' ? raw.status : fallback.status;
	const normalizedStatus = statusRaw?.trim() || fallback.status;
	const availableStatuses = deriveStatusNameList(statusOptions);
	const fallbackStatus = isStatusAllowed(fallback.status, availableStatuses)
		? fallback.status
		: availableStatuses[0] ?? fallback.status;
	const status = isStatusAllowed(normalizedStatus, availableStatuses) ? normalizedStatus : fallbackStatus;
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

function deriveStatusNameList(options?: IssueStatusOption[]): string[] {
	if (!options || options.length === 0) {
		return ISSUE_STATUS_OPTIONS;
	}
	const seen = new Set<string>();
	const names: string[] = [];
	for (const option of options) {
		const name = option?.name?.trim();
		if (!name) {
			continue;
		}
		const key = name.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			names.push(name);
		}
	}
	return names.length > 0 ? names : ISSUE_STATUS_OPTIONS;
}

function deriveInitialStatusName(options?: IssueStatusOption[]): string {
	const names = deriveStatusNameList(options);
	return names[0] ?? ISSUE_STATUS_OPTIONS[0];
}

function isStatusAllowed(value: string | undefined, options: string[]): boolean {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return options.some((name) => name.toLowerCase() === normalized);
}

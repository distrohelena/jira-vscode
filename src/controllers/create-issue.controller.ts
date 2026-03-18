import * as vscode from 'vscode';

import { JiraAuthManager } from '../model/auth.manager';
import { JiraFocusManager } from '../model/focus.manager';
import { ProjectStatusStore } from '../model/project-status.store';
import { ISSUE_STATUS_OPTIONS, ISSUE_TYPE_OPTIONS } from '../model/jira.constant';
import { jiraApiClient } from '../jira-api';
import {
	CreateIssueFieldDefinition,
	CreateIssueFormValues,
	CreateIssuePanelState,
	IssueAssignableUser,
	IssueStatusOption,
	JiraIssue,
	SelectedProjectInfo,
} from '../model/jira.type';
import { ErrorHelper } from '../shared/error.helper';
import { JiraWebviewPanel } from '../views/webview/webview.panel';

export type CreateIssueControllerDeps = {
	authManager: JiraAuthManager;
	focusManager: JiraFocusManager;
	projectStatusStore: ProjectStatusStore;
	revealIssueInItemsView: (issueOrKey?: JiraIssue | string) => Promise<void>;
	openIssueDetails: (issueOrKey?: JiraIssue | string) => Promise<void>;
};

export class CreateIssueControllerFactory {
	static create(deps: CreateIssueControllerDeps) {
		return CreateIssueControllerFactory.createCreateIssueControllerInternal(deps);
	}

	private static createCreateIssueControllerInternal(deps: CreateIssueControllerDeps) {
	const { authManager, focusManager, projectStatusStore, revealIssueInItemsView, openIssueDetails } = deps;

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
		const authenticatedInfo = authInfo;
		const selectedProject = project;

		const token = await authManager.getToken();
		if (!token) {
			await vscode.window.showInformationMessage('Missing auth token. Please log in again.');
			return;
		}
		const authenticatedToken = token;

		const cachedStatuses = projectStatusStore.get(selectedProject.key);
		const initialStatus = CreateIssueControllerFactory.deriveInitialStatusName(cachedStatuses);

		let state: CreateIssuePanelState = {
			values: {
				summary: '',
				description: '',
				issueType: 'Task',
				status: initialStatus,
				customFields: {},
			},
			createFields: [],
			createFieldsPending: true,
			currentUser: {
				accountId: authInfo.accountId ?? authInfo.username,
				displayName: authInfo.displayName ?? authInfo.username,
			},
			assigneeQuery: '',
			statusOptions: cachedStatuses,
			statusPending: !cachedStatuses,
		};

		const panel = JiraWebviewPanel.showCreateIssuePanel(selectedProject, state);
		let disposed = false;
		panel.onDidDispose(() => {
			disposed = true;
		});

		const updatePanel = (updates: Partial<CreateIssuePanelState>) => {
			if (disposed) {
				return;
			}
			state = { ...state, ...updates };
			JiraWebviewPanel.renderCreateIssuePanel(panel, selectedProject, state);
		};

			if (!cachedStatuses) {
				void loadProjectStatuses(selectedProject.key);
			}
			void loadCreateFields(state.values.issueType, state.values);

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
				const availableNames = CreateIssueControllerFactory.deriveStatusNameList(statuses);
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
				const messageText = ErrorHelper.deriveErrorMessage(error);
				updatePanel({
					statusPending: false,
					statusError: `Failed to load project statuses: ${messageText}`,
				});
			}
		}

		async function loadCreateFields(
			issueTypeName: string | undefined,
			valuesForMerge?: CreateIssueFormValues
		): Promise<void> {
			const values = valuesForMerge ?? state.values;
			updatePanel({
				values,
				createFieldsPending: true,
				createFieldsError: undefined,
			});
			try {
					const fields = await jiraApiClient.fetchCreateIssueFields(
						authenticatedInfo,
						authenticatedToken,
						selectedProject.key,
						issueTypeName
					);
				const mergedValues = CreateIssueControllerFactory.mergeCustomFieldsForDefinitions(values, fields);
				updatePanel({
					values: mergedValues,
					createFields: fields,
					createFieldsPending: false,
					createFieldsError: undefined,
				});
			} catch (error) {
				const messageText = ErrorHelper.deriveErrorMessage(error);
				updatePanel({
					createFields: [],
					createFieldsPending: false,
					createFieldsError: `Failed to load additional fields: ${messageText}`,
				});
			}
		}

		panel.webview.onDidReceiveMessage(async (message) => {
			if (!message?.type) {
				return;
			}
			if (message.type === 'loadCreateAssignees') {
				const values = CreateIssueControllerFactory.sanitizeCreateIssueValues(message.values, state.values, state.statusOptions);
					const normalizedQuery =
						typeof message.query === 'string' ? message.query.trim() : state.assigneeQuery?.trim() ?? '';
					updatePanel({
						assigneePending: true,
						assigneeError: undefined,
						assigneeQuery: normalizedQuery,
						values,
					});
				try {
						const users = await jiraApiClient.fetchAssignableUsers(
							authenticatedInfo,
							authenticatedToken,
							{ projectKey: selectedProject.key },
							normalizedQuery
						);
						updatePanel({
							assigneePending: false,
							assigneeOptions: users,
							assigneeQuery: normalizedQuery,
							values,
						});
				} catch (error) {
					const messageText = ErrorHelper.deriveErrorMessage(error);
						updatePanel({
							assigneePending: false,
							assigneeError: `Failed to load assignable users: ${messageText}`,
							assigneeQuery: normalizedQuery,
							values,
						});
				}
				return;
			}

			if (message.type === 'createIssueTypeChanged') {
				const values = CreateIssueControllerFactory.sanitizeCreateIssueValues(message.values, state.values, state.statusOptions);
				updatePanel({ values });
				void loadCreateFields(values.issueType, values);
				return;
			}

			if (message.type === 'selectCreateAssignee') {
				const values = CreateIssueControllerFactory.sanitizeCreateIssueValues(message.values, state.values, state.statusOptions);
				const accountIdRaw =
					typeof message.accountId === 'string' ? message.accountId.trim() : undefined;
				const accountId = accountIdRaw || values.assigneeAccountId || undefined;
				const displayName =
					typeof message.displayName === 'string' ? message.displayName.trim() : undefined;
				const avatarUrl =
					typeof message.avatarUrl === 'string' ? message.avatarUrl.trim() : undefined;
				updatePanel({
					values: {
						...values,
						assigneeAccountId: accountId,
						assigneeDisplayName: accountId ? displayName || values.assigneeDisplayName || accountId : undefined,
						assigneeAvatarUrl: accountId ? avatarUrl || values.assigneeAvatarUrl : undefined,
					},
					successIssue: undefined,
				});
				return;
			}

			if (message.type !== 'createIssue') {
				return;
			}

			const values = CreateIssueControllerFactory.sanitizeCreateIssueValues(message.values, state.values, state.statusOptions);
			if (!values.summary.trim()) {
				updatePanel({ error: 'Summary is required.', values });
				return;
			}
			const missingRequiredField = (state.createFields ?? []).find(
				(field) => field.required && !(values.customFields?.[field.id] ?? '').trim()
			);
			if (missingRequiredField) {
				updatePanel({ error: `${missingRequiredField.name} is required.`, values });
				return;
			}

			updatePanel({ submitting: true, error: undefined, successIssue: undefined, values });
			try {
				const createdIssue = await jiraApiClient.createIssue(
					authenticatedInfo,
					authenticatedToken,
					selectedProject.key,
					values
				);
				updatePanel({
					submitting: false,
					error: undefined,
					successIssue: createdIssue,
					values,
				});
				void revealIssueInItemsView(createdIssue);
				try {
					await openIssueDetails(createdIssue);
				} catch (error) {
					const messageText = ErrorHelper.deriveErrorMessage(error);
					void vscode.window.showErrorMessage(
						`Created ${createdIssue.key} but failed to open details: ${messageText}`
					);
				}
			} catch (error) {
				const messageText = ErrorHelper.deriveErrorMessage(error);
				updatePanel({ submitting: false, error: `Failed to create issue: ${messageText}` });
			}
		});
	};

	return {
		createIssue,
	};
}

	private static sanitizeCreateIssueValues(
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
	const availableStatuses = CreateIssueControllerFactory.deriveStatusNameList(statusOptions);
	const fallbackStatus = CreateIssueControllerFactory.isStatusAllowed(fallback.status, availableStatuses)
		? fallback.status
		: availableStatuses[0] ?? fallback.status;
	const status = CreateIssueControllerFactory.isStatusAllowed(normalizedStatus, availableStatuses) ? normalizedStatus : fallbackStatus;
	const customFields = CreateIssueControllerFactory.sanitizeCustomFields(raw?.customFields, fallback.customFields);
	const assigneeAccountIdRaw =
		typeof raw?.assigneeAccountId === 'string' ? raw.assigneeAccountId.trim() : undefined;
	const fallbackAccountId = fallback.assigneeAccountId?.trim();
	const assigneeAccountId = assigneeAccountIdRaw || fallbackAccountId || undefined;
	let assigneeDisplayName: string | undefined;
	let assigneeAvatarUrl: string | undefined;
	if (assigneeAccountId) {
		const displayNameRaw =
			typeof raw?.assigneeDisplayName === 'string' ? raw.assigneeDisplayName.trim() : undefined;
		const fallbackDisplayName = fallback.assigneeDisplayName?.trim();
		assigneeDisplayName = displayNameRaw || fallbackDisplayName || assigneeAccountId;
		const avatarUrlRaw =
			typeof raw?.assigneeAvatarUrl === 'string' ? raw.assigneeAvatarUrl.trim() : undefined;
		const fallbackAvatarUrl = fallback.assigneeAvatarUrl?.trim();
		assigneeAvatarUrl = avatarUrlRaw || fallbackAvatarUrl;
	}
	return {
		summary,
		description,
		issueType,
		status,
		customFields,
		assigneeAccountId,
		assigneeDisplayName,
		assigneeAvatarUrl,
	};
}

	private static sanitizeCustomFields(
	raw: any,
	fallback?: Record<string, string>
): Record<string, string> {
	const result: Record<string, string> = {};
	if (fallback && typeof fallback === 'object') {
		for (const [key, value] of Object.entries(fallback)) {
			if (typeof key !== 'string' || key.trim().length === 0) {
				continue;
			}
			result[key] = typeof value === 'string' ? value : '';
		}
	}
	if (!raw || typeof raw !== 'object') {
		return result;
	}
	for (const [key, value] of Object.entries(raw)) {
		if (typeof key !== 'string' || key.trim().length === 0) {
			continue;
		}
		result[key] = typeof value === 'string' ? value : '';
	}
	return result;
}

	private static mergeCustomFieldsForDefinitions(
	values: CreateIssueFormValues,
	definitions: CreateIssueFieldDefinition[]
): CreateIssueFormValues {
	const source = values.customFields ?? {};
	const filtered: Record<string, string> = {};
	for (const field of definitions) {
		const existing = source[field.id];
		filtered[field.id] = typeof existing === 'string' ? existing : '';
	}
	return {
		...values,
		customFields: filtered,
	};
}

	private static deriveStatusNameList(options?: IssueStatusOption[]): string[] {
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

	private static pickPreferredInitialStatus(names: string[]): string | undefined {
	const preferredOrder = ['To Do', 'Backlog'];
	const lowerNames = names.map((name) => name.toLowerCase());
	for (const target of preferredOrder) {
		const index = lowerNames.indexOf(target.toLowerCase());
		if (index >= 0) {
			return names[index];
		}
	}
	const firstNonDone = names.find((name) => !/done|closed|resolved/i.test(name));
	return firstNonDone;
}

	private static deriveInitialStatusName(options?: IssueStatusOption[]): string {
	const names = CreateIssueControllerFactory.deriveStatusNameList(options);
	const preferred = CreateIssueControllerFactory.pickPreferredInitialStatus(names);
	return preferred ?? names[0] ?? ISSUE_STATUS_OPTIONS[0];
}

	private static isStatusAllowed(value: string | undefined, options: string[]): boolean {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return options.some((name) => name.toLowerCase() === normalized);
	}
}

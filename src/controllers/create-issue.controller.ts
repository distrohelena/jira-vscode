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
	JiraAdfDocument,
	IssueAssignableUser,
	IssueStatusOption,
	JiraIssue,
	JiraRelatedIssue,
	RichTextMentionCandidate,
	SelectedProjectInfo,
} from '../model/jira.type';
import { ErrorHelper } from '../shared/error.helper';
import { JiraWebviewIconService } from '../services/jira-webview-icon.service';
import { ProjectAssignableMentionService } from '../services/project-assignable-mention.service';
import {
	ParentIssuePickerController,
	ParentIssuePickerSession,
} from './parent-issue-picker.controller';
import { AssigneePickerController, AssigneePickerSession } from './assignee-picker.controller';
import { JiraWebviewPanel } from '../views/webview/webview.panel';

export type CreateIssueControllerDeps = {
	authManager: JiraAuthManager;
	focusManager: JiraFocusManager;
	assigneePicker: AssigneePickerController;
	parentIssuePicker: ParentIssuePickerController;
	projectStatusStore: ProjectStatusStore;
	webviewIconService: JiraWebviewIconService;
	revealIssueInItemsView: (issueOrKey?: JiraIssue | string) => Promise<void>;
	openIssueDetails: (issueOrKey?: JiraIssue | string) => Promise<void>;
};

export class CreateIssueControllerFactory {
	static create(deps: CreateIssueControllerDeps) {
		return CreateIssueControllerFactory.createCreateIssueControllerInternal(deps);
	}

	private static createCreateIssueControllerInternal(deps: CreateIssueControllerDeps) {
	const {
		authManager,
		focusManager,
		assigneePicker,
		parentIssuePicker,
		projectStatusStore,
		webviewIconService,
		revealIssueInItemsView,
		openIssueDetails,
	} = deps;

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
			selectedParentIssue: undefined,
			statusOptions: cachedStatuses,
			statusPending: !cachedStatuses,
		};

		const panel = JiraWebviewPanel.showCreateIssuePanel(selectedProject, state);
		let disposed = false;
		let assigneePickerSession: AssigneePickerSession | undefined;
		let parentPickerSession: ParentIssuePickerSession | undefined;
		panel.onDidDispose(() => {
			disposed = true;
			assigneePickerSession?.dispose();
			parentPickerSession?.dispose();
		});

		const updatePanel = (updates: Partial<CreateIssuePanelState>) => {
			if (disposed) {
				return;
			}
			state = { ...state, ...updates };
			JiraWebviewPanel.renderCreateIssuePanel(panel, selectedProject, state);
		};

		/**
		 * Resolves Jira-owned status option icons for the active create-issue webview.
		 */
		const resolveStatusOptionsForWebview = async (
			options?: IssueStatusOption[]
		): Promise<IssueStatusOption[] | undefined> => {
			return webviewIconService.createStatusOptionsWithResolvedIconSources(panel.webview, options);
		};

			if (cachedStatuses) {
				void resolveStatusOptionsForWebview(cachedStatuses).then((resolvedStatuses) => {
					if (disposed || !resolvedStatuses) {
						return;
					}
					updatePanel({ statusOptions: resolvedStatuses, statusPending: false });
				});
			} else {
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
				const resolvedStatuses = await resolveStatusOptionsForWebview(statuses);
				updatePanel({
					statusOptions: resolvedStatuses ?? statuses,
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
			if (assigneePickerSession && (await assigneePickerSession.handleMessage(message))) {
				return;
			}
			if (parentPickerSession && (await parentPickerSession.handleMessage(message))) {
				return;
			}

			if (message.type === 'openAssigneePicker') {
				if (assigneePickerSession) {
					return;
				}
				assigneePickerSession = assigneePicker.pickAssignee({
					panel,
					scopeLabel: `${selectedProject.name ?? selectedProject.key} (${selectedProject.key})`,
					authInfo: authenticatedInfo,
					token: authenticatedToken,
					scopeOrIssueKey: { projectKey: selectedProject.key },
					initialSelectedAccountId: state.values.assigneeAccountId,
					initialSelectedUser: state.values.assigneeAccountId
						? {
								accountId: state.values.assigneeAccountId,
								displayName: state.values.assigneeDisplayName ?? state.values.assigneeAccountId,
								avatarUrl: state.values.assigneeAvatarUrl,
						  }
						: undefined,
				});
				void assigneePickerSession.promise.then((selection) => {
					if (disposed || !selection) {
						assigneePickerSession = undefined;
						return;
					}
					if (selection.kind === 'none') {
						state = {
							...state,
							values: {
								...state.values,
								assigneeAccountId: undefined,
								assigneeDisplayName: undefined,
								assigneeAvatarUrl: undefined,
							},
						};
						void panel.webview.postMessage({
							type: 'assigneePickerSelectionApplied',
						});
						assigneePickerSession = undefined;
						return;
					}
					state = {
						...state,
						values: {
							...state.values,
							assigneeAccountId: selection.user.accountId,
							assigneeDisplayName: selection.user.displayName,
							assigneeAvatarUrl: selection.user.avatarUrl,
						},
					};
					void panel.webview.postMessage({
						type: 'assigneePickerSelectionApplied',
						user: selection.user,
					});
					assigneePickerSession = undefined;
				});
				return;
			}

			if (message.type === 'openRichTextMentionSearch' && typeof message.editorId === 'string') {
				if (assigneePickerSession) {
					return;
				}
				const editorId = message.editorId;
				assigneePickerSession = assigneePicker.pickAssignee({
					mode: 'mention',
					panel,
					scopeLabel: `${selectedProject.name ?? selectedProject.key} (${selectedProject.key})`,
					authInfo: authenticatedInfo,
					token: authenticatedToken,
					scopeOrIssueKey: { projectKey: selectedProject.key },
					initialSearchQuery: typeof message.query === 'string' ? message.query : '',
					editorId,
				});
				void assigneePickerSession.promise.then((selection) => {
					assigneePickerSession = undefined;
					if (disposed || !selection || selection.kind !== 'user') {
						return;
					}

					const candidate: RichTextMentionCandidate = {
						accountId: selection.user.accountId,
						displayName: selection.user.displayName,
						mentionText: `@${selection.user.displayName}`,
						avatarUrl: selection.user.avatarUrl,
						userType: 'DEFAULT',
						source: 'assignable',
					};
					void panel.webview.postMessage({
						type: 'richTextMentionSearchSelectionApplied',
						editorId,
						candidate,
					});
				});
				return;
			}

			if (message.type === 'queryMentionCandidates' && typeof message.requestId === 'string') {
				let candidates: RichTextMentionCandidate[] = [];
				try {
					candidates = await ProjectAssignableMentionService.search(
						authenticatedInfo,
						authenticatedToken,
						{ projectKey: selectedProject.key },
						typeof message.query === 'string' ? message.query : ''
					);
				} catch {
					candidates = [];
				}
				await panel.webview.postMessage({
					type: 'richTextMentionCandidatesLoaded',
					editorId: typeof message.editorId === 'string' ? message.editorId : undefined,
					requestId: message.requestId,
					candidates,
				});
				return;
			}

			if (message.type === 'openParentPicker') {
				if (parentPickerSession) {
					return;
				}
				parentPickerSession = parentIssuePicker.pickParentIssue({
					panel,
					project: selectedProject,
					authInfo: authenticatedInfo,
					token: authenticatedToken,
					initialSelectedIssueKey: state.selectedParentIssue?.key ?? state.values.customFields?.parent ?? undefined,
				});
				void parentPickerSession.promise.then((selection) => {
					if (disposed || !selection) {
						parentPickerSession = undefined;
						return;
					}
					if (selection.kind === 'none') {
						state = {
							...state,
							selectedParentIssue: undefined,
							values: {
								...state.values,
								customFields: {
									...(state.values.customFields ?? {}),
									parent: '',
								},
							},
						};
						void panel.webview.postMessage({
							type: 'parentPickerSelectionApplied',
						});
						parentPickerSession = undefined;
						return;
					}
					const selectedIssue = selection.issue;
					const resolvedParent: JiraRelatedIssue = {
						key: selectedIssue.key,
						summary: selectedIssue.summary,
						statusName: selectedIssue.statusName,
						assigneeName: selectedIssue.assigneeName,
						url: selectedIssue.url,
						updated: selectedIssue.updated,
					};
					state = {
						...state,
						selectedParentIssue: resolvedParent,
						values: {
							...state.values,
							customFields: {
								...(state.values.customFields ?? {}),
								parent: selectedIssue.key,
							},
						},
					};
					void panel.webview.postMessage({
						type: 'parentPickerSelectionApplied',
						issue: resolvedParent,
					});
					parentPickerSession = undefined;
				});
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
				void panel.webview.postMessage({
					type: 'assigneePickerSelectionApplied',
					user: accountId
						? {
								accountId,
								displayName: displayName || values.assigneeDisplayName || accountId,
								avatarUrl: avatarUrl || values.assigneeAvatarUrl,
						  }
						: undefined,
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
	const descriptionDocument =
		CreateIssueControllerFactory.tryGetAdfDocument(raw?.descriptionDocument) ??
		fallback.descriptionDocument;
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
		descriptionDocument,
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

	/**
	 * Returns the provided value when it matches the shared Jira ADF document contract.
	 */
	private static tryGetAdfDocument(value: unknown): JiraAdfDocument | undefined {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return undefined;
		}

		const record = value as { type?: unknown; version?: unknown; content?: unknown };
		if (record.type !== 'doc' || record.version !== 1 || !Array.isArray(record.content)) {
			return undefined;
		}

		return value as JiraAdfDocument;
	}
}

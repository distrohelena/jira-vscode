import * as vscode from 'vscode';

import { jiraApiClient } from '../jira-api';
import { JiraAuthInfo, IssueAssignableUser } from '../model/jira.type';
import { ErrorHelper } from '../shared/error.helper';
import {
	AssigneePickerFilters,
	AssigneePickerNoneSelectionKey,
	AssigneePickerOverlay,
	AssigneePickerOverlayState,
} from '../views/webview/assignee-picker.overlay';

/**
 * Describes the inputs required to open the assignee picker for a create or edit screen.
 */
export type AssigneePickerRequest = {
	/**
	 * The active webview panel that will host the inline assignee picker overlay.
	 */
	panel: vscode.WebviewPanel;

	/**
	 * The label shown in the picker header to describe the active search scope.
	 */
	scopeLabel: string;

	/**
	 * The Jira auth identity used for API requests.
	 */
	authInfo: JiraAuthInfo;

	/**
	 * The Jira API token used for API requests.
	 */
	token: string;

	/**
	 * The assignable-user search scope accepted by the Jira API client.
	 */
	scopeOrIssueKey: string | { projectKey: string };

	/**
	 * The initially selected account identifier, when one already exists.
	 */
	initialSelectedAccountId?: string;

	/**
	 * The initial user details used to keep the current assignee visible before search results load.
	 */
	initialSelectedUser?: IssueAssignableUser;
};

/**
 * Represents a completed assignee-picker selection.
 */
export type AssigneePickerSelection =
	| {
			/**
			 * Identifies a concrete user selection.
			 */
			kind: 'user';

			/**
			 * Carries the selected assignable user.
			 */
			user: IssueAssignableUser;
	  }
	| {
			/**
			 * Identifies the explicit no-assignee option.
			 */
			kind: 'none';
	  };

/**
 * Represents an active assignee picker session bound to a specific webview panel.
 */
export type AssigneePickerSession = {
	/**
	 * Resolves once the user confirms or cancels the picker.
	 */
	promise: Promise<AssigneePickerSelection | undefined>;

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
 * Provides a Promise-based API for searching and selecting assignees using a large modal picker.
 */
export class AssigneePickerController {
	/**
	 * Opens the picker overlay in the supplied webview panel and resolves with the selected assignee,
	 * the explicit no-assignee option, or undefined when cancelled.
	 */
	pickAssignee(request: AssigneePickerRequest): AssigneePickerSession {
		const { panel, authInfo, token, scopeLabel, scopeOrIssueKey } = request;
		const initialSelectedUser = request.initialSelectedUser;
		const initialUsers = initialSelectedUser?.accountId ? [initialSelectedUser] : [];
		let disposed = false;
		let resolved = false;
		let resolver: ((value: AssigneePickerSelection | undefined) => void) | undefined;
		let state: AssigneePickerOverlayState = {
			scopeLabel,
			searchQuery: '',
			loading: false,
			error: undefined,
			users: initialUsers,
			selectedAccountId: request.initialSelectedAccountId?.trim(),
		};

		const promise = new Promise<AssigneePickerSelection | undefined>((resolvePromise) => {
			resolver = resolvePromise;
		});

		/**
		 * Resolves the active picker session exactly once.
		 */
		const resolve = (value: AssigneePickerSelection | undefined): void => {
			if (resolved) {
				return;
			}
			resolved = true;
			resolver?.(value);
		};

		/**
		 * Posts the latest overlay HTML into the active webview panel.
		 */
		const postOverlay = (): Promise<boolean> => {
			if (disposed) {
				return Promise.resolve(false);
			}
			return panel.webview.postMessage({
				type: 'assigneePickerRender',
				html: AssigneePickerOverlay.renderOverlayHtml(state),
			});
		};

		/**
		 * Removes the overlay markup from the active webview panel.
		 */
		const hideOverlay = (): Promise<boolean> => {
			if (disposed) {
				return Promise.resolve(false);
			}
			return panel.webview.postMessage({
				type: 'assigneePickerHide',
			});
		};

		/**
		 * Applies partial state updates and re-renders the overlay.
		 */
		const updateState = (updates: Partial<AssigneePickerOverlayState>): void => {
			if (disposed) {
				return;
			}
			state = { ...state, ...updates };
			void postOverlay();
		};

		/**
		 * Loads assignable users for the current search query and merges the current selection when needed.
		 */
		const loadUsers = async (filters: AssigneePickerFilters): Promise<void> => {
			updateState({
				loading: true,
				error: undefined,
				searchQuery: filters.searchQuery,
			});
			try {
				const users = await jiraApiClient.fetchAssignableUsers(authInfo, token, scopeOrIssueKey, filters.searchQuery);
				updateState({
					loading: false,
					users: AssigneePickerController.mergeUsers(initialSelectedUser, users),
					error: undefined,
				});
			} catch (error) {
				updateState({
					loading: false,
					error: `Search failed: ${ErrorHelper.deriveErrorMessage(error)}`,
				});
			}
		};

		/**
		 * Routes assignee-picker messages from the webview to the active session.
		 */
		const handleMessage = async (message: any): Promise<boolean> => {
			if (disposed || !message?.type) {
				return false;
			}

			if (message.type === 'loadAssigneeOptions') {
				const filters = AssigneePickerController.sanitizeFilters(message.filters, state);
				await loadUsers(filters);
				return true;
			}

			if (message.type === 'selectAssigneeOption') {
				const accountId = typeof message.accountId === 'string' ? message.accountId.trim() : '';
				updateState({
					selectedAccountId: accountId || undefined,
					error: undefined,
				});
				return true;
			}

			if (message.type === 'cancelAssigneePicker') {
				void hideOverlay();
				resolve(undefined);
				return true;
			}

			if (message.type === 'confirmAssigneeOption') {
				const requestedAccountId =
					typeof message.accountId === 'string' ? message.accountId.trim() : '';
				const accountId = requestedAccountId || state.selectedAccountId?.trim() || '';
				if (accountId.toUpperCase() === AssigneePickerNoneSelectionKey.toUpperCase()) {
					void hideOverlay();
					resolve({
						kind: 'none',
					});
					return true;
				}
				const user = state.users.find((candidate) => candidate?.accountId?.trim() === accountId);
				if (!user) {
					updateState({
						error: 'Select a loaded assignee before confirming.',
					});
					return true;
				}
				void hideOverlay();
				resolve({
					kind: 'user',
					user,
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
		void loadUsers({ searchQuery: '' });

		return {
			promise,
			handleMessage,
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				void hideOverlay();
				resolve(undefined);
			},
		};
	}

	/**
	 * Normalizes raw filter payloads received from the webview message channel.
	 */
	private static sanitizeFilters(raw: any, fallback: AssigneePickerFilters): AssigneePickerFilters {
		const searchQuery = typeof raw?.searchQuery === 'string' ? raw.searchQuery : fallback.searchQuery;
		return {
			searchQuery: searchQuery ?? '',
		};
	}

	/**
	 * Merges the initially selected user into the loaded result set when Jira does not return it.
	 */
	private static mergeUsers(
		initialSelectedUser: IssueAssignableUser | undefined,
		users: IssueAssignableUser[] | undefined
	): IssueAssignableUser[] {
		const result: IssueAssignableUser[] = [];
		const seen = new Set<string>();
		for (const user of [initialSelectedUser, ...(users ?? [])]) {
			const accountId = user?.accountId?.trim();
			if (!accountId || seen.has(accountId)) {
				continue;
			}
			seen.add(accountId);
			result.push(user);
		}
		return result;
	}
}

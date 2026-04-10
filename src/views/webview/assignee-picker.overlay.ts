import { IssueAssignableUser } from '../../model/jira.type';
import { HtmlHelper } from '../../shared/html.helper';

/**
 * Carries the stable synthetic value used when the assignee picker selects "None".
 */
export const AssigneePickerNoneSelectionKey = '__ASSIGNEE_PICKER_NONE__';

/**
 * Describes the picker presentation mode shown inside the shared people-search modal.
 */
export type AssigneePickerMode = 'assignee' | 'mention';

/**
 * Describes the search filters submitted from the assignee picker form.
 */
export type AssigneePickerFilters = {
	/**
	 * The text query applied to assignable-user search.
	 */
	searchQuery: string;
};

/**
 * Describes the inline assignee picker state rendered inside the active webview.
 */
export type AssigneePickerOverlayState = AssigneePickerFilters & {
	/**
	 * Identifies whether the modal is selecting an assignee or inserting a mention.
	 */
	mode: AssigneePickerMode;

	/**
	 * The human-readable label shown in the picker header for the search scope.
	 */
	scopeLabel: string;

	/**
	 * Indicates whether assignable users are currently loading.
	 */
	loading: boolean;

	/**
	 * Carries the friendly error message shown in the modal.
	 */
	error?: string;

	/**
	 * The users returned by the latest search.
	 */
	users: IssueAssignableUser[];

	/**
	 * The currently selected account identifier, if any.
	 */
	selectedAccountId?: string;
};

/**
 * Renders the inline assignee picker modal, its styling, and the host bridge used by the active webview.
 */
export class AssigneePickerOverlay {
	/**
	 * Returns the persistent host element that receives inline modal content.
	 */
	static renderHostMarkup(): string {
		return '<div id="assignee-picker-host" class="assignee-picker-host" aria-hidden="true"></div>';
	}

	/**
	 * Returns the CSS needed to render the inline assignee modal without affecting page layout.
	 */
	static renderStyles(): string {
		return `
		.assignee-picker-host {
			position: fixed;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			bottom: 0 !important;
			display: none;
			z-index: 9999;
		}
		.assignee-picker-host.active {
			display: block !important;
		}
		.assignee-picker-host .assignee-picker-overlay-backdrop {
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.58);
			backdrop-filter: blur(2px);
		}
		.assignee-picker-host .assignee-picker-shell {
			position: fixed;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			z-index: 1;
			width: min(92vw, 1100px);
			height: min(84vh, 860px);
			max-width: 1100px;
			border-radius: 16px;
			overflow: hidden;
			background: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-panel-background) 16%);
			border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
			box-shadow: 0 26px 80px rgba(0, 0, 0, 0.35);
			display: grid;
			grid-template-rows: auto auto 1fr auto;
		}
		.assignee-picker-host .assignee-picker-header {
			padding: 18px 20px 10px 20px;
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 12px;
			border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		}
		.assignee-picker-host .assignee-picker-title {
			font-size: 1.35em;
			font-weight: 800;
			letter-spacing: 0.2px;
			margin: 0;
		}
		.assignee-picker-host .assignee-picker-subtitle {
			margin: 4px 0 0 0;
			color: var(--vscode-descriptionForeground);
			font-size: 0.95em;
		}
		.assignee-picker-host .assignee-picker-header-right {
			display: flex;
			align-items: center;
			gap: 10px;
			min-width: 0;
		}
		.assignee-picker-host .assignee-picker-pill {
			padding: 6px 10px;
			border-radius: 999px;
			background: color-mix(in srgb, var(--vscode-badge-background) 80%, transparent);
			color: var(--vscode-badge-foreground);
			border: 1px solid color-mix(in srgb, var(--vscode-badge-foreground) 18%, transparent);
			white-space: nowrap;
		}
		.assignee-picker-host .assignee-picker-message {
			min-height: 48px;
			padding: 0 20px;
			display: flex;
			align-items: center;
		}
		.assignee-picker-host .message {
			padding: 10px 12px;
			border-radius: 10px;
			width: 100%;
		}
		.assignee-picker-host .message.error {
			background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
			border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
		}
		.assignee-picker-host .assignee-picker-body {
			padding: 14px 20px 0 20px;
			display: grid;
			grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr);
			gap: 18px;
			height: 100%;
			min-height: 0;
		}
		.assignee-picker-host .assignee-picker-left {
			display: grid;
			grid-template-rows: auto 1fr;
			gap: 10px;
			min-height: 0;
		}
		.assignee-picker-host .assignee-picker-filters {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 10px;
			align-items: end;
		}
		.assignee-picker-host .field label {
			display: flex;
			flex-direction: column;
			gap: 6px;
			font-weight: 700;
			color: var(--vscode-foreground);
		}
		.assignee-picker-host input[type='text'] {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 8px;
			padding: 9px 10px;
			font-size: 1em;
			width: 100%;
			outline: none;
		}
		.assignee-picker-host input[type='text']:focus {
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-textLink-foreground) 16%, transparent);
			border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 65%, var(--vscode-input-border) 35%);
		}
		.assignee-picker-host button {
			border-radius: 10px;
			padding: 10px 14px;
			font-weight: 800;
			cursor: pointer;
			border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 40%, transparent);
			background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent) 0%, transparent 100%);
			color: var(--vscode-foreground);
		}
		.assignee-picker-host button:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
		.assignee-picker-host button.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
		}
		.assignee-picker-host button.secondary {
			background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
			border: 1px solid var(--vscode-button-secondaryBorder, transparent);
			color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
		}
		.assignee-picker-host .assignee-picker-results {
			min-height: 280px;
			border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
			border-radius: 14px;
			overflow: hidden;
			display: grid;
			grid-template-rows: auto 1fr;
			background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
		}
		.assignee-picker-host .assignee-picker-results-header {
			padding: 10px 12px;
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 10px;
			border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		}
		.assignee-picker-host .assignee-picker-results-title {
			font-weight: 900;
		}
		.assignee-picker-host .assignee-picker-results-list {
			margin: 0;
			padding: 0;
			list-style: none;
			overflow: auto;
		}
		.assignee-picker-host .assignee-picker-result {
			border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
		}
		.assignee-picker-host .assignee-picker-result:last-child {
			border-bottom: none;
		}
		.assignee-picker-host .assignee-picker-result-button {
			width: 100%;
			text-align: left;
			border: none;
			border-radius: 0;
			padding: 12px 12px;
			background: transparent;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.assignee-picker-host .assignee-picker-result-button:hover {
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
		}
		.assignee-picker-host .assignee-picker-result-button.selected {
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
		}
		.assignee-picker-host .assignee-picker-result-copy {
			min-width: 0;
			flex: 1;
		}
		.assignee-picker-host .assignee-picker-result-title {
			font-weight: 800;
			min-height: 1.4em;
		}
		.assignee-picker-host .assignee-picker-result-detail {
			margin-top: 4px;
			color: var(--vscode-descriptionForeground);
			font-size: 0.92em;
			min-height: 1.2em;
		}
		.assignee-picker-host .assignee-picker-right {
			display: grid;
			grid-template-rows: 1fr;
			min-height: 0;
		}
		.assignee-picker-host .assignee-picker-preview {
			min-height: 140px;
			border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
			border-radius: 14px;
			padding: 14px 14px;
			background: color-mix(in srgb, var(--vscode-editor-background) 95%, black 5%);
		}
		.assignee-picker-host .assignee-picker-preview-header {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-bottom: 10px;
		}
		.assignee-picker-host .preview-title {
			font-weight: 900;
			margin: 0;
		}
		.assignee-picker-host .preview-body {
			color: var(--vscode-descriptionForeground);
			font-size: 0.96em;
			line-height: 1.45;
		}
		.assignee-picker-host .assignee-picker-actions {
			padding: 14px 20px;
			display: flex;
			justify-content: flex-end;
			align-items: center;
			gap: 10px;
			border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		}
		.assignee-picker-host .assignee-picker-actions button,
		.assignee-picker-host .assignee-picker-header-right button {
			min-width: 124px;
		}
		.assignee-picker-host .assignee-avatar {
			width: 40px;
			height: 40px;
			border-radius: 50%;
			object-fit: cover;
			flex-shrink: 0;
			border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
			background-color: var(--vscode-sideBar-background);
		}
		.assignee-picker-host .assignee-avatar.fallback {
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: 700;
		}
		.assignee-picker-host .muted {
			color: var(--vscode-descriptionForeground);
		}
		@media (max-width: 980px) {
			.assignee-picker-host {
				padding: 12px;
			}
			.assignee-picker-host .assignee-picker-shell {
				width: 96vw;
				height: 92vh;
			}
			.assignee-picker-host .assignee-picker-body {
				grid-template-columns: 1fr;
			}
			.assignee-picker-host .assignee-picker-right {
				display: none;
			}
		}
		`;
	}

	/**
	 * Returns the bootstrap script that bridges host messages and inline modal interactions.
	 */
	static renderBootstrapScript(): string {
		return `
			const assigneePickerHost = document.getElementById('assignee-picker-host');
			const assigneePickerReadFilters = () => {
				const form = assigneePickerHost ? assigneePickerHost.querySelector('[data-assignee-picker-form]') : null;
				if (!form) {
					return { searchQuery: '' };
				}
				const data = new FormData(form);
				return {
					searchQuery: typeof data.get('searchQuery') === 'string' ? data.get('searchQuery').trim() : '',
				};
			};
			const assigneePickerToggle = (visible) => {
				if (!assigneePickerHost) {
					return;
				}
				assigneePickerHost.classList.toggle('active', visible);
				assigneePickerHost.setAttribute('aria-hidden', visible ? 'false' : 'true');
			};
			const assigneePickerGetInitials = (name) => {
				const value = typeof name === 'string' ? name.trim() : '';
				if (!value) {
					return '??';
				}
				const parts = value.split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => (part[0] || '').toUpperCase());
				return parts.join('') || value.slice(0, 2).toUpperCase() || '??';
			};
			const assigneePickerSyncCreateField = (user) => {
				const field = document.querySelector('[data-create-assignee-field]');
				if (!field) {
					return;
				}
				const accountInput = document.querySelector('input[name="assigneeAccountId"]');
				const displayInput = document.querySelector('input[name="assigneeDisplayName"]');
				const avatarInput = document.querySelector('input[name="assigneeAvatarUrl"]');
				const titleEl = field.querySelector('.assignee-picker-card-title');
				const detailEl = field.querySelector('.assignee-picker-card-detail');
				const avatarSlot = field.querySelector('[data-assignee-card-avatar]');
				const applyAvatar = (label, avatarUrl) => {
					if (!avatarSlot) {
						return;
					}
					const resolvedLabel = typeof label === 'string' && label.trim() ? label.trim() : 'Unassigned';
					const resolvedAvatarUrl = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
					if (resolvedAvatarUrl) {
						avatarSlot.innerHTML = '<img class="assignee-avatar" src="' + resolvedAvatarUrl.replace(/"/g, '&quot;') + '" alt="Selected assignee avatar" />';
						return;
					}
					avatarSlot.innerHTML = '<div class="assignee-avatar fallback">' + assigneePickerGetInitials(resolvedLabel) + '</div>';
				};
				if (!user) {
					if (accountInput) {
						accountInput.value = '';
					}
					if (displayInput) {
						displayInput.value = '';
					}
					if (avatarInput) {
						avatarInput.value = '';
					}
					if (titleEl) {
						titleEl.textContent = 'Choose an assignee';
					}
					if (detailEl) {
						detailEl.textContent = 'Unassigned';
					}
					applyAvatar('Unassigned', '');
					return;
				}
				if (accountInput) {
					accountInput.value = user.accountId || '';
				}
				if (displayInput) {
					displayInput.value = user.displayName || '';
				}
				if (avatarInput) {
					avatarInput.value = user.avatarUrl || '';
				}
				if (titleEl) {
					titleEl.textContent = 'Choose an assignee';
				}
				if (detailEl) {
					detailEl.textContent = user.displayName || user.accountId || 'Assigned';
				}
				applyAvatar(user.displayName || user.accountId || 'Assigned', user.avatarUrl || '');
			};
			document.addEventListener('click', (event) => {
				const target = event.target instanceof Element ? event.target : null;
				if (!target) {
					return;
				}
				const openButton = target.closest('[data-assignee-picker-open]');
				if (openButton) {
					event.preventDefault();
					vscode.postMessage({ type: 'openAssigneePicker' });
					return;
				}
				const cancelButton = target.closest('[data-assignee-picker-cancel]');
				if (cancelButton) {
					event.preventDefault();
					vscode.postMessage({ type: 'cancelAssigneePicker' });
					return;
				}
				const confirmButton = target.closest('[data-assignee-picker-confirm]');
				if (confirmButton) {
					event.preventDefault();
					vscode.postMessage({
						type: 'confirmAssigneeOption',
						accountId: confirmButton.getAttribute('data-assignee-account-id') || '',
					});
					return;
				}
				const resultButton = target.closest('[data-assignee-picker-result]');
				if (resultButton) {
					event.preventDefault();
					const accountId = resultButton.getAttribute('data-assignee-account-id') || '';
					vscode.postMessage({
						type: 'selectAssigneeOption',
						accountId,
					});
				}
			});
			document.addEventListener('submit', (event) => {
				const target = event.target instanceof Element ? event.target : null;
				if (!target || !target.matches('[data-assignee-picker-form]')) {
					return;
				}
				event.preventDefault();
				vscode.postMessage({
					type: 'loadAssigneeOptions',
					filters: assigneePickerReadFilters(),
				});
			});
			window.addEventListener('message', (event) => {
				const message = event.data;
				if (!message || typeof message.type !== 'string') {
					return;
				}
				if (message.type === 'assigneePickerRender' && assigneePickerHost) {
					assigneePickerHost.innerHTML = typeof message.html === 'string' ? message.html : '';
					assigneePickerToggle(true);
					queueMicrotask(() => {
						const searchInput = assigneePickerHost.querySelector('[name="searchQuery"]');
						if (searchInput && typeof searchInput.focus === 'function') {
							searchInput.focus();
						}
					});
					return;
				}
				if (message.type === 'assigneePickerHide' && assigneePickerHost) {
					assigneePickerHost.innerHTML = '';
					assigneePickerToggle(false);
					return;
				}
				if (message.type === 'assigneePickerSelectionApplied') {
					assigneePickerSyncCreateField(message.user);
				}
			});
		`;
	}

	/**
	 * Renders the inline modal fragment injected into the active webview.
	 */
	static renderOverlayHtml(state: AssigneePickerOverlayState): string {
		const searchQueryValue = HtmlHelper.escapeAttribute(state.searchQuery ?? '');
		const selectedAccountId = (state.selectedAccountId ?? '').trim();
		const isNoneSelected = selectedAccountId.toUpperCase() === AssigneePickerNoneSelectionKey.toUpperCase();
		const isMentionMode = state.mode === 'mention';
		const searchDisabledAttr = state.loading ? 'disabled' : '';
		const confirmDisabledAttr = selectedAccountId ? '' : 'disabled';
		const confirmLabel = isMentionMode ? 'Insert Mention' : isNoneSelected ? 'Clear Assignee' : 'Use Assignee';
		const title = isMentionMode ? 'Search People' : 'Select Assignee';
		const messageMarkup = state.error
			? `<div class="message error">${HtmlHelper.escapeHtml(state.error)}</div>`
			: `<div class="message muted">${HtmlHelper.escapeHtml(
				isMentionMode
					? 'Search assignable users and choose the right person to mention.'
					: 'Search assignable users and pick the right assignee.'
			)}</div>`;
		const resultCount = Array.isArray(state.users) ? state.users.length : 0;
		const resultLabel = state.loading ? 'Loading...' : `${resultCount} result${resultCount === 1 ? '' : 's'}`;
		const previewUser = state.users.find((user) => user?.accountId?.trim() === selectedAccountId);
		return `<div class="assignee-picker-overlay-backdrop" data-assignee-picker-overlay>
			<div class="assignee-picker-shell" role="dialog" aria-modal="true" aria-label="${HtmlHelper.escapeAttribute(title)}">
				<div class="assignee-picker-header">
					<div>
						<h2 class="assignee-picker-title">${HtmlHelper.escapeHtml(title)}</h2>
						<p class="assignee-picker-subtitle">${HtmlHelper.escapeHtml(state.scopeLabel)}</p>
					</div>
					<div class="assignee-picker-header-right">
						<div class="assignee-picker-pill">${HtmlHelper.escapeHtml(resultLabel)}</div>
						<button type="button" class="secondary" data-assignee-picker-cancel>Close</button>
					</div>
				</div>
				<div class="assignee-picker-message">${messageMarkup}</div>
				<div class="assignee-picker-body">
					<div class="assignee-picker-left">
						<form class="assignee-picker-filters" data-assignee-picker-form>
							<label class="field">
								<span>Search</span>
								<input type="text" name="searchQuery" value="${searchQueryValue}" placeholder="Search people" ${searchDisabledAttr} />
							</label>
							<button type="submit" class="primary" ${searchDisabledAttr}>Search</button>
						</form>
						<div class="assignee-picker-results">
							<div class="assignee-picker-results-header">
								<div class="assignee-picker-results-title">Results</div>
								<div class="muted">${HtmlHelper.escapeHtml(state.scopeLabel)}</div>
							</div>
							${AssigneePickerOverlay.renderResults(state.users, selectedAccountId, !isMentionMode)}
						</div>
					</div>
					<div class="assignee-picker-right">
						<div class="assignee-picker-preview">${AssigneePickerOverlay.renderPreview(previewUser, isNoneSelected, state.mode)}</div>
					</div>
				</div>
				<div class="assignee-picker-actions">
					<button type="button" class="secondary" data-assignee-picker-cancel>Cancel</button>
					<button type="button" class="primary" data-assignee-picker-confirm ${confirmDisabledAttr}>${HtmlHelper.escapeHtml(confirmLabel)}</button>
				</div>
			</div>
		</div>`;
	}

	/**
	 * Renders the result list, including the top-level "None" option.
	 */
	private static renderResults(users: IssueAssignableUser[], selectedAccountId: string, includeNoneOption: boolean): string {
		const noneSelected = selectedAccountId.toUpperCase() === AssigneePickerNoneSelectionKey.toUpperCase();
		const noneResult = includeNoneOption ? `<li class="assignee-picker-result">
			<button type="button" class="assignee-picker-result-button ${noneSelected ? 'selected' : ''}" data-assignee-picker-result data-assignee-account-id="${HtmlHelper.escapeAttribute(
				AssigneePickerNoneSelectionKey
			)}">
				<div class="assignee-avatar fallback">??</div>
				<div class="assignee-picker-result-copy">
					<div class="assignee-picker-result-title">None</div>
					<div class="assignee-picker-result-detail">Leave the ticket unassigned.</div>
				</div>
			</button>
		</li>` : '';
		const items = (users ?? [])
			.filter((user) => !!user?.accountId)
			.map((user) => {
				const isSelected = selectedAccountId === user.accountId;
				return `<li class="assignee-picker-result">
					<button type="button" class="assignee-picker-result-button ${isSelected ? 'selected' : ''}" data-assignee-picker-result data-assignee-account-id="${HtmlHelper.escapeAttribute(
						user.accountId
					)}">
						${AssigneePickerOverlay.renderAvatar(user.displayName, user.avatarUrl)}
						<div class="assignee-picker-result-copy">
							<div class="assignee-picker-result-title">${HtmlHelper.escapeHtml(user.displayName || user.accountId)}</div>
							<div class="assignee-picker-result-detail">${HtmlHelper.escapeHtml(user.accountId)}</div>
						</div>
					</button>
				</li>`;
			})
			.join('');
		const emptyMarkup = users.length === 0
			? `<li class="assignee-picker-result">
				<div class="assignee-picker-result-button muted" style="cursor: default;">
					<div class="assignee-picker-result-copy">
						<div class="assignee-picker-result-title">No matching users</div>
						<div class="assignee-picker-result-detail">Try a broader search or choose None.</div>
					</div>
				</div>
			</li>`
			: '';
		return `<ul class="assignee-picker-results-list">${noneResult}${items}${emptyMarkup}</ul>`;
	}

	/**
	 * Renders the preview panel for the selected user or the explicit none selection.
	 */
	private static renderPreview(
		user: IssueAssignableUser | undefined,
		isNoneSelected: boolean,
		mode: AssigneePickerMode
	): string {
		const isMentionMode = mode === 'mention';
		if (isNoneSelected) {
			return `<div>
				<p class="preview-title">No Assignee</p>
				<div class="preview-body">Confirm this selection to leave the ticket unassigned.</div>
			</div>`;
		}
		if (!user) {
			return `<div>
				<p class="preview-title">Preview</p>
				<div class="preview-body">${HtmlHelper.escapeHtml(
					isMentionMode
						? 'Select a person from the results to insert a real Jira mention.'
						: 'Select a person from the results to preview the assignee here.'
				)}</div>
			</div>`;
		}
		return `<div>
			<div class="assignee-picker-preview-header">
				${AssigneePickerOverlay.renderAvatar(user.displayName, user.avatarUrl)}
				<div>
					<p class="preview-title">${HtmlHelper.escapeHtml(user.displayName || user.accountId)}</p>
					<div class="muted">${HtmlHelper.escapeHtml(user.accountId)}</div>
				</div>
			</div>
			<div class="preview-body">${HtmlHelper.escapeHtml(
				isMentionMode ? 'Insert this person as a real Jira mention.' : 'Use this assignee for the current ticket.'
			)}</div>
		</div>`;
	}

	/**
	 * Renders a user avatar or initials fallback for the picker.
	 */
	private static renderAvatar(label?: string, avatarUrl?: string): string {
		const resolvedLabel = label?.trim() || 'User';
		const resolvedAvatarUrl = avatarUrl?.trim();
		if (resolvedAvatarUrl) {
			return `<img class="assignee-avatar" src="${HtmlHelper.escapeAttribute(resolvedAvatarUrl)}" alt="${HtmlHelper.escapeAttribute(
				resolvedLabel
			)} avatar" />`;
		}
		return `<div class="assignee-avatar fallback">${HtmlHelper.escapeHtml(AssigneePickerOverlay.getInitials(resolvedLabel))}</div>`;
	}

	/**
	 * Derives up to two initials for fallback avatar rendering.
	 */
	private static getInitials(name: string): string {
		const parts = name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '');
		return parts.join('') || name.slice(0, 2).toUpperCase() || '??';
	}
}

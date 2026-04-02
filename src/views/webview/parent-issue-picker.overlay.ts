import { IssueModel } from '../../model/issue.model';
import { IssueStatusCategory, JiraIssue } from '../../model/jira.type';
import { HtmlHelper } from '../../shared/html.helper';

/**
 * Carries the stable synthetic key used when the picker selects "None" instead of a Jira issue.
 */
export const ParentIssuePickerNoneSelectionKey = '__PARENT_PICKER_NONE__';

/**
 * Describes the search filters submitted from the parent picker form.
 */
export type ParentIssuePickerFilters = {
	/**
	 * The text search applied to the Jira query.
	 */
	searchQuery: string;

	/**
	 * The optional issue type filter applied to the Jira query.
	 */
	issueTypeName: string;

	/**
	 * The optional status filter applied to the Jira query.
	 */
	statusName: string;
};

/**
 * Describes the inline parent picker state rendered inside the active issue webview.
 */
export type ParentIssuePickerOverlayState = ParentIssuePickerFilters & {
	/**
	 * The Jira project key shown in the picker header and used as the search scope.
	 */
	projectKey: string;

	/**
	 * The human-readable project label shown in the picker header.
	 */
	projectLabel: string;

	/**
	 * The search text entered by the user.
	 */
	searchQuery: string;

	/**
	 * The optional issue type filter applied to the search.
	 */
	issueTypeName: string;

	/**
	 * The optional status filter applied to the search.
	 */
	statusName: string;

	/**
	 * Carries the available project-scoped status names that should populate the filter select.
	 */
	availableStatusNames?: string[];

	/**
	 * Indicates whether the first page of results is loading.
	 */
	loading: boolean;

	/**
	 * Indicates whether an additional page of results is loading.
	 */
	loadingMore: boolean;

	/**
	 * Carries the friendly error message shown in the modal.
	 */
	error?: string;

	/**
	 * The issues returned by the latest search.
	 */
	issues: JiraIssue[];

	/**
	 * Carries packaged webview-safe status icon sources used when a Jira status icon is unavailable.
	 */
	statusIconFallbacks?: Partial<Record<IssueStatusCategory, string>>;

	/**
	 * Indicates whether more results are available for the current query.
	 */
	hasMore: boolean;

	/**
	 * The currently selected issue key, if any.
	 */
	selectedIssueKey?: string;
};

/**
 * Renders the inline parent picker modal, its styling, and the host bridge used by the active webview.
 */
export class ParentIssuePickerOverlay {
	/**
	 * Returns the persistent host element that receives inline modal content.
	 */
	static renderHostMarkup(): string {
		return '<div id="parent-picker-host" class="parent-picker-host" aria-hidden="true"></div>';
	}

	/**
	 * Returns the CSS needed to render the inline modal without affecting the page layout.
	 */
	static renderStyles(): string {
		return `
		.parent-picker-host {
			position: fixed;
			inset: 0;
			display: none;
			place-items: center;
			padding: 24px;
			z-index: 60;
		}
		.parent-picker-host.active {
			display: grid;
		}
		.parent-picker-host .parent-picker-overlay-backdrop {
			position: absolute;
			inset: 0;
			background: rgba(0, 0, 0, 0.58);
			backdrop-filter: blur(2px);
		}
		.parent-picker-host .parent-picker-shell {
			position: relative;
			z-index: 1;
			width: min(92vw, 1200px);
			height: min(84vh, 860px);
			max-width: 1200px;
			border-radius: 16px;
			overflow: hidden;
			background: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-panel-background) 16%);
			border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
			box-shadow: 0 26px 80px rgba(0, 0, 0, 0.35);
			display: grid;
			grid-template-rows: auto auto 1fr auto;
			justify-self: center;
			align-self: center;
		}
		.parent-picker-host .parent-picker-header {
			padding: 18px 20px 10px 20px;
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 12px;
			border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		}
		.parent-picker-host .parent-picker-title {
			font-size: 1.35em;
			font-weight: 800;
			letter-spacing: 0.2px;
			margin: 0;
		}
		.parent-picker-host .parent-picker-subtitle {
			margin: 4px 0 0 0;
			color: var(--vscode-descriptionForeground);
			font-size: 0.95em;
		}
		.parent-picker-host .parent-picker-header-right {
			display: flex;
			align-items: center;
			gap: 10px;
			min-width: 0;
		}
		.parent-picker-host .parent-picker-pill {
			padding: 6px 10px;
			border-radius: 999px;
			background: color-mix(in srgb, var(--vscode-badge-background) 80%, transparent);
			color: var(--vscode-badge-foreground);
			border: 1px solid color-mix(in srgb, var(--vscode-badge-foreground) 18%, transparent);
			white-space: nowrap;
		}
		.parent-picker-host .parent-picker-message {
			min-height: 48px;
			padding: 0 20px;
			display: flex;
			align-items: center;
		}
		.parent-picker-host .message {
			padding: 10px 12px;
			border-radius: 10px;
			width: 100%;
		}
		.parent-picker-host .message.error {
			background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
			border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
		}
		.parent-picker-host .parent-picker-body {
			padding: 14px 20px 0 20px;
			display: grid;
			grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
			gap: 18px;
			height: 100%;
			min-height: 0;
		}
		.parent-picker-host .parent-picker-left {
			display: grid;
			grid-template-rows: auto 1fr;
			gap: 10px;
			min-height: 0;
		}
		.parent-picker-host .parent-picker-filters {
			display: grid;
			grid-template-columns: 1.2fr 0.9fr 0.9fr auto;
			gap: 10px;
			align-items: end;
		}
		.parent-picker-host .field label {
			display: flex;
			flex-direction: column;
			gap: 6px;
			font-weight: 700;
			color: var(--vscode-foreground);
		}
		.parent-picker-host input[type='text'],
		.parent-picker-host select {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 8px;
			padding: 9px 10px;
			font-size: 1em;
			width: 100%;
			outline: none;
		}
		.parent-picker-host input[type='text']:focus,
		.parent-picker-host select:focus {
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-textLink-foreground) 16%, transparent);
			border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 65%, var(--vscode-input-border) 35%);
		}
		.parent-picker-host button {
			border-radius: 10px;
			padding: 10px 14px;
			font-weight: 800;
			cursor: pointer;
			border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 40%, transparent);
			background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent) 0%, transparent 100%);
			color: var(--vscode-foreground);
		}
		.parent-picker-host button:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
		.parent-picker-host button.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
		}
		.parent-picker-host button.secondary {
			background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
			border: 1px solid var(--vscode-button-secondaryBorder, transparent);
			color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
		}
		.parent-picker-host .parent-picker-results {
			min-height: 280px;
			border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
			border-radius: 14px;
			overflow: hidden;
			display: grid;
			grid-template-rows: auto 1fr auto;
			background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
		}
		.parent-picker-host .parent-picker-results-header {
			padding: 10px 12px;
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 10px;
			border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		}
		.parent-picker-host .parent-picker-results-title {
			font-weight: 900;
		}
		.parent-picker-host .parent-picker-results-list {
			margin: 0;
			padding: 0;
			list-style: none;
			overflow: auto;
		}
		.parent-picker-host .parent-picker-result {
			border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
		}
		.parent-picker-host .parent-picker-result:last-child {
			border-bottom: none;
		}
		.parent-picker-host .parent-picker-result-button {
			width: 100%;
			text-align: left;
			border: none;
			border-radius: 0;
			padding: 12px 12px;
			background: transparent;
			cursor: pointer;
		}
		.parent-picker-host .parent-picker-result-button:hover {
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
		}
		.parent-picker-host .parent-picker-result-button.selected {
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
		}
		.parent-picker-host .result-top {
			display: flex;
			align-items: flex-start;
			gap: 10px;
		}
		.parent-picker-host .result-icon-stack,
		.parent-picker-host .preview-icon-stack {
			display: flex;
			flex-direction: column;
			gap: 4px;
			flex-shrink: 0;
			min-width: 28px;
		}
		.parent-picker-host .result-icon-slot,
		.parent-picker-host .preview-icon-slot {
			width: 28px;
			height: 28px;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
		}
		.parent-picker-host .result-icon-slot img,
		.parent-picker-host .preview-icon-slot img {
			width: 28px;
			height: 28px;
			object-fit: contain;
			display: block;
		}
		.parent-picker-host .result-icon-slot .issue-type-icon-placeholder,
		.parent-picker-host .preview-icon-slot .issue-type-icon-placeholder,
		.parent-picker-host .result-icon-slot .status-icon-placeholder,
		.parent-picker-host .preview-icon-slot .status-icon-placeholder {
			width: 28px;
			height: 28px;
			border-radius: 8px;
			border: 1px solid color-mix(in srgb, var(--vscode-foreground) 16%, transparent);
			background: color-mix(in srgb, var(--vscode-input-background) 82%, transparent);
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--vscode-descriptionForeground);
			flex-shrink: 0;
		}
		.parent-picker-host .result-icon-slot .issue-type-icon-placeholder::before,
		.parent-picker-host .preview-icon-slot .issue-type-icon-placeholder::before {
			content: attr(data-placeholder-text);
			font-size: 0.78em;
			font-weight: 800;
			line-height: 1;
			text-transform: uppercase;
		}
		.parent-picker-host .result-icon-slot .status-icon-placeholder::before,
		.parent-picker-host .preview-icon-slot .status-icon-placeholder::before {
			content: '•';
			font-size: 1.05em;
			line-height: 1;
		}
		.parent-picker-host .result-copy,
		.parent-picker-host .preview-copy {
			display: flex;
			flex-direction: column;
			gap: 2px;
			min-width: 0;
			flex: 1;
		}
		.parent-picker-host .result-key {
			font-weight: 900;
			letter-spacing: 0.2px;
			color: var(--vscode-textLink-foreground);
		}
		.parent-picker-host .result-summary {
			font-weight: 700;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			flex: 1;
			min-width: 0;
		}
		.parent-picker-host .result-meta {
			margin-top: 4px;
			color: var(--vscode-descriptionForeground);
			font-size: 0.92em;
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}
		.parent-picker-host .parent-picker-results-footer {
			padding: 10px 12px;
			display: flex;
			justify-content: flex-end;
			gap: 10px;
			border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		}
		.parent-picker-host .parent-picker-right {
			display: grid;
			grid-template-rows: auto 1fr;
			gap: 10px;
			min-height: 0;
		}
		.parent-picker-host .parent-picker-preview {
			min-height: 120px;
			border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
			border-radius: 14px;
			padding: 12px 12px;
			background: color-mix(in srgb, var(--vscode-editor-background) 95%, black 5%);
		}
		.parent-picker-host .preview-title {
			font-weight: 900;
			margin: 0 0 6px 0;
		}
		.parent-picker-host .preview-body {
			color: var(--vscode-descriptionForeground);
			font-size: 0.96em;
			line-height: 1.45;
		}
		.parent-picker-host .parent-picker-actions {
			padding: 14px 20px;
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 10px;
			border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		}
		.parent-picker-host .parent-picker-actions-right {
			display: flex;
			gap: 10px;
		}
		.parent-picker-host .parent-picker-header-right button,
		.parent-picker-host .parent-picker-actions-right button,
		.parent-picker-host .parent-picker-results-footer button {
			min-width: 124px;
		}
		.parent-picker-host .muted {
			color: var(--vscode-descriptionForeground);
		}
		@media (max-width: 980px) {
			.parent-picker-host {
				padding: 12px;
			}
			.parent-picker-host .parent-picker-shell {
				width: 96vw;
				height: 92vh;
			}
			.parent-picker-host .parent-picker-body {
				grid-template-columns: 1fr;
			}
			.parent-picker-host .parent-picker-right {
				display: none;
			}
			.parent-picker-host .parent-picker-filters {
				grid-template-columns: 1fr 1fr;
			}
		}
		`;
	}

	/**
	 * Returns the bootstrap script that bridges host messages and inline modal interactions.
	 */
	static renderBootstrapScript(): string {
		return `
			const parentPickerHost = document.getElementById('parent-picker-host');
			const parentPickerReadFilters = () => {
				const form = parentPickerHost ? parentPickerHost.querySelector('[data-parent-picker-form]') : null;
				if (!form) {
					return { searchQuery: '', issueTypeName: '', statusName: '' };
				}
				const data = new FormData(form);
				return {
					searchQuery: typeof data.get('searchQuery') === 'string' ? data.get('searchQuery').trim() : '',
					issueTypeName: typeof data.get('issueTypeName') === 'string' ? data.get('issueTypeName').trim() : '',
					statusName: typeof data.get('statusName') === 'string' ? data.get('statusName').trim() : '',
				};
			};
			const parentPickerToggle = (visible) => {
				if (!parentPickerHost) {
					return;
				}
				parentPickerHost.classList.toggle('active', visible);
				parentPickerHost.setAttribute('aria-hidden', visible ? 'false' : 'true');
			};
			const parentPickerSyncCreateParentField = (issue) => {
				const field = document.querySelector('[data-create-parent-field]');
				if (!field) {
					return;
				}
				const hiddenInput = field.querySelector('input[type="hidden"][data-create-custom-field]');
				const titleEl = field.querySelector('.parent-picker-card-title');
				const detailEl = field.querySelector('.parent-picker-card-detail');
				if (!issue) {
					if (hiddenInput) {
						hiddenInput.value = '';
					}
					if (titleEl) {
						titleEl.textContent = 'Choose a parent ticket';
					}
					if (detailEl) {
						detailEl.textContent = 'No parent selected • Unassigned';
					}
					return;
				}
				if (hiddenInput) {
					hiddenInput.value = issue.key || '';
				}
				if (titleEl) {
					titleEl.textContent = 'Choose a parent ticket';
				}
				if (detailEl) {
					detailEl.textContent = (issue.key || '') + (issue.summary ? ' - ' + issue.summary : '');
				}
			};
			const parentPickerCreateIconPlaceholder = (image) => {
				if (!(image instanceof HTMLImageElement)) {
					return null;
				}
				const placeholder = document.createElement('span');
				const isStatusIcon = image.classList.contains('status-icon');
				placeholder.className = isStatusIcon
					? 'status-icon status-icon-placeholder'
					: 'issue-type-icon issue-type-icon-placeholder';
				placeholder.setAttribute('aria-hidden', 'true');
				if (!isStatusIcon) {
					placeholder.setAttribute('data-placeholder-text', image.getAttribute('data-placeholder-text') || '?');
				}
				return placeholder;
			};
			const parentPickerApplyIconFallback = (image) => {
				if (!(image instanceof HTMLImageElement)) {
					return;
				}
				const fallbackSrc = (image.getAttribute('data-fallback-src') || '').trim();
				if (fallbackSrc && fallbackSrc !== image.getAttribute('src')) {
					image.setAttribute('src', fallbackSrc);
					image.removeAttribute('data-fallback-src');
					return;
				}
				const placeholder = parentPickerCreateIconPlaceholder(image);
				const parent = image.parentElement;
				if (!placeholder || !parent) {
					return;
				}
				parent.replaceChild(placeholder, image);
			};
			document.addEventListener('error', (event) => {
				const target = event.target instanceof HTMLImageElement ? event.target : null;
				if (!target || !parentPickerHost || !parentPickerHost.contains(target)) {
					return;
				}
				parentPickerApplyIconFallback(target);
			}, true);
			document.addEventListener('click', (event) => {
				const target = event.target instanceof Element ? event.target : null;
				if (!target) {
					return;
				}
				const openButton = target.closest('[data-parent-picker-open]');
				if (openButton) {
					event.preventDefault();
					vscode.postMessage({ type: 'openParentPicker' });
					return;
				}
				const cancelButton = target.closest('[data-parent-picker-cancel]');
				if (cancelButton) {
					event.preventDefault();
					vscode.postMessage({ type: 'cancelParentIssue' });
					return;
				}
				const loadMoreButton = target.closest('[data-parent-picker-load-more]');
				if (loadMoreButton) {
					event.preventDefault();
					vscode.postMessage({
						type: 'loadMoreParentIssues',
						filters: parentPickerReadFilters(),
					});
					return;
				}
				const confirmButton = target.closest('[data-parent-picker-confirm]');
				if (confirmButton) {
					event.preventDefault();
					vscode.postMessage({
						type: 'confirmParentIssue',
						issueKey: confirmButton.getAttribute('data-parent-issue-key') || '',
					});
					return;
				}
				const resultButton = target.closest('[data-parent-picker-result]');
				if (resultButton) {
					event.preventDefault();
					const issueKey = resultButton.getAttribute('data-parent-issue-key') || '';
					vscode.postMessage({
						type: 'selectParentIssue',
						issueKey,
					});
				}
			});
			document.addEventListener('submit', (event) => {
				const target = event.target instanceof Element ? event.target : null;
				if (!target || !target.matches('[data-parent-picker-form]')) {
					return;
				}
				event.preventDefault();
				vscode.postMessage({
					type: 'loadParentIssues',
					filters: parentPickerReadFilters(),
				});
			});
			window.addEventListener('message', (event) => {
				const message = event.data;
				if (!message || typeof message.type !== 'string') {
					return;
				}
				if (message.type === 'parentPickerRender' && parentPickerHost) {
					parentPickerHost.innerHTML = typeof message.html === 'string' ? message.html : '';
					parentPickerToggle(true);
					queueMicrotask(() => {
						const searchInput = parentPickerHost.querySelector('[name="searchQuery"]');
						if (searchInput && typeof searchInput.focus === 'function') {
							searchInput.focus();
						}
					});
					return;
				}
				if (message.type === 'parentPickerHide' && parentPickerHost) {
					parentPickerHost.innerHTML = '';
					parentPickerToggle(false);
					return;
				}
				if (message.type === 'parentPickerSelectionApplied') {
					parentPickerSyncCreateParentField(message.issue);
				}
			});
		`;
	}

	/**
	 * Renders the inline modal fragment that is injected into the active webview.
	 */
	static renderOverlayHtml(state: ParentIssuePickerOverlayState): string {
		const searchQueryValue = HtmlHelper.escapeAttribute(state.searchQuery ?? '');
		const issueTypeValue = HtmlHelper.escapeAttribute(state.issueTypeName ?? '');
		const statusValue = (state.statusName ?? '').trim();
		const selectedKey = (state.selectedIssueKey ?? '').trim();
		const isNoneSelected = selectedKey.toUpperCase() === ParentIssuePickerNoneSelectionKey.toUpperCase();
		const isBusy = state.loading || state.loadingMore;
		const searchDisabledAttr = isBusy ? 'disabled' : '';
		const confirmDisabledAttr = selectedKey ? '' : 'disabled';
		const confirmLabel = isNoneSelected ? 'Clear Parent' : 'Use as Parent';
		const loadMoreDisabledAttr = state.loadingMore || !state.hasMore ? 'disabled' : '';
		const errorMarkup = state.error
			? `<div class="message error">${HtmlHelper.escapeHtml(state.error)}</div>`
			: '<div class="message muted">Search the current project to choose a parent issue.</div>';
		const resultsMarkup = ParentIssuePickerOverlay.renderIssueResultsList(
			state.issues,
			selectedKey,
			state.statusIconFallbacks
		);
		const previewIssue = state.issues.find((issue) => issue?.key?.trim().toUpperCase() === selectedKey.toUpperCase());
		const previewMarkup = ParentIssuePickerOverlay.renderPreview(
			previewIssue,
			isNoneSelected,
			state.statusIconFallbacks
		);
		const statusOptions = ParentIssuePickerOverlay.renderStatusOptions(statusValue, state.availableStatusNames);
		const resultCount = Array.isArray(state.issues) ? state.issues.length : 0;
		const resultLabel = isBusy ? 'Loading...' : `${resultCount} result${resultCount === 1 ? '' : 's'}`;
		return `<div class="parent-picker-overlay-backdrop" data-parent-picker-overlay>
			<div class="parent-picker-shell" role="dialog" aria-modal="true" aria-label="Select parent issue">
				<div class="parent-picker-header">
					<div>
						<h2 class="parent-picker-title">Select Parent Ticket</h2>
						<p class="parent-picker-subtitle">${HtmlHelper.escapeHtml(state.projectLabel)}</p>
					</div>
					<div class="parent-picker-header-right">
						<div class="parent-picker-pill">${HtmlHelper.escapeHtml(resultLabel)}</div>
						<button type="button" class="secondary" data-parent-picker-cancel>Close</button>
					</div>
				</div>
				<div class="parent-picker-message">${errorMarkup}</div>
				<div class="parent-picker-body">
					<div class="parent-picker-left">
						<form class="parent-picker-filters" data-parent-picker-form>
							<label class="field">
								<span>Search</span>
								<input type="text" name="searchQuery" value="${searchQueryValue}" placeholder="Search key or text" ${searchDisabledAttr} />
							</label>
							<label class="field">
								<span>Issue Type</span>
								<input type="text" name="issueTypeName" value="${issueTypeValue}" placeholder="Bug, Task, Story" ${searchDisabledAttr} />
							</label>
							<label class="field">
								<span>Status</span>
								<select name="statusName" ${searchDisabledAttr}>
									${statusOptions}
								</select>
							</label>
							<button type="submit" class="primary" ${searchDisabledAttr}>Search</button>
						</form>
						<div class="parent-picker-results">
							<div class="parent-picker-results-header">
								<div class="parent-picker-results-title">Results</div>
								<div class="muted">${HtmlHelper.escapeHtml(state.projectKey)}</div>
							</div>
							${resultsMarkup}
							<div class="parent-picker-results-footer">
								<button type="button" class="secondary" data-parent-picker-load-more ${loadMoreDisabledAttr}>${
									state.loadingMore ? 'Loading more...' : 'Load more'
								}</button>
							</div>
						</div>
					</div>
					<div class="parent-picker-right">
						<div class="parent-picker-preview">${previewMarkup}</div>
					</div>
				</div>
				<div class="parent-picker-actions">
					<div class="parent-picker-actions-right">
						<button type="button" class="secondary" data-parent-picker-cancel>Cancel</button>
						<button type="button" class="primary" data-parent-picker-confirm ${confirmDisabledAttr}>${HtmlHelper.escapeHtml(confirmLabel)}</button>
					</div>
				</div>
			</div>
		</div>`;
	}

	/**
	 * Renders the result list, including empty and selected states.
	 */
	private static renderIssueResultsList(
		issues: JiraIssue[],
		selectedIssueKey: string,
		statusIconFallbacks?: Partial<Record<IssueStatusCategory, string>>
	): string {
		const noneIsSelected =
			selectedIssueKey.trim().toUpperCase() === ParentIssuePickerNoneSelectionKey.toUpperCase();
		const noneResultMarkup = `<li class="parent-picker-result">
			<button
				type="button"
				class="parent-picker-result-button ${noneIsSelected ? 'selected' : ''}"
				data-parent-picker-result
				data-parent-issue-key="${HtmlHelper.escapeAttribute(ParentIssuePickerNoneSelectionKey)}"
			>
				<div class="result-top">
					<div class="result-key">None</div>
					<div class="result-summary">Leave this issue without a parent ticket</div>
				</div>
				<div class="result-meta">Use this when the ticket should not have a parent relationship.</div>
			</button>
		</li>`;
		if (!issues || issues.length === 0) {
			return `<ul class="parent-picker-results-list">
				${noneResultMarkup}
				<li class="parent-picker-result">
					<div class="parent-picker-result-button muted" style="cursor: default;">
						<div class="result-top">
							<div class="result-summary">No results yet. Search to load issues.</div>
						</div>
						<div class="result-meta">Try a key like PROJ-123, search by text, or choose None.</div>
					</div>
				</li>
			</ul>`;
		}

		const listItems = issues
			.filter((issue) => !!issue?.key)
			.map((issue) => {
				const key = issue.key.trim();
				const summary = issue.summary ?? key;
				const status = issue.statusName?.trim();
				const assignee = issue.assigneeName?.trim();
				const typeName = issue.issueTypeName?.trim();
				const metaParts = [typeName ? `Type: ${typeName}` : undefined, status ? `Status: ${status}` : undefined, assignee ? `Assignee: ${assignee}` : undefined]
					.filter((value): value is string => !!value);
				const isSelected = selectedIssueKey && selectedIssueKey.trim().toUpperCase() === key.toUpperCase();
				const selectedClass = isSelected ? 'selected' : '';
				const issueTypeIconMarkup = ParentIssuePickerOverlay.renderIssueTypeIconMarkup(issue);
				const statusIconMarkup = ParentIssuePickerOverlay.renderStatusIconMarkup(issue, statusIconFallbacks);
				return `<li class="parent-picker-result">
					<button type="button" class="parent-picker-result-button ${selectedClass}" data-parent-picker-result data-parent-issue-key="${HtmlHelper.escapeAttribute(
						key
					)}">
						<div class="result-top">
							<div class="result-icon-stack">
								<div class="result-icon-slot">${issueTypeIconMarkup}</div>
								<div class="result-icon-slot">${statusIconMarkup}</div>
							</div>
							<div class="result-copy">
								<div class="result-key">${HtmlHelper.escapeHtml(key)}</div>
								<div class="result-summary">${HtmlHelper.escapeHtml(summary)}</div>
							</div>
						</div>
						<div class="result-meta">${HtmlHelper.escapeHtml(metaParts.join(' - ') || 'No metadata')}</div>
					</button>
				</li>`;
			})
			.join('');

		return `<ul class="parent-picker-results-list">${noneResultMarkup}${listItems}</ul>`;
	}

	/**
	 * Renders the preview panel for the currently selected issue.
	 */
	private static renderPreview(
		issue: JiraIssue | undefined,
		isNoneSelected: boolean,
		statusIconFallbacks?: Partial<Record<IssueStatusCategory, string>>
	): string {
		if (isNoneSelected) {
			return `<div>
				<div class="preview-title">No Parent Ticket</div>
				<div class="preview-body">Confirm this selection to leave the issue without a parent ticket.</div>
			</div>`;
		}
		if (!issue) {
			return `<div>
				<div class="preview-title">Preview</div>
				<div class="preview-body">Select an issue from the results to preview it here.</div>
			</div>`;
		}

		const meta: string[] = [];
		if (issue.issueTypeName) {
			meta.push(`Type: ${issue.issueTypeName}`);
		}
		if (issue.statusName) {
			meta.push(`Status: ${issue.statusName}`);
		}
		if (issue.assigneeName) {
			meta.push(`Assignee: ${issue.assigneeName}`);
		}
		const issueTypeIconMarkup = ParentIssuePickerOverlay.renderIssueTypeIconMarkup(issue);
		const statusIconMarkup = ParentIssuePickerOverlay.renderStatusIconMarkup(issue, statusIconFallbacks);

		return `<div>
			<div class="preview-title">${HtmlHelper.escapeHtml(issue.key)}</div>
			<div class="preview-body">
				<div style="display: flex; gap: 10px; align-items: flex-start;">
					<div class="preview-icon-stack">
						<div class="preview-icon-slot">${issueTypeIconMarkup}</div>
						<div class="preview-icon-slot">${statusIconMarkup}</div>
					</div>
					<div class="preview-copy">
						<div><strong>${HtmlHelper.escapeHtml(issue.summary ?? issue.key)}</strong></div>
						<div class="muted" style="margin-top: 6px;">${HtmlHelper.escapeHtml(meta.join(' - ') || 'No metadata')}</div>
					</div>
				</div>
				${
					issue.url
						? `<div style="margin-top: 10px;"><a href="${HtmlHelper.escapeAttribute(
								issue.url
						  )}" target="_blank" rel="noreferrer noopener">Open in Jira</a></div>`
						: ''
				}
			</div>
		</div>`;
	}

	/**
	 * Renders the supported status options, including the default "All" option.
	 */
	private static renderStatusOptions(currentValue: string, availableStatusNames?: string[]): string {
		const options = ParentIssuePickerOverlay.buildStatusOptionList(currentValue, availableStatusNames);
		return options
			.map((option) => {
				const label = option ? option : 'All';
				const selectedAttr = option === currentValue ? 'selected' : '';
				return `<option value="${HtmlHelper.escapeAttribute(option)}" ${selectedAttr}>${HtmlHelper.escapeHtml(label)}</option>`;
			})
			.join('');
	}

	/**
	 * Builds the deduplicated status option list for the current project while preserving the active selection.
	 */
	private static buildStatusOptionList(currentValue: string, availableStatusNames?: string[]): string[] {
		const result: string[] = [''];
		const seen = new Set<string>(['']);
		for (const option of availableStatusNames ?? []) {
			const normalized = option?.trim();
			if (!normalized) {
				continue;
			}
			const key = normalized.toLowerCase();
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			result.push(normalized);
		}
		const selectedValue = currentValue?.trim();
		if (selectedValue) {
			const selectedKey = selectedValue.toLowerCase();
			if (!seen.has(selectedKey)) {
				result.push(selectedValue);
			}
		}
		return result;
	}

	/**
	 * Renders the issue type icon markup, falling back to a visible placeholder when no icon is available.
	 */
	private static renderIssueTypeIconMarkup(issue: JiraIssue): string {
		const issueTypeIconSrc = issue.issueTypeIconSrc?.trim();
		const placeholderText = ParentIssuePickerOverlay.getIssueTypePlaceholderText(issue.issueTypeName);
		if (issueTypeIconSrc) {
			return `<img class="issue-type-icon" src="${HtmlHelper.escapeAttribute(issueTypeIconSrc)}" data-placeholder-text="${HtmlHelper.escapeAttribute(
				placeholderText
			)}" alt="${HtmlHelper.escapeHtml(issue.issueTypeName ?? 'Issue type')} icon" />`;
		}
		return ParentIssuePickerOverlay.renderIssueTypePlaceholderMarkup(placeholderText);
	}

	/**
	 * Builds the issue type placeholder markup used when a Jira issue type icon is unavailable.
	 */
	private static renderIssueTypePlaceholderMarkup(placeholderText: string): string {
		return `<span class="issue-type-icon issue-type-icon-placeholder" data-placeholder-text="${HtmlHelper.escapeAttribute(
			placeholderText
		)}" aria-hidden="true"></span>`;
	}

	/**
	 * Derives the short label rendered inside the issue type placeholder.
	 */
	private static getIssueTypePlaceholderText(issueTypeName?: string): string {
		const normalizedIssueTypeName = issueTypeName?.trim();
		if (!normalizedIssueTypeName) {
			return '?';
		}
		return normalizedIssueTypeName.charAt(0).toUpperCase();
	}

	/**
	 * Resolves the packaged status fallback icon that matches the issue status category.
	 */
	private static resolveStatusFallbackIconSrc(
		issue: JiraIssue,
		statusIconFallbacks?: Partial<Record<IssueStatusCategory, string>>
	): string | undefined {
		const category = IssueModel.determineStatusCategory(issue.statusName);
		return statusIconFallbacks?.[category] ?? statusIconFallbacks?.default;
	}

	/**
	 * Renders the status icon slot using the resolved Jira source first and the packaged fallback source second.
	 */
	private static renderStatusIconMarkup(
		issue: JiraIssue,
		statusIconFallbacks?: Partial<Record<IssueStatusCategory, string>>
	): string {
		const statusIconSrc = issue.statusIconSrc?.trim();
		const fallbackIconSrc = ParentIssuePickerOverlay.resolveStatusFallbackIconSrc(issue, statusIconFallbacks);
		if (statusIconSrc) {
			const fallbackAttribute = fallbackIconSrc?.trim()
				? ` data-fallback-src="${HtmlHelper.escapeAttribute(fallbackIconSrc)}"`
				: '';
			return `<img class="status-icon" src="${HtmlHelper.escapeAttribute(statusIconSrc)}"${fallbackAttribute} alt="${HtmlHelper.escapeHtml(
				issue.statusName ?? 'Issue status'
			)} status icon" />`;
		}
		if (fallbackIconSrc?.trim()) {
			return `<img class="status-icon" src="${HtmlHelper.escapeAttribute(fallbackIconSrc)}" alt="${HtmlHelper.escapeHtml(
				issue.statusName ?? 'Issue status'
			)} status icon" />`;
		}
		return '<span class="status-icon status-icon-placeholder" aria-hidden="true"></span>';
	}
}

import * as vscode from 'vscode';

import {
	CreateIssueFormValues,
	CreateIssuePanelState,
	IssueAssignableUser,
	IssuePanelOptions,
	IssueStatusOption,
	JiraIssue,
	JiraIssueComment,
	JiraRelatedIssue,
	JiraCommentFormat,
	SelectedProjectInfo,
} from '../../model/types';
import { ISSUE_STATUS_OPTIONS, ISSUE_TYPE_OPTIONS } from '../../model/constants';
import { createPlaceholderIssue, determineStatusCategory, formatIssueUpdated } from '../../model/issueModel';
import { escapeAttribute, escapeHtml } from '../../shared/html';
import { getItemsIconPath, getStatusIconPath, getStatusIconWebviewSrc } from '../resources';

export function showIssueDetailsPanel(
	issueKey: string,
	issue?: JiraIssue,
	options?: IssuePanelOptions,
	onMessage?: (message: any, panel: vscode.WebviewPanel) => void
): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		'jiraIssueDetails',
		`${issueKey} – Jira`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
		}
	);
	panel.webview.onDidReceiveMessage((message) => {
		if (message?.type === 'openIssue' && typeof message.key === 'string') {
			vscode.commands.executeCommand('jira.openIssueDetails', message.key);
			return;
		}
		onMessage?.(message, panel);
	});
	const issueData = issue ?? createPlaceholderIssue(issueKey);
	renderIssuePanelContent(panel, issueData, options);
	return panel;
}

export function renderIssuePanelContent(panel: vscode.WebviewPanel, issue: JiraIssue, options?: IssuePanelOptions) {
	const statusCategory = determineStatusCategory(issue.statusName);
	const iconPath = getStatusIconPath(statusCategory);
	if (iconPath) {
		panel.iconPath = iconPath;
	}
	const statusIconSrc = getStatusIconWebviewSrc(panel.webview, statusCategory);
	panel.webview.html = renderIssueDetailsHtml(panel.webview, issue, statusIconSrc, options);
}

export function showCreateIssuePanel(project: SelectedProjectInfo, state: CreateIssuePanelState): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		'jiraCreateIssue',
		`New Ticket (${project.key})`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
		}
	);
	const iconPath = getItemsIconPath();
	if (iconPath) {
		panel.iconPath = iconPath;
	}
	renderCreateIssuePanel(panel, project, state);
	return panel;
}

export function renderCreateIssuePanel(
	panel: vscode.WebviewPanel,
	project: SelectedProjectInfo,
	state: CreateIssuePanelState
): void {
	panel.webview.html = renderCreateIssuePanelHtml(panel.webview, project, state);
}

function renderIssueDetailsHtml(
	webview: vscode.Webview,
	issue: JiraIssue,
	statusIconSrc?: string,
	options?: IssuePanelOptions
): string {
	const updatedText = formatIssueUpdated(issue.updated);
	const assignee = issue.assigneeName ?? 'Unassigned';
	const nonce = generateNonce();
	const isLoading = options?.loading ?? false;
	const errorMessage = options?.error;
	const descriptionSection = errorMessage ? '' : renderDescriptionSection(issue);
	const parentSection = errorMessage ? '' : renderParentSection(issue);
	const childrenSection = errorMessage ? '' : renderChildrenSection(issue);
	const cspSource = webview.cspSource;
	const metadataPanel = renderMetadataPanel(issue, assignee, updatedText, options);
	const statusIconMarkup = statusIconSrc
		? `<img class="status-icon" src="${escapeAttribute(statusIconSrc)}" alt="${escapeHtml(
				issue.statusName ?? 'Issue status'
		  )} status icon" />`
		: '';
	let messageBanner = '';
	if (errorMessage) {
		messageBanner = `<div class="section error-banner">${escapeHtml(errorMessage)}</div>`;
	} else if (isLoading) {
		messageBanner = `<div class="section loading-banner">Refreshing issue details…</div>`;
	}
	const linkSection =
		issue.url && !errorMessage
			? `<div class="section">
		<a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer noopener">Open in Jira</a>
	</div>`
			: '';
	const commentsSection = renderCommentsSection(options);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<title>${escapeHtml(issue.key)}</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			padding: 24px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			line-height: 1.5;
			max-width: 1100px;
			margin: 0 auto;
		}
		.issue-header {
			display: flex;
			gap: 16px;
			align-items: flex-start;
			margin-bottom: 24px;
		}
		.status-icon {
			width: 56px;
			height: 56px;
			flex-shrink: 0;
			margin-top: 4px;
		}
		h1 {
			margin-top: 0;
			font-size: 2em;
			margin-bottom: 8px;
		}
		p.issue-summary {
			font-size: 1.1em;
			margin-top: 0;
			margin-bottom: 24px;
		}
	.section {
		margin-top: 24px;
	}
	.comments-section {
		border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.15));
		padding-top: 24px;
		margin-top: 32px;
	}
	.comments-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	.comment-refresh,
	.comment-delete,
	.comment-submit {
		border-radius: 4px;
		border: 1px solid var(--vscode-button-secondaryBorder, transparent);
		background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
		color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
		padding: 6px 12px;
		cursor: pointer;
		font-size: 0.9em;
	}
	.comment-refresh:disabled,
	.comment-delete:disabled,
	.comment-submit:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.comment-list {
		list-style: none;
		margin: 16px 0 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.comment-item {
		display: flex;
		gap: 12px;
	}
	.comment-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.15));
		background: var(--vscode-sideBar-background);
	}
	.comment-avatar.fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
	}
	.comment-content {
		flex: 1;
		min-width: 0;
	}
	.comment-meta {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}
	.comment-author {
		font-weight: 600;
	}
	.comment-author-self {
		color: var(--vscode-descriptionForeground);
		font-size: 0.85em;
	}
	.comment-date {
		color: var(--vscode-descriptionForeground);
		font-size: 0.9em;
	}
	.rich-text-block {
		padding: 12px;
		border-radius: 6px;
		border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.15));
		background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03));
		overflow-x: auto;
	}
	.rich-text-block :where(p, ul, ol) {
		margin-top: 0;
	}
	.rich-text-block pre {
		background: var(--vscode-editor-background);
		padding: 8px;
		border-radius: 4px;
		overflow-x: auto;
	}
	.comment-body,
	.description-body {
		margin-top: 8px;
	}
	.description-card {
		border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.15));
		border-radius: 6px;
		padding: 16px;
	}
	.comment-message {
		margin-top: 16px;
		padding: 12px;
		border-radius: 6px;
		border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.15));
		background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03));
	}
	.comment-message.error {
		border-color: color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
		color: var(--vscode-errorForeground);
	}
	.comment-form {
		margin-top: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.comment-form textarea {
		min-height: 120px;
		resize: vertical;
	}
	.comment-controls {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.comment-select-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
	}
	.comment-error {
		color: var(--vscode-errorForeground);
		font-size: 0.9em;
	}
	.comment-error.hidden {
		display: none;
	}
	.comment-helper {
		font-size: 0.9em;
	}
		.section-title {
			font-weight: 600;
			margin-bottom: 4px;
		}
		.label {
			font-weight: 600;
			margin-right: 8px;
		}
		a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		.issue-layout {
			display: grid;
			grid-template-columns: minmax(0, 2.5fr) minmax(280px, 1fr);
			gap: 32px;
			align-items: start;
		}
		.issue-sidebar {
			position: relative;
		}
		.meta-card {
			border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
			border-radius: 6px;
			padding: 16px;
			display: flex;
			flex-direction: column;
			gap: 18px;
		}
		.meta-section {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
			.assignee-card {
				flex-direction: row;
				gap: 12px;
				align-items: center;
			}
			.assignee-control-details {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.assignee-search-row {
				display: flex;
				gap: 8px;
			}
			.assignee-search-row input {
				flex: 1;
			}
			.assignee-select-row {
				display: flex;
				gap: 8px;
				align-items: stretch;
				width: 100%;
			}
			.jira-assignee-select {
				flex: 1;
				min-width: 0;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 4px 8px;
				min-height: 28px;
			}
			.jira-assignee-select:disabled {
				opacity: 0.7;
			}
			.jira-assignee-apply {
				padding: 4px 12px;
				border-radius: 4px;
				border: 1px solid var(--vscode-button-secondaryBorder, transparent);
				background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				cursor: pointer;
				font-size: 0.9em;
				min-width: 56px;
				min-height: 28px;
				align-self: stretch;
				margin-left: auto;
			}
			.jira-assignee-apply:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}
			.status-select-wrapper {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.jira-status-select {
				width: 100%;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 4px 8px;
			}
			.jira-status-select:disabled {
				opacity: 0.7;
			}
			.assignee-avatar {
				width: 56px;
				height: 56px;
				border-radius: 50%;
				object-fit: cover;
			flex-shrink: 0;
			border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
			background-color: var(--vscode-sideBar-background);
		}
		.assignee-avatar.fallback {
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: 600;
			font-size: 1em;
		}
		.issue-link {
			background: transparent;
			border: 1px solid var(--vscode-button-border, var(--vscode-foreground));
			border-radius: 4px;
			color: var(--vscode-foreground);
			padding: 4px 8px;
			cursor: pointer;
			font-size: 0.95em;
			margin-top: 4px;
			text-align: left;
			width: 100%;
		}
		.issue-link:hover {
			background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.04));
		}
		.issue-list {
			list-style: none;
			padding-left: 0;
			margin: 4px 0 0 0;
		}
			.issue-list li {
				margin-top: 6px;
			}
			.muted {
				color: var(--vscode-descriptionForeground);
			}
			.loading-banner {
				color: var(--vscode-descriptionForeground);
			}
			.error-banner {
				background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
				border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
				border-radius: 6px;
				padding: 12px;
			}
			.status-error {
				color: var(--vscode-errorForeground);
				font-size: 0.9em;
			}
			@media (max-width: 900px) {
				.issue-layout {
					grid-template-columns: 1fr;
				}
		}
	</style>
</head>
<body>
	<div class="issue-layout">
		<div class="issue-main">
			<div class="issue-header">
				${statusIconMarkup}
				<div>
					<h1>${escapeHtml(issue.key)}</h1>
					<p class="issue-summary">${escapeHtml(issue.summary ?? 'Loading issue details…')}</p>
				</div>
			</div>
			${messageBanner}
			${descriptionSection}
			${parentSection}
			${childrenSection}
			${linkSection}
			${commentsSection}
		</div>
		${metadataPanel}
	</div>
		<script nonce="${nonce}">
			(function () {
				const vscode = acquireVsCodeApi();
				document.querySelectorAll('.issue-link').forEach((el) => {
					el.addEventListener('click', () => {
					const key = el.getAttribute('data-issue-key');
					if (key) {
						vscode.postMessage({ type: 'openIssue', key });
					}
				});
				});
				document.querySelectorAll('.jira-status-select').forEach((select) => {
					select.addEventListener('change', () => {
						const transitionId = select.value;
						const issueKey = select.getAttribute('data-issue-key');
						if (!transitionId || !issueKey) {
							return;
						}
						select.setAttribute('disabled', 'true');
						vscode.postMessage({ type: 'changeStatus', transitionId, issueKey });
					});
				});
				const requestAssignees = (issueKey, query, force) => {
					if (!issueKey) {
						return;
					}
					vscode.postMessage({ type: 'loadAssignees', issueKey, query: query ?? '', force: !!force });
				};
				const updateApplyState = (select, button) => {
					if (!button) {
						return;
					}
					const currentAccountId = (select.getAttribute('data-current-account-id') || '').trim();
					const value = select.value || '';
					const hasNewSelection = !!value && value !== currentAccountId;
					button.disabled = select.disabled || !hasNewSelection;
				};

				document.querySelectorAll('.jira-assignee-select').forEach((select) => {
					const issueKey = select.getAttribute('data-issue-key');
					const row = select.closest('.assignee-select-row');
					const applyButton = row ? row.querySelector('.jira-assignee-apply') : null;

					const ensureAssigneesLoaded = () => {
						if (!issueKey) {
							return;
						}
						const selector = '.jira-assignee-search[data-issue-key="' + issueKey + '"]';
						const searchInput = document.querySelector(selector);
						const query = searchInput ? searchInput.value : '';
						const loaded = select.getAttribute('data-loaded') === 'true';
						const lastQuery = select.getAttribute('data-query') || '';
						if (!loaded || lastQuery !== query) {
							select.setAttribute('data-loaded', 'pending');
							select.setAttribute('data-query', query);
							requestAssignees(issueKey, query);
						}
					};

					select.addEventListener('focus', ensureAssigneesLoaded);
					select.addEventListener('click', ensureAssigneesLoaded);
					select.addEventListener('change', () => {
						updateApplyState(select, applyButton);
					});
					updateApplyState(select, applyButton);
				});

				document.querySelectorAll('.jira-assignee-apply').forEach((button) => {
					button.addEventListener('click', () => {
						if (button.disabled) {
							return;
						}
						const row = button.closest('.assignee-select-row');
						if (!row) {
							return;
						}
						const select = row.querySelector('.jira-assignee-select');
						if (!select) {
							return;
						}
						const issueKey = select.getAttribute('data-issue-key');
						const accountId = select.value;
						if (!accountId || !issueKey) {
							return;
						}
						button.disabled = true;
						select.disabled = true;
						vscode.postMessage({ type: 'changeAssignee', accountId, issueKey });
					});
				});
				document.querySelectorAll('.jira-assignee-search').forEach((input) => {
				const issueKey = input.getAttribute('data-issue-key');
				const triggerSearch = () => {
					requestAssignees(issueKey, input.value, true);
				};
				input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					triggerSearch();
					input.dataset.loaded = 'true';
				}
			});
			});
			const commentForm = document.querySelector('.comment-form');
			if (commentForm) {
				const textarea = commentForm.querySelector('.comment-input');
				const formatSelect = commentForm.querySelector('.comment-format-select');
				const submitButton = commentForm.querySelector('.comment-submit');
				const errorEl = commentForm.querySelector('.comment-error');
				const updateSubmitState = () => {
					if (!submitButton || !textarea) {
						return;
					}
					const pending = commentForm.getAttribute('data-pending') === 'true';
					const hasText = textarea.value.trim().length > 0;
					submitButton.disabled = pending || !hasText;
				};
				if (textarea) {
					textarea.addEventListener('input', () => {
						vscode.postMessage({ type: 'commentDraftChanged', value: textarea.value });
						updateSubmitState();
						if (errorEl) {
							errorEl.classList.add('hidden');
						}
					});
				}
				if (formatSelect) {
					formatSelect.addEventListener('change', () => {
						vscode.postMessage({ type: 'changeCommentFormat', format: formatSelect.value });
					});
				}
				commentForm.addEventListener('submit', (event) => {
					event.preventDefault();
					if (!textarea || !formatSelect || !submitButton || submitButton.disabled) {
						return;
					}
					vscode.postMessage({ type: 'addComment', body: textarea.value, format: formatSelect.value });
				});
				updateSubmitState();
			}
			document.querySelectorAll('.comment-delete').forEach((button) => {
				button.addEventListener('click', () => {
					if (button.disabled) {
						return;
					}
					const commentId = button.getAttribute('data-comment-id');
					if (!commentId) {
						return;
					}
					button.disabled = true;
					vscode.postMessage({ type: 'deleteComment', commentId });
				});
			});
			const refreshButton = document.querySelector('.comment-refresh');
			if (refreshButton) {
				refreshButton.addEventListener('click', () => {
					if (refreshButton.disabled) {
						return;
					}
					refreshButton.disabled = true;
					vscode.postMessage({ type: 'refreshComments' });
				});
			}
		})();
	</script>
</body>
</html>`;
}

function renderCreateIssuePanelHtml(
	webview: vscode.Webview,
	project: SelectedProjectInfo,
	state: CreateIssuePanelState
): string {
	const nonce = generateNonce();
	const cspSource = webview.cspSource;
	const values = state.values;
	const disabledAttr = state.submitting ? 'disabled' : '';
	const errorBanner = state.error
		? `<div class="section error-banner">${escapeHtml(state.error)}</div>`
		: '';
	const successBanner = state.successIssue
		? `<div class="section success-banner">
			Created ticket <strong>${escapeHtml(state.successIssue.key)}</strong>.
			${state.successIssue.url ? `<a href="${escapeHtml(state.successIssue.url)}" target="_blank" rel="noreferrer noopener">Open in Jira</a>` : ''}
		</div>`
		: '';
	const projectLabel = project.name ? `${project.name} (${project.key})` : project.key;
	const assigneeSection = renderCreateAssigneeSection(state);
	const buttonLabel = state.submitting ? 'Creating…' : 'Create Ticket';
	const statusNames = deriveStatusOptionNames(state.statusOptions);
	const defaultStatus = statusNames[0] ?? ISSUE_STATUS_OPTIONS[0];
	const defaultStatusAttr = escapeAttribute(defaultStatus);
	const statusPending = state.statusPending ?? false;
	const statusError = state.statusError;

	return `<!DOCTYPE html>
<html lang="en">
<head>
\t<meta charset="UTF-8" />
\t<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
\t<title>New Jira Ticket</title>
\t<style>
\t\t*, *::before, *::after {
\t\t\tbox-sizing: border-box;
\t\t}
\t\tbody {
\t\t\tfont-family: var(--vscode-font-family);
\t\t\tfont-size: var(--vscode-font-size);
\t\t\tcolor: var(--vscode-foreground);
\t\t\tbackground-color: var(--vscode-editor-background);
\t\t\tpadding: 24px;
\t\t\tline-height: 1.5;
\t\t}
\t\t.create-issue-wrapper {
\t\t\tmax-width: 1100px;
\t\t\tmargin: 0 auto;
\t\t}
\t\t.issue-layout {
\t\t\tdisplay: grid;
\t\t\tgrid-template-columns: minmax(0, 2.5fr) minmax(280px, 1fr);
\t\t\tgap: 32px;
\t\t\talign-items: flex-start;
\t\t\twidth: 100%;
\t\t}
\t\t.issue-header h1 {
\t\t\tmargin: 0;
\t\t\tfont-size: 2em;
\t\t}
\t\t.issue-header .issue-summary {
\t\t\tmargin: 6px 0 0 0;
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t}
\t\t.issue-main {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 18px;
\t\t\tmin-width: 0;
\t\t}
\t\t.issue-sidebar {
\t\t\tmin-width: 0;
\t\t}
\t\t.form-field label {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 6px;
\t\t\tfont-weight: 600;
\t\t}
\t\tinput[type="text"],
\t\ttextarea,
\t\tselect {
\t\t\tbackground: var(--vscode-input-background);
\t\t\tcolor: var(--vscode-input-foreground);
\t\t\tborder: 1px solid var(--vscode-input-border);
\t\t\tborder-radius: 4px;
\t\t\tpadding: 8px;
\t\t\tfont-size: 1em;
\t\t\twidth: 100%;
\t\t}
\t\ttextarea {
\t\t\tmin-height: 160px;
\t\t\tresize: vertical;
\t\t}
\t\tbutton.primary {
\t\t\tbackground: var(--vscode-button-background);
\t\t\tcolor: var(--vscode-button-foreground);
\t\t\tborder: none;
\t\t\tborder-radius: 4px;
\t\t\tpadding: 10px 16px;
\t\t\tfont-size: 1em;
\t\t\tcursor: pointer;
\t\t}
\t\tbutton.primary:disabled {
\t\t\topacity: 0.7;
\t\t\tcursor: default;
\t\t}
\t\t.form-actions {
\t\t\tmargin-top: 8px;
\t\t}
\t\t.meta-card {
\t\t\tborder: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
\t\t\tborder-radius: 6px;
\t\t\tpadding: 16px;
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 18px;
\t\t}
\t\t.meta-section {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 6px;
\t\t}
\t\t.project-pill {
\t\t\tdisplay: inline-flex;
\t\t\talign-items: center;
\t\t\tgap: 6px;
\t\t\tbackground: var(--vscode-badge-background);
\t\t\tcolor: var(--vscode-badge-foreground);
\t\t\tpadding: 4px 10px;
\t\t\tborder-radius: 999px;
\t\t\tfont-size: 0.9em;
\t\t\tfont-weight: 600;
\t\t}
\t\t.assignee-card {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 10px;
\t\t}
\t\t.assignee-control-details {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 8px;
\t\t}
\t\t.assignee-search-row input {
\t\t\twidth: 100%;
\t\t}
\t\t.assignee-select-row {
\t\t\tdisplay: flex;
\t\t\tgap: 8px;
\t\t}
\t\t.assignee-select-row select {
\t\t\tflex: 1;
\t\t\tmin-width: 0;
\t\t}
\t\t.assignee-select-row button {
\t\t\tpadding: 6px 12px;
\t\t\tborder-radius: 4px;
\t\t\tborder: 1px solid var(--vscode-button-secondaryBorder, transparent);
\t\t\tbackground: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
\t\t\tcolor: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
\t\t\tcursor: pointer;
\t\t\tmin-width: 56px;
\t\t}
\t\t.assignee-select-row button:disabled {
\t\t\topacity: 0.6;
\t\t\tcursor: not-allowed;
\t\t}
\t\t.section-title {
\t\t\tfont-weight: 600;
\t\t}
\t\t.section {
\t\t\tmargin: 0;
\t\t}
\t\t.error-banner {
\t\t\tbackground: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
\t\t\tborder: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
\t\t\tborder-radius: 6px;
\t\t\tpadding: 12px;
\t\t}
\t\t.success-banner {
\t\t\tbackground: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 15%, transparent);
\t\t\tborder: 1px solid color-mix(in srgb, var(--vscode-terminal-ansiGreen) 40%, transparent);
\t\t\tborder-radius: 6px;
\t\t\tpadding: 12px;
\t\t}
\t\t.muted {
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t}
\t\t.assignee-helper {
\t\t\tfont-size: 0.9em;
\t\t}
\t\t.status-helper {
\t\t\tfont-size: 0.9em;
\t\t\tmargin-top: 4px;
\t\t}
\t\t.status-error {
\t\t\tcolor: var(--vscode-errorForeground);
\t\t\tfont-size: 0.9em;
\t\t}
\t\ta {
\t\t\tcolor: var(--vscode-textLink-foreground);
\t\t\ttext-decoration: none;
\t\t}
\t\t@media (max-width: 900px) {
\t\t\t.issue-layout {
\t\t\t\tgrid-template-columns: 1fr;
\t\t\t}
\t\t}
\t</style>
</head>
<body>
\t<div class="create-issue-wrapper">
\t\t<form id="create-issue-form" class="issue-layout create-issue-layout">
\t\t\t<div class="issue-main">
\t\t\t\t<div class="issue-header">
\t\t\t\t\t<div>
\t\t\t\t\t\t<h1>New Jira Ticket</h1>
\t\t\t\t\t\t<p class="issue-summary">Project ${escapeHtml(projectLabel)}</p>
\t\t\t\t\t</div>
\t\t\t\t</div>
\t\t\t\t${errorBanner}
\t\t\t\t${successBanner}
\t\t\t\t<div class="form-field">
\t\t\t\t\t<label>
\t\t\t\t\t\t<span class="section-title">Summary</span>
\t\t\t\t\t\t<input type="text" name="summary" value="${escapeAttribute(
							values.summary
						)}" placeholder="Ticket summary" ${disabledAttr} required />
\t\t\t\t\t</label>
\t\t\t\t</div>
\t\t\t\t<div class="form-field">
\t\t\t\t\t<label>
\t\t\t\t\t\t<span class="section-title">Description</span>
\t\t\t\t\t\t<textarea name="description" placeholder="What needs to be done?" ${disabledAttr}>${escapeHtml(
							values.description
						)}</textarea>
\t\t\t\t\t</label>
\t\t\t\t</div>
\t\t\t\t<div class="form-actions">
\t\t\t\t\t<button type="submit" class="primary" ${disabledAttr}>${buttonLabel}</button>
\t\t\t\t</div>
\t\t\t</div>
\t\t\t<div class="issue-sidebar">
\t\t\t\t<div class="meta-card">
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Project</div>
\t\t\t\t\t\t<div class="project-pill">${escapeHtml(projectLabel)}</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Issue Type</div>
\t\t\t\t\t\t<select name="issueType" ${disabledAttr}>
\t\t\t\t\t\t\t${renderIssueTypeOptions(values.issueType)}
\t\t\t\t\t\t</select>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Starting Status</div>
\t\t\t\t\t\t<select name="status" ${disabledAttr}>
\t\t\t\t\t\t\t${renderIssueStatusOptions(values.status, state.statusOptions)}
\t\t\t\t\t\t</select>
\t\t\t\t\t\t${statusPending ? '<div class="muted status-helper">Loading project statuses…</div>' : ''}
\t\t\t\t\t\t${statusError ? `<div class="status-error">${escapeHtml(statusError)}</div>` : ''}
\t\t\t\t\t</div>
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Assignee</div>
\t\t\t\t\t\t${assigneeSection}
\t\t\t\t\t</div>
\t\t\t\t\t<input type="hidden" name="assigneeAccountId" value="${escapeAttribute(
						values.assigneeAccountId ?? ''
					)}" />
\t\t\t\t\t<input type="hidden" name="assigneeDisplayName" value="${escapeAttribute(
						values.assigneeDisplayName ?? ''
					)}" />
\t\t\t\t</div>
\t\t\t</div>
\t\t</form>
\t</div>
\t<script nonce="${nonce}">
\t\t(function () {
\t\t\tconst vscode = acquireVsCodeApi();
\t\t\tconst form = document.getElementById('create-issue-form');
\t\t\tconst searchInput = document.querySelector('.jira-create-assignee-search');
\t\t\tconst select = document.querySelector('.jira-create-assignee-select');
\t\t\tconst applyButton = document.querySelector('.jira-create-assignee-apply');
\t\t\tconst accountInput = form ? form.querySelector('input[name="assigneeAccountId"]') : null;
\t\t\tconst displayInput = form ? form.querySelector('input[name="assigneeDisplayName"]') : null;
\t\t\tconst asString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

\t\t\tconst buildFormPayload = () => {
\t\t\t\tif (!form) {
\t\t\t\t\treturn {
\t\t\t\t\t\tsummary: '',
\t\t\t\t\t\tdescription: '',
\t\t\t\t\t\tissueType: 'Task',
\t\t\t\t\t\tstatus: '${defaultStatusAttr}',
\t\t\t\t\t\tassigneeAccountId: '',
\t\t\t\t\t\tassigneeDisplayName: '',
\t\t\t\t\t};
\t\t\t\t}
\t\t\t\tconst formData = new FormData(form);
\t\t\t\treturn {
\t\t\t\t\tsummary: asString(formData.get('summary')),
\t\t\t\t\tdescription: asString(formData.get('description')),
\t\t\t\t\tissueType: asString(formData.get('issueType'), 'Task'),
\t\t\t\t\tstatus: asString(formData.get('status'), '${defaultStatusAttr}'),
\t\t\t\t\tassigneeAccountId: asString(formData.get('assigneeAccountId')),
\t\t\t\t\tassigneeDisplayName: asString(formData.get('assigneeDisplayName')),
\t\t\t\t};
\t\t\t};

\t\t\tif (form) {
\t\t\t\tform.addEventListener('submit', (event) => {
\t\t\t\t\tevent.preventDefault();
\t\t\t\t\tconst payload = buildFormPayload();
\t\t\t\t\tvscode.postMessage({ type: 'createIssue', values: payload });
\t\t\t\t});
\t\t\t}

\t\t\tconst requestAssignees = (query) => {
\t\t\t\tif (!select) {
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst payload = buildFormPayload();
\t\t\t\tselect.setAttribute('data-loaded', 'pending');
\t\t\t\tselect.setAttribute('data-query', query ?? '');
\t\t\t\tvscode.postMessage({ type: 'loadCreateAssignees', query: query ?? '', values: payload });
\t\t\t};

\t\t\tconst updateApplyState = () => {
\t\t\t\tif (!select || !applyButton) {
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst current = (select.getAttribute('data-current-account-id') || '').trim();
\t\t\t\tconst value = (select.value || '').trim();
\t\t\t\tconst hasChange = value !== current;
\t\t\t\tapplyButton.disabled = select.disabled || !hasChange;
\t\t\t};

\t\t\tif (searchInput) {
\t\t\t\tsearchInput.addEventListener('keydown', (event) => {
\t\t\t\t\tif (event.key === 'Enter') {
\t\t\t\t\t\tevent.preventDefault();
\t\t\t\t\t\trequestAssignees(searchInput.value || '');
\t\t\t\t\t}
\t\t\t\t});
\t\t\t}

\t\t\tif (select) {
\t\t\t\tconst ensureLoaded = () => {
\t\t\t\t\tif (!searchInput) {
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tconst loadState = select.getAttribute('data-loaded');
\t\t\t\t\tconst pending = loadState === 'pending';
\t\t\t\t\tconst loaded = loadState === 'true';
\t\t\t\t\tconst lastQuery = select.getAttribute('data-query') || '';
\t\t\t\t\tconst currentQuery = searchInput.value || '';
\t\t\t\t\tif (!pending && (!loaded || lastQuery !== currentQuery)) {
\t\t\t\t\t\trequestAssignees(currentQuery);
\t\t\t\t\t}
\t\t\t\t};
\t\t\t\tselect.addEventListener('focus', ensureLoaded);
\t\t\t\tselect.addEventListener('click', ensureLoaded);
\t\t\t\tselect.addEventListener('change', () => {
\t\t\t\t\tupdateApplyState();
\t\t\t\t});
\t\t\t\tupdateApplyState();
\t\t\t}

\t\t\tif (applyButton && select) {
\t\t\t\tapplyButton.addEventListener('click', () => {
\t\t\t\t\tif (applyButton.disabled) {
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tconst selectedOption = select.options[select.selectedIndex];
\t\t\t\t\tconst displayName = selectedOption ? (selectedOption.textContent || '').trim() : '';
\t\t\t\t\tconst accountId = select.value || '';
\t\t\t\t\tconst resolvedDisplayName = accountId ? displayName : '';
\t\t\t\t\tif (accountInput) {
\t\t\t\t\t\taccountInput.value = accountId;
\t\t\t\t\t}
\t\t\t\t\tif (displayInput) {
\t\t\t\t\t\tdisplayInput.value = resolvedDisplayName;
\t\t\t\t\t}
\t\t\t\t\tselect.setAttribute('data-current-account-id', accountId);
\t\t\t\t\tupdateApplyState();
\t\t\t\t\tvscode.postMessage({
\t\t\t\t\t\ttype: 'selectCreateAssignee',
\t\t\t\t\t\taccountId,
\t\t\t\t\t\tdisplayName: resolvedDisplayName,
\t\t\t\t\t});
\t\t\t\t});
\t\t\t}
\t\t})();
\t</script>
</body>
</html>`;
}

function renderParentSection(issue: JiraIssue): string {
	const parent = issue.parent;
	const content = parent
		? renderRelatedIssueButton(parent)
		: '<div class="muted">No parent issue.</div>';
	return `<div class="section">
		<div class="section-title">Parent</div>
		${content}
	</div>`;
}

function renderChildrenSection(issue: JiraIssue): string {
	const children = issue.children?.filter((child) => !!child) ?? [];
	if (children.length === 0) {
		return `<div class="section">
			<div class="section-title">Subtasks</div>
			<div class="muted">No subtasks.</div>
		</div>`;
	}

	const listItems = children
		.map((child) => `<li>${renderRelatedIssueButton(child)}</li>`)
		.join('');

	return `<div class="section">
		<div class="section-title">Subtasks</div>
		<ul class="issue-list">${listItems}</ul>
	</div>`;
}

function renderDescriptionSection(issue: JiraIssue): string {
	const descriptionHtml = issue.descriptionHtml;
	const fallbackHtml = issue.description
		? `<p>${escapeHtml(issue.description).replace(/\r?\n/g, '<br />')}</p>`
		: undefined;
	const content = descriptionHtml ?? fallbackHtml;
	const body = content
		? `<div class="description-body rich-text-block">${content}</div>`
		: '<div class="muted">No description provided.</div>';
	return `<div class="section description-card">
		<div class="section-title">Description</div>
		${body}
	</div>`;
}

function renderCommentsSection(options?: IssuePanelOptions): string {
	const comments = options?.comments ?? [];
	const pending = options?.commentsPending ?? false;
	const error = options?.commentsError;

	let listContent = '';
	if (error) {
		listContent = `<div class="comment-message error">${escapeHtml(error)}</div>`;
	} else if (comments.length === 0 && pending) {
		listContent = '<div class="comment-message loading">Loading comments…</div>';
	} else if (comments.length === 0) {
		listContent = '<div class="comment-message muted">No comments yet.</div>';
	} else {
		const loadingBanner = pending
			? '<div class="comment-message loading">Refreshing comments…</div>'
			: '';
		listContent = `${loadingBanner}<ul class="comment-list">${renderCommentList(comments, options)}</ul>`;
	}

	const refreshLabel = pending ? 'Refreshing…' : 'Refresh';
	const refreshDisabledAttr = pending ? 'disabled' : '';
	return `<div class="section comments-section">
		<div class="comments-header">
			<div>
				<div class="section-title">Comments</div>
				<div class="muted">Use Jira wiki formatting to access every supported style.</div>
			</div>
			<button type="button" class="comment-refresh" ${refreshDisabledAttr}>${escapeHtml(refreshLabel)}</button>
		</div>
		${listContent}
		${renderCommentForm(options)}
	</div>`;
}

function renderCommentList(comments: JiraIssueComment[], options?: IssuePanelOptions): string {
	return comments.map((comment) => renderCommentItem(comment, options)).join('');
}

function renderCommentItem(comment: JiraIssueComment, options?: IssuePanelOptions): string {
	const timestamp = comment.updated ?? comment.created;
	const timestampText = timestamp ? formatIssueUpdated(timestamp) : undefined;
	const authorLabel = escapeHtml(comment.authorName ?? 'Unknown user');
	const isDeleting = options?.commentDeletingId === comment.id;
	const deleteDisabled = isDeleting || (options?.commentsPending ?? false);
	const deleteLabel = isDeleting ? 'Deleting…' : 'Delete';
	const deleteButton = comment.id
		? `<button type="button" class="comment-delete" data-comment-id="${escapeAttribute(comment.id)}" ${deleteDisabled ? 'disabled' : ''}>${escapeHtml(deleteLabel)}</button>`
		: '';
	const currentUserTag = comment.isCurrentUser ? '<span class="comment-author-self">You</span>' : '';
	const bodyHtml = comment.renderedBody && comment.renderedBody.trim().length > 0
		? comment.renderedBody
		: '<p class="muted">No comment body</p>';
	return `<li class="comment-item">
		${renderCommentAvatar(comment)}
		<div class="comment-content">
			<div class="comment-meta">
				<span class="comment-author">${authorLabel}</span>
				${currentUserTag}
				${timestampText ? `<span class="comment-date">${escapeHtml(timestampText)}</span>` : ''}
				${deleteButton}
			</div>
			<div class="comment-body rich-text-block" data-comment-id="${escapeAttribute(comment.id ?? '')}">${bodyHtml}</div>
		</div>
	</li>`;
}

function renderCommentForm(options?: IssuePanelOptions): string {
	const pending = options?.commentSubmitPending ?? false;
	const draftValue = options?.commentDraft ?? '';
	const format: JiraCommentFormat = options?.commentFormat === 'plain' ? 'plain' : 'wiki';
	const hasText = draftValue.trim().length > 0;
	const buttonDisabled = pending || !hasText;
	const buttonLabel = pending ? 'Adding…' : 'Add comment';
	const errorMarkup = options?.commentSubmitError
		? `<div class="comment-error">${escapeHtml(options.commentSubmitError)}</div>`
		: '<div class="comment-error hidden"></div>';
	return `<form class="comment-form" data-pending="${pending ? 'true' : 'false'}">
		<label class="section-title" for="comment-input">Add a comment</label>
		<textarea id="comment-input" class="comment-input" ${pending ? 'disabled' : ''} placeholder="Share updates or blockers">${escapeHtml(draftValue)}</textarea>
		<div class="comment-controls">
			<label class="comment-select-label">
				Format
				<select class="comment-format-select" ${pending ? 'disabled' : ''}>
					<option value="wiki" ${format === 'wiki' ? 'selected' : ''}>Jira wiki (full formatting)</option>
					<option value="plain" ${format === 'plain' ? 'selected' : ''}>Plain text</option>
				</select>
			</label>
			<button type="submit" class="comment-submit" ${buttonDisabled ? 'disabled' : ''}>${escapeHtml(buttonLabel)}</button>
		</div>
		<div class="muted comment-helper">All Jira formatting is supported when using the Jira wiki option.</div>
		${errorMarkup}
	</form>`;
}

function renderCommentAvatar(comment: JiraIssueComment): string {
	if (comment.authorAvatarUrl) {
		return `<img class="comment-avatar" src="${escapeAttribute(comment.authorAvatarUrl)}" alt="${escapeAttribute(comment.authorName ?? 'Comment author')} avatar" />`;
	}
	return `<div class="comment-avatar fallback">${escapeHtml(getInitials(comment.authorName))}</div>`;
}

function renderRelatedIssueButton(issue: JiraRelatedIssue): string {
	const summaryText = issue.summary ? ` · ${escapeHtml(issue.summary)}` : '';
	const statusText = issue.statusName ? ` — ${escapeHtml(issue.statusName)}` : '';
	return `<button class="issue-link" data-issue-key="${escapeHtml(issue.key)}">
		${escapeHtml(issue.key)}${summaryText}${statusText}
	</button>`;
}

function renderMetadataPanel(
	issue: JiraIssue,
	assignee: string,
	updatedText: string,
	options?: IssuePanelOptions
): string {
	const statusControl = renderStatusControl(issue, options);
	const assigneeControl = renderAssigneeControl(issue, assignee, options);
	return `<div class="issue-sidebar">
		<div class="meta-card">
			<div class="meta-section">
				<div class="section-title">Status</div>
				${statusControl}
			</div>
			<div class="meta-section">
				<div class="section-title">Assignee</div>
				${assigneeControl}
			</div>
			<div class="meta-section">
				<div class="section-title">Last Updated</div>
				<div>${escapeHtml(updatedText)}</div>
			</div>
		</div>
		</div>`;
}

function renderStatusControl(issue: JiraIssue, options?: IssuePanelOptions): string {
	const transitions = options?.statusOptions;
	const pending = options?.statusPending;
	const statusError = options?.statusError;

	if (!transitions || transitions.length === 0) {
		const message = statusError
			? statusError
			: options?.loading
			? 'Loading available statuses…'
			: 'No status transitions available.';
		return `<div>${escapeHtml(issue.statusName)}</div>
		<div class="muted">${escapeHtml(message)}</div>`;
	}

	const selectOptions = transitions
		.map(
			(option) =>
				`<option value="${escapeAttribute(option.id)}">${escapeHtml(option.name)}</option>`
		)
		.join('');
	const disabledAttr = pending ? 'disabled' : '';

	return `<div class="status-select-wrapper">
		<select class="jira-status-select" data-issue-key="${escapeAttribute(issue.key)}" ${disabledAttr}>
			<option value="" disabled selected>Current: ${escapeHtml(issue.statusName)}</option>
			${selectOptions}
		</select>
		${statusError ? `<div class="status-error">${escapeHtml(statusError)}</div>` : ''}
	</div>`;
}

function renderIssueTypeOptions(selected: string): string {
	return ISSUE_TYPE_OPTIONS.map((option) => {
		const isSelected = option === selected;
		return `<option value="${escapeAttribute(option)}" ${isSelected ? 'selected' : ''}>${escapeHtml(option)}</option>`;
	}).join('');
}

function renderIssueStatusOptions(selected: string, options?: IssueStatusOption[]): string {
	const names = deriveStatusOptionNames(options);
	return names
		.map((option) => {
			const isSelected = option === selected;
			return `<option value="${escapeAttribute(option)}" ${isSelected ? 'selected' : ''}>${escapeHtml(option)}</option>`;
		})
		.join('');
}

function renderCreateAssigneeSection(state: CreateIssuePanelState): string {
	const pending = state.assigneePending ?? false;
	const interactionDisabled = !!state.submitting || pending;
	const queryValue = state.assigneeQuery ?? '';
	const hasOptions = !!state.assigneeOptions && state.assigneeOptions.length > 0;
	const selectLoadState = pending ? 'pending' : hasOptions ? 'true' : 'false';
	const placeholderText = hasOptions
		? 'Select an assignee'
		: pending
		? 'Loading assignable users…'
		: state.assigneeError
		? state.assigneeError
		: 'Search to load assignable users.';
	const selectOptions = hasOptions ? renderCreateAssigneeOptions(state) : '';
	const helperText = pending
		? 'Loading assignable users…'
		: 'Type a name, press Enter to search, then choose a person and press OK.';
	const errorText =
		!pending && state.assigneeError
			? `<div class="status-error">${escapeHtml(state.assigneeError)}</div>`
			: '';
	const currentLabel = state.values.assigneeDisplayName
		? `Selected: ${state.values.assigneeDisplayName}`
		: 'Selected: Unassigned (assign later)';
	const selectDisabledAttr = interactionDisabled ? 'disabled' : '';
	const searchDisabledAttr = interactionDisabled ? 'disabled' : '';
	return `<div class="assignee-card">
		<div class="assignee-control-details">
			<div class="muted">${escapeHtml(currentLabel)}</div>
			<div class="assignee-search-row">
				<input type="text" class="jira-create-assignee-search" value="${escapeAttribute(
					queryValue
				)}" placeholder="Search people" ${searchDisabledAttr} />
			</div>
			<div class="assignee-select-row">
				<select class="jira-create-assignee-select" data-loaded="${escapeAttribute(
					selectLoadState
				)}" data-query="${escapeAttribute(queryValue)}" data-current-account-id="${escapeAttribute(
		state.values.assigneeAccountId ?? ''
	)}" ${selectDisabledAttr}>
					<option value="">${escapeHtml(placeholderText)}</option>
					${selectOptions}
				</select>
				<button type="button" class="jira-create-assignee-apply" disabled>OK</button>
			</div>
			<div class="muted assignee-helper">${escapeHtml(helperText)}</div>
			${errorText}
		</div>
	</div>`;
}

function renderCreateAssigneeOptions(state: CreateIssuePanelState): string {
	const options = state.assigneeOptions ?? [];
	if (options.length === 0) {
		return '';
	}
	const currentId = state.values.assigneeAccountId?.trim();
	let hasCurrent = false;
	const rendered = options
		.map((user) => {
			const isSelected = !!currentId && user.accountId === currentId;
			if (isSelected) {
				hasCurrent = true;
			}
			return `<option value="${escapeAttribute(user.accountId)}" ${
				isSelected ? 'selected' : ''
			}>${escapeHtml(user.displayName)}</option>`;
		})
		.join('');
	if (currentId && !hasCurrent) {
		const fallbackLabel = state.values.assigneeDisplayName ?? `Selected (${currentId})`;
		return `<option value="${escapeAttribute(currentId)}" selected>${escapeHtml(
			fallbackLabel
		)}</option>${rendered}`;
	}
	return rendered;
}

function deriveStatusOptionNames(options?: IssueStatusOption[]): string[] {
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

function renderAssigneeControl(
	issue: JiraIssue,
	currentAssigneeLabel: string,
	options?: IssuePanelOptions
): string {
	const assigneeOptions = options?.assigneeOptions;
	const pending = options?.assigneePending;
	const assigneeError = options?.assigneeError;
	const currentAccountId = issue.assigneeAccountId;
	const queryValue = options?.assigneeQuery ?? '';
	const searchDisabledAttr = pending ? 'disabled' : '';

	if (!assigneeOptions || assigneeOptions.length === 0) {
		const message = assigneeError
			? assigneeError
			: 'Search to load assignable users.';
	return `<div class="assignee-card">
		${renderAssigneeAvatar(issue)}
		<div class="assignee-control-details">
			<div class="muted">Current: ${escapeHtml(currentAssigneeLabel || 'Unassigned')}</div>
			<div class="assignee-search-row">
				<input type="text" class="jira-assignee-search" data-issue-key="${escapeAttribute(
					issue.key
				)}" data-query="${escapeAttribute(queryValue)}" value="${escapeAttribute(
					queryValue
				)}" placeholder="Search people" ${searchDisabledAttr} />
			</div>
			<div class="assignee-select-row">
				<select class="jira-assignee-select" data-issue-key="${escapeAttribute(
					issue.key
				)}" data-loaded="false" data-query="${escapeAttribute(queryValue)}" data-current-account-id="${escapeAttribute(
					currentAccountId ?? ''
				)}" ${searchDisabledAttr}>
					<option value="">${escapeHtml(message)}</option>
				</select>
				<button class="jira-assignee-apply" data-issue-key="${escapeAttribute(
					issue.key
				)}" title="Apply assignee change" disabled>OK</button>
			</div>
		</div>
	</div>`;
}

	const selectDisabledAttr = pending ? 'disabled' : '';
	const selectOptions = assigneeOptions
		.map((user) => {
			const isCurrent =
				(currentAccountId && user.accountId === currentAccountId) ||
				user.displayName === issue.assigneeName;
			return `<option value="${escapeAttribute(user.accountId)}" ${
				isCurrent ? 'selected' : ''
			}>${escapeHtml(user.displayName)}</option>`;
		})
		.join('');
	const disabledAttr = pending ? 'disabled' : '';

	return `<div class="assignee-card">
		${renderAssigneeAvatar(issue)}
		<div class="assignee-control-details">
			<div class="muted">Current: ${escapeHtml(currentAssigneeLabel || 'Unassigned')}</div>
			<div class="assignee-search-row">
				<input type="text" class="jira-assignee-search" data-issue-key="${escapeAttribute(
					issue.key
				)}" value="${escapeAttribute(queryValue)}" placeholder="Search people" ${searchDisabledAttr} />
			</div>
			<div class="assignee-select-row">
				<select class="jira-assignee-select" data-issue-key="${escapeAttribute(
					issue.key
				)}" data-loaded="true" data-query="${escapeAttribute(queryValue)}" data-current-account-id="${escapeAttribute(
					currentAccountId ?? ''
				)}" ${selectDisabledAttr}>
					${selectOptions}
				</select>
				<button class="jira-assignee-apply" data-issue-key="${escapeAttribute(
					issue.key
				)}" title="Apply assignee change" disabled>OK</button>
			</div>
			${assigneeError ? `<div class="status-error">${escapeHtml(assigneeError)}</div>` : ''}
		</div>
	</div>`;
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

function renderAssigneeAvatar(issue: JiraIssue): string {
	if (issue.assigneeAvatarUrl) {
		return `<img class="assignee-avatar" src="${escapeAttribute(issue.assigneeAvatarUrl)}" alt="Assignee avatar" />`;
	}
	const initials = getInitials(issue.assigneeName);
	return `<div class="assignee-avatar fallback">${escapeHtml(initials)}</div>`;
}

function getInitials(name?: string): string {
	if (!name) {
		return '??';
	}
	const parts = name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? '');
	const combined = parts.join('');
	if (combined) {
		return combined;
	}
	const trimmed = name.replace(/\s+/g, '');
	return trimmed.slice(0, 2).toUpperCase() || '??';
}

function generateNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

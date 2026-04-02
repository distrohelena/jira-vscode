import * as vscode from 'vscode';

import {
	CreateIssueFieldDefinition,
	CreateIssueFormValues,
	CreateIssuePanelState,
	IssueAssignableUser,
	IssueStatusCategory,
	IssuePanelOptions,
	IssueStatusOption,
	JiraIssue,
	JiraIssueComment,
	JiraRelatedIssue,
	SelectedProjectInfo,
} from '../../model/jira.type';
import { ISSUE_STATUS_OPTIONS, ISSUE_TYPE_OPTIONS } from '../../model/jira.constant';
import { IssueModel } from '../../model/issue.model';
import { HtmlHelper } from '../../shared/html.helper';
import { ViewResource } from '../view.resource';
import { AssigneePickerOverlay } from './assignee-picker.overlay';
import { ParentIssuePickerOverlay } from './parent-issue-picker.overlay';
import { SharedParentPicker } from './shared-parent-picker';

type RichTextEditorRenderOptions = {
	editorId: string;
	name?: string;
	value: string;
	placeholder: string;
	disabled?: boolean;
	minRows?: number;
	inputClassName?: string;
	editorClassName?: string;
	ariaLabel?: string;
};

export class JiraWebviewPanel {
	static showIssueDetailsPanel(
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
			if (message?.type === 'debugLog') {
				const eventName = typeof message.event === 'string' ? message.event : 'unknown';
				const details = formatDebugDetails(message.details);
				console.log(`[jira.webview] ${eventName}${details}`);
				return;
			}
			onMessage?.(message, panel);
		});
		const issueData = issue ?? IssueModel.createPlaceholderIssue(issueKey);
		JiraWebviewPanel.renderIssuePanelContent(panel, issueData, options);
		return panel;
	}

	static renderIssuePanelContent(panel: vscode.WebviewPanel, issue: JiraIssue, options?: IssuePanelOptions): void {
		const statusCategory = IssueModel.determineStatusCategory(issue.statusName);
		const iconPath = ViewResource.getStatusIconPath(statusCategory);
		if (iconPath) {
			panel.iconPath = iconPath;
		}
		const statusIconSrc = issue.statusIconSrc?.trim() || ViewResource.getStatusIconWebviewSrc(panel.webview, statusCategory);
		panel.webview.html = renderIssueDetailsHtml(panel.webview, issue, statusIconSrc, options);
	}

	static showCreateIssuePanel(project: SelectedProjectInfo, state: CreateIssuePanelState): vscode.WebviewPanel {
		const panel = vscode.window.createWebviewPanel(
			'jiraCreateIssue',
			`New Ticket (${project.key})`,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		);
		const iconPath = ViewResource.getItemsIconPath();
		if (iconPath) {
			panel.iconPath = iconPath;
		}
		JiraWebviewPanel.renderCreateIssuePanel(panel, project, state);
		return panel;
	}

	static renderCreateIssuePanel(
		panel: vscode.WebviewPanel,
		project: SelectedProjectInfo,
		state: CreateIssuePanelState
	): void {
		panel.webview.html = renderCreateIssuePanelHtml(panel.webview, project, state);
	}

	static formatDebugDetails(details: unknown): string {
	if (details === undefined) {
		return '';
	}
	try {
		return ` ${JSON.stringify(details)}`;
	} catch {
		return ' [unserializable]';
	}
}

	static renderIssueDetailsHtml(
	webview: vscode.Webview,
	issue: JiraIssue,
	statusIconSrc?: string,
	options?: IssuePanelOptions
): string {
	const updatedText = IssueModel.formatIssueUpdated(issue.updated);
	const assignee = issue.assigneeName ?? 'Unassigned';
	const reporter = issue.reporterName ?? 'Unknown';
	const nonce = generateNonce();
	const isLoading = options?.loading ?? false;
	const errorMessage = options?.error;
	const descriptionSection = errorMessage ? '' : renderDescriptionSection(issue, options, isLoading);
	const parentSection = errorMessage ? '' : renderParentMetadataSection(issue);
	const childrenSection = errorMessage ? '' : renderChildrenSection(issue);
	const cspSource = webview.cspSource;
	const metadataPanel = renderMetadataPanel(webview, issue, parentSection, assignee, reporter, updatedText, options);
	const issueTypeLabel = (issue.issueTypeName?.trim() || 'Issue').toUpperCase();
	const effectiveStatusIconSrc = statusIconSrc?.trim();
	const effectiveIssueTypeIconSrc = issue.issueTypeIconSrc?.trim();
	const issueTypeIconMarkup = `<div class="ticket-icon-slot">
		${
			effectiveIssueTypeIconSrc
				? `<img class="issue-type-icon" src="${HtmlHelper.escapeAttribute(effectiveIssueTypeIconSrc)}" alt="${HtmlHelper.escapeHtml(
						issue.issueTypeName ?? 'Issue type'
					)} icon" />`
				: '<span class="issue-type-icon issue-type-icon-placeholder" aria-hidden="true"></span>'
		}
	</div>`;
	const statusIconMarkup = `<div class="ticket-icon-slot">
		${
			effectiveStatusIconSrc
				? `<img class="status-icon" src="${HtmlHelper.escapeAttribute(effectiveStatusIconSrc)}" alt="${HtmlHelper.escapeHtml(
						issue.statusName ?? 'Issue status'
					)} status icon" />`
				: '<span class="status-icon status-icon-placeholder" aria-hidden="true"></span>'
		}
	</div>`;
	const ticketIconMarkup = `<div class="ticket-icon-block">
		${issueTypeIconMarkup}
		${statusIconMarkup}
		<div class="ticket-type-label">${HtmlHelper.escapeHtml(issueTypeLabel)}</div>
	</div>`;
	let messageBanner = '';
	if (errorMessage) {
		messageBanner = `<div class="section error-banner">${HtmlHelper.escapeHtml(errorMessage)}</div>`;
	} else if (isLoading) {
		messageBanner = `<div class="section loading-banner">Refreshing issue details…</div>`;
	}
	const linkSection =
		issue.url && !errorMessage
			? `<div class="section">
		<a href="${HtmlHelper.escapeHtml(issue.url)}" target="_blank" rel="noreferrer noopener">Open in Jira</a>
	</div>`
			: '';
	const commentsSection = renderCommentsSection(options);
	const richTextEditorStyles = renderRichTextEditorStyles();
	const richTextEditorBootstrapScript = renderRichTextEditorBootstrapScript();
	const statusPickerStyles = renderStatusPickerStylesV2();
	const statusPickerBootstrapScript = renderStatusPickerBootstrapScriptV2(
		JiraWebviewPanel.buildStatusIconFallbacks(webview)
	);
	const summaryText = issue.summary ?? 'Loading issue details…';
	const summaryValue = issue.summary ?? '';
	const summaryEditPending = options?.summaryEditPending ?? false;
	const summaryEditError = options?.summaryEditError;
	const summaryEditDisabled = summaryEditPending;
	const summaryEditDisabledAttr = summaryEditDisabled ? 'disabled' : '';
	const summaryBlockClasses = ['issue-summary-block'];
	if (summaryEditPending) {
		summaryBlockClasses.push('summary-edit-pending');
	}
	if (summaryEditDisabled) {
		summaryBlockClasses.push('summary-edit-disabled');
	}
	const summaryErrorMarkup = summaryEditError
		? `<div class="status-error issue-summary-error">${HtmlHelper.escapeHtml(summaryEditError)}</div>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<title>${HtmlHelper.escapeHtml(issue.key)}</title>
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
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
		margin-bottom: 24px;
	}
	.issue-header-main {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		flex: 1;
	}
	.issue-header-copy {
		flex: 1;
		min-width: 0;
	}
	.status-icon {
		width: 56px;
		height: 56px;
		flex-shrink: 0;
		margin-top: 4px;
		object-fit: contain;
	}
	.issue-type-icon {
		width: 56px;
		height: 56px;
		flex-shrink: 0;
		object-fit: contain;
	}
	.ticket-icon-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
		min-width: 72px;
	}
	.ticket-icon-slot {
		width: 56px;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.ticket-icon-slot .issue-type-icon,
	.ticket-icon-slot .status-icon,
	.ticket-icon-slot .issue-type-icon-placeholder,
	.ticket-icon-slot .status-icon-placeholder {
		display: block;
	}
	.ticket-type-label {
		margin-top: 4px;
		font-size: 10px;
		line-height: 1.2;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--vscode-descriptionForeground);
		text-align: center;
		white-space: nowrap;
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
	.issue-summary-block {
		position: relative;
		width: 100%;
	}
	.issue-summary-block .issue-summary {
		margin-bottom: 6px;
	}
	.issue-summary-block .jira-summary-display {
		cursor: pointer;
		border-radius: 4px;
		padding: 2px 4px;
		margin-left: -4px;
		margin-right: -4px;
		transition: background-color 120ms ease-in-out;
	}
	.issue-summary-block:hover .jira-summary-display {
		background: var(--vscode-editor-selectionBackground, rgba(127,127,127,0.24));
	}
	.jira-summary-editor {
		display: none;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 12px;
		width: 100%;
	}
	.issue-summary-block.editor-open .jira-summary-editor {
		display: flex;
	}
	.issue-summary-block.editor-open .jira-summary-display {
		display: none;
	}
	.jira-summary-input {
		display: block;
		width: 100%;
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border);
		border-radius: 4px;
		padding: 6px 10px;
		font-size: 1em;
	}
	.jira-summary-actions {
		display: flex;
		gap: 8px;
	}
	.jira-summary-save,
	.jira-summary-cancel {
		border-radius: 4px;
		border: 1px solid var(--vscode-button-secondaryBorder, transparent);
		background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
		color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
		padding: 6px 12px;
		cursor: pointer;
		font-size: 0.9em;
	}
	.jira-summary-save:disabled,
	.jira-summary-cancel:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.issue-summary-error {
		margin-bottom: 10px;
	}
.issue-actions {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}
.issue-commit,
.issue-search-commit-history {
	border-radius: 4px;
	border: 1px solid var(--vscode-button-secondaryBorder, transparent);
	background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
	color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
	padding: 8px 12px;
	cursor: pointer;
	font-size: 0.95em;
	white-space: nowrap;
}
.issue-commit:disabled,
.issue-search-commit-history:disabled {
	opacity: 0.6;
	cursor: not-allowed;
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
	.comment-reply,
	.comment-delete,
	.comment-reply-cancel,
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
	.comment-reply:disabled,
	.comment-delete:disabled,
	.comment-reply-cancel:disabled,
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
	.comment-meta-actions {
		display: inline-flex;
		gap: 8px;
		margin-left: auto;
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
	.issue-description-block {
		position: relative;
		width: 100%;
	}
	.jira-description-display {
		cursor: pointer;
		margin-top: 8px;
	}
	.jira-description-preview {
		display: none;
		margin-top: 8px;
		font-size: 0.85em;
		color: var(--vscode-descriptionForeground);
		padding: 3px 8px;
		border: 1px dashed var(--vscode-panel-border, rgba(255,255,255,0.22));
		border-radius: 4px;
		width: fit-content;
		user-select: none;
		cursor: pointer;
	}
	.issue-description-block:hover .jira-description-preview {
		display: inline-block;
	}
	.issue-description-block:hover .jira-description-display {
		border-color: var(--vscode-textLink-foreground);
	}
	.jira-description-editor {
		display: none;
		flex-direction: column;
		gap: 8px;
		margin-top: 8px;
		width: 100%;
	}
	.issue-description-block.editor-open .jira-description-editor {
		display: flex;
	}
	.issue-description-block.editor-open .jira-description-display,
	.issue-description-block.editor-open .jira-description-preview {
		display: none;
	}
	.jira-description-visual-editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.jira-description-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
		.jira-description-editor-input {
			width: 100%;
			box-sizing: border-box;
			min-height: 360px;
			height: 360px;
			resize: none;
		overflow-y: auto;
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border);
		border-radius: 4px;
		padding: 10px;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.jira-description-editor-input[contenteditable='true']:focus {
		outline: none;
		border-color: var(--vscode-focusBorder, var(--vscode-input-border));
		box-shadow: 0 0 0 1px var(--vscode-focusBorder, transparent);
	}
	.jira-description-editor-input[contenteditable='true']:empty::before {
		content: attr(data-placeholder);
		color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
		pointer-events: none;
	}
	.jira-description-editor-input h1,
	.jira-description-editor-input h2,
	.jira-description-editor-input h3,
	.jira-description-editor-input h4,
	.jira-description-editor-input h5,
	.jira-description-editor-input h6 {
		margin: 0.4em 0 0.3em 0;
	}
	.jira-description-editor-input p {
		margin: 0 0 0.8em 0;
	}
	.jira-description-editor-input ul,
	.jira-description-editor-input ol {
		margin: 0 0 0.8em 1.2em;
	}
	.jira-description-editor-input blockquote {
		margin: 0 0 0.8em 0;
		padding-left: 10px;
		border-left: 3px solid var(--vscode-panel-border, rgba(255,255,255,0.2));
		color: var(--vscode-descriptionForeground);
	}
	.jira-description-editor-input pre {
		background: var(--vscode-editor-background);
		border: 1px solid var(--vscode-input-border);
		border-radius: 4px;
		padding: 8px;
		overflow-x: auto;
	}
	.jira-description-editor-input code {
		background: var(--vscode-editorWidget-background, rgba(255,255,255,0.04));
		padding: 1px 4px;
		border-radius: 3px;
	}
	.jira-description-actions {
		display: flex;
		gap: 8px;
	}
	.jira-description-save,
	.jira-description-cancel {
		border-radius: 4px;
		border: 1px solid var(--vscode-button-secondaryBorder, transparent);
		background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
		color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
		padding: 6px 12px;
		cursor: pointer;
		font-size: 0.9em;
	}
	.jira-description-save:disabled,
	.jira-description-cancel:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.description-edit-pending .jira-description-preview {
		display: inline-block;
	}
	.description-edit-pending .jira-description-preview::before {
		content: 'Saving description...';
	}
	.description-edit-pending .jira-description-preview span {
		display: none;
	}
	.description-edit-disabled .jira-description-preview,
	.description-edit-disabled:hover .jira-description-preview {
		display: none;
	}
	.issue-description-error {
		margin-top: 8px;
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
	.comment-reply-banner {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		padding: 12px;
		border-radius: 6px;
		border: 1px solid var(--vscode-textLink-foreground, rgba(0,122,204,0.35));
		background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
	}
	.comment-reply-copy {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.comment-reply-title {
		font-weight: 600;
	}
	.comment-reply-excerpt {
		color: var(--vscode-descriptionForeground);
		font-size: 0.9em;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.comment-form .jira-rich-editor-input {
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
		.issue-sidebar[data-issue-details-sidebar] [data-parent-picker-open],
		.issue-sidebar[data-issue-details-sidebar] [data-assignee-picker-open] {
			cursor: pointer;
		}
		.issue-sidebar[data-issue-details-sidebar] [data-parent-picker-open]:disabled,
		.issue-sidebar[data-issue-details-sidebar] [data-assignee-picker-open]:disabled {
			cursor: not-allowed;
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
				display: flex;
				flex-direction: column;
				gap: 8px;
			}
			.assignee-current-row {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 12px;
			}
			.assignee-current-copy {
				display: flex;
				flex-direction: column;
				justify-content: center;
				min-width: 0;
			}
			.assignee-current-name {
				font-weight: 600;
				line-height: 1.2;
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
				min-width: 0;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 4px 8px;
				min-height: 28px;
				box-sizing: border-box;
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
			}
			.assignee-search-row input::placeholder {
				color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
			}
			.assignee-search-row input:focus {
				outline: none;
				border-color: var(--vscode-focusBorder, var(--vscode-input-border));
				box-shadow: 0 0 0 1px var(--vscode-focusBorder, transparent);
			}
			.assignee-search-row input:disabled {
				opacity: 0.7;
				cursor: not-allowed;
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
		${statusPickerStyles}
		${richTextEditorStyles}
			${ParentIssuePickerOverlay.renderStyles()}
			${AssigneePickerOverlay.renderStyles()}
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
				<div class="issue-header-main">
					${ticketIconMarkup}
					<div class="issue-header-copy">
						<h1>${HtmlHelper.escapeHtml(issue.key)}</h1>
						<div class="${summaryBlockClasses.join(' ')}" data-issue-key="${HtmlHelper.escapeAttribute(
							issue.key
						)}" data-summary-edit-disabled="${summaryEditDisabled ? 'true' : 'false'}">
							<p class="issue-summary jira-summary-display">${HtmlHelper.escapeHtml(summaryText)}</p>
							<form class="jira-summary-editor">
								<input type="text" class="jira-summary-input" value="${HtmlHelper.escapeAttribute(
									summaryValue
								)}" ${summaryEditDisabledAttr} />
								<div class="jira-summary-actions">
									<button type="submit" class="jira-summary-save" ${summaryEditDisabledAttr}>Save</button>
									<button type="button" class="jira-summary-cancel" ${summaryEditDisabledAttr}>Cancel</button>
								</div>
							</form>
							${summaryErrorMarkup}
						</div>
					</div>
				</div>
				<div class="issue-actions">
					<button type="button" class="issue-commit" data-issue-key="${HtmlHelper.escapeAttribute(
						issue.key
					)}" ${isLoading ? 'disabled' : ''}>Commit from Issue</button>
					<button type="button" class="issue-search-commit-history" data-issue-key="${HtmlHelper.escapeAttribute(
						issue.key
					)}" ${isLoading ? 'disabled' : ''}>Search Commit History</button>
				</div>
			</div>
			${messageBanner}
			${descriptionSection}
			${childrenSection}
			${linkSection}
			${commentsSection}
		</div>
		${metadataPanel}
	</div>
	${ParentIssuePickerOverlay.renderHostMarkup()}
	${AssigneePickerOverlay.renderHostMarkup()}
			<script nonce="${nonce}">
				(function () {
					const vscode = acquireVsCodeApi();
					${ParentIssuePickerOverlay.renderBootstrapScript()}
					${AssigneePickerOverlay.renderBootstrapScript()}
					const logDebug = (event, details) => {
						try {
							vscode.postMessage({ type: 'debugLog', event, details });
						} catch {
							// Ignore logging failures to avoid impacting issue actions.
						}
					};
					${richTextEditorBootstrapScript}
					${statusPickerBootstrapScript}
					initializeJiraRichTextEditors(document);
					initializeJiraStatusPickers(document, vscode);
					const summaryBlock = document.querySelector('.issue-summary-block');
					logDebug('issuePanel.init', {
						hasSummaryBlock: !!summaryBlock,
						hasDescriptionBlock: !!document.querySelector('.issue-description-block'),
					});
					if (summaryBlock) {
						const summaryDisplay = summaryBlock.querySelector('.jira-summary-display');
						const summaryEditor = summaryBlock.querySelector('.jira-summary-editor');
						const summaryInput = summaryBlock.querySelector('.jira-summary-input');
						const summaryCancel = summaryBlock.querySelector('.jira-summary-cancel');
						const issueKey = summaryBlock.getAttribute('data-issue-key');
						const openSummaryEditor = () => {
							if (
								!summaryEditor ||
								!summaryInput ||
								summaryBlock.classList.contains('summary-edit-pending')
							) {
								logDebug('summary.open.blocked', {
									issueKey,
									hasEditor: !!summaryEditor,
									hasInput: !!summaryInput,
									pending: summaryBlock.classList.contains('summary-edit-pending'),
								});
								return;
							}
							summaryBlock.classList.add('editor-open');
							logDebug('summary.open', { issueKey });
							summaryInput.focus();
							summaryInput.select();
						};
						const closeSummaryEditor = () => {
							if (!summaryEditor || !summaryInput || !summaryDisplay) {
								logDebug('summary.close.blocked', {
									issueKey,
									hasEditor: !!summaryEditor,
									hasInput: !!summaryInput,
									hasDisplay: !!summaryDisplay,
								});
								return;
							}
							summaryInput.value = summaryDisplay.textContent || '';
							summaryBlock.classList.remove('editor-open');
							logDebug('summary.close', { issueKey });
						};
						if (summaryDisplay) {
							summaryDisplay.addEventListener('click', () => {
								logDebug('summary.click', { issueKey });
								openSummaryEditor();
							});
						}
						if (summaryEditor && summaryInput && issueKey) {
							summaryEditor.addEventListener('submit', (event) => {
								event.preventDefault();
								const nextSummary = summaryInput.value.trim();
								if (!nextSummary) {
									logDebug('summary.submit.ignoredEmpty', { issueKey });
									return;
								}
								if (nextSummary === (summaryDisplay?.textContent || '').trim()) {
									logDebug('summary.submit.unchanged', { issueKey });
									closeSummaryEditor();
									return;
								}
								summaryBlock.classList.add('summary-edit-pending');
								const buttons = summaryEditor.querySelectorAll('button');
								buttons.forEach((button) => {
									button.disabled = true;
								});
								summaryInput.disabled = true;
								logDebug('summary.submit', { issueKey, nextSummaryLength: nextSummary.length });
								vscode.postMessage({ type: 'updateSummary', issueKey, summary: nextSummary });
							});
						}
						if (summaryCancel) {
							summaryCancel.addEventListener('click', () => {
								logDebug('summary.cancel', { issueKey });
								closeSummaryEditor();
							});
						}
						if (summaryInput) {
							summaryInput.addEventListener('keydown', (event) => {
								if (event.key === 'Escape') {
									event.preventDefault();
									logDebug('summary.escape', { issueKey });
									closeSummaryEditor();
								}
							});
						}
					}
				const descriptionBlock = document.querySelector('.issue-description-block');
				if (descriptionBlock) {
					const normalizeDescriptionText = (value) => {
						return (value || '')
							.replace(/\\r/g, '')
							.replace(/[ \\t]+\\n/g, '\\n')
							.replace(/\\n{3,}/g, '\\n\\n')
							trim();
					};
					const serializeInlineNodeToWiki = (node) => {
						if (!node) {
							return '';
						}
						if (node.nodeType === Node.TEXT_NODE) {
							return (node.textContent || '').replace(/\u00A0/g, ' ');
						}
						if (!(node instanceof HTMLElement)) {
							return '';
						}
						const tag = node.tagName.toLowerCase();
						const content = Array.from(node.childNodes).map(serializeInlineNodeToWiki).join('');
						switch (tag) {
							case 'strong':
							case 'b':
								return content ? '*' + content + '*' : '';
							case 'em':
							case 'i':
								return content ? '_' + content + '_' : '';
							case 'u':
								return content ? '+' + content + '+' : '';
							case 's':
							case 'strike':
							case 'del':
								return content ? '-' + content + '-' : '';
							case 'code':
								return '{{' + (node.textContent || '') + '}}';
							case 'a': {
								const href = (node.getAttribute('href') || '').trim();
								const linkText = content.trim() || href;
								return href ? '[' + linkText + '|' + href + ']' : linkText;
							}
							case 'br':
								return '\\n';
							default:
								return content;
						}
					};
					const serializeBlockNodeToWiki = (node) => {
						if (!node) {
							return '';
						}
						if (node.nodeType === Node.TEXT_NODE) {
							return (node.textContent || '').trim();
						}
						if (!(node instanceof HTMLElement)) {
							return '';
						}
						const tag = node.tagName.toLowerCase();
						const inline = Array.from(node.childNodes).map(serializeInlineNodeToWiki).join('').trim();
						switch (tag) {
							case 'h2':
								return inline ? 'h2. ' + inline : '';
							case 'h3':
								return inline ? 'h3. ' + inline : '';
							case 'h4':
								return inline ? 'h4. ' + inline : '';
							case 'blockquote':
								return inline ? 'bq. ' + inline : '';
							case 'ul': {
								const items = Array.from(node.children)
									.filter((child) => child.tagName.toLowerCase() === 'li')
									.map((item) =>
										Array.from(item.childNodes)
											.map(serializeInlineNodeToWiki)
											.join('')
											.trim()
									)
									.filter((item) => item.length > 0);
								return items.map((item) => '* ' + item).join('\\n');
							}
							case 'ol': {
								const items = Array.from(node.children)
									.filter((child) => child.tagName.toLowerCase() === 'li')
									.map((item) =>
										Array.from(item.childNodes)
											.map(serializeInlineNodeToWiki)
											.join('')
											.trim()
									)
									.filter((item) => item.length > 0);
								return items.map((item) => '# ' + item).join('\\n');
							}
							case 'pre': {
								const codeContent = (node.textContent || '').replace(/\\r/g, '').trimEnd();
								return codeContent ? '{code}\\n' + codeContent + '\\n{code}' : '';
							}
							case 'p':
							case 'div':
							case 'section':
								return inline;
							default:
								return inline;
						}
					};
					const serializeDescriptionHtmlToWiki = (html) => {
						const container = document.createElement('div');
						container.innerHTML = html || '';
						const blocks = Array.from(container.childNodes)
							.map(serializeBlockNodeToWiki)
							.map((block) => block.trim())
							.filter((block) => block.length > 0);
						if (blocks.length === 0) {
							return '';
						}
						return normalizeDescriptionText(blocks.join('\\n\\n'));
					};
					const applyDescriptionFormatting = (input, action) => {
						if (!input || input.getAttribute('contenteditable') !== 'true') {
							return;
						}
						input.focus();
						switch (action) {
							case 'bold':
								document.execCommand('bold');
								break;
							case 'italic':
								document.execCommand('italic');
								break;
							case 'underline':
								document.execCommand('underline');
								break;
							case 'strike':
								document.execCommand('strikeThrough');
								break;
							case 'h2':
								document.execCommand('formatBlock', false, 'h2');
								break;
							case 'bullet':
								document.execCommand('insertUnorderedList');
								break;
							case 'number':
								document.execCommand('insertOrderedList');
								break;
							case 'quote':
								document.execCommand('formatBlock', false, 'blockquote');
								break;
							case 'link': {
								const url = window.prompt('Enter URL');
								if (url && url.trim()) {
									document.execCommand('createLink', false, url.trim());
								}
								break;
							}
							case 'code': {
								const selection = window.getSelection();
								if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
									document.execCommand('insertHTML', false, '<code>code</code>');
								} else {
									const range = selection.getRangeAt(0);
									const code = document.createElement('code');
									code.textContent = selection.toString();
									range.deleteContents();
									range.insertNode(code);
									selection.removeAllRanges();
									const nextRange = document.createRange();
									nextRange.selectNodeContents(code);
									selection.addRange(nextRange);
								}
								break;
							}
							case 'codeblock': {
								const selection = window.getSelection();
								const pre = document.createElement('pre');
								if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
									pre.textContent = 'code';
									document.execCommand('insertHTML', false, pre.outerHTML);
								} else {
									pre.textContent = selection.toString();
									const range = selection.getRangeAt(0);
									range.deleteContents();
									range.insertNode(pre);
								}
								break;
							}
							default:
								break;
						}
					};
					const descriptionDisplay = descriptionBlock.querySelector('.jira-description-display');
					const descriptionPreview = descriptionBlock.querySelector('.jira-description-preview');
					const descriptionEditor = descriptionBlock.querySelector('.jira-description-editor');
					const descriptionInput = descriptionBlock.querySelector('.jira-description-editor-input');
					const descriptionCancel = descriptionBlock.querySelector('.jira-description-cancel');
					const descriptionToolbarButtons = Array.from(
						descriptionBlock.querySelectorAll('.jira-description-editor-action')
					);
					const issueKey = descriptionBlock.getAttribute('data-issue-key');
					const originalDescriptionHtml = descriptionInput ? descriptionInput.innerHTML : '';
						const openDescriptionEditor = () => {
							if (
								!descriptionEditor ||
								!descriptionInput ||
								descriptionBlock.classList.contains('description-edit-pending')
							) {
								logDebug('description.open.blocked', {
									issueKey,
									hasEditor: !!descriptionEditor,
									hasInput: !!descriptionInput,
									pending: descriptionBlock.classList.contains('description-edit-pending'),
								});
								return;
							}
							descriptionBlock.classList.add('editor-open');
							logDebug('description.open', { issueKey, initialHtmlLength: descriptionInput.innerHTML.length });
							descriptionInput.focus();
						};
						const closeDescriptionEditor = () => {
							if (!descriptionInput) {
								logDebug('description.close.blocked', { issueKey, hasInput: !!descriptionInput });
								return;
							}
							descriptionInput.innerHTML = originalDescriptionHtml;
							descriptionBlock.classList.remove('editor-open');
							logDebug('description.close', { issueKey });
						};
						if (descriptionDisplay) {
							descriptionDisplay.addEventListener('click', () => {
								logDebug('description.clickDisplay', { issueKey });
								openDescriptionEditor();
							});
						}
						if (descriptionPreview) {
							descriptionPreview.addEventListener('click', () => {
								logDebug('description.clickPreview', { issueKey });
								openDescriptionEditor();
							});
						}
					descriptionToolbarButtons.forEach((button) => {
						button.addEventListener('click', () => {
							if (!descriptionInput) {
								return;
							}
							const action = button.getAttribute('data-action') || '';
							applyDescriptionFormatting(descriptionInput, action);
						});
					});
						if (descriptionEditor && descriptionInput && issueKey) {
							descriptionEditor.addEventListener('submit', (event) => {
								event.preventDefault();
								const currentDescription = normalizeDescriptionText(
									descriptionBlock.getAttribute('data-description-plain') || ''
								);
								const nextDescription = serializeDescriptionHtmlToWiki(descriptionInput.innerHTML || '');
								if (normalizeDescriptionText(nextDescription) === currentDescription) {
									logDebug('description.submit.unchanged', { issueKey });
									closeDescriptionEditor();
									return;
								}
								descriptionBlock.classList.add('description-edit-pending');
							const buttons = descriptionEditor.querySelectorAll('button');
								buttons.forEach((button) => {
									button.disabled = true;
								});
								descriptionInput.setAttribute('contenteditable', 'false');
								logDebug('description.submit', {
									issueKey,
									currentLength: currentDescription.length,
									nextLength: nextDescription.length,
								});
								vscode.postMessage({
									type: 'updateDescription',
									issueKey,
									description: nextDescription,
								});
							});
						}
						if (descriptionCancel) {
							descriptionCancel.addEventListener('click', () => {
								logDebug('description.cancel', { issueKey });
								closeDescriptionEditor();
							});
						}
						if (descriptionInput) {
							descriptionInput.addEventListener('keydown', (event) => {
								if (event.key === 'Escape') {
									event.preventDefault();
									logDebug('description.escape', { issueKey });
									closeDescriptionEditor();
								}
							});
						}
				}
				document.querySelectorAll('.issue-link').forEach((el) => {
					el.addEventListener('click', () => {
					const key = el.getAttribute('data-issue-key');
					if (key) {
						vscode.postMessage({ type: 'openIssue', key });
					}
				});
				});
				document.querySelectorAll('.issue-commit').forEach((button) => {
					button.addEventListener('click', () => {
						if (button.disabled) {
							return;
						}
						const issueKey = button.getAttribute('data-issue-key');
						if (issueKey) {
							button.disabled = true;
							vscode.postMessage({ type: 'commitFromIssue', issueKey });
							setTimeout(() => {
								button.disabled = false;
							}, 500);
						}
					});
				});
				document.querySelectorAll('.issue-search-commit-history').forEach((button) => {
					button.addEventListener('click', () => {
						if (button.disabled) {
							return;
						}
						const issueKey = button.getAttribute('data-issue-key');
						if (issueKey) {
							button.disabled = true;
							vscode.postMessage({ type: 'searchCommitHistory', issueKey });
							setTimeout(() => {
								button.disabled = false;
							}, 500);
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
				document.querySelectorAll('.jira-assignee-assign-me').forEach((button) => {
					button.addEventListener('click', () => {
						if (button.disabled) {
							return;
						}
						const issueKey = button.getAttribute('data-issue-key');
						const accountId = (button.getAttribute('data-account-id') || '').trim();
						if (!issueKey || !accountId) {
							return;
						}
						button.disabled = true;
						vscode.postMessage({ type: 'changeAssignee', issueKey, accountId });
					});
				});
			const commentForm = document.querySelector('.comment-form');
			if (commentForm) {
				const textarea = commentForm.querySelector('.comment-input');
				const submitButton = commentForm.querySelector('.comment-submit');
				const errorEl = commentForm.querySelector('.comment-error');
				const cancelReplyButton = commentForm.querySelector('.comment-reply-cancel');
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
				commentForm.addEventListener('submit', (event) => {
					event.preventDefault();
					if (!textarea || !submitButton || submitButton.disabled) {
						return;
					}
					vscode.postMessage({ type: 'addComment', body: textarea.value, format: 'wiki' });
				});
				if (cancelReplyButton) {
					cancelReplyButton.addEventListener('click', () => {
						if (cancelReplyButton.disabled) {
							return;
						}
						vscode.postMessage({ type: 'cancelCommentReply' });
					});
				}
				updateSubmitState();
			}
			document.querySelectorAll('.comment-reply').forEach((button) => {
				button.addEventListener('click', () => {
					if (button.disabled) {
						return;
					}
					const commentId = button.getAttribute('data-comment-id');
					if (!commentId) {
						return;
					}
					vscode.postMessage({ type: 'startCommentReply', commentId });
				});
			});
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

	static renderCreateIssuePanelHtml(
	webview: vscode.Webview,
	project: SelectedProjectInfo,
	state: CreateIssuePanelState
): string {
	const nonce = generateNonce();
	const cspSource = webview.cspSource;
	const values = state.values;
	const disabledAttr = state.submitting ? 'disabled' : '';
	const errorBanner = state.error
		? `<div class="section error-banner">${HtmlHelper.escapeHtml(state.error)}</div>`
		: '';
	const successBanner = state.successIssue
		? `<div class="section success-banner">
			Created ticket <strong>${HtmlHelper.escapeHtml(state.successIssue.key)}</strong>.
			${state.successIssue.url ? `<a href="${HtmlHelper.escapeHtml(state.successIssue.url)}" target="_blank" rel="noreferrer noopener">Open in Jira</a>` : ''}
		</div>`
		: '';
	const projectLabel = project.name ? `${project.name} (${project.key})` : project.key;
	const parentSidebarSection = renderCreateParentSidebarSection(state, !!state.submitting);
	const assigneeSection = renderCreateAssigneeSection(state);
	const additionalFieldsSection = renderCreateAdditionalFieldsSection(state, !!state.submitting);
	const buttonLabel = state.submitting ? 'Creating…' : 'Create Ticket';
	const statusNames = deriveStatusOptionNames(state.statusOptions);
	const defaultStatus = pickPreferredInitialStatus(statusNames) ?? statusNames[0] ?? ISSUE_STATUS_OPTIONS[0];
	const defaultStatusAttr = HtmlHelper.escapeAttribute(defaultStatus);
	const statusPending = state.statusPending ?? false;
	const statusError = state.statusError;
	const richTextEditorStyles = renderRichTextEditorStyles();
	const richTextEditorBootstrapScript = renderRichTextEditorBootstrapScript();
	const statusPickerStyles = renderStatusPickerStylesV2();
	const statusPickerBootstrapScript = renderStatusPickerBootstrapScriptV2(
		JiraWebviewPanel.buildStatusIconFallbacks(webview)
	);

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
\t\t.create-additional-fields {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 10px;
\t\t}
\t\t.create-custom-field-label {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 6px;
\t\t\tfont-weight: 600;
\t\t}
\t\t.create-custom-field-input {
\t\t\twidth: 100%;
\t\t}
\t\ttextarea.create-custom-field-input {
\t\t\tmin-height: 140px;
\t\t\tresize: vertical;
\t\t}
\t\t.parent-field {
\t\t\tgap: 8px;
\t\t}
\t\t.parent-picker-summary {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tjustify-content: center;
\t\t\tgap: 4px;
\t\t\tmin-height: 72px;
\t\t\tpadding: 10px 12px;
\t\t\tborder: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
\t\t\tborder-radius: 6px;
\t\t\tbackground: var(--vscode-editorWidget-background, rgba(255,255,255,0.03));
\t\t}
\t\t.parent-picker-summary-key {
\t\t\tfont-weight: 600;
\t\t\tmin-height: 1.4em;
\t\t}
\t\t.parent-picker-summary-meta {
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t\tfont-size: 0.9em;
\t\t\tmin-height: 1.2em;
\t\t}
\t\t.parent-picker-trigger {
\t\t\talign-self: flex-start;
\t\t\tmin-height: 32px;
\t\t\tpadding: 6px 12px;
\t\t\tborder-radius: 4px;
\t\t\tborder: 1px solid var(--vscode-button-secondaryBorder, transparent);
\t\t\tbackground: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
\t\t\tcolor: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
\t\t\tcursor: pointer;
\t\t}
\t\t.parent-picker-card .parent-picker-card-title {
\t\t\tfont-weight: 600;
\t\t\tmin-height: 1.4em;
\t\t}
\t\t.parent-picker-card .parent-picker-card-detail {
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t\tfont-size: 0.9em;
\t\t\tmin-height: 1.2em;
\t\t}
\t\t.parent-picker-card .parent-picker-card-detail + .parent-picker-card-detail {
\t\t\tdisplay: none;
\t\t}
\t\t.field-required {
\t\t\tcolor: var(--vscode-errorForeground);
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
\t\t\tgrid-column: 1 / 2;
\t\t}
\t\t.form-actions button {
\t\t\twidth: 100%;
\t\t\tmax-width: 220px;
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
\t\t.assignee-actions {
\t\t\tdisplay: flex;
\t\t\tjustify-content: flex-start;
\t\t\twidth: 100%;
\t\t}
\t\t.jira-create-assign-me,
\t\t.jira-assignee-assign-me {
\t\t\tpadding: 8px 14px;
\t\t\tborder-radius: 999px;
\t\t\tborder: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
\t\t\tbackground: transparent;
\t\t\tcolor: var(--vscode-foreground);
\t\t\tcursor: pointer;
\t\t\tmin-width: 0;
\t\t\twidth: 100%;
\t\t\ttransition: background-color 120ms ease, border-color 120ms ease;
\t\t}
\t\t.jira-create-assign-me:hover:not(:disabled),
\t\t.jira-assignee-assign-me:hover:not(:disabled) {
\t\t\tbackground: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
\t\t\tborder-color: color-mix(in srgb, var(--vscode-textLink-foreground) 32%, transparent);
\t\t}
\t\t.jira-create-assign-me:disabled,
\t\t.jira-assignee-assign-me:disabled {
\t\t\topacity: 0.6;
\t\t\tcursor: not-allowed;
\t\t}
\t\t.assignee-selected {
\t\t\tdisplay: flex;
\t\t\talign-items: center;
\t\t\tgap: 10px;
\t\t}
\t\t.assignee-selected-name {
\t\t\tfont-weight: 600;
\t\t}
\t\t.assignee-avatar {
\t\t\twidth: 44px;
\t\t\theight: 44px;
\t\t\tborder-radius: 50%;
\t\t\tobject-fit: cover;
\t\t\tflex-shrink: 0;
\t\t\tborder: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
\t\t\tbackground-color: var(--vscode-sideBar-background);
\t\t}
\t\t.assignee-avatar.fallback {
\t\t\tdisplay: flex;
\t\t\talign-items: center;
\t\t\tjustify-content: center;
\t\t\tfont-weight: 600;
\t\t}
\t\t.assignee-control-details {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 8px;
\t\t}
\t\t.assignee-search-row input {
\t\t\twidth: 100%;
\t\t\tbackground: var(--vscode-input-background);
\t\t\tcolor: var(--vscode-input-foreground);
\t\t\tborder: 1px solid var(--vscode-input-border);
\t\t\tborder-radius: 4px;
\t\t\tpadding: 4px 8px;
\t\t\tmin-height: 28px;
\t\t\tbox-sizing: border-box;
\t\t\tfont-family: var(--vscode-font-family);
\t\t\tfont-size: var(--vscode-font-size);
\t\t}
\t\t.assignee-search-row input::placeholder {
\t\t\tcolor: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
\t\t}
\t\t.assignee-search-row input:focus {
\t\t\toutline: none;
\t\t\tborder-color: var(--vscode-focusBorder, var(--vscode-input-border));
\t\t\tbox-shadow: 0 0 0 1px var(--vscode-focusBorder, transparent);
\t\t}
\t\t.assignee-search-row input:disabled {
\t\t\topacity: 0.7;
\t\t\tcursor: not-allowed;
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
\t\t${statusPickerStyles}
\t\t${richTextEditorStyles}
\t\t${ParentIssuePickerOverlay.renderStyles()}
\t\t${AssigneePickerOverlay.renderStyles()}
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
\t\t\t\t\t\t<p class="issue-summary">Project ${HtmlHelper.escapeHtml(projectLabel)}</p>
\t\t\t\t\t</div>
\t\t\t\t</div>
\t\t\t\t${errorBanner}
\t\t\t\t${successBanner}
\t\t\t\t<div class="form-field">
\t\t\t\t\t<label>
\t\t\t\t\t\t<span class="section-title">Summary</span>
\t\t\t\t\t\t<input type="text" name="summary" value="${HtmlHelper.escapeAttribute(
							values.summary
						)}" placeholder="Ticket summary" ${disabledAttr} required />
\t\t\t\t\t</label>
\t\t\t\t</div>
\t\t\t\t<div class="form-field">
\t\t\t\t\t<label>
\t\t\t\t\t\t<span class="section-title">Description</span>
\t\t\t\t\t\t${renderRichTextEditor({
							editorId: 'create-description-input',
							name: 'description',
							value: values.description,
							placeholder: 'What needs to be done?',
							disabled: !!state.submitting,
							minRows: 8,
							inputClassName: 'create-description-input',
							ariaLabel: 'Description',
						})}
\t\t\t\t\t</label>
\t\t\t\t</div>
\t\t\t\t${additionalFieldsSection}
\t\t\t</div>
\t\t\t<div class="issue-sidebar">
\t\t\t\t<div class="meta-card">
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Project</div>
\t\t\t\t\t\t<div class="project-pill">${HtmlHelper.escapeHtml(projectLabel)}</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Issue Type</div>
\t\t\t\t\t\t<select name="issueType" ${disabledAttr}>
\t\t\t\t\t\t\t${renderIssueTypeOptions(values.issueType)}
\t\t\t\t\t\t</select>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Starting Status</div>
\t\t\t\t\t\t${renderCreateStatusPickerControl(webview, values.status, state.statusOptions, !!state.submitting)}
\t\t\t\t\t\t${statusPending ? '<div class="muted status-helper">Loading project statuses…</div>' : ''}
\t\t\t\t\t\t${statusError ? `<div class="status-error">${HtmlHelper.escapeHtml(statusError)}</div>` : ''}
\t\t\t\t\t</div>
					${parentSidebarSection}
\t\t\t\t\t<div class="meta-section">
\t\t\t\t\t\t<div class="section-title">Assignee</div>
\t\t\t\t\t\t${assigneeSection}
\t\t\t\t\t</div>
\t\t\t\t\t<input type="hidden" name="assigneeAccountId" value="${HtmlHelper.escapeAttribute(
						values.assigneeAccountId ?? ''
					)}" />
\t\t\t\t\t<input type="hidden" name="assigneeDisplayName" value="${HtmlHelper.escapeAttribute(
						values.assigneeDisplayName ?? ''
					)}" />
					<input type="hidden" name="assigneeAvatarUrl" value="${HtmlHelper.escapeAttribute(
						values.assigneeAvatarUrl ?? ''
					)}" />
\t\t\t\t</div>
\t\t\t</div>
\t\t\t<div class="form-actions">
\t\t\t\t<button type="submit" class="primary" ${disabledAttr}>${buttonLabel}</button>
\t\t\t</div>
\t\t</form>
\t</div>
\t${ParentIssuePickerOverlay.renderHostMarkup()}
\t${AssigneePickerOverlay.renderHostMarkup()}
\t<script nonce="${nonce}">
\t\t(function () {
\t\t\tconst vscode = acquireVsCodeApi();
\t\t\t${ParentIssuePickerOverlay.renderBootstrapScript()}
\t\t\t${AssigneePickerOverlay.renderBootstrapScript()}
			${richTextEditorBootstrapScript}
			${statusPickerBootstrapScript}
			initializeJiraRichTextEditors(document);
			initializeJiraStatusPickers(document, vscode);
\t\t\tconst form = document.getElementById('create-issue-form');
\t\t\tconst issueTypeSelect = form ? form.querySelector('select[name="issueType"]') : null;
\t\t\tconst assignMeButton = document.querySelector('.jira-create-assign-me');
\t\t\tconst accountInput = form ? form.querySelector('input[name="assigneeAccountId"]') : null;
\t\t\tconst displayInput = form ? form.querySelector('input[name="assigneeDisplayName"]') : null;
\t\t\tconst avatarInput = form ? form.querySelector('input[name="assigneeAvatarUrl"]') : null;
\t\t\tconst asString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

\t\t\tconst buildFormPayload = () => {
\t\t\t\tif (!form) {
\t\t\t\t\treturn {
\t\t\t\t\t\tsummary: '',
\t\t\t\t\t\tdescription: '',
\t\t\t\t\t\tissueType: 'Task',
\t\t\t\t\t\tstatus: '${defaultStatusAttr}',
\t\t\t\t\t\tcustomFields: {},
\t\t\t\t\t\tassigneeAccountId: '',
\t\t\t\t\t\tassigneeDisplayName: '',
\t\t\t\t\t\tassigneeAvatarUrl: '',
\t\t\t\t\t};
\t\t\t\t}
\t\t\t\tconst customFields = {};
\t\t\t\tform.querySelectorAll('[data-create-custom-field]').forEach((field) => {
\t\t\t\t\tconst fieldId = field.getAttribute('data-create-custom-field');
\t\t\t\t\tif (!fieldId) {
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tconst value = typeof field.value === 'string' ? field.value : '';
\t\t\t\t\tcustomFields[fieldId] = value;
\t\t\t\t});
\t\t\t\tconst formData = new FormData(form);
\t\t\t\treturn {
\t\t\t\t\tsummary: asString(formData.get('summary')),
\t\t\t\t\tdescription: asString(formData.get('description')),
\t\t\t\t\tissueType: asString(formData.get('issueType'), 'Task'),
\t\t\t\t\tstatus: asString(formData.get('status'), '${defaultStatusAttr}'),
\t\t\t\t\tcustomFields,
\t\t\t\t\tassigneeAccountId: asString(formData.get('assigneeAccountId')),
\t\t\t\t\tassigneeDisplayName: asString(formData.get('assigneeDisplayName')),
\t\t\t\t\tassigneeAvatarUrl: asString(formData.get('assigneeAvatarUrl')),
\t\t\t\t};
\t\t\t};

\t\t\tif (form) {
\t\t\t\tform.addEventListener('submit', (event) => {
\t\t\t\t\tevent.preventDefault();
\t\t\t\t\tconst payload = buildFormPayload();
\t\t\t\t\tvscode.postMessage({ type: 'createIssue', values: payload });
\t\t\t\t});
\t\t\t}

\t\t\tif (issueTypeSelect) {
\t\t\t\tissueTypeSelect.addEventListener('change', () => {
\t\t\t\t\tconst payload = buildFormPayload();
\t\t\t\t\tvscode.postMessage({ type: 'createIssueTypeChanged', values: payload });
\t\t\t\t});
\t\t\t}

\t\t\tconst applyLocalSelection = (accountId, displayName, avatarUrl) => {
\t\t\t\tif (accountInput) {
\t\t\t\t\taccountInput.value = accountId || '';
\t\t\t\t}
\t\t\t\tif (displayInput) {
\t\t\t\t\tdisplayInput.value = accountId ? displayName : '';
\t\t\t\t}
\t\t\t\tif (avatarInput) {
\t\t\t\t\tavatarInput.value = accountId ? avatarUrl : '';
\t\t\t\t}
\t\t\t};

\t\t\tif (assignMeButton) {
\t\t\t\tassignMeButton.addEventListener('click', () => {
\t\t\t\t\tconst accountId = (assignMeButton.getAttribute('data-account-id') || '').trim();
\t\t\t\t\tif (!accountId) {
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tconst displayName =
\t\t\t\t\t\t(assignMeButton.getAttribute('data-display-name') || '').trim() || 'Me';
\t\t\t\t\tconst avatarUrl = (assignMeButton.getAttribute('data-avatar-url') || '').trim();
\t\t\t\t\tapplyLocalSelection(accountId, displayName, avatarUrl);
\t\t\t\t\tconst payload = buildFormPayload();
\t\t\t\t\tvscode.postMessage({
\t\t\t\t\t\ttype: 'selectCreateAssignee',
\t\t\t\t\t\taccountId,
\t\t\t\t\t\tdisplayName,
\t\t\t\t\t\tavatarUrl,
\t\t\t\t\t\tvalues: payload,
\t\t\t\t\t});
\t\t\t\t});
\t\t\t}
\t\t})();
\t</script>
</body>
</html>`;
}

	static renderParentSection(issue: JiraIssue): string {
	const parent = issue.parent;
	const content = parent
		? renderRelatedIssueButton(parent)
		: '<div class="muted">No parent issue.</div>';
	const actionLabel = parent ? 'Change parent' : 'Select parent';
	return `<div class="section parent-section">
		<div class="section-title">Parent</div>
		<div class="parent-section-body">
			${content}
			<button type="button" class="parent-picker-trigger" data-parent-picker-open>${HtmlHelper.escapeHtml(actionLabel)}</button>
		</div>
	</div>`;
}

	static renderChildrenSection(issue: JiraIssue): string {
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

	static renderDescriptionSection(
	issue: JiraIssue,
	options?: IssuePanelOptions,
	isLoading = false
): string {
	const descriptionHtml = issue.descriptionHtml;
	const fallbackHtml = issue.description
		? `<p>${HtmlHelper.escapeHtml(issue.description).replace(/\r?\n/g, '<br />')}</p>`
		: undefined;
	const content = descriptionHtml ?? fallbackHtml;
	const descriptionText = deriveEditableDescriptionText(issue, content);
	const editableDescriptionHtml = deriveEditableDescriptionHtml(content, descriptionText);
	const descriptionEditPending = options?.descriptionEditPending ?? false;
	const descriptionEditError = options?.descriptionEditError;
	const descriptionEditDisabled = descriptionEditPending;
	const descriptionEditDisabledAttr = descriptionEditDisabled ? 'disabled' : '';
	const blockClasses = ['issue-description-block'];
	if (descriptionEditPending) {
		blockClasses.push('description-edit-pending');
	}
	if (descriptionEditDisabled) {
		blockClasses.push('description-edit-disabled');
	}
	const body = content
		? `<div class="description-body rich-text-block jira-description-display">${content}</div>`
		: '<div class="description-body rich-text-block jira-description-display muted">No description provided. Click to add one.</div>';
	const errorMarkup = descriptionEditError
		? `<div class="status-error issue-description-error">${HtmlHelper.escapeHtml(descriptionEditError)}</div>`
		: '';
	return `<div class="section description-card">
		<div class="section-title">Description</div>
		<div class="${blockClasses.join(' ')}" data-issue-key="${HtmlHelper.escapeAttribute(
			issue.key
		)}" data-description-edit-disabled="${descriptionEditDisabled ? 'true' : 'false'}" data-description-plain="${HtmlHelper.escapeAttribute(
			descriptionText
		)}">
			${body}
			<form class="jira-description-editor">
				<div class="jira-description-visual-editor">
					<div class="jira-description-toolbar" role="toolbar" aria-label="Description formatting">
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="bold" ${descriptionEditDisabledAttr}><span class="fmt-bold">B</span></button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="italic" ${descriptionEditDisabledAttr}><span class="fmt-italic">I</span></button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="underline" ${descriptionEditDisabledAttr}><span class="fmt-underline">U</span></button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="strike" ${descriptionEditDisabledAttr}><span class="fmt-strike">S</span></button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="code" ${descriptionEditDisabledAttr}>{ }</button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="h2" ${descriptionEditDisabledAttr}>H2</button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="bullet" ${descriptionEditDisabledAttr}>• List</button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="number" ${descriptionEditDisabledAttr}>1. List</button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="quote" ${descriptionEditDisabledAttr}>Quote</button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="codeblock" ${descriptionEditDisabledAttr}>Code</button>
						<button type="button" class="jira-rich-editor-action jira-description-editor-action" data-action="link" ${descriptionEditDisabledAttr}>Link</button>
					</div>
					<div
						class="jira-description-editor-input"
						contenteditable="${descriptionEditDisabled ? 'false' : 'true'}"
						data-placeholder="Add description..."
					>${editableDescriptionHtml}</div>
				</div>
				<div class="jira-description-actions">
					<button type="submit" class="jira-description-save" ${descriptionEditDisabledAttr}>Save</button>
					<button type="button" class="jira-description-cancel" ${descriptionEditDisabledAttr}>Cancel</button>
				</div>
			</form>
			${errorMarkup}
		</div>
	</div>`;
}

	static deriveEditableDescriptionText(issue: JiraIssue, renderedContent?: string): string {
	const rawDescription = issue.description;
	if (typeof rawDescription === 'string' && rawDescription.length > 0) {
		return rawDescription;
	}
	if (!renderedContent) {
		return '';
	}
	return htmlToPlainText(renderedContent);
}

	static deriveEditableDescriptionHtml(renderedContent: string | undefined, fallbackText: string): string {
	if (renderedContent && renderedContent.trim().length > 0) {
		return renderedContent;
	}
	if (!fallbackText) {
		return '';
	}
	return `<p>${HtmlHelper.escapeHtml(fallbackText).replace(/\r?\n/g, '<br />')}</p>`;
}

	static htmlToPlainText(html: string): string {
	const withStructure = html
		.replace(/<\s*br\s*\/?>/gi, '\n')
		.replace(/<\/\s*(p|div|h1|h2|h3|h4|h5|h6)\s*>/gi, '\n')
		.replace(/<\s*li[^>]*>/gi, '- ')
		.replace(/<\/\s*li\s*>/gi, '\n');
	const withoutTags = withStructure.replace(/<[^>]+>/g, '');
	const decoded = decodeHtmlEntities(withoutTags);
	return decoded
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

	static decodeHtmlEntities(text: string): string {
	return text
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_match, value: string) => {
			const code = Number.parseInt(value, 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
		});
}

	static renderRichTextEditor(options: RichTextEditorRenderOptions): string {
	const disabledAttr = options.disabled ? 'disabled' : '';
	const wrapperClasses = ['jira-rich-editor'];
	if (options.editorClassName) {
		wrapperClasses.push(options.editorClassName);
	}
	const inputClasses = ['jira-rich-editor-input'];
	if (options.inputClassName) {
		inputClasses.push(options.inputClassName);
	}
	const nameAttr = options.name ? `name="${HtmlHelper.escapeAttribute(options.name)}"` : '';
	const rows = Math.max(3, options.minRows ?? 6);
	const label = options.ariaLabel ?? 'Rich text input';
	return `<div class="${wrapperClasses.join(' ')}" data-disabled="${options.disabled ? 'true' : 'false'}">
		<div class="jira-rich-editor-toolbar" role="toolbar" aria-label="${HtmlHelper.escapeAttribute(label)} formatting">
			<button type="button" class="jira-rich-editor-action" data-action="bold" title="Bold (*text*)" ${disabledAttr}><span class="fmt-bold">B</span></button>
			<button type="button" class="jira-rich-editor-action" data-action="italic" title="Italic (_text_)" ${disabledAttr}><span class="fmt-italic">I</span></button>
			<button type="button" class="jira-rich-editor-action" data-action="underline" title="Underline (+text+)" ${disabledAttr}><span class="fmt-underline">U</span></button>
			<button type="button" class="jira-rich-editor-action" data-action="strike" title="Strike (-text-)" ${disabledAttr}><span class="fmt-strike">S</span></button>
			<button type="button" class="jira-rich-editor-action" data-action="code" title="Inline code ({{code}})" ${disabledAttr}>{ }</button>
			<button type="button" class="jira-rich-editor-action" data-action="h2" title="Heading (h2.)" ${disabledAttr}>H2</button>
			<button type="button" class="jira-rich-editor-action" data-action="bullet" title="Bulleted list (* )" ${disabledAttr}>• List</button>
			<button type="button" class="jira-rich-editor-action" data-action="number" title="Numbered list (# )" ${disabledAttr}>1. List</button>
			<button type="button" class="jira-rich-editor-action" data-action="quote" title="Quote (bq.)" ${disabledAttr}>Quote</button>
			<button type="button" class="jira-rich-editor-action" data-action="codeblock" title="Code block ({code})" ${disabledAttr}>Code</button>
			<button type="button" class="jira-rich-editor-action" data-action="link" title="Link ([text|url])" ${disabledAttr}>Link</button>
		</div>
		<textarea id="${HtmlHelper.escapeAttribute(options.editorId)}" class="${inputClasses.join(' ')}" ${nameAttr} rows="${rows}" placeholder="${HtmlHelper.escapeAttribute(
			options.placeholder
		)}" ${disabledAttr}>${HtmlHelper.escapeHtml(options.value)}</textarea>
	</div>`;
}

	static renderRichTextEditorStyles(): string {
	return `
	.jira-rich-editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.jira-rich-editor-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.jira-rich-editor-action {
		border-radius: 4px;
		border: 1px solid var(--vscode-button-secondaryBorder, transparent);
		background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
		color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
		padding: 4px 8px;
		cursor: pointer;
		font-size: 0.85em;
		line-height: 1.2;
	}
	.jira-rich-editor-action:hover:not(:disabled) {
		background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.12));
	}
	.jira-rich-editor-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.jira-rich-editor-action .fmt-bold {
		font-weight: 700;
	}
	.jira-rich-editor-action .fmt-italic {
		font-style: italic;
	}
	.jira-rich-editor-action .fmt-underline {
		text-decoration: underline;
		text-decoration-thickness: 2px;
	}
	.jira-rich-editor-action .fmt-strike {
		text-decoration: line-through;
		text-decoration-thickness: 2px;
	}
	.jira-rich-editor-input {
		width: 100%;
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border);
		border-radius: 4px;
		padding: 8px;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		font-weight: normal;
		font-style: normal;
		line-height: 1.45;
		caret-color: var(--vscode-input-foreground);
	}
	.jira-rich-editor-input::placeholder {
		color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		font-weight: normal;
		font-style: normal;
		opacity: 1;
	}
	.jira-rich-editor-input:focus {
		outline: none;
		border-color: var(--vscode-focusBorder, var(--vscode-input-border));
		box-shadow: 0 0 0 1px var(--vscode-focusBorder, transparent);
	}
	.jira-rich-editor-input:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
	`;
}

	static renderRichTextEditorBootstrapScript(): string {
	return `
				const wrapEditorSelection = (input, prefix, suffix, placeholder) => {
					if (!input || input.disabled) {
						return;
					}
					const start = input.selectionStart ?? 0;
					const end = input.selectionEnd ?? start;
					const value = input.value || '';
					const selected = value.slice(start, end);
					const baseText = selected || placeholder;
					const next = value.slice(0, start) + prefix + baseText + suffix + value.slice(end);
					input.value = next;
					const cursorStart = start + prefix.length;
					const cursorEnd = cursorStart + baseText.length;
					input.setSelectionRange(cursorStart, cursorEnd);
					input.dispatchEvent(new Event('input', { bubbles: true }));
				};

				const prefixEditorLines = (input, prefix, placeholder) => {
					if (!input || input.disabled) {
						return;
					}
					const start = input.selectionStart ?? 0;
					const end = input.selectionEnd ?? start;
					const value = input.value || '';
					if (start === end) {
						const next = value.slice(0, start) + prefix + placeholder + value.slice(end);
						input.value = next;
						const cursorStart = start + prefix.length;
						const cursorEnd = cursorStart + placeholder.length;
						input.setSelectionRange(cursorStart, cursorEnd);
						input.dispatchEvent(new Event('input', { bubbles: true }));
						return;
					}
					const lineStart = value.lastIndexOf('\\n', start - 1) + 1;
					const lineEndIndex = value.indexOf('\\n', end);
					const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
					const selectedLines = value.slice(lineStart, lineEnd);
					const prefixedLines = selectedLines
						.split('\\n')
						.map((line) => (line.trim().length > 0 ? prefix + line : prefix.trim()))
						.join('\\n');
					input.value = value.slice(0, lineStart) + prefixedLines + value.slice(lineEnd);
					input.setSelectionRange(lineStart, lineStart + prefixedLines.length);
					input.dispatchEvent(new Event('input', { bubbles: true }));
				};

				const wrapEditorBlock = (input, prefix, suffix, placeholder) => {
					if (!input || input.disabled) {
						return;
					}
					const start = input.selectionStart ?? 0;
					const end = input.selectionEnd ?? start;
					const value = input.value || '';
					const selected = value.slice(start, end) || placeholder;
					const next = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
					input.value = next;
					const cursorStart = start + prefix.length;
					const cursorEnd = cursorStart + selected.length;
					input.setSelectionRange(cursorStart, cursorEnd);
					input.dispatchEvent(new Event('input', { bubbles: true }));
				};

				const editorActionHandlers = {
					bold: (input) => wrapEditorSelection(input, '*', '*', 'bold text'),
					italic: (input) => wrapEditorSelection(input, '_', '_', 'italic text'),
					underline: (input) => wrapEditorSelection(input, '+', '+', 'underlined text'),
					strike: (input) => wrapEditorSelection(input, '-', '-', 'struck text'),
					code: (input) => wrapEditorSelection(input, '{{', '}}', 'code'),
					h2: (input) => prefixEditorLines(input, 'h2. ', 'Heading'),
					bullet: (input) => prefixEditorLines(input, '* ', 'List item'),
					number: (input) => prefixEditorLines(input, '# ', 'List item'),
					quote: (input) => prefixEditorLines(input, 'bq. ', 'Quoted text'),
					codeblock: (input) => wrapEditorBlock(input, '{code}\\n', '\\n{code}', 'code block'),
					link: (input) => wrapEditorSelection(input, '[', '|https://example.com]','link text'),
				};

				const initializeJiraRichTextEditors = (root) => {
					const editorNodes = Array.from((root || document).querySelectorAll('.jira-rich-editor'));
					editorNodes.forEach((editor) => {
						const input = editor.querySelector('.jira-rich-editor-input');
						const toolbarButtons = Array.from(editor.querySelectorAll('.jira-rich-editor-action'));
						toolbarButtons.forEach((button) => {
							button.addEventListener('click', () => {
								if (!input || input.disabled) {
									return;
								}
								const action = button.getAttribute('data-action') || '';
								const handler = editorActionHandlers[action];
								if (!handler) {
									return;
								}
								handler(input);
								input.focus();
							});
						});
					});
				};
	`;
}

	static renderCommentsSection(options?: IssuePanelOptions): string {
	const comments = options?.comments ?? [];
	const pending = options?.commentsPending ?? false;
	const error = options?.commentsError;

	let listContent = '';
	if (error) {
		listContent = `<div class="comment-message error">${HtmlHelper.escapeHtml(error)}</div>`;
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
			</div>
			<button type="button" class="comment-refresh" ${refreshDisabledAttr}>${HtmlHelper.escapeHtml(refreshLabel)}</button>
		</div>
		${listContent}
		${renderCommentForm(options)}
	</div>`;
}

	static renderCommentList(comments: JiraIssueComment[], options?: IssuePanelOptions): string {
	return comments.map((comment) => renderCommentItem(comment, options)).join('');
}

	static renderCommentItem(comment: JiraIssueComment, options?: IssuePanelOptions): string {
	const timestamp = comment.updated ?? comment.created;
	const timestampText = timestamp ? IssueModel.formatIssueUpdated(timestamp) : undefined;
	const authorLabel = HtmlHelper.escapeHtml(comment.authorName ?? 'Unknown user');
	const isDeleting = options?.commentDeletingId === comment.id;
	const deleteDisabled = isDeleting || (options?.commentsPending ?? false);
	const deleteLabel = isDeleting ? 'Deleting…' : 'Delete';
	const deleteButton = comment.id
		? `<button type="button" class="comment-delete" data-comment-id="${HtmlHelper.escapeAttribute(comment.id)}" ${deleteDisabled ? 'disabled' : ''}>${HtmlHelper.escapeHtml(deleteLabel)}</button>`
		: '';
	const replyDisabled = (options?.commentsPending ?? false) || (options?.commentSubmitPending ?? false);
	const isReplying = options?.commentReplyContext?.commentId === comment.id;
	const replyButton = comment.id
		? `<button type="button" class="comment-reply" data-comment-id="${HtmlHelper.escapeAttribute(comment.id)}" ${replyDisabled || isReplying ? 'disabled' : ''}>${HtmlHelper.escapeHtml(
				isReplying ? 'Replying...' : 'Reply'
			)}</button>`
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
				${timestampText ? `<span class="comment-date">${HtmlHelper.escapeHtml(timestampText)}</span>` : ''}
				<div class="comment-meta-actions">
					${replyButton}
					${deleteButton}
				</div>
			</div>
			<div class="comment-body rich-text-block" data-comment-id="${HtmlHelper.escapeAttribute(comment.id ?? '')}">${bodyHtml}</div>
		</div>
	</li>`;
}

	static renderCommentForm(options?: IssuePanelOptions): string {
	const pending = options?.commentSubmitPending ?? false;
	const draftValue = options?.commentDraft ?? '';
	const replyContext = options?.commentReplyContext;
	const hasText = draftValue.trim().length > 0;
	const buttonDisabled = pending || !hasText;
	const formTitle = replyContext ? 'Reply to comment' : 'Add a comment';
	const placeholder = replyContext ? 'Write your reply' : 'Share updates or blockers';
	const errorMarkup = options?.commentSubmitError
		? `<div class="comment-error">${HtmlHelper.escapeHtml(options.commentSubmitError)}</div>`
		: '<div class="comment-error hidden"></div>';
	return `<form class="comment-form" data-pending="${pending ? 'true' : 'false'}">
		<label class="section-title" for="comment-input">${HtmlHelper.escapeHtml(formTitle)}</label>
		${renderCommentReplyBanner(options)}
		${renderRichTextEditor({
			editorId: 'comment-input',
			value: draftValue,
			placeholder,
			disabled: pending,
			minRows: 6,
			inputClassName: 'comment-input',
			editorClassName: 'comment-editor',
			ariaLabel: formTitle,
		})}
		<div class="comment-controls">
			<button type="submit" class="comment-submit" ${buttonDisabled ? 'disabled' : ''}>${HtmlHelper.escapeHtml(
				pending ? (replyContext ? 'Replying...' : 'Adding...') : replyContext ? 'Reply' : 'Add comment'
			)}</button>
		</div>
		${errorMarkup}
	</form>`;
}

	static renderCommentReplyBanner(options?: IssuePanelOptions): string {
	const replyContext = options?.commentReplyContext;
	if (!replyContext) {
		return '';
	}
	const timestampMarkup = replyContext.timestampLabel
		? `<div class="comment-date">${HtmlHelper.escapeHtml(replyContext.timestampLabel)}</div>`
		: '';
	const excerptMarkup = replyContext.excerpt
		? `<div class="comment-reply-excerpt">${HtmlHelper.escapeHtml(replyContext.excerpt)}</div>`
		: '';
	return `<div class="comment-reply-banner">
		<div class="comment-reply-copy">
			<div class="comment-reply-title">Replying to ${HtmlHelper.escapeHtml(replyContext.authorName)}</div>
			${timestampMarkup}
			${excerptMarkup}
		</div>
		<button type="button" class="comment-reply-cancel" ${options?.commentSubmitPending ? 'disabled' : ''}>Cancel reply</button>
	</div>`;
}

	static renderCommentAvatar(comment: JiraIssueComment): string {
	if (comment.authorAvatarUrl) {
		return `<img class="comment-avatar" src="${HtmlHelper.escapeAttribute(comment.authorAvatarUrl)}" alt="${HtmlHelper.escapeAttribute(comment.authorName ?? 'Comment author')} avatar" />`;
	}
	return `<div class="comment-avatar fallback">${HtmlHelper.escapeHtml(getInitials(comment.authorName))}</div>`;
}

	static renderRelatedIssueButton(issue: JiraRelatedIssue): string {
	const summaryText = issue.summary ? ` · ${HtmlHelper.escapeHtml(issue.summary)}` : '';
	const statusText = issue.statusName ? ` — ${HtmlHelper.escapeHtml(issue.statusName)}` : '';
	return `<button class="issue-link" data-issue-key="${HtmlHelper.escapeHtml(issue.key)}">
		${HtmlHelper.escapeHtml(issue.key)}${summaryText}${statusText}
	</button>`;
}

	/**
	 * Renders the parent issue row inside the sidebar metadata card.
	 */
	static renderParentMetadataSection(issue: JiraIssue): string {
		const parent = issue.parent;
		const selectedParent = parent
			? {
				key: parent.key,
				summary: parent.summary,
			}
			: undefined;
		const parentPickerCard = SharedParentPicker.renderCard({
			ariaLabel: 'Choose a parent ticket',
			selectedParent,
		});
		const parentIssueLink = parent ? `<div style="margin-top: 8px;">${renderRelatedIssueButton(parent)}</div>` : '';
		return `<div class="meta-section">
			<div class="section-title">Parent Ticket</div>
			${parentPickerCard}
			${parentIssueLink}
		</div>`;
	}

static renderMetadataPanel(
	webview: vscode.Webview,
	issue: JiraIssue,
	parentSection: string,
	assignee: string,
	reporter: string,
	updatedText: string,
	options?: IssuePanelOptions
): string {
	const statusControl = renderStatusControlV2(webview, issue, options);
	const assigneeControl = renderAssigneeControl(issue, assignee, options);
	return `<div class="issue-sidebar" data-issue-details-sidebar>
		<div class="meta-card">
			<div class="meta-section">
				<div class="section-title">Status</div>
				${statusControl}
			</div>
			${parentSection}
			<div class="meta-section">
				<div class="section-title">Assignee</div>
				${assigneeControl}
			</div>
			<div class="meta-section">
				<div class="section-title">Reporter</div>
				<div>${HtmlHelper.escapeHtml(reporter)}</div>
			</div>
			<div class="meta-section">
				<div class="section-title">Last Updated</div>
				<div>${HtmlHelper.escapeHtml(updatedText)}</div>
			</div>
		</div>
		</div>`;
}

	/**
	 * Builds the packaged status icon fallback map used by the custom status picker when Jira icons are unavailable.
	 */
	static buildStatusIconFallbacks(webview: vscode.Webview): Record<IssueStatusCategory, string> {
		return {
			done: ViewResource.getStatusIconWebviewSrc(webview, 'done') ?? '',
			inProgress: ViewResource.getStatusIconWebviewSrc(webview, 'inProgress') ?? '',
			open: ViewResource.getStatusIconWebviewSrc(webview, 'open') ?? '',
			default: ViewResource.getStatusIconWebviewSrc(webview, 'default') ?? '',
		};
	}

	/**
	 * Renders the shared CSS used by the custom Jira status pickers.
	 */
	static renderStatusPickerStyles(): string {
		return `
			.status-select-wrapper {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.jira-status-picker {
				position: relative;
				width: 100%;
			}
			.status-picker-source-hidden {
				display: none !important;
			}
			.jira-status-picker-trigger {
				width: 100%;
				min-height: 36px;
				display: inline-flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 7px 10px;
				text-align: left;
				cursor: pointer;
			}
			.jira-status-picker-trigger:disabled {
				opacity: 0.7;
				cursor: not-allowed;
			}
			.jira-status-picker-trigger-content,
			.jira-status-picker-option-content {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				min-width: 0;
			}
			.jira-status-picker-trigger-label,
			.jira-status-picker-option-label {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.jira-status-picker-chevron {
				flex-shrink: 0;
				color: var(--vscode-descriptionForeground);
			}
			.jira-status-picker-menu {
				position: absolute;
				top: calc(100% + 4px);
				left: 0;
				right: 0;
				z-index: 20;
				display: flex;
				flex-direction: column;
				gap: 4px;
				padding: 6px;
				background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
				border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
				border-radius: 6px;
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
			}
			.jira-status-picker-menu[hidden] {
				display: none;
			}
			.jira-status-picker-option {
				width: 100%;
				min-height: 34px;
				display: flex;
				align-items: center;
				background: transparent;
				color: var(--vscode-input-foreground);
				border: 1px solid transparent;
				border-radius: 4px;
				padding: 6px 8px;
				cursor: pointer;
				text-align: left;
			}
			.jira-status-picker-option:hover:not(:disabled),
			.jira-status-picker-option:focus-visible:not(:disabled) {
				background: color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-inputOption-activeBackground)) 100%, transparent);
				border-color: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-input-border)) 60%, transparent);
				outline: none;
			}
			.jira-status-picker-option:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}
			.jira-status-picker .status-icon,
			.jira-status-picker .status-icon-placeholder {
				width: 16px;
				height: 16px;
				flex-shrink: 0;
			}
			.jira-status-picker .status-icon-placeholder {
				display: inline-block;
				border-radius: 50%;
				background: color-mix(in srgb, var(--vscode-descriptionForeground) 45%, transparent);
			}`;
	}

	/**
	 * Renders the shared bootstrap script that upgrades native status selects into custom icon pickers.
	 */
	static renderStatusPickerBootstrapScript(statusIconFallbacks: Record<IssueStatusCategory, string>): string {
		return `
			const jiraStatusPickerFallbacks = ${JSON.stringify(statusIconFallbacks)};
			const deriveJiraStatusCategory = (statusName) => {
				const status = typeof statusName === 'string' ? statusName.toLowerCase().trim() : '';
				if (!status) {
					return 'default';
				}
				if (
					status.includes('done') ||
					status.includes('closed') ||
					status.includes('resolved') ||
					status.includes('complete')
				) {
					return 'done';
				}
				if (
					status.includes('progress') ||
					status.includes('doing') ||
					status.includes('active') ||
					status.includes('working')
				) {
					return 'inProgress';
				}
				if (
					status.includes('todo') ||
					status.includes('to do') ||
					status.includes('open') ||
					status.includes('backlog')
				) {
					return 'open';
				}
				return 'default';
			};
			const resolveJiraStatusIconSrc = (iconSrc, category, label) => {
				if (typeof iconSrc === 'string' && iconSrc.trim()) {
					return iconSrc.trim();
				}
				const resolvedCategory = category || deriveJiraStatusCategory(label);
				return jiraStatusPickerFallbacks[resolvedCategory] || jiraStatusPickerFallbacks.default || '';
			};
			const createJiraStatusIcon = (iconSrc, label) => {
				if (iconSrc) {
					const image = document.createElement('img');
					image.className = 'status-icon';
					image.src = iconSrc;
					image.alt = (label || 'Status') + ' status icon';
					return image;
				}
				const placeholder = document.createElement('span');
				placeholder.className = 'status-icon status-icon-placeholder';
				placeholder.setAttribute('aria-hidden', 'true');
				return placeholder;
			};
			const applyJiraStatusTriggerState = (trigger, label, iconSrc) => {
				const content = trigger.querySelector('.jira-status-picker-trigger-content');
				if (!content) {
					return;
				}
				content.innerHTML = '';
				content.appendChild(createJiraStatusIcon(iconSrc, label));
				const labelSpan = document.createElement('span');
				labelSpan.className = 'jira-status-picker-trigger-label';
				labelSpan.textContent = label || '';
				content.appendChild(labelSpan);
			};
			const closeJiraStatusPicker = (picker) => {
				const trigger = picker.querySelector('.jira-status-picker-trigger');
				const menu = picker.querySelector('.jira-status-picker-menu');
				if (!trigger || !menu) {
					return;
				}
				menu.hidden = true;
				trigger.setAttribute('aria-expanded', 'false');
			};
			const closeAllJiraStatusPickers = (root) => {
				root.querySelectorAll('.jira-status-picker').forEach((picker) => closeJiraStatusPicker(picker));
			};
			const createJiraStatusPickerOption = (entry, picker, select, hiddenInput) => {
				const optionButton = document.createElement('button');
				optionButton.type = 'button';
				optionButton.className = 'jira-status-picker-option';
				optionButton.setAttribute('data-status-label', entry.label);
				if (entry.transitionId) {
					optionButton.setAttribute('data-transition-id', entry.transitionId);
				}
				if (entry.statusValue) {
					optionButton.setAttribute('data-status-value', entry.statusValue);
				}
				const content = document.createElement('span');
				content.className = 'jira-status-picker-option-content';
				content.appendChild(createJiraStatusIcon(entry.iconSrc, entry.label));
				const labelSpan = document.createElement('span');
				labelSpan.className = 'jira-status-picker-option-label';
				labelSpan.textContent = entry.label;
				content.appendChild(labelSpan);
				optionButton.appendChild(content);
				optionButton.addEventListener('click', () => {
					if (optionButton.disabled || select.disabled) {
						return;
					}
					select.value = entry.value;
					if (hiddenInput) {
						hiddenInput.value = entry.statusValue || entry.label;
					}
					const trigger = picker.querySelector('.jira-status-picker-trigger');
					if (trigger) {
						applyJiraStatusTriggerState(trigger, entry.label, entry.iconSrc);
					}
					closeJiraStatusPicker(picker);
					if (picker.classList.contains('issue-status-picker')) {
						select.disabled = true;
						if (trigger) {
							trigger.disabled = true;
						}
						picker.querySelectorAll('.jira-status-picker-option').forEach((button) => {
							button.disabled = true;
						});
						select.dispatchEvent(new Event('change', { bubbles: true }));
					}
				});
				return optionButton;
			};
			const buildJiraStatusPicker = (root, select) => {
				if (!select || select.getAttribute('data-jira-status-picker-initialized') === 'true') {
					return;
				}
				const wrapper = document.createElement('div');
				wrapper.className = 'status-select-wrapper jira-status-picker';
				const isIssuePicker = select.classList.contains('jira-status-select');
				wrapper.classList.add(isIssuePicker ? 'issue-status-picker' : 'create-status-picker');
				const trigger = document.createElement('button');
				trigger.type = 'button';
				trigger.className = 'jira-status-picker-trigger';
				trigger.disabled = select.disabled;
				trigger.setAttribute('aria-haspopup', 'listbox');
				trigger.setAttribute('aria-expanded', 'false');
				const triggerContent = document.createElement('span');
				triggerContent.className = 'jira-status-picker-trigger-content';
				const triggerChevron = document.createElement('span');
				triggerChevron.className = 'jira-status-picker-chevron';
				triggerChevron.setAttribute('aria-hidden', 'true');
				triggerChevron.textContent = '▾';
				trigger.appendChild(triggerContent);
				trigger.appendChild(triggerChevron);
				const menu = document.createElement('div');
				menu.className = 'jira-status-picker-menu';
				menu.hidden = true;
				let hiddenInput;
				if (!isIssuePicker) {
					hiddenInput = document.createElement('input');
					hiddenInput.type = 'hidden';
					hiddenInput.name = select.name;
					hiddenInput.value = select.value;
					select.removeAttribute('name');
					wrapper.appendChild(hiddenInput);
				}
				const optionEntries = Array.from(select.options)
					.filter((option) => !option.disabled && option.value)
					.map((option) => {
						const label = (option.getAttribute('data-status-label') || option.textContent || '').trim();
						const statusValue = option.getAttribute('data-status-value') || label;
						const category = option.getAttribute('data-status-category') || '';
						const iconSrc = resolveJiraStatusIconSrc(
							option.getAttribute('data-status-icon-src') || '',
							category,
							label
						);
						return {
							value: option.value,
							label,
							statusValue,
							iconSrc,
							transitionId: isIssuePicker ? option.value : '',
						};
					});
				optionEntries.forEach((entry) => {
					menu.appendChild(createJiraStatusPickerOption(entry, wrapper, select, hiddenInput));
				});
				const currentLabel = isIssuePicker
					? (select.getAttribute('data-current-status-label') || '').trim()
					: optionEntries.find((entry) => entry.statusValue === select.value || entry.value === select.value)?.label || '';
				const currentCategory = isIssuePicker ? select.getAttribute('data-current-status-category') || '' : '';
				const currentIconSrc = isIssuePicker
					? resolveJiraStatusIconSrc(
						select.getAttribute('data-current-status-icon-src') || '',
						currentCategory,
						currentLabel
					  )
					: optionEntries.find((entry) => entry.statusValue === select.value || entry.value === select.value)?.iconSrc || '';
				applyJiraStatusTriggerState(trigger, currentLabel, currentIconSrc);
				trigger.addEventListener('click', () => {
					if (trigger.disabled) {
						return;
					}
					const nextExpanded = trigger.getAttribute('aria-expanded') !== 'true';
					closeAllJiraStatusPickers(root);
					menu.hidden = !nextExpanded;
					trigger.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
				});
				wrapper.appendChild(trigger);
				wrapper.appendChild(menu);
				select.classList.add('status-picker-source-hidden');
				select.setAttribute('data-jira-status-picker-initialized', 'true');
				select.parentNode.insertBefore(wrapper, select.nextSibling);
				wrapper.appendChild(select);
			};
			const initializeJiraStatusPickers = (root) => {
				root.querySelectorAll('select[name="status"], .jira-status-select').forEach((select) => {
					buildJiraStatusPicker(root, select);
				});
				root.addEventListener('click', (event) => {
					const target = event.target;
					if (!(target instanceof Element) || target.closest('.jira-status-picker')) {
						return;
					}
					closeAllJiraStatusPickers(root);
				});
				root.addEventListener('keydown', (event) => {
					if (event.key === 'Escape') {
						closeAllJiraStatusPickers(root);
					}
				});
			};`;
	}

	/**
	 * Renders the issue-details status picker using a native select as the underlying state source.
	 */
	static renderStatusControl(issue: JiraIssue, options?: IssuePanelOptions): string {
	const transitions = options?.statusOptions;
	const pending = options?.statusPending;
	const statusError = options?.statusError;

	if (!transitions || transitions.length === 0) {
		const message = statusError
			? statusError
			: options?.loading
			? 'Loading available statuses…'
			: 'No status transitions available.';
		return `<div>${HtmlHelper.escapeHtml(issue.statusName)}</div>
		<div class="muted">${HtmlHelper.escapeHtml(message)}</div>`;
	}

	const selectOptions = transitions
		.map((option) => JiraWebviewPanel.renderStatusSelectOption(option, option.id, false))
		.join('');
	const disabledAttr = pending ? 'disabled' : '';
	const currentStatusCategory = IssueModel.determineStatusCategory(issue.statusName);
	const currentStatusIconSrc = issue.statusIconSrc?.trim() ?? '';

	return `<div class="status-select-wrapper">
		<select
			class="jira-status-select"
			data-issue-key="${HtmlHelper.escapeAttribute(issue.key)}"
			data-current-status-label="${HtmlHelper.escapeAttribute(issue.statusName)}"
			data-current-status-category="${HtmlHelper.escapeAttribute(currentStatusCategory)}"
			data-current-status-icon-src="${HtmlHelper.escapeAttribute(currentStatusIconSrc)}"
			${disabledAttr}
		>
			<option value="" disabled selected>Current: ${HtmlHelper.escapeHtml(issue.statusName)}</option>
			${selectOptions}
		</select>
		${statusError ? `<div class="status-error">${HtmlHelper.escapeHtml(statusError)}</div>` : ''}
	</div>`;
}

	static renderIssueTypeOptions(selected: string): string {
	return ISSUE_TYPE_OPTIONS.map((option) => {
		const isSelected = option === selected;
		return `<option value="${HtmlHelper.escapeAttribute(option)}" ${isSelected ? 'selected' : ''}>${HtmlHelper.escapeHtml(option)}</option>`;
	}).join('');
}

	/**
	 * Renders the create-issue status options with metadata that the custom picker script can upgrade into icon rows.
	 */
	static renderIssueStatusOptions(selected: string, options?: IssueStatusOption[]): string {
	const renderOptions =
		options && options.length > 0
			? options
			: ISSUE_STATUS_OPTIONS.map((name) => ({
					id: name,
					name,
			  }));
	const seen = new Set<string>();
	return renderOptions
		.filter((option) => {
			const name = option?.name?.trim();
			if (!name) {
				return false;
			}
			const key = name.toLowerCase();
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		})
		.map((option) => JiraWebviewPanel.renderStatusSelectOption(option, option.name, option.name === selected))
		.join('');
}

	/**
	 * Renders one native select option carrying the icon metadata needed by the custom picker bootstrap.
	 */
static renderStatusSelectOption(option: IssueStatusOption, value: string, selected: boolean): string {
	const label = option.name?.trim() ?? value;
	const category = option.category ?? IssueModel.determineStatusCategory(label);
	const selectedAttr = selected ? 'selected' : '';
	const iconSrcAttr = HtmlHelper.escapeAttribute(option.iconSrc?.trim() ?? '');
	return `<option
		value="${HtmlHelper.escapeAttribute(value)}"
		data-status-label="${HtmlHelper.escapeAttribute(label)}"
		data-status-value="${HtmlHelper.escapeAttribute(label)}"
		data-status-category="${HtmlHelper.escapeAttribute(category)}"
		data-status-icon-src="${iconSrcAttr}"
		${selectedAttr}
	>${HtmlHelper.escapeHtml(label)}</option>`;
}

	/**
	 * Renders the updated shared CSS used by the single status picker control.
	 */
	static renderStatusPickerStylesV2(): string {
		return `
			.status-select-wrapper {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.jira-status-picker {
				position: relative;
				width: 100%;
			}
			.jira-status-picker-trigger {
				width: 100%;
				min-height: 28px;
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 4px 8px;
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				line-height: 1.4;
				text-align: left;
				cursor: pointer;
			}
			.create-status-picker .jira-status-picker-trigger {
				min-height: 40px;
			}
			.jira-status-picker-trigger:disabled {
				opacity: 0.7;
				cursor: not-allowed;
			}
			.jira-status-picker-trigger:focus-visible,
			.jira-status-picker-option:focus-visible {
				outline: 1px solid var(--vscode-focusBorder, var(--vscode-input-border));
				outline-offset: 0;
			}
			.jira-status-picker-trigger-content,
			.jira-status-picker-option-content {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				min-width: 0;
			}
			.jira-status-picker-trigger-label,
			.jira-status-picker-option-label {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.jira-status-picker-chevron {
				flex-shrink: 0;
				color: var(--vscode-descriptionForeground);
				font-size: 0.85em;
			}
			.jira-status-picker-menu {
				position: absolute;
				top: calc(100% + 4px);
				left: 0;
				right: 0;
				z-index: 20;
				display: flex;
				flex-direction: column;
				gap: 2px;
				padding: 4px;
				background: var(--vscode-dropdown-background, var(--vscode-input-background));
				border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
				border-radius: 4px;
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
			}
			.jira-status-picker-menu[hidden] {
				display: none;
			}
			.jira-status-picker-option {
				width: 100%;
				min-height: 28px;
				display: flex;
				align-items: center;
				background: transparent;
				color: var(--vscode-input-foreground);
				border: 1px solid transparent;
				border-radius: 4px;
				padding: 4px 8px;
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				line-height: 1.4;
				cursor: pointer;
				text-align: left;
			}
			.jira-status-picker-option:hover:not(:disabled) {
				background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
			}
			.jira-status-picker-option:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}
			.jira-status-picker .status-icon,
			.jira-status-picker .status-icon-placeholder {
				width: 16px;
				height: 16px;
				flex-shrink: 0;
			}
			.jira-status-picker .status-icon-placeholder {
				display: inline-block;
				border-radius: 50%;
				background: color-mix(in srgb, var(--vscode-descriptionForeground) 45%, transparent);
			}`;
	}

	/**
	 * Renders the updated bootstrap script that wires the direct status picker markup.
	 */
	static renderStatusPickerBootstrapScriptV2(_statusIconFallbacks: Record<IssueStatusCategory, string>): string {
		return `
			const attachJiraStatusImageFallback = (image) => {
				if (!(image instanceof HTMLImageElement) || image.getAttribute('data-status-fallback-initialized') === 'true') {
					return;
				}
				image.addEventListener('error', () => {
					const fallbackSrc = (image.getAttribute('data-fallback-src') || '').trim();
					const currentSrc = image.getAttribute('src') || '';
					if (!fallbackSrc || fallbackSrc === currentSrc) {
						return;
					}
					image.setAttribute('src', fallbackSrc);
				});
				image.setAttribute('data-status-fallback-initialized', 'true');
			};
			const attachJiraStatusImageFallbacks = (root) => {
				root.querySelectorAll('.status-icon[data-fallback-src]').forEach((image) => {
					attachJiraStatusImageFallback(image);
				});
			};
			const closeJiraStatusPicker = (picker) => {
				const trigger = picker.querySelector('.jira-status-picker-trigger');
				const menu = picker.querySelector('.jira-status-picker-menu');
				if (!trigger || !menu) {
					return;
				}
				menu.hidden = true;
				trigger.setAttribute('aria-expanded', 'false');
			};
			const closeAllJiraStatusPickers = (root) => {
				root.querySelectorAll('.jira-status-picker').forEach((picker) => closeJiraStatusPicker(picker));
			};
			const initializeJiraStatusPickers = (root, vscode) => {
				root.querySelectorAll('.jira-status-picker').forEach((picker) => {
					if (picker.getAttribute('data-status-picker-initialized') === 'true') {
						return;
					}
					const trigger = picker.querySelector('.jira-status-picker-trigger');
					const menu = picker.querySelector('.jira-status-picker-menu');
					const hiddenInput = picker.querySelector('input[name="status"]');
					const issueKey = picker.getAttribute('data-issue-key') || '';
					const mode = picker.getAttribute('data-status-picker') || 'create';
					if (!trigger || !menu) {
						return;
					}
					trigger.addEventListener('click', () => {
						if (trigger.disabled) {
							return;
						}
						const nextExpanded = trigger.getAttribute('aria-expanded') !== 'true';
						closeAllJiraStatusPickers(root);
						menu.hidden = !nextExpanded;
						trigger.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
					});
					picker.querySelectorAll('.jira-status-picker-option').forEach((option) => {
						option.addEventListener('click', () => {
							if (option.disabled || trigger.disabled) {
								return;
							}
							const optionContent = option.querySelector('.jira-status-picker-option-content');
							const triggerContent = trigger.querySelector('.jira-status-picker-trigger-content');
							if (optionContent && triggerContent) {
								triggerContent.innerHTML = optionContent.innerHTML;
								attachJiraStatusImageFallbacks(triggerContent);
							}
							closeJiraStatusPicker(picker);
							if (mode === 'issue') {
								const transitionId = option.getAttribute('data-transition-id') || '';
								if (!transitionId || !issueKey) {
									return;
								}
								trigger.disabled = true;
								picker.querySelectorAll('.jira-status-picker-option').forEach((button) => {
									button.disabled = true;
								});
								vscode.postMessage({ type: 'changeStatus', transitionId, issueKey });
								return;
							}
							if (hiddenInput) {
								hiddenInput.value = option.getAttribute('data-status-value') || '';
							}
						});
					});
					attachJiraStatusImageFallbacks(picker);
					picker.setAttribute('data-status-picker-initialized', 'true');
				});
				root.addEventListener('click', (event) => {
					const target = event.target;
					if (!(target instanceof Element) || target.closest('.jira-status-picker')) {
						return;
					}
					closeAllJiraStatusPickers(root);
				});
				root.addEventListener('keydown', (event) => {
					if (event.key === 'Escape') {
						closeAllJiraStatusPickers(root);
					}
				});
			};`;
	}

	/**
	 * Resolves the effective category for one rendered status option.
	 */
	static resolveStatusOptionCategoryV2(option: IssueStatusOption): IssueStatusCategory {
		return option.category ?? IssueModel.determineStatusCategory(option.name);
	}

	/**
	 * Resolves the effective icon source for one rendered status option.
	 */
	static resolveStatusOptionIconSrcV2(webview: vscode.Webview, option: IssueStatusOption): string {
		const iconSrc = option.iconSrc?.trim();
		if (iconSrc) {
			return iconSrc;
		}
		return ViewResource.getStatusIconWebviewSrc(webview, JiraWebviewPanel.resolveStatusOptionCategoryV2(option)) ?? '';
	}

	/**
	 * Resolves the packaged fallback icon source for one rendered status option.
	 */
	static resolveStatusOptionFallbackIconSrcV2(webview: vscode.Webview, option: IssueStatusOption): string {
		return ViewResource.getStatusIconWebviewSrc(webview, JiraWebviewPanel.resolveStatusOptionCategoryV2(option)) ?? '';
	}

	/**
	 * Renders one status icon image with an optional packaged fallback source.
	 */
	static renderStatusIconMarkupV2(label: string, iconSrc: string, fallbackIconSrc?: string): string {
		if (!iconSrc) {
			return '<span class="status-icon status-icon-placeholder" aria-hidden="true"></span>';
		}
		const fallbackAttribute =
			fallbackIconSrc && fallbackIconSrc !== iconSrc
				? ` data-fallback-src="${HtmlHelper.escapeAttribute(fallbackIconSrc)}"`
				: '';
		return `<img class="status-icon" src="${HtmlHelper.escapeAttribute(iconSrc)}"${fallbackAttribute} alt="${HtmlHelper.escapeHtml(
			label
		)} status icon" />`;
	}

	/**
	 * Renders the icon-plus-label fragment shared by status picker triggers and options.
	 */
	static renderStatusPickerDisplayContentV2(label: string, iconSrc: string, fallbackIconSrc?: string): string {
		const iconMarkup = JiraWebviewPanel.renderStatusIconMarkupV2(label, iconSrc, fallbackIconSrc);
		return `<span class="jira-status-picker-trigger-content">${iconMarkup}<span class="jira-status-picker-trigger-label">${HtmlHelper.escapeHtml(
			label
		)}</span></span>`;
	}

	/**
	 * Renders one direct status picker option button.
	 */
	static renderStatusPickerOptionButtonV2(
		label: string,
		iconSrc: string,
		fallbackIconSrc: string,
		attributes: string,
		disabled: boolean
	): string {
		return `<button type="button" class="jira-status-picker-option" ${attributes} ${disabled ? 'disabled' : ''}>
			<span class="jira-status-picker-option-content">
				${JiraWebviewPanel.renderStatusIconMarkupV2(label, iconSrc, fallbackIconSrc)}
				<span class="jira-status-picker-option-label">${HtmlHelper.escapeHtml(label)}</span>
			</span>
		</button>`;
	}

	/**
	 * Renders the create-issue status picker as a single custom control.
	 */
	static renderCreateStatusPickerControl(
		webview: vscode.Webview,
		selected: string,
		options?: IssueStatusOption[],
		disabled = false
	): string {
		const renderOptions =
			options && options.length > 0
				? options
				: ISSUE_STATUS_OPTIONS.map((name) => ({
						id: name,
						name,
				  }));
		const seen = new Set<string>();
		const deduplicatedOptions = renderOptions.filter((option) => {
			const name = option?.name?.trim();
			if (!name) {
				return false;
			}
			const key = name.toLowerCase();
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
		const selectedOption =
			deduplicatedOptions.find((option) => option.name === selected) ??
			deduplicatedOptions[0] ?? {
				id: selected,
				name: selected,
			};
		const selectedIconSrc = JiraWebviewPanel.resolveStatusOptionIconSrcV2(webview, selectedOption);
		const selectedFallbackIconSrc = JiraWebviewPanel.resolveStatusOptionFallbackIconSrcV2(webview, selectedOption);
		const optionButtons = deduplicatedOptions
			.map((option) =>
				JiraWebviewPanel.renderStatusPickerOptionButtonV2(
					option.name,
					JiraWebviewPanel.resolveStatusOptionIconSrcV2(webview, option),
					JiraWebviewPanel.resolveStatusOptionFallbackIconSrcV2(webview, option),
					`data-status-value="${HtmlHelper.escapeAttribute(option.name)}" data-status-label="${HtmlHelper.escapeAttribute(option.name)}"`,
					disabled
				)
			)
			.join('');
		return `<div class="status-select-wrapper jira-status-picker create-status-picker" data-status-picker="create">
			<input type="hidden" name="status" value="${HtmlHelper.escapeAttribute(selectedOption.name)}" />
			<button type="button" class="jira-status-picker-trigger" aria-haspopup="listbox" aria-expanded="false" ${disabled ? 'disabled' : ''}>
				${JiraWebviewPanel.renderStatusPickerDisplayContentV2(selectedOption.name, selectedIconSrc, selectedFallbackIconSrc)}
				<span class="jira-status-picker-chevron" aria-hidden="true">▾</span>
			</button>
			<div class="jira-status-picker-menu" hidden>
				${optionButtons}
			</div>
		</div>`;
	}

	/**
	 * Renders the issue-details status picker as a single custom control.
	 */
	static renderStatusControlV2(webview: vscode.Webview, issue: JiraIssue, options?: IssuePanelOptions): string {
		const transitions = options?.statusOptions;
		const pending = options?.statusPending ?? false;
		const statusError = options?.statusError;
		if (!transitions || transitions.length === 0) {
			const message = statusError
				? statusError
				: options?.loading
				? 'Loading available statusesâ€¦'
				: 'No status transitions available.';
			return `<div>${HtmlHelper.escapeHtml(issue.statusName)}</div>
		<div class="muted">${HtmlHelper.escapeHtml(message)}</div>`;
		}
		const currentStatusIconSrc =
			issue.statusIconSrc?.trim() ??
			(ViewResource.getStatusIconWebviewSrc(webview, IssueModel.determineStatusCategory(issue.statusName)) ?? '');
		const currentStatusFallbackIconSrc =
			ViewResource.getStatusIconWebviewSrc(webview, IssueModel.determineStatusCategory(issue.statusName)) ?? '';
		const optionButtons = transitions
			.map((option) =>
				JiraWebviewPanel.renderStatusPickerOptionButtonV2(
					option.name,
					JiraWebviewPanel.resolveStatusOptionIconSrcV2(webview, option),
					JiraWebviewPanel.resolveStatusOptionFallbackIconSrcV2(webview, option),
					`data-transition-id="${HtmlHelper.escapeAttribute(option.id)}" data-status-label="${HtmlHelper.escapeAttribute(option.name)}"`,
					pending
				)
			)
			.join('');
		return `<div class="status-select-wrapper jira-status-picker issue-status-picker" data-status-picker="issue" data-issue-key="${HtmlHelper.escapeAttribute(
			issue.key
		)}">
			<button type="button" class="jira-status-picker-trigger" aria-haspopup="listbox" aria-expanded="false" ${pending ? 'disabled' : ''}>
				${JiraWebviewPanel.renderStatusPickerDisplayContentV2(issue.statusName, currentStatusIconSrc, currentStatusFallbackIconSrc)}
				<span class="jira-status-picker-chevron" aria-hidden="true">▾</span>
			</button>
			<div class="jira-status-picker-menu" hidden>
				${optionButtons}
			</div>
			${statusError ? `<div class="status-error">${HtmlHelper.escapeHtml(statusError)}</div>` : ''}
		</div>`;
	}

	static renderCreateAdditionalFieldsSection(
	state: CreateIssuePanelState,
	disabled: boolean
): string {
	const fields = (state.createFields ?? []).filter((field) => !field.isParentField && field.id !== 'parent');
	const pending = state.createFieldsPending ?? false;
	const error = state.createFieldsError;
	if (!pending && !error && fields.length === 0) {
		return '';
	}

	const disabledAttr = disabled ? 'disabled' : '';
	const values = state.values.customFields ?? {};
	const fieldRows = fields
		.map((field) => renderCreateAdditionalFieldInput(state, field, values[field.id] ?? '', disabledAttr))
		.join('');
	const pendingMarkup = pending ? '<div class="muted status-helper">Loading additional fields…</div>' : '';
	const errorMarkup = error ? `<div class="status-error">${HtmlHelper.escapeHtml(error)}</div>` : '';

	return `<div class="form-field create-additional-fields">
		<div class="section-title">Additional Fields</div>
	${pendingMarkup}
	${errorMarkup}
	${fieldRows}
	</div>`;
}

	/**
	 * Renders the parent selector in the create form sidebar.
	 */
	static renderCreateParentSidebarSection(state: CreateIssuePanelState, disabled: boolean): string {
		const parentField = (state.createFields ?? []).find((field) => field.isParentField || field.id === 'parent');
		if (!parentField) {
			return '';
		}
		const parentValue = state.values.customFields?.[parentField.id] ?? '';
		const disabledAttr = disabled ? 'disabled' : '';
		const content = renderCreateParentFieldInput(
			state,
			parentField,
			parentValue,
			disabledAttr,
			'Parent Ticket'
		);
		return `<div class="meta-section">
			<div class="section-title">Parent Ticket</div>
			${content}
		</div>`;
	}

	static renderCreateAdditionalFieldInput(
	state: CreateIssuePanelState,
	field: CreateIssueFieldDefinition,
	value: string,
	disabledAttr: string
): string {
	const requiredSuffix = field.required ? ' <span class="field-required">*</span>' : '';
	const label = `${HtmlHelper.escapeHtml(field.name)}${requiredSuffix}`;
	if (field.isParentField) {
		return renderCreateParentFieldInput(state, field, value, disabledAttr, label);
	}
	if (field.multiline) {
		return `<label class="create-custom-field-label" for="${HtmlHelper.escapeAttribute(field.id)}">
			<span>${label}</span>
			<textarea id="${HtmlHelper.escapeAttribute(field.id)}" data-create-custom-field="${HtmlHelper.escapeAttribute(
				field.id
			)}" rows="6" class="create-custom-field-input" ${disabledAttr}>${HtmlHelper.escapeHtml(value)}</textarea>
		</label>`;
	}
	return `<label class="create-custom-field-label" for="${HtmlHelper.escapeAttribute(field.id)}">
		<span>${label}</span>
		<input id="${HtmlHelper.escapeAttribute(field.id)}" type="text" data-create-custom-field="${HtmlHelper.escapeAttribute(
			field.id
		)}" value="${HtmlHelper.escapeAttribute(value)}" class="create-custom-field-input" ${disabledAttr} />
	</label>`;
}

	/**
	 * Renders the parent selector field so the form can open the dedicated picker instead of accepting raw keys.
	 */
	static renderCreateParentFieldInput(
		state: CreateIssuePanelState,
		field: CreateIssueFieldDefinition,
		value: string,
		disabledAttr: string,
		label: string
	): string {
		return SharedParentPicker.renderCard({
			ariaLabel: label,
			fieldId: field.id,
			fieldValue: value,
			selectedParent: state.selectedParentIssue
				? {
					key: state.selectedParentIssue.key,
					summary: state.selectedParentIssue.summary,
				}
				: undefined,
			disabled: Boolean(disabledAttr),
		});
	}
	static renderCreateAssigneeSection(state: CreateIssuePanelState): string {
	const selection = resolveCreateAssigneeSelection(state);
	const selectedLabel = selection.label ?? 'Unassigned';
	const disabledAttr = state.submitting ? 'disabled' : '';
	const assignMeButton =
		state.currentUser?.accountId && state.currentUser.accountId.trim().length > 0
			? `<div class="assignee-actions">
				<button type="button" class="jira-create-assign-me" data-account-id="${HtmlHelper.escapeAttribute(
					state.currentUser.accountId
				)}" data-display-name="${HtmlHelper.escapeAttribute(
					state.currentUser.displayName ?? ''
				)}" data-avatar-url="${HtmlHelper.escapeAttribute(
					state.currentUser.avatarUrl ?? ''
				)}" ${disabledAttr}>Assign to Me</button>
			</div>`
			: '';
	const errorText = state.assigneeError
		? `<div class="status-error">${HtmlHelper.escapeHtml(state.assigneeError)}</div>`
		: '';
	return `<div class="assignee-card" data-create-assignee-field>
		<button
			type="button"
			class="parent-picker-trigger parent-picker-card"
			data-assignee-picker-open
			aria-label="Assignee"
			${disabledAttr}
			style="align-self: stretch; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 72px; padding: 10px 12px; text-align: left; border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1)); border-radius: 6px; background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03)); color: var(--vscode-foreground);"
		>
			<span data-assignee-card-avatar>${renderCreateAssigneeAvatar(selection)}</span>
			<span style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0;">
				<span class="assignee-picker-card-title">${HtmlHelper.escapeHtml('Choose an assignee')}</span>
				<span class="assignee-picker-card-detail">${HtmlHelper.escapeHtml(selectedLabel)}</span>
			</span>
		</button>
		${assignMeButton}
		${errorText}
	</div>`;
}

	static resolveCreateAssigneeSelection(state: CreateIssuePanelState) {
	const accountId = state.values.assigneeAccountId?.trim();
	if (!accountId) {
		return { label: undefined, avatarUrl: undefined, accountId: undefined };
	}
	const match = state.assigneeOptions?.find((user) => user.accountId === accountId);
	if (match) {
		return {
			label: match.displayName || accountId,
			avatarUrl: match.avatarUrl,
			accountId,
		};
	}
	return {
		label: state.values.assigneeDisplayName ?? accountId,
		avatarUrl: state.values.assigneeAvatarUrl,
		accountId,
	};
}

	static renderCreateAssigneeAvatar(selection: { label?: string; avatarUrl?: string }): string {
	if (selection.avatarUrl) {
		return `<img class="assignee-avatar" src="${HtmlHelper.escapeAttribute(selection.avatarUrl)}" alt="Selected assignee avatar" />`;
	}
	const initials = getInitials(selection.label);
	return `<div class="assignee-avatar fallback">${HtmlHelper.escapeHtml(initials)}</div>`;
}

static renderCreateAssigneeOptions(state: CreateIssuePanelState): string {
	return '';
}

	static deriveStatusOptionNames(options?: IssueStatusOption[]): string[] {
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

	static pickPreferredInitialStatus(names: string[]): string | undefined {
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

static renderAssigneeControl(
	issue: JiraIssue,
	currentAssigneeLabel: string,
	options?: IssuePanelOptions
): string {
	const disabledAttr = options?.assigneePending ? 'disabled' : '';
	const assignMeButton =
		options?.currentUser?.accountId && options.currentUser.accountId.trim().length > 0
			? `<div class="assignee-actions">
				<button
					type="button"
					class="jira-assignee-assign-me"
					data-issue-key="${HtmlHelper.escapeAttribute(issue.key)}"
					data-account-id="${HtmlHelper.escapeAttribute(options.currentUser.accountId)}"
					${disabledAttr}
				>Assign to Me</button>
			</div>`
			: '';
	return `<div class="assignee-card">
		<button
			type="button"
			class="parent-picker-trigger parent-picker-card"
			data-assignee-picker-open
			aria-label="Assignee"
			${disabledAttr}
			style="align-self: stretch; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 72px; padding: 10px 12px; text-align: left; border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1)); border-radius: 6px; background: var(--vscode-editorWidget-background, rgba(255,255,255,0.03)); color: var(--vscode-foreground);"
		>
			<span data-assignee-card-avatar>${renderAssigneeAvatar(issue)}</span>
			<span style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0;">
				<span class="assignee-picker-card-title">${HtmlHelper.escapeHtml('Choose an assignee')}</span>
				<span class="assignee-picker-card-detail">${HtmlHelper.escapeHtml(currentAssigneeLabel || 'Unassigned')}</span>
			</span>
		</button>
		${assignMeButton}
		${options?.assigneeError ? `<div class="status-error">${HtmlHelper.escapeHtml(options.assigneeError)}</div>` : ''}
	</div>`;
}

	static sanitizeCreateIssueValues(
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
	const customFields = sanitizeCreateCustomFields(raw?.customFields, fallback.customFields);
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

	static sanitizeCreateCustomFields(
	raw: any,
	fallback?: Record<string, string>
): Record<string, string> {
	const result: Record<string, string> = {};
	if (fallback && typeof fallback === 'object') {
		for (const [key, value] of Object.entries(fallback)) {
			if (!key.trim()) {
				continue;
			}
			result[key] = typeof value === 'string' ? value : '';
		}
	}
	if (!raw || typeof raw !== 'object') {
		return result;
	}
	for (const [key, value] of Object.entries(raw)) {
		if (!key.trim()) {
			continue;
		}
		result[key] = typeof value === 'string' ? value : '';
	}
	return result;
}

	static renderAssigneeAvatar(issue: JiraIssue): string {
	if (issue.assigneeAvatarUrl) {
		return `<img class="assignee-avatar" src="${HtmlHelper.escapeAttribute(issue.assigneeAvatarUrl)}" alt="Assignee avatar" />`;
	}
	const initials = getInitials(issue.assigneeName);
	return `<div class="assignee-avatar fallback">${HtmlHelper.escapeHtml(initials)}</div>`;
}

	static getInitials(name?: string): string {
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

	static generateNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}
}

const formatDebugDetails = JiraWebviewPanel.formatDebugDetails;
const renderIssueDetailsHtml = JiraWebviewPanel.renderIssueDetailsHtml;
const renderCreateIssuePanelHtml = JiraWebviewPanel.renderCreateIssuePanelHtml;
const renderParentSection = JiraWebviewPanel.renderParentSection;
const renderParentMetadataSection = JiraWebviewPanel.renderParentMetadataSection;
const renderChildrenSection = JiraWebviewPanel.renderChildrenSection;
const renderDescriptionSection = JiraWebviewPanel.renderDescriptionSection;
const deriveEditableDescriptionText = JiraWebviewPanel.deriveEditableDescriptionText;
const deriveEditableDescriptionHtml = JiraWebviewPanel.deriveEditableDescriptionHtml;
const htmlToPlainText = JiraWebviewPanel.htmlToPlainText;
const decodeHtmlEntities = JiraWebviewPanel.decodeHtmlEntities;
const renderRichTextEditor = JiraWebviewPanel.renderRichTextEditor;
const renderRichTextEditorStyles = JiraWebviewPanel.renderRichTextEditorStyles;
const renderRichTextEditorBootstrapScript = JiraWebviewPanel.renderRichTextEditorBootstrapScript;
const renderCommentsSection = JiraWebviewPanel.renderCommentsSection;
const renderCommentList = JiraWebviewPanel.renderCommentList;
const renderCommentItem = JiraWebviewPanel.renderCommentItem;
const renderCommentForm = JiraWebviewPanel.renderCommentForm;
const renderCommentReplyBanner = JiraWebviewPanel.renderCommentReplyBanner;
const renderCommentAvatar = JiraWebviewPanel.renderCommentAvatar;
const renderRelatedIssueButton = JiraWebviewPanel.renderRelatedIssueButton;
const renderMetadataPanel = JiraWebviewPanel.renderMetadataPanel;
const renderStatusPickerStyles = JiraWebviewPanel.renderStatusPickerStyles;
const renderStatusPickerBootstrapScript = JiraWebviewPanel.renderStatusPickerBootstrapScript;
const renderStatusPickerStylesV2 = JiraWebviewPanel.renderStatusPickerStylesV2;
const renderStatusPickerBootstrapScriptV2 = JiraWebviewPanel.renderStatusPickerBootstrapScriptV2;
const renderStatusControl = JiraWebviewPanel.renderStatusControl;
const renderStatusControlV2 = JiraWebviewPanel.renderStatusControlV2;
const renderIssueTypeOptions = JiraWebviewPanel.renderIssueTypeOptions;
const renderIssueStatusOptions = JiraWebviewPanel.renderIssueStatusOptions;
const renderCreateStatusPickerControl = JiraWebviewPanel.renderCreateStatusPickerControl;
const renderCreateAdditionalFieldsSection = JiraWebviewPanel.renderCreateAdditionalFieldsSection;
const renderCreateParentSidebarSection = JiraWebviewPanel.renderCreateParentSidebarSection;
const renderCreateAdditionalFieldInput = JiraWebviewPanel.renderCreateAdditionalFieldInput;
const renderCreateParentFieldInput = JiraWebviewPanel.renderCreateParentFieldInput;
const renderCreateAssigneeSection = JiraWebviewPanel.renderCreateAssigneeSection;
const resolveCreateAssigneeSelection = JiraWebviewPanel.resolveCreateAssigneeSelection;
const renderCreateAssigneeAvatar = JiraWebviewPanel.renderCreateAssigneeAvatar;
const renderCreateAssigneeOptions = JiraWebviewPanel.renderCreateAssigneeOptions;
const deriveStatusOptionNames = JiraWebviewPanel.deriveStatusOptionNames;
const pickPreferredInitialStatus = JiraWebviewPanel.pickPreferredInitialStatus;
const renderAssigneeControl = JiraWebviewPanel.renderAssigneeControl;
const sanitizeCreateIssueValues = JiraWebviewPanel.sanitizeCreateIssueValues;
const sanitizeCreateCustomFields = JiraWebviewPanel.sanitizeCreateCustomFields;
const renderAssigneeAvatar = JiraWebviewPanel.renderAssigneeAvatar;
const getInitials = JiraWebviewPanel.getInitials;
const generateNonce = JiraWebviewPanel.generateNonce;

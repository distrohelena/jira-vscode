import * as vscode from 'vscode';

import { JiraIssue, SelectedProjectInfo } from '../../model/jira.type';
import { HtmlHelper } from '../../shared/html.helper';

/**
 * Represents the filter inputs shown in the parent issue picker modal.
 */
export type ParentIssuePickerFilters = {
	/**
	 * A free-text query applied to Jira search (typically `text ~ "<query>"`).
	 */
	searchQuery: string;

	/**
	 * An optional issue type label (for example, `Bug` or `Task`).
	 */
	issueTypeName: string;

	/**
	 * An optional status label (for example, `Closed` or `In Progress`).
	 * When empty, the picker should include all statuses, including closed issues.
	 */
	statusName: string;
};

/**
 * Represents the view state rendered by the parent issue picker modal.
 */
export type ParentIssuePickerPanelState = ParentIssuePickerFilters & {
	/**
	 * Indicates whether the picker is currently loading the first page of results.
	 */
	loading: boolean;

	/**
	 * Indicates whether the picker is currently loading an additional page of results.
	 */
	loadingMore: boolean;

	/**
	 * Carries the friendly error message to display when a search request fails.
	 */
	error?: string;

	/**
	 * Carries the issues returned for the current filter state.
	 */
	issues: JiraIssue[];

	/**
	 * Indicates whether additional pages of results are available for the current query.
	 */
	hasMore: boolean;

	/**
	 * Carries the currently selected issue key, if the user picked one.
	 */
	selectedIssueKey?: string;
};

/**
 * Renders the large modal-style issue picker used for selecting parent tickets.
 */
export class ParentIssuePickerPanel {
	/**
	 * Creates and shows the modal picker as a dedicated webview panel.
	 */
	static showParentIssuePickerPanel(
		project: SelectedProjectInfo,
		state: ParentIssuePickerPanelState,
		onMessage?: (message: any, panel: vscode.WebviewPanel) => void
	): vscode.WebviewPanel {
		const panel = vscode.window.createWebviewPanel(
			'jiraParentIssuePicker',
			`Select Parent (${project.key})`,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		);

		panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'debugLog') {
				const eventName = typeof message.event === 'string' ? message.event : 'unknown';
				console.log(`[jira.parentPicker] ${eventName}`);
				return;
			}
			onMessage?.(message, panel);
		});

		ParentIssuePickerPanel.renderParentIssuePickerPanel(panel, project, state);
		return panel;
	}

	/**
	 * Updates the modal picker content with the latest state.
	 */
	static renderParentIssuePickerPanel(
		panel: vscode.WebviewPanel,
		project: SelectedProjectInfo,
		state: ParentIssuePickerPanelState
	): void {
		panel.webview.html = ParentIssuePickerPanel.renderParentIssuePickerPanelHtml(panel.webview, project, state);
	}

	/**
	 * Produces the full HTML for the picker webview, including stable layout regions.
	 */
	static renderParentIssuePickerPanelHtml(
		webview: vscode.Webview,
		project: SelectedProjectInfo,
		state: ParentIssuePickerPanelState
	): string {
		const nonce = ParentIssuePickerPanel.generateNonce();
		const cspSource = webview.cspSource;
		const projectLabel = project.name ? `${project.name} (${project.key})` : project.key;

		const searchQueryValue = HtmlHelper.escapeAttribute(state.searchQuery ?? '');
		const issueTypeValue = HtmlHelper.escapeAttribute(state.issueTypeName ?? '');
		const statusValue = (state.statusName ?? '').trim();
		const selectedKey = (state.selectedIssueKey ?? '').trim();

		const isBusy = state.loading || state.loadingMore;
		const searchDisabledAttr = isBusy ? 'disabled' : '';
		const confirmDisabledAttr = selectedKey ? '' : 'disabled';
		const loadMoreDisabledAttr = state.loadingMore || !state.hasMore ? 'disabled' : '';

		const errorText = state.error?.trim();
		const messageMarkup = errorText ? `<div class="message error">${HtmlHelper.escapeHtml(errorText)}</div>` : '';

		const resultsMarkup = ParentIssuePickerPanel.renderIssueResultsList(state.issues, selectedKey);
		const previewIssue = state.issues.find((issue) => issue?.key?.trim() === selectedKey);
		const previewMarkup = ParentIssuePickerPanel.renderPreview(previewIssue);

		const statusOptions = ParentIssuePickerPanel.renderStatusOptions(statusValue);

		return `<!DOCTYPE html>
<html lang="en">
<head>
\t<meta charset="UTF-8" />
\t<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
\t<title>Select Parent Ticket</title>
\t<style>
\t\t:root {
\t\t\t--picker-surface: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-panel-background) 16%);
\t\t\t--picker-border: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
\t\t\t--picker-shadow: 0 26px 80px rgba(0,0,0,0.35);
\t\t\t--picker-accent: var(--vscode-textLink-foreground);
\t\t\t--picker-accentSoft: color-mix(in srgb, var(--picker-accent) 16%, transparent);
\t\t}
\t\t*, *::before, *::after { box-sizing: border-box; }
\t\tbody {
\t\t\tmargin: 0;
\t\t\tfont-family: var(--vscode-font-family);
\t\t\tfont-size: var(--vscode-font-size);
\t\t\tcolor: var(--vscode-foreground);
\t\t\tbackground: radial-gradient(1200px 680px at 10% 0%, color-mix(in srgb, var(--picker-accent) 20%, transparent) 0%, transparent 55%),
\t\t\t\tlinear-gradient(140deg, color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%) 0%, var(--vscode-editor-background) 55%, color-mix(in srgb, var(--picker-accent) 10%, var(--vscode-editor-background) 90%) 100%);
\t\t\theight: 100vh;
\t\t\toverflow: hidden;
\t\t}
\t\t.parent-picker-overlay {
\t\t\tposition: fixed;
\t\t\tinset: 0;
\t\t\tpadding: 24px;
\t\t\tdisplay: flex;
\t\t\talign-items: center;
\t\t\tjustify-content: center;
\t\t}
\t\t.parent-picker-shell {
\t\t\twidth: 92vw;
\t\t\theight: min(84vh, 860px);
\t\t\tmax-width: 1200px;
\t\t\tborder-radius: 16px;
\t\t\tbackground: var(--picker-surface);
\t\t\tborder: 1px solid var(--picker-border);
\t\t\tbox-shadow: var(--picker-shadow);
\t\t\toverflow: hidden;
\t\t\tdisplay: grid;
\t\t\tgrid-template-rows: auto auto 1fr auto;
\t\t}
\t\t.parent-picker-header {
\t\t\tpadding: 18px 20px 10px 20px;
\t\t\tdisplay: flex;
\t\t\talign-items: baseline;
\t\t\tjustify-content: space-between;
\t\t\tgap: 12px;
\t\t\tborder-bottom: 1px solid var(--picker-border);
\t\t}
\t\t.parent-picker-title {
\t\t\tfont-size: 1.35em;
\t\t\tfont-weight: 800;
\t\t\tletter-spacing: 0.2px;
\t\t\tmargin: 0;
\t\t}
\t\t.parent-picker-subtitle {
\t\t\tmargin: 4px 0 0 0;
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t\tfont-size: 0.95em;
\t\t}
\t\t.parent-picker-header-right {
\t\t\tdisplay: flex;
\t\t\talign-items: center;
\t\t\tgap: 10px;
\t\t\tmin-width: 0;
\t\t}
\t\t.parent-picker-pill {
\t\t\tpadding: 6px 10px;
\t\t\tborder-radius: 999px;
\t\t\tbackground: color-mix(in srgb, var(--vscode-badge-background) 80%, transparent);
\t\t\tcolor: var(--vscode-badge-foreground);
\t\t\tborder: 1px solid color-mix(in srgb, var(--vscode-badge-foreground) 18%, transparent);
\t\t\twhite-space: nowrap;
\t\t}
\t\t.parent-picker-body {
\t\t\tpadding: 14px 20px 0 20px;
\t\t\tdisplay: grid;
\t\t\tgrid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
\t\t\tgap: 18px;
\t\t\theight: 100%;
\t\t\tmin-height: 0;
\t\t}
\t\t.parent-picker-left {
\t\t\tdisplay: grid;
\t\t\tgrid-template-rows: auto auto 1fr;
\t\t\tgap: 10px;
\t\t\tmin-height: 0;
\t\t}
\t\t.parent-picker-filters {
\t\t\tdisplay: grid;
\t\t\tgrid-template-columns: 1.3fr 0.9fr 0.9fr auto;
\t\t\tgap: 10px;
\t\t\talign-items: end;
\t\t}
\t\t.field label {
\t\t\tdisplay: flex;
\t\t\tflex-direction: column;
\t\t\tgap: 6px;
\t\t\tfont-weight: 700;
\t\t\tcolor: var(--vscode-foreground);
\t\t}
\t\tinput[type="text"], select {
\t\t\tbackground: var(--vscode-input-background);
\t\t\tcolor: var(--vscode-input-foreground);
\t\t\tborder: 1px solid var(--vscode-input-border);
\t\t\tborder-radius: 8px;
\t\t\tpadding: 9px 10px;
\t\t\tfont-size: 1em;
\t\t\twidth: 100%;
\t\t\toutline: none;
\t\t}
\t\tinput[type="text"]:focus, select:focus {
\t\t\tbox-shadow: 0 0 0 2px var(--picker-accentSoft);
\t\t\tborder-color: color-mix(in srgb, var(--picker-accent) 65%, var(--vscode-input-border) 35%);
\t\t}
\t\tbutton {
\t\t\tborder-radius: 10px;
\t\t\tpadding: 10px 14px;
\t\t\tfont-weight: 800;
\t\t\tcursor: pointer;
\t\t\tborder: 1px solid color-mix(in srgb, var(--picker-accent) 40%, transparent);
\t\t\tbackground: linear-gradient(180deg, color-mix(in srgb, var(--picker-accent) 18%, transparent) 0%, transparent 100%);
\t\t\tcolor: var(--vscode-foreground);
\t\t}
\t\tbutton:disabled {
\t\t\topacity: 0.6;
\t\t\tcursor: not-allowed;
\t\t}
\t\tbutton.primary {
\t\t\tbackground: var(--vscode-button-background);
\t\t\tcolor: var(--vscode-button-foreground);
\t\t\tborder: none;
\t\t}
\t\tbutton.secondary {
\t\t\tbackground: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
\t\t\tborder: 1px solid var(--vscode-button-secondaryBorder, transparent);
\t\t\tcolor: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
\t\t}
\t\t.parent-picker-message {
\t\t\tmin-height: 48px;
\t\t\tdisplay: flex;
\t\t\talign-items: center;
\t\t}
\t\t.message {
\t\t\tpadding: 10px 12px;
\t\t\tborder-radius: 10px;
\t\t\twidth: 100%;
\t\t}
\t\t.message.error {
\t\t\tbackground: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
\t\t\tborder: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, transparent);
\t\t}
\t\t.parent-picker-results {
\t\t\tmin-height: 280px;
\t\t\tborder: 1px solid var(--picker-border);
\t\t\tborder-radius: 14px;
\t\t\toverflow: hidden;
\t\t\tdisplay: grid;
\t\t\tgrid-template-rows: auto 1fr auto;
\t\t\tbackground: color-mix(in srgb, var(--picker-surface) 92%, black 8%);
\t\t}
\t\t.parent-picker-results-header {
\t\t\tpadding: 10px 12px;
\t\t\tdisplay: flex;
\t\t\tjustify-content: space-between;
\t\t\talign-items: center;
\t\t\tgap: 10px;
\t\t\tborder-bottom: 1px solid var(--picker-border);
\t\t}
\t\t.parent-picker-results-title {
\t\t\tfont-weight: 900;
\t\t}
\t\t.parent-picker-results-list {
\t\t\tmargin: 0;
\t\t\tpadding: 0;
\t\t\tlist-style: none;
\t\t\toverflow: auto;
\t\t}
\t\t.parent-picker-result {
\t\t\tborder-bottom: 1px solid color-mix(in srgb, var(--picker-border) 70%, transparent);
\t\t}
\t\t.parent-picker-result:last-child { border-bottom: none; }
\t\t.parent-picker-result-button {
\t\t\twidth: 100%;
\t\t\ttext-align: left;
\t\t\tborder: none;
\t\t\tborder-radius: 0;
\t\t\tpadding: 12px 12px;
\t\t\tbackground: transparent;
\t\t\tcursor: pointer;
\t\t}
\t\t.parent-picker-result-button:hover {
\t\t\tbackground: color-mix(in srgb, var(--picker-accent) 10%, transparent);
\t\t}
\t\t.parent-picker-result-button.selected {
\t\t\tbackground: color-mix(in srgb, var(--picker-accent) 18%, transparent);
\t\t}
\t\t.result-top {
\t\t\tdisplay: flex;
\t\t\talign-items: baseline;
\t\t\tgap: 10px;
\t\t}
\t\t.result-key {
\t\t\tfont-weight: 900;
\t\t\tletter-spacing: 0.2px;
\t\t\tcolor: var(--picker-accent);
\t\t}
\t\t.result-summary {
\t\t\tfont-weight: 700;
\t\t\twhite-space: nowrap;
\t\t\toverflow: hidden;
\t\t\ttext-overflow: ellipsis;
\t\t\tflex: 1;
\t\t\tmin-width: 0;
\t\t}
\t\t.result-meta {
\t\t\tmargin-top: 4px;
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t\tfont-size: 0.92em;
\t\t\tdisplay: flex;
\t\t\tgap: 10px;
\t\t\tflex-wrap: wrap;
\t\t}
\t\t.parent-picker-results-footer {
\t\t\tpadding: 10px 12px;
\t\t\tdisplay: flex;
\t\t\tjustify-content: flex-end;
\t\t\tgap: 10px;
\t\t\tborder-top: 1px solid var(--picker-border);
\t\t}
\t\t.parent-picker-right {
\t\t\tdisplay: grid;
\t\t\tgrid-template-rows: auto 1fr;
\t\t\tgap: 10px;
\t\t\tmin-height: 0;
\t\t}
\t\t.parent-picker-preview {
\t\t\tmin-height: 120px;
\t\t\tborder: 1px solid var(--picker-border);
\t\t\tborder-radius: 14px;
\t\t\tpadding: 12px 12px;
\t\t\tbackground: color-mix(in srgb, var(--picker-surface) 95%, black 5%);
\t\t}
\t\t.preview-title {
\t\t\tfont-weight: 900;
\t\t\tmargin: 0 0 6px 0;
\t\t}
\t\t.preview-body {
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t\tfont-size: 0.96em;
\t\t\tline-height: 1.45;
\t\t}
\t\t.parent-picker-actions {
\t\t\tpadding: 14px 20px;
\t\t\tdisplay: flex;
\t\t\tjustify-content: space-between;
\t\t\talign-items: center;
\t\t\tgap: 10px;
\t\t\tborder-top: 1px solid var(--picker-border);
\t\t}
\t\t.parent-picker-actions-left {
\t\t\tdisplay: flex;
\t\t\tgap: 10px;
\t\t}
\t\t.parent-picker-actions-right {
\t\t\tdisplay: flex;
\t\t\tgap: 10px;
\t\t}
\t\t.muted {
\t\t\tcolor: var(--vscode-descriptionForeground);
\t\t}
\t\t@media (max-width: 980px) {
\t\t\t.parent-picker-shell { width: 96vw; height: 92vh; }
\t\t\t.parent-picker-body { grid-template-columns: 1fr; }
\t\t\t.parent-picker-filters { grid-template-columns: 1fr 1fr; }
\t\t\t.parent-picker-right { display: none; }
\t\t}
\t</style>
</head>
<body>
\t<div class="parent-picker-overlay" role="dialog" aria-modal="true" aria-label="Select parent ticket">
\t\t<div class="parent-picker-shell" style="width: 92vw; height: min(84vh, 860px);">
\t\t\t<header class="parent-picker-header">
\t\t\t\t<div>
\t\t\t\t\t<h1 class="parent-picker-title">Select Parent Ticket</h1>
\t\t\t\t\t<div class="parent-picker-subtitle">Search in <strong>${HtmlHelper.escapeHtml(projectLabel)}</strong>. Closed issues are included unless you filter by status.</div>
\t\t\t\t</div>
\t\t\t\t<div class="parent-picker-header-right">
\t\t\t\t\t<div class="parent-picker-pill">Project: ${HtmlHelper.escapeHtml(project.key)}</div>
\t\t\t\t</div>
\t\t\t</header>
\t\t\t<div class="parent-picker-body">
\t\t\t\t<section class="parent-picker-left">
\t\t\t\t\t<div class="parent-picker-filters">
\t\t\t\t\t\t<div class="field">
\t\t\t\t\t\t\t<label>
\t\t\t\t\t\t\t\t<span>Search</span>
\t\t\t\t\t\t\t\t<input type="text" name="searchQuery" value="${searchQueryValue}" placeholder="Key, summary, or text" ${searchDisabledAttr} />
\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t</div>
\t\t\t\t\t\t<div class="field">
\t\t\t\t\t\t\t<label>
\t\t\t\t\t\t\t\t<span>Issue type</span>
\t\t\t\t\t\t\t\t<input type="text" name="issueTypeName" value="${issueTypeValue}" placeholder="Bug, Task, Story" ${searchDisabledAttr} />
\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t</div>
\t\t\t\t\t\t<div class="field">
\t\t\t\t\t\t\t<label>
\t\t\t\t\t\t\t\t<span>Status</span>
\t\t\t\t\t\t\t\t<select name="statusName" ${searchDisabledAttr}>
\t\t\t\t\t\t\t\t\t${statusOptions}
\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t</div>
\t\t\t\t\t\t<div class="field">
\t\t\t\t\t\t\t<button type="button" class="parent-picker-search" ${searchDisabledAttr}>Search</button>
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="parent-picker-message" aria-live="polite">
\t\t\t\t\t\t${messageMarkup}
\t\t\t\t\t</div>
\t\t\t\t\t<div class="parent-picker-results" style="min-height: 280px;">
\t\t\t\t\t\t<div class="parent-picker-results-header">
\t\t\t\t\t\t\t<div class="parent-picker-results-title">Results</div>
\t\t\t\t\t\t\t<div class="muted">${state.loading ? 'Loading…' : state.issues.length + ' issues'}</div>
\t\t\t\t\t\t</div>
\t\t\t\t\t\t${resultsMarkup}
\t\t\t\t\t\t<div class="parent-picker-results-footer">
\t\t\t\t\t\t\t<button type="button" class="parent-picker-load-more secondary" ${loadMoreDisabledAttr}>Load more</button>
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t</section>
\t\t\t\t<aside class="parent-picker-right">
\t\t\t\t\t<div class="parent-picker-preview" style="min-height: 120px;">
\t\t\t\t\t\t${previewMarkup}
\t\t\t\t\t</div>
\t\t\t\t\t<div class="muted">Preview stays in place so the layout does not jump while you search.</div>
\t\t\t\t</aside>
\t\t\t</div>
\t\t\t<footer class="parent-picker-actions">
\t\t\t\t<div class="parent-picker-actions-left">
\t\t\t\t\t<button type="button" class="parent-picker-cancel secondary">Cancel</button>
\t\t\t\t</div>
\t\t\t\t<div class="parent-picker-actions-right">
\t\t\t\t\t<button type="button" class="parent-picker-confirm primary" ${confirmDisabledAttr}>Use as Parent</button>
\t\t\t\t</div>
\t\t\t</footer>
\t\t</div>
\t</div>
\t<script nonce="${nonce}">
\t\t(function () {
\t\t\tconst vscode = acquireVsCodeApi();
\t\t\tconst shell = document.querySelector('.parent-picker-shell');
\t\t\tconst queryInput = document.querySelector('input[name=\"searchQuery\"]');
\t\t\tconst issueTypeInput = document.querySelector('input[name=\"issueTypeName\"]');
\t\t\tconst statusSelect = document.querySelector('select[name=\"statusName\"]');
\t\t\tconst searchButton = document.querySelector('.parent-picker-search');
\t\t\tconst loadMoreButton = document.querySelector('.parent-picker-load-more');
\t\t\tconst confirmButton = document.querySelector('.parent-picker-confirm');
\t\t\tconst cancelButton = document.querySelector('.parent-picker-cancel');
\t\t\tlet selectedIssueKey = ${JSON.stringify(selectedKey)};

\t\t\tconst getValue = (input) => (input && typeof input.value === 'string' ? input.value : '');
\t\t\tconst buildFilters = () => ({
\t\t\t\tsearchQuery: getValue(queryInput),
\t\t\t\tissueTypeName: getValue(issueTypeInput),
\t\t\t\tstatusName: getValue(statusSelect),
\t\t\t});
\t\t\tconst requestSearch = () => {
\t\t\t\tvscode.postMessage({ type: 'loadParentIssues', filters: buildFilters() });
\t\t\t};
\t\t\tconst requestLoadMore = () => {
\t\t\t\tvscode.postMessage({ type: 'loadMoreParentIssues', filters: buildFilters() });
\t\t\t};
\t\t\tconst setSelectedKey = (key) => {
\t\t\t\tselectedIssueKey = (key || '').trim();
\t\t\t\tvscode.postMessage({ type: 'selectParentIssue', issueKey: selectedIssueKey });
\t\t\t};

\t\t\tif (shell) {
\t\t\t\tshell.addEventListener('click', (event) => {
\t\t\t\t\tconst target = event.target;
\t\t\t\t\tconst button = target && target.closest ? target.closest('[data-parent-issue-key]') : null;
\t\t\t\t\tif (!button) return;
\t\t\t\t\tconst key = button.getAttribute('data-parent-issue-key') || '';
\t\t\t\t\tsetSelectedKey(key);
\t\t\t\t});
\t\t\t}
\t\t\tif (searchButton) {
\t\t\t\tsearchButton.addEventListener('click', requestSearch);
\t\t\t}
\t\t\tif (queryInput) {
\t\t\t\tqueryInput.addEventListener('keydown', (event) => {
\t\t\t\t\tif (event.key === 'Enter') {
\t\t\t\t\t\tevent.preventDefault();
\t\t\t\t\t\trequestSearch();
\t\t\t\t\t}
\t\t\t\t});
\t\t\t}
\t\t\tif (loadMoreButton) {
\t\t\t\tloadMoreButton.addEventListener('click', requestLoadMore);
\t\t\t}
\t\t\tif (confirmButton) {
\t\t\t\tconfirmButton.addEventListener('click', () => {
\t\t\t\t\tvscode.postMessage({ type: 'confirmParentIssue', issueKey: selectedIssueKey });
\t\t\t\t});
\t\t\t}
\t\t\tif (cancelButton) {
\t\t\t\tcancelButton.addEventListener('click', () => {
\t\t\t\t\tvscode.postMessage({ type: 'cancelParentIssue' });
\t\t\t\t});
\t\t\t}
\t\t})();
\t</script>
</body>
</html>`;
	}

	/**
	 * Renders the list of issue results as selectable buttons.
	 */
	private static renderIssueResultsList(issues: JiraIssue[], selectedIssueKey: string): string {
		if (!issues || issues.length === 0) {
			return `<ul class="parent-picker-results-list">
\t\t\t<li class="parent-picker-result">
\t\t\t\t<div class="parent-picker-result-button muted" style="cursor: default;">
\t\t\t\t\t<div class="result-top">
\t\t\t\t\t\t<div class="result-summary">No results yet. Search to load issues.</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="result-meta">Try a key like PROJ-123, or search by text.</div>
\t\t\t\t</div>
\t\t\t</li>
\t\t</ul>`;
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
				return `<li class="parent-picker-result">
\t\t\t\t<button type="button" class="parent-picker-result-button ${selectedClass}" data-parent-issue-key="${HtmlHelper.escapeAttribute(
					key
				)}">
\t\t\t\t\t<div class="result-top">
\t\t\t\t\t\t<div class="result-key">${HtmlHelper.escapeHtml(key)}</div>
\t\t\t\t\t\t<div class="result-summary">${HtmlHelper.escapeHtml(summary)}</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="result-meta">${HtmlHelper.escapeHtml(metaParts.join(' · ') || 'No metadata')}</div>
\t\t\t\t</button>
\t\t\t</li>`;
			})
			.join('');

		return `<ul class="parent-picker-results-list">${listItems}</ul>`;
	}

	/**
	 * Renders a stable preview card for the selected issue.
	 */
	private static renderPreview(issue: JiraIssue | undefined): string {
		if (!issue) {
			return `<div>
\t\t\t<div class="preview-title">Preview</div>
\t\t\t<div class="preview-body">Select an issue from the results to preview it here.</div>
\t\t</div>`;
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

		return `<div>
\t\t\t<div class="preview-title">${HtmlHelper.escapeHtml(issue.key)}</div>
\t\t\t<div class="preview-body">
\t\t\t\t<div><strong>${HtmlHelper.escapeHtml(issue.summary ?? issue.key)}</strong></div>
\t\t\t\t<div class="muted" style="margin-top: 6px;">${HtmlHelper.escapeHtml(meta.join(' · ') || 'No metadata')}</div>
\t\t\t\t${
					issue.url
						? `<div style="margin-top: 10px;"><a href="${HtmlHelper.escapeAttribute(
								issue.url
						  )}" target="_blank" rel="noreferrer noopener">Open in Jira</a></div>`
						: ''
				}
\t\t\t</div>
\t\t</div>`;
	}

	/**
	 * Renders the supported status options, keeping an "All" option to include closed issues by default.
	 */
	private static renderStatusOptions(currentValue: string): string {
		const options = ['', 'To Do', 'In Progress', 'Done', 'Closed'];
		return options
			.map((option) => {
				const label = option ? option : 'All';
				const selectedAttr = option === currentValue ? 'selected' : '';
				return `<option value="${HtmlHelper.escapeAttribute(option)}" ${selectedAttr}>${HtmlHelper.escapeHtml(
					label
				)}</option>`;
			})
			.join('');
	}

	/**
	 * Generates a CSP nonce for the picker webview.
	 */
	private static generateNonce(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		for (let i = 0; i < 32; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return result;
	}
}

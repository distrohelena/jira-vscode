import * as vscode from 'vscode';

import { JiraIssue, JiraNodeKind, JiraProject } from '../../model/types';
import { determineStatusCategory } from '../../model/issueModel';

export class JiraTreeItem extends vscode.TreeItem {
	project?: JiraProject;
	constructor(
		public readonly kind: JiraNodeKind,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		command?: vscode.Command,
		public readonly issue?: JiraIssue,
		public readonly children?: JiraTreeItem[]
	) {
		super(label, collapsibleState);
		this.command = command;
	}
}

export function createIssueTreeItem(issue: JiraIssue): JiraTreeItem {
	const displaySummary = normalizeIssueSummaryForTree(issue.summary);
	const item = new JiraTreeItem(
		'issue',
		`${issue.key} · ${displaySummary}`,
		vscode.TreeItemCollapsibleState.None,
		undefined,
		issue
	);
	item.tooltip = `${issue.summary}\nStatus: ${issue.statusName}\nUpdated: ${new Date(issue.updated).toLocaleString()}`;
	contextualizeIssue(item, issue);
	return item;
}

export function contextualizeIssue(item: JiraTreeItem, issue: JiraIssue) {
	item.contextValue = 'jiraIssue';
	item.description = formatIssueDateForTree(issue.updated);
	item.iconPath = deriveIssueIcon(issue.statusName);
	if (issue.key) {
		item.command = {
			command: 'jira.openIssueDetails',
			title: 'Open Issue Details',
			arguments: [issue],
		};
	}
}

export function deriveIssueIcon(statusName?: string): vscode.ThemeIcon {
	const category = determineStatusCategory(statusName);
	switch (category) {
		case 'done':
			return new vscode.ThemeIcon('pass');
		case 'inProgress':
			return new vscode.ThemeIcon('sync');
		case 'open':
			return new vscode.ThemeIcon('circle-outline');
		default:
			return new vscode.ThemeIcon('issues');
	}
}

function normalizeIssueSummaryForTree(summary: string | undefined): string {
	if (!summary) {
		return 'Untitled';
	}
	const withoutControls = summary.replace(/[\u0000-\u001F\u007F]/g, ' ');
	const collapsed = withoutControls.replace(/\s+/g, ' ').trim();
	return collapsed.length > 0 ? collapsed : 'Untitled';
}

function formatIssueDateForTree(updated: string | undefined): string {
	if (!updated) {
		return 'Unknown date';
	}
	const timestamp = Date.parse(updated);
	if (Number.isNaN(timestamp)) {
		return updated;
	}
	return new Date(timestamp).toLocaleString();
}

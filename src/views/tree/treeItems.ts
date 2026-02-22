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
	const displayKey = normalizeIssueKeyForTree(issue.key);
	const displaySummary = normalizeIssueSummaryForTree(issue.summary);
	const item = new JiraTreeItem(
		'issue',
		`${displayKey} · ${displaySummary}`,
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
	const iconName = 'circle-filled';
	switch (category) {
		case 'done':
			return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('testing.iconPassed'));
		case 'inProgress':
			return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('testing.iconQueued'));
		case 'open':
			return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('testing.iconUnset'));
		default:
			return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('icon.foreground'));
	}
}

function normalizeIssueSummaryForTree(summary: string | undefined): string {
	if (!summary) {
		return 'Untitled';
	}
	const withoutControls = summary.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
	const withoutDirectionalMarks = withoutControls.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
	const collapsed = withoutDirectionalMarks
		.replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ' ')
		.trim();
	return collapsed.length > 0 ? collapsed : 'Untitled';
}

function normalizeIssueKeyForTree(key: string | undefined): string {
	if (!key) {
		return 'UNKNOWN';
	}
	const withoutControls = key.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
	const withoutDirectionalMarks = withoutControls.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
	const trimmed = withoutDirectionalMarks.trim();
	return trimmed.length > 0 ? trimmed : key;
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
